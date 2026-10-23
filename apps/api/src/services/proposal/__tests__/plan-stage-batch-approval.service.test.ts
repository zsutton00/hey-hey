import { PlanStageBatchApprovalService } from '../plan-stage-batch-approval.service';
import type { PlanReviewScope } from '../withdraw-plan-review-batch';

const scope = {
  organizationId: 'org',
  projectId: 'project',
  conversationId: 'conversation',
  userId: 'user',
} as PlanReviewScope;

function fixture() {
  const proposal = {
    id: 'proposal',
    status: 'DRAFT',
    targetEntityId: 'stage',
    approvalRecords: [] as { userId: string; type: string }[],
  };
  const db = {
    conversation: {
      findFirst: jest.fn().mockResolvedValue({
        workflowAboutType: 'task',
        workflowAboutId: 'plan',
      }),
    },
    task: {
      findFirst: jest.fn().mockResolvedValue({ id: 'plan' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
    },
    proposal: { findMany: jest.fn().mockResolvedValue([proposal]) },
  };
  const approval = {
    approve: jest
      .fn()
      .mockResolvedValue({ enacted: true, resultingEntityId: 'stage' }),
    reject: jest.fn().mockResolvedValue({ proposal: { status: 'REJECTED' } }),
    retryApprovedGenericProposal: jest
      .fn()
      .mockResolvedValue({ enacted: true, resultingEntityId: 'stage' }),
  };
  const service = new PlanStageBatchApprovalService(
    { db } as never,
    approval as never,
  );
  return { db, approval, service, proposal };
}

describe('Plan stage review without groups', () => {
  it('approves ungrouped stages and verifies their materialization under the Plan', async () => {
    const { db, approval, service } = fixture();
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).resolves.toMatchObject({
      kind: 'approved',
      approvedCount: 1,
      approvedProposalIds: ['proposal'],
    });
    expect(approval.approve).toHaveBeenCalledWith(
      'proposal',
      'org',
      'project',
      'user',
    );
    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org',
          projectId: 'project',
          conversationId: 'conversation',
          action: 'CREATE',
          targetEntityType: 'TASK',
          groupMembership: { is: null },
          AND: [
            { updates: { path: ['type'], equals: 'PLAN_STAGE' } },
            { updates: { path: ['parentTaskId'], equals: 'plan' } },
          ],
        },
      }),
    );
    expect(db.task.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org',
        projectId: 'project',
        parentTaskId: 'plan',
        type: 'PLAN_STAGE',
        archivedAt: null,
        id: { in: ['stage'] },
      },
    });
  });

  it('approves all nine ungrouped proposals in a batch', async () => {
    const { db, approval, service, proposal } = fixture();
    db.proposal.findMany.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({
        ...proposal,
        id: `proposal-${i}`,
      })),
    );
    approval.approve.mockImplementation(async (id: string) => ({
      enacted: true,
      resultingEntityId: `stage-${id}`,
    }));
    db.task.count.mockResolvedValue(9);
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).resolves.toMatchObject({ kind: 'approved', approvedCount: 9 });
    expect(approval.approve).toHaveBeenCalledTimes(9);
  });

  it('skips rejected proposals and blocks an empty stage set', async () => {
    const { approval, service, proposal } = fixture();
    proposal.status = 'REJECTED';
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).resolves.toMatchObject({ kind: 'no_stages', preRejectedCount: 1 });
    expect(approval.approve).not.toHaveBeenCalled();
  });

  it('does not approve already materialized proposals again on retry', async () => {
    const { db, approval, service, proposal } = fixture();
    proposal.status = 'APPROVED';
    db.task.findMany.mockResolvedValue([{ id: 'stage' }]);
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).resolves.toMatchObject({
      kind: 'approved',
      approvedCount: 0,
      preApprovedCount: 1,
    });
    expect(approval.approve).not.toHaveBeenCalled();
    expect(approval.retryApprovedGenericProposal).not.toHaveBeenCalled();
  });

  it('resumes approved but unmaterialized proposals on retry', async () => {
    const { approval, service, proposal } = fixture();
    proposal.status = 'APPROVED';
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).resolves.toMatchObject({ kind: 'approved' });
    expect(approval.approve).not.toHaveBeenCalled();
    expect(approval.retryApprovedGenericProposal).toHaveBeenCalledWith({
      proposalId: 'proposal',
      organizationId: 'org',
      projectId: 'project',
    });
  });

  it('does not advance when enactment remains pending even with an existing stage', async () => {
    const { db, approval, service } = fixture();
    db.task.findMany.mockResolvedValue([{ id: 'existing-stage' }]);
    approval.approve.mockResolvedValue({
      enacted: false,
      resultingEntityId: 'stage',
    });
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).rejects.toThrow('still pending');
  });

  it('does not record duplicate approval while awaiting a threshold', async () => {
    const { approval, service, proposal } = fixture();
    proposal.approvalRecords.push({ userId: 'user', type: 'APPROVAL' });
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).rejects.toThrow('approval threshold');
    expect(approval.approve).not.toHaveBeenCalled();
  });

  it('does not advance if an approved stage is missing from the Plan', async () => {
    const { db, service } = fixture();
    db.task.count.mockResolvedValue(0);
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).rejects.toThrow('have not materialized');
  });

  it('allows an already materialized Plan with no outstanding proposals', async () => {
    const { db, service } = fixture();
    db.proposal.findMany.mockResolvedValue([]);
    db.task.findMany.mockResolvedValue([{ id: 'stage' }]);
    await expect(
      service.approveAllDraftPlanStagesForConversation(scope),
    ).resolves.toMatchObject({ kind: 'approved', approvedCount: 0 });
  });

  it('withdraws ungrouped draft stages using ordinary rejection', async () => {
    const { service, approval } = fixture();
    await service.withdrawForRevision(scope);
    expect(approval.reject).toHaveBeenCalledWith(
      'proposal',
      'org',
      'project',
      'user',
      expect.stringContaining('Continue Revising'),
    );
  });

  it('validates the entire revision batch before rejecting any proposal', async () => {
    const { db, service, approval, proposal } = fixture();
    db.proposal.findMany.mockResolvedValue([
      proposal,
      { ...proposal, id: 'approved', status: 'APPROVED' },
    ]);
    await expect(service.withdrawForRevision(scope)).rejects.toThrow(
      'after approval has begun',
    );
    expect(approval.reject).not.toHaveBeenCalled();
  });

  it('does not reject previously withdrawn proposals on retry', async () => {
    const { service, approval, proposal } = fixture();
    proposal.status = 'REJECTED';
    await service.withdrawForRevision(scope);
    expect(approval.reject).not.toHaveBeenCalled();
  });
});
