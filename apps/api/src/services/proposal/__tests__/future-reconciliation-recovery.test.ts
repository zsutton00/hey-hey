import { ConflictException } from '@nestjs/common';
import type { Proposal } from '@prisma/client';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import * as futures from '../future-revision';
import type { OrganizationId, ProjectId } from 'src/types';
import { ProposalService } from '../proposal.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';

const target = {
  id: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  projectId: '10000000-0000-4000-8000-000000000003',
  type: 'FEATURE',
  name: 'Original',
  status: 'BACKLOG',
  source: 'user',
  sections: [],
};
const futureProposal = {
  id: 'origin',
  organizationId: 'org',
  projectId: 'project',
  status: 'APPROVED',
  action: 'VERSIONED_UPDATE',
  targetEntityId: 'target',
  targetEntityType: 'TASK',
  createdAt: new Date(),
  updatedAt: new Date(),
  updates: {
    operation: 'REVISE',
    futureId: '10000000-0000-4000-8000-000000000004',
    expectedRevision: 0,
    baseline: { kind: 'LIVE', revision: 'v1', content: target },
    result: { ...target, name: 'Proposed' },
    dependencies: [],
  },
} as unknown as Proposal;

function fixture(outcome = 'STAGED') {
  const basis = {
    entityType: 'TASK',
    entityId: 'target',
    version: 'v2',
    content: { ...target, name: 'Current', sections: {}, sectionOrder: {} },
  };
  const row = {
    id: 'revision',
    proposalId: 'origin',
    source: 'AUTHORING',
    previousRevisionId: null,
    bases: [basis],
    proposedResult: target,
    intent: 'Rename',
    createdAt: new Date(),
  };
  const tx = {
    proposalGroupMember: { findUnique: jest.fn().mockResolvedValue(null) },
    proposalFuture: {
      findFirst: jest.fn().mockResolvedValue({
        outcome,
        revision: 2,
        latestProposalId: 'latest',
      }),
    },
    proposal: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest
        .fn()
        .mockResolvedValue({ ...futureProposal, id: 'latest' }),
    },
    proposalReconciliationRevision: {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]),
    },
    proposalReconciliationReplacement: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    workItemChangeSetMaterialization: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const owner = new ProposalReconciliationService(
    {
      task: jest.fn().mockResolvedValue(basis),
      currentFutureContent: jest.fn().mockResolvedValue(target),
      futureContentBasis: jest.fn().mockImplementation((_type, content) => ({
        ...content,
        sections: {},
        sectionOrder: {},
      })),
      currentFutureBasisContent: jest
        .fn()
        .mockImplementation((_type, current) => current.content),
    } as never,
    {} as never,
    jest.fn(),
  );
  const service = Object.create(ProposalService.prototype) as ProposalService;
  Object.assign(service, {
    prisma: { db: tx },
    logger: { debug: jest.fn(), warn: jest.fn() },
  });
  return { tx, owner, service };
}

