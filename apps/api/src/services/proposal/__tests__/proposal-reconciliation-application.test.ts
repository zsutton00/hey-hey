import { ConflictException } from '@nestjs/common';
import type { Proposal } from '@prisma/client';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { ProposalReconciliationBasis } from 'src/generated';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { projectReconciliationContent } from '../proposal-reconciliation-content';

const original: ProposalReconciliationBasis = {
  entityType: 'TASK',
  entityId: 'target',
  version: 'first',
  content: {
    name: 'Original',
    sections: { description: 'Keep this', notes: 'Notes' },
    sectionOrder: { description: 0, notes: 1 },
  },
};
const proposal = {
  id: 'proposal',
  action: 'UPDATE',
  targetEntityType: 'TASK',
  targetEntityId: 'target',
  updates: { name: 'Renamed' },
  title: 'Rename',
  eli5: null,
} as unknown as Proposal;

function fixture() {
  let current = structuredClone(original);
  const adapter = { task: jest.fn(async () => structuredClone(current)) };
  const revision = {
    id: 'revision',
    proposalId: proposal.id,
    previousRevisionId: null,
    source: 'AUTHORING',
    bases: [structuredClone(original)],
    proposedResult: projectReconciliationContent(
      original.content,
      proposal.updates as object,
    ),
    intent: 'Rename',
    createdAt: new Date(),
  };
  let receipt: {
    basis: ProposalReconciliationBasis;
    operationIndexes: number[];
  } | null = null;
  const db = {
    workItemChangeSetMaterialization: { findUnique: jest.fn(async () => null) },
    proposalGroupMember: { findUnique: jest.fn(async () => null) },
    proposalReconciliationRevision: {
      findFirst: jest.fn(async () => revision),
      findMany: jest.fn(async () => [revision]),
      create: jest.fn(async ({ data }) => ({ id: 'new-revision', ...data })),
    },
    proposalReconciliationReplacement: { findFirst: jest.fn(async () => null) },
    proposalApprovalRecord: { deleteMany: jest.fn() },
    proposalReconciliationEffect: {
      findMany: jest.fn(async () =>
        receipt ? [{ ...receipt, entityType: 'TASK', entityId: 'target' }] : [],
      ),
      findUnique: jest.fn(async () => receipt),
      upsert: jest.fn(async ({ create, update }) => {
        receipt = receipt
          ? {
              basis: update.basis,
              operationIndexes: [
                ...receipt.operationIndexes,
                update.operationIndexes.push,
              ],
            }
          : create;
      }),
    },
  };
  const tx = db as unknown as AnyTransactionClient;
  const owner = new ProposalReconciliationService(
    adapter as never,
    {} as never,
    jest.fn(),
  );
  return {
    owner,
    tx,
    db,
    revision,
    getCurrent: () => current,
    change: (
      content: ProposalReconciliationBasis['content'],
      version: string,
    ) => {
      current = { ...original, content, version };
    },
  };
}

