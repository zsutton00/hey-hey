import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WorkItemPlanGenerationService } from '../work-item-plan-generation.service';
import { OrganizationId, ProjectId, TaskId, UserId } from '../../../types';

const org = 'org' as OrganizationId;
const project = 'project' as ProjectId;
const planId = 'plan' as TaskId;
const user = 'user' as UserId;

function fixture() {
  const tx = {
    planStage: { deleteMany: jest.fn() },
    plan: { updateMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: planId }]),
    task: {
      findFirst: jest.fn().mockResolvedValue({
        id: planId,
        name: 'My Plan',
        type: 'PLAN',
        status: 'BACKLOG',
        parentTaskId: null,
        initiativeId: null,
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    agentSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    designDoc: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'doc',
        sections: [{ materializedMarkdown: '# Current design' }],
      }),
    },
    planRelationship: { findFirst: jest.fn().mockResolvedValue(null) },
    proposal: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = { $transaction: jest.fn((fn) => fn(tx)) };
  const sessions = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'session', conversationId: 'conversation' }),
    remove: jest.fn(),
  };
  const conversations = { deleteConversation: jest.fn() };
  const tasks = {
    removeInTransaction: jest.fn(),
    updateInTransaction: jest.fn().mockResolvedValue({ postCommit: {} }),
    runUpdatePostCommit: jest.fn(),
  };
  const launcher = {
    materializeForExistingWorkItemInTransaction: jest.fn().mockResolvedValue({
      agentSessionId: 'session',
      conversationId: 'conversation',
    }),
  };
  const triggers = {
    emitStopRunControl: jest.fn().mockResolvedValue({ emitted: true }),
  };
  const proposals = { delete: jest.fn() };
  const reports = { deleteReportsAttachedToEntity: jest.fn() };
  const service = new WorkItemPlanGenerationService(
    prisma as never,
    sessions as never,
    conversations as never,
    tasks as never,
    launcher as never,
    triggers as never,
    proposals as never,
    reports as never,
    { resolve: jest.fn().mockResolvedValue([]) } as never,
  );
  return {
    service,
    tx,
    prisma,
    sessions,
    conversations,
    tasks,
    launcher,
    triggers,
    proposals,
    reports,
  };
}

describe('work-item Plan generation', () => {
  it('prepares a session for a reset standalone draft without creating a Plan', async () => {
    const f = fixture();
    await expect(
      f.service.prepare(org, project, planId, user),
    ).resolves.toEqual({ id: 'session', conversationId: 'conversation' });
    expect(
      f.launcher.materializeForExistingWorkItemInTransaction,
    ).toHaveBeenCalledWith(f.tx, {
      organizationId: org,
      projectId: project,
      planId,
      planTitle: 'My Plan',
      requestorId: user,
      designDocMarkdown: '# Current design',
    });
    expect(f.tasks.updateInTransaction).not.toHaveBeenCalled();
    expect(f.tx.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: planId,
        organizationId: org,
        projectId: project,
        type: 'PLAN',
        archivedAt: null,
      },
    });
  });

  it('reuses an existing session on a repeated prepare', async () => {
    const f = fixture();
    f.tx.agentSession.findFirst.mockResolvedValue({
      id: 'existing',
      userId: user,
    });
    await f.service.prepare(org, project, planId, user);
    expect(f.sessions.findOne).toHaveBeenCalledWith(org, 'existing');
    expect(
      f.launcher.materializeForExistingWorkItemInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('rejects a missing Plan and a non-draft Plan before setup', async () => {
    const f = fixture();
    f.tx.task.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.prepare(org, project, planId, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    f.tx.task.findFirst.mockResolvedValueOnce({ status: 'ACTIVE' });
    await expect(
      f.service.prepare(org, project, planId, user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      f.launcher.materializeForExistingWorkItemInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('leaves a reset draft with no session and preserves its identity', async () => {
    const f = fixture();
    await f.service.reset(org, project, planId, user);
    expect(f.tasks.updateInTransaction).toHaveBeenCalledWith(
      f.tx,
      org,
      null,
      planId,
      { status: 'BACKLOG' },
      user,
    );
    expect(
      f.launcher.materializeForExistingWorkItemInTransaction,
    ).not.toHaveBeenCalled();
    expect(f.sessions.remove).not.toHaveBeenCalled();
    expect(f.tasks.runUpdatePostCommit).toHaveBeenCalledWith(org, planId, {});
  });

  it('stops and removes generation, then archives stages and their tasks', async () => {
    const f = fixture();
    f.tx.agentSession.findMany.mockResolvedValue([
      { id: 'old', userId: user, conversationId: 'conversation' },
    ]);
    f.tx.proposal.findMany.mockResolvedValue([{ id: 'draft' }]);
    f.tx.task.findMany
      .mockResolvedValueOnce([{ id: 'stage' }])
      .mockResolvedValueOnce([{ id: 'child' }]);
    await f.service.reset(org, project, planId, user);
    expect(f.triggers.emitStopRunControl).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'old', conversationId: 'conversation' }),
    );
    expect(f.conversations.deleteConversation).toHaveBeenCalledWith(
      'conversation',
      org,
      user,
      'Plan generation reset',
    );
    expect(f.proposals.delete).toHaveBeenCalledWith('draft', org, project);
    expect(f.reports.deleteReportsAttachedToEntity).toHaveBeenCalled();
    expect(f.sessions.remove).toHaveBeenCalledWith(org, 'old');
    expect(
      f.tasks.removeInTransaction.mock.calls.map((call) => call[2]),
    ).toEqual(['child', 'stage']);
    expect(
      f.launcher.materializeForExistingWorkItemInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('rejects another owner before stopping or removing anything', async () => {
    const f = fixture();
    f.tx.agentSession.findMany.mockResolvedValue([
      { id: 'old', userId: 'someone-else' },
    ]);
    await expect(
      f.service.reset(org, project, planId, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.sessions.remove).not.toHaveBeenCalled();
    expect(f.tasks.updateInTransaction).not.toHaveBeenCalled();
    expect(f.triggers.emitStopRunControl).not.toHaveBeenCalled();
  });

  it('does not reset the work item when stopping generation fails', async () => {
    const f = fixture();
    f.tx.agentSession.findMany.mockResolvedValue([
      { id: 'old', userId: user, conversationId: 'conversation' },
    ]);
    f.triggers.emitStopRunControl.mockRejectedValue(new Error('stop failed'));
    await expect(f.service.reset(org, project, planId, user)).rejects.toThrow(
      'stop failed',
    );
    expect(f.tasks.updateInTransaction).not.toHaveBeenCalled();
    expect(f.sessions.remove).not.toHaveBeenCalled();
  });
});