describe('approved future reconciliation recovery', () => {
  it('keeps recovery and readable overlaps available after approval', async () => {
    const { tx, owner } = fixture();
    const mutation = futureProposal.updates as { baseline: never };
    const state = await owner.stateForFuture(
      tx as unknown as AnyTransactionClient,
      futureProposal,
      mutation.baseline,
    );
    expect(state.status).toBe('RECONCILIATION_REQUIRED');
    expect(state.futureRevision).toBe(2);
    expect(state.currentBases).toHaveLength(1);
    expect(state.overlaps).toEqual([
      expect.objectContaining({
        path: 'name',
        currentValue: 'Current',
        proposedValue: 'Proposed',
      }),
    ]);
  });
  it.each(['APPLIED', 'CANCELLED'])(
    'leaves %s futures terminal',
    async (outcome) => {
      const { tx, owner } = fixture(outcome);
      expect(
        (
          await owner.state(
            tx as unknown as AnyTransactionClient,
            futureProposal,
          )
        ).status,
      ).toBe('NOT_APPLICABLE');
      expect(tx.proposalReconciliationRevision.findMany).not.toHaveBeenCalled();
    },
  );
  it('lets guarded future application use its reviewed basis without permanent replacement bookkeeping', async () => {
    const { tx, owner } = fixture();
    await expect(
      owner.assertApplicable(
        tx as unknown as AnyTransactionClient,
        futureProposal,
      ),
    ).resolves.toBeUndefined();
    expect(
      tx.proposalReconciliationReplacement.findFirst,
    ).not.toHaveBeenCalled();
  });
  it('resolves an old approved link to the latest stored review', async () => {
    const { service, tx } = fixture();
    expect(
      (await service.currentReconciliationProposal(futureProposal)).id,
    ).toBe('latest');
    expect(tx.proposal.findFirst).toHaveBeenCalledWith({
      where: { id: 'latest', organizationId: 'org', projectId: 'project' },
    });
  });
  it.each(['MANUAL', 'AGENT_FIX'] as const)(
    'stages %s as a same-future refinement and rejects a newer future revision',
    async (method) => {
      const { service, tx, owner } = fixture();
      const state = await owner.stateForFuture(
        tx as unknown as AnyTransactionClient,
        futureProposal,
        (futureProposal.updates as { baseline: never }).baseline,
      );
      Object.assign(service, {
        reconciliation: owner,
        workItemTypeRegistry: {},
        prisma: {
          db: {
            ...tx,
            $transaction: async (run: (db: typeof tx) => unknown) => run(tx),
          },
        },
      });
      jest.spyOn(service, 'reconciliationState').mockResolvedValue(state);
      const create = jest
        .spyOn(service, 'create')
        .mockResolvedValue({ id: 'candidate' } as never);
      jest
        .spyOn(owner, 'currentFutureContent')
        .mockResolvedValue({ ...target, name: 'Current' } as never);
      const dependency = {
        edgeType: 'DEPENDS_ON',
        targetEntityType: 'TASK',
        targetEntityId: '10000000-0000-4000-8000-000000000005',
      };
      const stored = {
        id: '10000000-0000-4000-8000-000000000004',
        revision: 2,
        outcome: 'STAGED',
        latestProposalId: 'latest',
        dependencies: [dependency],
      };
      const read = jest
        .spyOn(futures, 'readFutureRevision')
        .mockResolvedValue(stored as never);
      const input = {
        method,
        proposedResult: { ...target, name: 'Resolved' },
        expectedCurrentBases: state.currentBases,
        expectedFutureRevision: 2,
      };
      const submit = () =>
        service.reconcile(
          'origin',
          'org' as OrganizationId,
          'project' as ProjectId,
          { userId: 'user' } as never,
          input,
          {} as never,
        );
      try {
        expect(await submit()).toMatchObject({
          replacementProposalId: 'candidate',
        });
        expect(create).toHaveBeenCalledWith(
          'org',
          'project',
          'user',
          expect.objectContaining({
            action: 'VERSIONED_UPDATE',
            updates: expect.objectContaining({
              futureId: stored.id,
              expectedRevision: 2,
              result: input.proposedResult,
              dependencies: [dependency],
              baseline: expect.objectContaining({ kind: 'LIVE' }),
            }),
          }),
          expect.objectContaining({ source: method }),
        );
        create.mockClear();
        read.mockResolvedValue({ ...stored, revision: 3 } as never);
        await expect(submit()).rejects.toThrow('future revision changed');
        expect(create).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    },
  );
  it('blocks an unavailable latest review rather than substituting the old result', async () => {
    const { service, tx } = fixture();
    tx.proposal.findFirst.mockResolvedValue(null as never);
    await expect(
      service.currentReconciliationProposal(futureProposal),
    ).rejects.toThrow(ConflictException);
  });
});
