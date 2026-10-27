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
    $queryRaw: jest.fn(),
    proposalReconciliationSuggestion: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    proposalGroupMember: { findUnique: jest.fn().mockResolvedValue(null) },
    proposalFuture: {
      findFirst: jest.fn().mockResolvedValue({
        outcome,
        revision: 2,
        latestProposalId: 'latest',
      }),
    },
    proposal: {
      update: jest.fn(async ({ data }) => ({
        ...futureProposal,
        id: 'latest',
        ...data,
      })),
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
    logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn() },
  });
  return { tx, owner, service };
}

describe('approved future reconciliation recovery', () => {
  it('ignores metadata-only future drift but still requires reconciliation for section changes', async () => {
    const { tx, owner } = fixture();
    const reviewed = {
      entityType: 'TASK' as const,
      entityId: 'target',
      version: 'v1',
      content: {
        name: 'Original',
        sections: {},
        priority: 'LOW',
        parentTaskId: 'old-parent',
        sectionOrder: {},
      },
    };
    const current = {
      ...reviewed,
      version: 'v2',
      content: {
        ...reviewed.content,
        priority: 'HIGH',
        parentTaskId: 'new-parent',
        sectionOrder: { description: 1 },
      },
    };
    const adapter = (owner as any).adapter;
    adapter.task.mockResolvedValue(current);
    const baseline = (futureProposal.updates as any).baseline;
    await expect(
      owner.futureBaselineChanged(
        tx as never,
        {
          organizationId: 'org',
          projectId: 'project',
          targetEntityType: 'TASK',
          targetEntityId: 'target',
        },
        baseline,
      ),
    ).resolves.toBe(false);
    expect(() =>
      owner.assertFutureReviewedBasisCurrent([reviewed], [current], 'TASK'),
    ).not.toThrow();
    current.content.sections = { description: 'New content' };
    await expect(
      owner.futureBaselineChanged(
        tx as never,
        {
          organizationId: 'org',
          projectId: 'project',
          targetEntityType: 'TASK',
          targetEntityId: 'target',
        },
        baseline,
      ),
    ).resolves.toBe(true);
    expect(() =>
      owner.assertFutureReviewedBasisCurrent([reviewed], [current], 'TASK'),
    ).toThrow(ConflictException);
  });

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
  it('retains suggestion comparisons after application without reopening reconciliation', async () => {
    const { tx, owner } = fixture('APPLIED');
    tx.proposalReconciliationSuggestion.findMany.mockResolvedValue([
      {
        id: 'saved-suggestion',
        candidateRevisionId: 'revision',
        status: 'ACCEPTED',
        createdAt: new Date(),
        request: {
          method: 'AGENT_FIX',
          proposedResult: target,
          expectedCurrentBases: [],
        },
      },
    ] as never);
    const state = await owner.stateForFuture(
      tx as never,
      futureProposal,
      (futureProposal.updates as { baseline: never }).baseline,
    );
    expect(state.status).toBe('NOT_APPLICABLE');
    expect(state.revisions).toHaveLength(1);
    expect(state.suggestions).toEqual([
      expect.objectContaining({ status: 'ACCEPTED', proposedResult: target }),
    ]);
  });
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
  it('saves manual reconciliation on the same proposal and rejects a newer future revision', async () => {
    const method = 'MANUAL' as const;
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
    tx.proposal.findFirst.mockResolvedValue({
      ...futureProposal,
      id: 'latest',
      updates: {
        ...futures.parseFutureRevisionMutation(futureProposal.updates),
        dependencies: [dependency],
      },
    } as never);
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
    jest
      .spyOn(futures, 'validateFutureRevision')
      .mockImplementation(
        async (_tx, _registry, proposal) => proposal.updates as never,
      );
    const capture = jest.spyOn(owner, 'captureAuthoring').mockResolvedValue();
    const input = {
      method,
      expectedCandidateRevisionId: state.candidateRevisionId,
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
      await submit();
      expect(create).not.toHaveBeenCalled();
      expect(tx.proposal.update).toHaveBeenCalledWith({
        where: { id: 'latest' },
        data: {
          status: 'DRAFT',
          updates: expect.objectContaining({
            futureId: stored.id,
            expectedRevision: 2,
            result: input.proposedResult,
            dependencies: [dependency],
          }),
        },
      });
      expect(capture).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ id: 'latest', status: 'DRAFT' }),
        expect.objectContaining({ source: 'MANUAL' }),
      );
      create.mockClear();
      read.mockResolvedValue({ ...stored, revision: 3 } as never);
      await expect(submit()).rejects.toThrow('future revision changed');
      expect(create).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
  it('records an agent suggestion in its conversation without changing proposal content or approvals', async () => {
    const { service, tx, owner } = fixture();
    const state = await owner.stateForFuture(
      tx as unknown as AnyTransactionClient,
      futureProposal,
      (futureProposal.updates as { baseline: never }).baseline,
    );
    const candidate = { ...target, name: 'Suggested' };
    const createSuggestion = jest.fn().mockResolvedValue({
      id: 'suggestion',
      candidateRevisionId: 'revision',
      createdAt: new Date(),
    });
    const addMessage = jest.fn().mockResolvedValue({ id: 'message' });
    Object.assign(tx, {
      agentSession: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ conversationId: 'conversation' }),
      },
      proposalReconciliationSuggestion: {
        ...tx.proposalReconciliationSuggestion,
        create: createSuggestion,
        update: jest.fn(),
      },
    });
    Object.assign(tx.proposal, {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...futureProposal, id: 'latest' }),
    });
    Object.assign(service, {
      prisma: {
        db: {
          ...tx,
          $transaction: async (run: (db: typeof tx) => unknown) => run(tx),
        },
      },
      reconciliation: owner,
      workItemTypeRegistry: {},
      messages: { addMessageInTransaction: addMessage },
    });
    jest.spyOn(service, 'reconciliationState').mockResolvedValue(state);
    jest
      .spyOn(owner, 'currentFutureContent')
      .mockResolvedValue(target as never);
    const validate = jest
      .spyOn(futures, 'validateFutureRevision')
      .mockImplementation(
        async (_tx, _registry, proposal) => proposal.updates as never,
      );
    try {
      await service.reconcile(
        'origin',
        'org' as OrganizationId,
        'project' as ProjectId,
        { userId: 'user' } as never,
        {
          method: 'AGENT_FIX',
          proposedResult: candidate,
          expectedCurrentBases: state.currentBases,
          expectedCandidateRevisionId: state.candidateRevisionId,
          expectedFutureRevision: 2,
        },
        {} as never,
        'session',
      );
      expect(createSuggestion).toHaveBeenCalledWith({
        data: expect.objectContaining({
          proposalId: 'latest',
          agentSessionId: 'session',
          candidateRevisionId: 'revision',
        }),
      });
      expect(addMessage).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          conversationId: 'conversation',
          data: expect.objectContaining({
            proposalSuggestion: expect.objectContaining({
              proposedResult: candidate,
              status: 'PENDING',
            }),
          }),
        }),
        'org',
        'proposal-reconciliation-suggestion',
      );
      expect(tx.proposal.update).not.toHaveBeenCalled();
      expect(
        tx.proposalReconciliationReplacement.create,
      ).not.toHaveBeenCalled();
    } finally {
      validate.mockRestore();
    }
  });
  it.each(['ACCEPT_SUGGESTION', 'REJECT_SUGGESTION'] as const)(
    '%s preserves the separate proposal approval boundary',
    async (method) => {
      const { service, tx, owner } = fixture();
      const version = '10000000-0000-4000-8000-000000000010';
      const state = {
        ...(await owner.stateForFuture(
          tx as unknown as AnyTransactionClient,
          futureProposal,
          (futureProposal.updates as { baseline: never }).baseline,
        )),
        candidateRevisionId: version,
      };
      const suggestion = {
        id: 'saved-suggestion',
        proposalId: 'latest',
        status: 'PENDING',
        request: {
          method: 'AGENT_FIX',
          expectedCandidateRevisionId: version,
          expectedFutureRevision: 2,
          expectedCurrentBases: state.currentBases,
          proposedResult: { ...target, name: 'Accepted suggestion' },
        },
      };
      const updateSuggestion = jest.fn();
      Object.assign(tx.proposalReconciliationSuggestion, {
        findFirst: jest.fn().mockResolvedValue(suggestion),
        findUniqueOrThrow: jest.fn().mockResolvedValue(suggestion),
        update: updateSuggestion,
      });
      Object.assign(service, {
        prisma: {
          db: {
            ...tx,
            $transaction: async (run: (db: typeof tx) => unknown) => run(tx),
          },
        },
        reconciliation: owner,
        workItemTypeRegistry: {},
      });
      jest.spyOn(service, 'reconciliationState').mockResolvedValue(state);
      jest.spyOn(owner, 'stateForFuture').mockResolvedValue(state);
      jest
        .spyOn(owner, 'currentFutureContent')
        .mockResolvedValue(target as never);
      const capture = jest.spyOn(owner, 'captureAuthoring').mockResolvedValue();
      const validate = jest
        .spyOn(futures, 'validateFutureRevision')
        .mockImplementation(
          async (_tx, _registry, proposal) => proposal.updates as never,
        );
      const read = jest.spyOn(futures, 'readFutureRevision').mockResolvedValue({
        id: '10000000-0000-4000-8000-000000000004',
        revision: 2,
        outcome: 'STAGED',
        latestProposalId: 'latest',
        dependencies: [],
      } as never);
      try {
        await service.reconcile(
          'latest',
          'org' as OrganizationId,
          'project' as ProjectId,
          { userId: 'user' } as never,
          { method, suggestionId: suggestion.id },
          {} as never,
        );
        if (method === 'ACCEPT_SUGGESTION') {
          expect(tx.proposal.update).toHaveBeenCalledWith({
            where: { id: 'latest' },
            data: expect.objectContaining({
              status: 'DRAFT',
              updates: expect.objectContaining({
                result: suggestion.request.proposedResult,
              }),
            }),
          });
          expect(capture).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({ status: 'DRAFT' }),
            expect.objectContaining({ source: 'AGENT_FIX' }),
          );
          expect(updateSuggestion).toHaveBeenCalledWith({
            where: { id: suggestion.id },
            data: { status: 'ACCEPTED' },
          });
        } else {
          expect(tx.proposal.update).not.toHaveBeenCalled();
          expect(capture).not.toHaveBeenCalled();
          expect(
            tx.proposalReconciliationSuggestion.updateMany,
          ).toHaveBeenCalledWith({
            where: { id: suggestion.id, status: 'PENDING' },
            data: { status: 'REJECTED' },
          });
        }
        expect(
          tx.proposalReconciliationReplacement.create,
        ).not.toHaveBeenCalled();
      } finally {
        validate.mockRestore();
        read.mockRestore();
      }
    },
  );
  it('returns a stored RETIRED suggestion as retired rather than out of date', async () => {
    const { tx, owner } = fixture();
    tx.proposalReconciliationSuggestion.findMany.mockResolvedValue([
      {
        id: 'retired-suggestion',
        candidateRevisionId: 'older-revision',
        legacyProposalId: 'old-correction',
        status: 'RETIRED',
        createdAt: new Date(),
        request: {
          method: 'AGENT_FIX',
          proposedResult: target,
          expectedCurrentBases: [],
        },
      },
    ] as never);
    const state = await owner.stateForFuture(
      tx as never,
      futureProposal,
      (futureProposal.updates as { baseline: never }).baseline,
    );
    expect(state.suggestions).toEqual([
      expect.objectContaining({
        status: 'RETIRED',
        legacyProposalId: 'old-correction',
      }),
    ]);
  });
  it.each(['ACCEPT_SUGGESTION', 'REJECT_SUGGESTION'] as const)(
    '%s refuses a retired suggestion migrated from a standalone correction',
    async (method) => {
      const { service, tx } = fixture();
      const retired = {
        id: 'retired-suggestion',
        proposalId: 'latest',
        status: 'RETIRED',
        legacyProposalId: 'old-correction',
        request: {},
      };
      Object.assign(tx.proposalReconciliationSuggestion, {
        findFirst: jest.fn().mockResolvedValue(retired),
      });
      Object.assign(service, {
        prisma: { db: { ...tx, $transaction: jest.fn() } },
      });
      tx.proposal.findFirst.mockResolvedValue(futureProposal as never);
      await expect(
        service.reconcile(
          'latest',
          'org' as OrganizationId,
          'project' as ProjectId,
          { userId: 'user' } as never,
          { method, suggestionId: retired.id },
          {} as never,
        ),
      ).rejects.toThrow('retired and kept only in history');
      expect(tx.proposal.update).not.toHaveBeenCalled();
      expect(
        tx.proposalReconciliationSuggestion.updateMany,
      ).not.toHaveBeenCalled();
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
