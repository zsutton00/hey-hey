import { PlanStepBatchApprovalService } from '../plan-step-batch-approval.service';
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
    targetEntityId: 'step',
    updates: { type: 'STANDARD', parentTaskId: 'stage' } as Record<
      string,
      string
    >,
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
      findMany: jest
        .fn()
        .mockImplementation(async ({ where }) =>
          where.type === 'PLAN_STAGE' ? [{ id: 'stage' }] : [],
        ),
      count: jest.fn().mockResolvedValue(1),
    },
    proposal: { findMany: jest.fn().mockResolvedValue([proposal]) },
  };
  const approvals = {
    approve: jest
      .fn()
      .mockResolvedValue({ enacted: true, resultingEntityId: 'step' }),
    retryApprovedGenericProposal: jest
      .fn()
      .mockResolvedValue({ enacted: true, resultingEntityId: 'step' }),
    reject: jest.fn().mockResolvedValue({}),
  };
  const service = new PlanStepBatchApprovalService(
    { db } as never,
    approvals as never,
  );
  return { service, db, approvals, proposal };
}

describe('ungrouped Plan step review', () => {
  it('approves scoped STANDARD proposals and verifies every resulting work item', async () => {
    const { service, db, approvals } = fixture();
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).resolves.toMatchObject({ kind: 'approved', approvedCount: 1 });
    expect(approvals.approve).toHaveBeenCalledWith(
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
          OR: [{ updates: { path: ['parentTaskId'], equals: 'stage' } }],
        },
      }),
    );
    expect(db.task.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org',
        projectId: 'project',
        type: 'STANDARD',
        archivedAt: null,
        parentTask: {
          organizationId: 'org',
          projectId: 'project',
          parentTaskId: 'plan',
          type: 'PLAN_STAGE',
          archivedAt: null,
        },
        id: { in: ['step'] },
      },
    });
  });

  it('accepts omitted work-item type according to the STANDARD contract default', async () => {
    const { service, proposal } = fixture();
    delete proposal.updates.type;
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).resolves.toMatchObject({ kind: 'approved' });
  });

  it('does not approve other work-item types under the same stage', async () => {
    const { service, proposal, approvals } = fixture();
    proposal.updates.type = 'PLAN_STAGE';
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).resolves.toMatchObject({ kind: 'no_steps' });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('uses an empty parent scope when the Plan has no stages', async () => {
    const { service, db } = fixture();
    db.task.findMany.mockResolvedValue([]);
    db.proposal.findMany.mockResolvedValue([]);
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).resolves.toMatchObject({ kind: 'no_steps' });
    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [] }) }),
    );
  });

  it('skips rejected steps', async () => {
    const { service, proposal, approvals } = fixture();
    proposal.status = 'REJECTED';
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).resolves.toMatchObject({ kind: 'no_steps', preRejectedCount: 1 });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('does not repeat approval for a materialized step on activity retry', async () => {
    const { service, proposal, db, approvals } = fixture();
    proposal.status = 'APPROVED';
    db.task.findMany
      .mockResolvedValueOnce([{ id: 'stage' }])
      .mockResolvedValueOnce([{ id: 'step' }]);
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).resolves.toMatchObject({ kind: 'approved', approvedCount: 0 });
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(approvals.retryApprovedGenericProposal).not.toHaveBeenCalled();
  });

  it('resumes interrupted materialization of an approved proposal', async () => {
    const { service, proposal, approvals } = fixture();
    proposal.status = 'APPROVED';
    await service.approveAllDraftPlanStepsForConversation(scope);
    expect(approvals.retryApprovedGenericProposal).toHaveBeenCalledWith({
      proposalId: 'proposal',
      organizationId: 'org',
      projectId: 'project',
    });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('does not advance while approval or materialization is pending', async () => {
    const { service, approvals } = fixture();
    approvals.approve.mockResolvedValue({
      enacted: false,
      resultingEntityId: 'step',
    });
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).rejects.toThrow('still pending');
  });

  it('does not duplicate a recorded approval awaiting threshold', async () => {
    const { service, proposal, approvals } = fixture();
    proposal.approvalRecords.push({ userId: 'user', type: 'APPROVAL' });
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).rejects.toThrow('approval threshold');
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('does not advance if a resulting step is outside the canonical Plan hierarchy', async () => {
    const { service, db } = fixture();
    db.task.count.mockResolvedValue(0);
    await expect(
      service.approveAllDraftPlanStepsForConversation(scope),
    ).rejects.toThrow('have not materialized');
  });

  it('withdraws individual drafts through ordinary rejection', async () => {
    const { service, approvals } = fixture();
    await service.withdrawForRevision(scope);
    expect(approvals.reject).toHaveBeenCalledWith(
      'proposal',
      'org',
      'project',
      'user',
      expect.stringContaining('Continue Revising'),
    );
  });

  it('validates the whole revision batch before rejecting any proposal', async () => {
    const { service, db, proposal, approvals } = fixture();
    db.proposal.findMany.mockResolvedValue([
      proposal,
      { ...proposal, id: 'approved', status: 'APPROVED' },
    ]);
    await expect(service.withdrawForRevision(scope)).rejects.toThrow(
      'after approval has begun',
    );
    expect(approvals.reject).not.toHaveBeenCalled();
  });
});