describe('reviewed reconciliation application', () => {
  it('uses completed-effect receipts for retry classification without refreshing the original revision', async () => {
    const f = fixture();
    f.db.workItemChangeSetMaterialization.findUnique.mockResolvedValue({
      id: 'intent',
      status: 'FAILED',
      operationSet: { operations: [] },
      relationshipIdMappings: {},
    } as never);
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'intent',
      'target',
      0,
      false,
      async () => {
        f.change({ ...original.content, name: 'Renamed' }, 'own-effect');
      },
    );
    expect((await f.owner.state(f.tx, proposal)).status).toBe('CURRENT');
    expect(f.revision.bases).toEqual([original]);
    f.change({ ...f.getCurrent().content, name: 'External edit' }, 'external');
    expect((await f.owner.state(f.tx, proposal)).status).toBe(
      'RECONCILIATION_REQUIRED',
    );
  });

  it('does not make reserved references stale when finalization updates proposal metadata', async () => {
    const f = fixture();
    f.db.proposalGroupMember.findUnique.mockResolvedValue({
      groupId: 'group',
    } as never);
    const creator = {
      proposalId: 'creator',
      executionState: 'PENDING_APPROVAL',
      proposal: {
        createdAt: new Date('2026-09-28T00:00:00Z'),
        updatedAt: new Date('2026-09-28T00:00:00Z'),
        updates: { name: 'Reserved' },
      },
    };
    Object.assign(f.db.proposalGroupMember, {
      findFirst: jest.fn(async () => creator),
    });
    const before = await f.owner.currentBases(f.tx, proposal);
    creator.proposal.updatedAt = new Date('2026-09-28T01:00:00Z');
    expect(await f.owner.currentBases(f.tx, proposal)).toEqual(before);
  });

  it('expands a patch without deleting omitted fields or sections', () => {
    expect(
      projectReconciliationContent(original.content, { name: 'Renamed' }),
    ).toEqual({ ...original.content, name: 'Renamed' });
  });

  it('accepts an unchanged authored proposal and rejects drift irrespective of acknowledgement', async () => {
    const f = fixture();
    await expect(
      f.owner.assertApplicable(f.tx, proposal),
    ).resolves.toBeUndefined();
    f.change({ ...original.content, name: 'Someone else' }, 'second');
    await expect(
      f.owner.assertApplicable(f.tx, {
        ...proposal,
        updates: {
          ...(proposal.updates as object),
          acknowledgeOutOfDate: true,
        },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('requires Agent fix when the original basis is unavailable', async () => {
    const f = fixture();
    f.db.proposalReconciliationRevision.findFirst.mockResolvedValueOnce(
      null as never,
    );
    await expect(f.owner.assertApplicable(f.tx, proposal)).rejects.toThrow(
      'Original proposal content is unavailable',
    );
  });

  it('binds reconciliation review to the exact candidate while allowing an unchanged application retry', async () => {
    const f = fixture();
    f.revision.source = 'MERGE';
    await expect(
      f.owner.assertApplicable(f.tx, proposal, undefined, true),
    ).rejects.toThrow('identify the reconciled revision');
    await expect(
      f.owner.assertApplicable(f.tx, proposal, 'another', true),
    ).rejects.toThrow('displayed proposal revision');
    await expect(
      f.owner.assertApplicable(f.tx, proposal, 'revision', true),
    ).resolves.toBeUndefined();
    await expect(
      f.owner.assertApplicable(f.tx, proposal),
    ).resolves.toBeUndefined();
  });

  it('preserves intervening work during Merge and rejects further drift after review', async () => {
    const f = fixture();
    f.change(
      {
        ...original.content,
        sections: { description: 'Keep this', notes: 'New notes' },
      },
      'second',
    );
    const state = await f.owner.state(f.tx, proposal);
    expect(state.status).toBe('RECONCILIATION_REQUIRED');
    expect(f.owner.prepareMerge(proposal, state)).toEqual({
      kind: 'MERGED',
      updates: { name: 'Renamed' },
    });
    f.revision.bases = [structuredClone(f.getCurrent())];
    f.revision.source = 'MERGE';
    f.change({ ...f.getCurrent().content, name: 'Changed again' }, 'third');
    await expect(
      f.owner.assertApplicable(f.tx, proposal, 'revision', true),
    ).rejects.toThrow(ConflictException);
  });

  it('retains the original basis on edits and invalidates earlier votes', async () => {
    const f = fixture();
    f.change({ ...original.content, name: 'Intervening' }, 'second');
    await f.owner.captureAuthoring(f.tx, {
      ...proposal,
      updates: { name: 'Edited proposal' },
    });
    expect(f.db.proposalReconciliationRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bases: [original] }),
      }),
    );
    expect(f.db.proposalApprovalRecord.deleteMany).toHaveBeenCalledWith({
      where: { proposalId: proposal.id },
    });
  });

  it('records its own effect, skips replay, and rejects a later external write', async () => {
    const f = fixture();
    const write = jest.fn(async () => {
      f.change({ ...original.content, name: 'Renamed' }, 'second');
    });
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'materialization',
      'target',
      0,
      false,
      write,
    );
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'materialization',
      'target',
      0,
      false,
      write,
    );
    expect(write).toHaveBeenCalledTimes(1);
    const next = jest.fn(async () => {
      f.change(
        {
          ...f.getCurrent().content,
          sections: { description: 'Own second effect' },
        },
        'third',
      );
    });
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'materialization',
      'target',
      1,
      false,
      next,
    );
    f.change({ ...f.getCurrent().content, name: 'External' }, 'fourth');
    await expect(
      f.owner.guardTaskEffect(
        f.tx,
        proposal,
        'materialization',
        'target',
        2,
        false,
        write,
      ),
    ).rejects.toThrow(ConflictException);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
