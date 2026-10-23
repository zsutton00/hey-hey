import { ConflictException } from '@nestjs/common';
import {
  ProposalReconciliationGroupService,
  lockReconciliationReplacement,
} from '../proposal-reconciliation-group.service';
import { projectReconciliationChangeSet } from '../proposal-reconciliation-content';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';

const create = {
  op: 'workItem.create',
  ref: { refType: 'temporary', tempId: 'child' },
  name: 'Child',
  type: 'STANDARD',
};
const update = {
  op: 'workItem.update',
  ref: { refType: 'temporary', tempId: 'child' },
  name: 'Reviewed name',
};
function fixture(receiptIndexes: number[] = []) {
  const db = {
    proposalReconciliationEffect: {
      findMany: jest.fn(async () => [{ operationIndexes: receiptIndexes }]),
    },
  };
  const service = new ProposalReconciliationGroupService(
    { db } as never,
    {} as never,
  );
  const materialization = {
    id: 'intent',
    operationSet: { operations: [create, update] },
    rootWorkItemId: 'created-child',
    workItemIdMappings: { 'temporary:child': 'created-child' },
    relationshipIdMappings: {},
    checkpoints: [
      { operationIndex: 0, status: 'FAILED' },
      { operationIndex: 1, status: 'PENDING' },
    ],
  };
  return { service, materialization };
}

describe('reconciliation replacement integrity', () => {
  it('preserves a relationship created before its Graph response was lost', async () => {
    const edgeBasis = jest.fn(async () => ({ version: 'created-version' }));
    const service = new ProposalReconciliationGroupService(
      {
        db: {
          proposalReconciliationEffect: { findMany: jest.fn(async () => []) },
        },
      } as never,
      { get: jest.fn(() => ({ edgeBasis })) } as never,
    );
    const createEdge = {
      op: 'relationship.create',
      ref: { refType: 'temporary', tempId: 'edge' },
      source: { refType: 'existing', id: 'source' },
      target: { refType: 'existing', id: 'target' },
      edgeType: 'RELATED_TO',
    };
    const updateEdge = {
      op: 'relationship.update',
      ref: { refType: 'temporary', tempId: 'edge' },
      reasoning: 'Reviewed reason',
    };
    const materialization = {
      ...fixture().materialization,
      operationSet: { operations: [createEdge, updateEdge] },
      relationshipIdMappings: { 'temporary:edge': 'created-edge' },
    };
    const result = await service.remainingCandidate(
      {} as never,
      { operations: [createEdge, updateEdge] },
      materialization as never,
    );
    expect(result.hasCompletedEffects).toBe(true);
    expect(result.updates).toEqual({
      operations: [
        { ...updateEdge, ref: { refType: 'existing', id: 'created-edge' } },
      ],
    });
    expect(edgeBasis).toHaveBeenCalledWith({}, 'created-edge');
  });

  it('preserves an entity committed before its checkpoint acknowledgement and does not recreate it', async () => {
    const f = fixture([0]);
    const result = await f.service.remainingCandidate(
      { targetEntityId: 'reserved' } as never,
      { operations: [create, update] },
      f.materialization as never,
    );
    expect(result).toEqual({
      hasCompletedEffects: true,
      targetEntityId: 'created-child',
      updates: {
        operations: [
          { ...update, ref: { refType: 'existing', id: 'created-child' } },
        ],
      },
    });
  });

  it('refuses a changed completed operation even when its checkpoint acknowledgement was lost', async () => {
    const f = fixture([0]);
    await expect(
      f.service.remainingCandidate(
        {} as never,
        { operations: [{ ...create, name: 'Different creation' }, update] },
        f.materialization as never,
      ),
    ).rejects.toThrow('Completed operations are immutable');
  });

  it('does not treat merely failed work without an effect receipt as completed', async () => {
    const f = fixture();
    const updates = { operations: [create, update] };
    expect(
      await f.service.remainingCandidate(
        {} as never,
        updates,
        f.materialization as never,
      ),
    ).toEqual({
      updates,
      hasCompletedEffects: false,
      targetEntityId: 'created-child',
    });
  });

  it('refuses to freeze a replacement when the original group advanced', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      proposalReconciliationReplacement: {
        findFirst: jest.fn(async () => ({
          groupId: 'original',
          sourceState: [
            {
              id: 'member',
              executionState: 'READY',
              updatedAt: '2026-09-28T00:00:00.000Z',
            },
          ],
        })),
      },
      proposalGroupMember: {
        findMany: jest.fn(async () => [
          {
            id: 'member',
            executionState: 'APPLIED',
            updatedAt: new Date('2026-09-28T00:01:00Z'),
          },
        ]),
      },
    } as unknown as AnyTransactionClient;
    await expect(
      lockReconciliationReplacement(tx, 'replacement'),
    ).rejects.toThrow(ConflictException);
  });

  it('compares the complete relationship result using the same fields as the current provider content', () => {
    const result = projectReconciliationChangeSet(
      [
        {
          entityType: 'EDGE',
          entityId: 'edge',
          version: 'v1',
          content: {
            sourceNodeId: 'first',
            targetNodeId: 'second',
            type: 'RELATED_TO',
            reasoning: 'Keep',
          },
        },
      ],
      {
        operations: [
          {
            op: 'relationship.update',
            ref: { refType: 'existing', id: 'edge' },
            target: { refType: 'existing', id: 'third' },
            edgeType: 'DEPENDS_ON',
          },
        ],
      } as never,
    );
    expect(result).toEqual({
      'EDGE:edge': {
        sourceNodeId: 'first',
        targetNodeId: 'third',
        type: 'DEPENDS_ON',
        reasoning: 'Keep',
      },
    });
  });
});
