import { ProposalService } from '../proposal.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import type { ProposalReconciliationState } from 'src/generated';
import type { OrganizationId, ProjectId } from 'src/types';

const basis = {
  entityType: 'TASK' as const,
  entityId: 'target',
  version: 'v2',
  content: {
    name: 'Original',
    priority: 'HIGH',
    sections: {},
    sectionOrder: {},
  },
};
const authored = {
  id: 'authoring',
  proposalId: 'proposal',
  source: 'AUTHORING' as const,
  bases: [
    { ...basis, version: 'v1', content: { ...basis.content, priority: 'LOW' } },
  ],
  proposedResult: { ...basis.content, name: 'Proposed', priority: 'LOW' },
  intent: 'Rename',
  createdAt: '2026-10-23T00:00:00Z',
};
const stale: ProposalReconciliationState = {
  status: 'RECONCILIATION_REQUIRED',
  currentBases: [basis],
  revisions: [authored],
  candidateRevisionId: authored.id,
  conflictingPaths: [],
  overlaps: [],
  interveningProposals: [],
};

function setup(state = stale, overrides = {}) {
  const proposal = {
    id: 'proposal',
    eli5: 'Rename',
    action: 'UPDATE',
    status: 'DRAFT',
    updates: { name: 'Proposed' },
    groupMembership: null,
    ...overrides,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'proposal' }]),
    proposal: {
      findFirst: jest.fn().mockResolvedValue(proposal),
      update: jest
        .fn()
        .mockImplementation(async ({ data }) => ({ ...proposal, ...data })),
    },
    proposalApprovalRecord: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const owner = new ProposalReconciliationService(
    {} as never,
    {} as never,
    jest.fn(),
  );
  const ready: ProposalReconciliationState = {
    ...state,
    status: 'READY_FOR_REVIEW',
    candidateRevisionId: 'merged',
  };
  jest
    .spyOn(owner, 'state')
    .mockResolvedValueOnce(state)
    .mockResolvedValue(ready);
  jest.spyOn(owner, 'appendRevision').mockResolvedValue('merged');
  const service = Object.create(ProposalService.prototype) as ProposalService;
  Object.assign(service, {
    prisma: {
      db: {
        proposal: tx.proposal,
        $transaction: async (fn: (transaction: typeof tx) => unknown) => fn(tx),
      },
    },
    reconciliation: owner,
    validationEngine: {
      assertAuthoringCandidatesValid: jest.fn(async ({ proposals }) => ({
        candidates: proposals.map((candidate: object) => ({ candidate })),
      })),
      assertTaskMutationAuthoringValid: jest.fn(),
      assertPlanStageProposalTopologyValid: jest.fn(),
    },
    prepareTaskMutationRequirements: jest.fn(async (candidate) => candidate),
  });
  const load = () =>
    service.reconciliationReviewState(
      'proposal',
      'org' as OrganizationId,
      'project' as ProjectId,
    );
  return { load, owner, tx, service };
}

describe('standalone review preparation', () => {
  it('persists the merged patch and immutable complete result on the original, preserves earlier votes, and reuses it on repeat load', async () => {
    const { load, owner, tx } = setup();
    expect((await load()).status).toBe('READY_FOR_REVIEW');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.proposal.update).toHaveBeenCalledWith({
      where: { id: 'proposal' },
      data: { updates: { name: 'Proposed' } },
    });
    expect(owner.appendRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        proposalId: 'proposal',
        previousRevisionId: 'authoring',
        source: 'MERGE',
        bases: [basis],
        proposedResult: { ...basis.content, name: 'Proposed' },
        intent: 'Rename',
      }),
    );
    expect(tx.proposalApprovalRecord.deleteMany).not.toHaveBeenCalled();
    await load();
    expect(owner.appendRevision).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ groupMembership: { groupId: 'group' } }, stale],
    [{ action: 'DELETE' }, stale],
    [{ status: 'APPROVED' }, stale],
    [
      {},
      {
        ...stale,
        overlaps: [
          {
            path: 'name',
            currentValue: 'Now',
            proposedValue: 'Proposed',
            interveningProposalId: null,
          },
        ],
      },
    ],
  ])(
    'keeps excluded or unresolved review unchanged',
    async (overrides, state) => {
      const { load, owner, tx } = setup(state, overrides);
      expect(await load()).toEqual(state);
      expect(owner.appendRevision).not.toHaveBeenCalled();
      expect(tx.proposal.update).not.toHaveBeenCalled();
    },
  );
  it('keeps standalone MERGE on the original candidate', async () => {
    const { service, owner } = setup();
    const result = await service.reconcile(
      'proposal',
      'org' as OrganizationId,
      'project' as ProjectId,
      {} as never,
      { method: 'MERGE' },
      {} as never,
    );
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.replacementProposalId).toBeUndefined();
    expect(owner.appendRevision).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])(
    'resolves on the original and preserves votes only for an unchanged update (%s)',
    async (unchanged) => {
      const { service, owner, tx } = setup();
      const capture = jest.spyOn(owner, 'captureAuthoring').mockResolvedValue();
      const create = jest.spyOn(service, 'create');
      // Both reads see the same unresolved revision under the proposal lock.
      jest.mocked(owner.state).mockReset().mockResolvedValue(stale);
      const updates = { name: unchanged ? 'Proposed' : 'Resolved' };
      await service.reconcile(
        'proposal',
        'org' as OrganizationId,
        'project' as ProjectId,
        {} as never,
        {
          method: 'AGENT_FIX',
          proposedResult: updates,
          expectedCurrentBases: [basis],
        },
        {} as never,
      );
      expect(tx.proposal.update).toHaveBeenCalledWith({
        where: { id: 'proposal' },
        data: { updates },
      });
      expect(capture).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ id: 'proposal' }),
        expect.objectContaining({
          source: 'AGENT_FIX',
          preserveVotes: unchanged,
        }),
      );
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('refuses an assisted result when current content has drifted', async () => {
    const { service, tx } = setup();
    await expect(
      service.reconcile(
        'proposal',
        'org' as OrganizationId,
        'project' as ProjectId,
        {} as never,
        {
          method: 'AGENT_FIX',
          proposedResult: { name: 'Resolved' },
          expectedCurrentBases: [
            { ...basis, content: { ...basis.content, name: 'Older' } },
          ],
        },
        {} as never,
      ),
    ).rejects.toThrow('changed');
    expect(tx.proposal.update).not.toHaveBeenCalled();
  });
  it('keeps generic state reads free from automatic preparation', async () => {
    const { service, owner, tx } = setup();
    expect(
      await service.reconciliationState(
        'proposal',
        'org' as OrganizationId,
        'project' as ProjectId,
      ),
    ).toEqual(stale);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(owner.appendRevision).not.toHaveBeenCalled();
  });
  it('returns Agent fix for unsupported patch semantics without changing the proposal', async () => {
    const { load, tx } = setup(stale, { updates: { requirementOps: [] } });
    expect((await load()).status).toBe('AGENT_FIX_REQUIRED');
    expect(tx.proposal.update).not.toHaveBeenCalled();
  });
});
