import {
  withdrawPlanReviewBatch,
  type PlanReviewScope,
} from '../withdraw-plan-review-batch';

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
    updates: { type: 'PLAN_STAGE', parentTaskId: 'plan' },
    approvalRecords: [] as { type: string }[],
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
      findMany: jest.fn().mockResolvedValue([{ id: 'stage' }]),
    },
    proposal: { findMany: jest.fn().mockResolvedValue([proposal]) },
  };
  const approvals = { reject: jest.fn().mockResolvedValue({}) };
  const run = (type: 'PLAN_STAGE' | 'STANDARD' = 'PLAN_STAGE') =>
    withdrawPlanReviewBatch({ db } as never, approvals as never, scope, type);
  return { db, proposal, approvals, run };
}
describe('withdrawPlanReviewBatch without groups', () => {
  it('withdraws scoped individual proposals through authenticated rejection', async () => {
    const { run, approvals, db } = fixture();
    await run();
    expect(approvals.reject).toHaveBeenCalledWith(
      'proposal',
      'org',
      'project',
      'user',
      expect.stringContaining('Continue Revising'),
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
          OR: [{ updates: { path: ['parentTaskId'], equals: 'plan' } }],
        },
      }),
    );
  });
  it('does not withdraw work-item proposals of another type', async () => {
    const { run, proposal, approvals } = fixture();
    proposal.updates.type = 'STANDARD';
    await run();
    expect(approvals.reject).not.toHaveBeenCalled();
  });
  it('blocks partial approvals before recording any rejection', async () => {
    const { run, db, proposal, approvals } = fixture();
    db.proposal.findMany.mockResolvedValue([
      proposal,
      { ...proposal, id: 'partial', approvalRecords: [{ type: 'APPROVAL' }] },
    ]);
    await expect(run()).rejects.toThrow('after approval has begun');
    expect(approvals.reject).not.toHaveBeenCalled();
  });
  it('skips already rejected proposals on retry', async () => {
    const { run, proposal, approvals } = fixture();
    proposal.status = 'REJECTED';
    await run();
    expect(approvals.reject).not.toHaveBeenCalled();
  });
  it('scopes step withdrawal to canonical stage IDs', async () => {
    const { run, proposal, db, approvals } = fixture();
    proposal.updates = { type: 'STANDARD', parentTaskId: 'stage' };
    await run('STANDARD');
    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ updates: { path: ['parentTaskId'], equals: 'stage' } }],
        }),
      }),
    );
    expect(approvals.reject).toHaveBeenCalledTimes(1);
  });
});
