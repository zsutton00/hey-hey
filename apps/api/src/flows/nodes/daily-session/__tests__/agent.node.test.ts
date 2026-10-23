import { EntityType, RecentActivityCorrelationRecordDto } from 'src/generated';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import {
  DailySessionFlowContext,
  DailySessionSessionContext,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import { DailySessionAgentNode } from '../agent.node';

function makeRecord(
  overrides: Partial<RecentActivityCorrelationRecordDto> & {
    entityId: string;
  },
): RecentActivityCorrelationRecordDto {
  return {
    entityType: EntityType.Task,
    title: `Record ${overrides.entityId}`,
    timestamp: '2026-03-16T10:00:00Z',
    linkedEntities: [],
    reports: [],
    ...overrides,
  };
}

function makeContext(
  sessionContext?: DailySessionSessionContext,
): DailySessionFlowContext {
  return {
    core: {
      workflowId: 'wf-1' as WorkflowId,
      projectId: 'proj-1' as ProjectId,
      organizationId: 'org-1' as OrganizationId,
      conversationId: 'conv-1' as ConversationId,
      workflowAboutId: 'about-1',
      workflowAboutType: 'project',
      user: { id: 'user-1' as UserId, role: 'member' },
      session: { startTime: new Date(), interactionCount: 0 },
    },
    flowId: 'daily-session',
    flowPath: { pathTaken: [] },
    ...(sessionContext !== undefined ? { sessionContext } : {}),
  };
}

describe('DailySessionAgentNode – prior state loading on resume', () => {
  let node: DailySessionAgentNode;
  let mockActivityService: { listCorrelatedActivity: jest.Mock };

  beforeEach(() => {
    mockActivityService = {
      listCorrelatedActivity: jest.fn().mockResolvedValue({ records: [] }),
    };

    node = new DailySessionAgentNode(
      {} as any, // artifactService
      mockActivityService as any,
    );

    jest
      .spyOn(node as any, 'loadRecentConversationMessages')
      .mockResolvedValue([]);
  });

  it('uses restored sessionContext.lastUserActivities as delta baseline on resume', async () => {
    const previousActivities = [
      makeRecord({ entityId: 'task-1', status: 'TODO' }),
      makeRecord({ entityId: 'task-2', status: 'IN_PROGRESS' }),
    ];
    const currentActivities = [
      makeRecord({ entityId: 'task-1', status: 'IN_PROGRESS' }),
      makeRecord({ entityId: 'task-2', status: 'COMPLETED' }),
    ];

    mockActivityService.listCorrelatedActivity.mockResolvedValue({
      records: currentActivities,
    });

    const context = makeContext({
      lastSystemMessage: 'Previous agent response',
      lastUserActivities: previousActivities,
    });

    const tracker = createMutableContextHandle(context);
    const request = await node.agentInput(tracker, undefined);

    // Delta should show status changes, not treat everything as new
    expect(request.computedDelta.statusChanges).toHaveLength(2);
    expect(request.computedDelta.newSignals).toHaveLength(0);
    expect(request.computedDelta.statusChanges[0]).toMatchObject({
      entityId: 'task-1',
      previousStatus: 'TODO',
      currentStatus: 'IN_PROGRESS',
    });
  });

  it('treats all activity as new signals when no prior sessionContext exists (first session)', async () => {
    const currentActivities = [
      makeRecord({ entityId: 'task-1', status: 'TODO' }),
      makeRecord({ entityId: 'task-2', status: 'IN_PROGRESS' }),
    ];

    mockActivityService.listCorrelatedActivity.mockResolvedValue({
      records: currentActivities,
    });

    const context = makeContext(undefined);
    const tracker = createMutableContextHandle(context);
    const request = await node.agentInput(tracker, undefined);

    expect(request.computedDelta.statusChanges).toHaveLength(0);
    expect(request.computedDelta.newSignals).toHaveLength(2);
  });

  it('passes restored lastSystemMessage to agent request on resume', async () => {
    const context = makeContext({
      lastSystemMessage: 'Here is your daily summary...',
      lastUserActivities: [],
    });

    const tracker = createMutableContextHandle(context);
    const request = await node.agentInput(tracker, undefined);

    expect(request.lastSystemMessage).toBe('Here is your daily summary...');
  });

  it('generates resume auto-trigger prompt when sessionContext has prior state', async () => {
    const context = makeContext({
      lastSystemMessage: 'Previous response text',
    });

    const tracker = createMutableContextHandle(context);
    const request = await node.agentInput(tracker, undefined);

    expect(request.lastUserMessage).toContain('resuming');
  });

  it('generates new-session auto-trigger prompt when no prior state exists', async () => {
    const context = makeContext(undefined);
    const tracker = createMutableContextHandle(context);
    const request = await node.agentInput(tracker, undefined);

    expect(request.lastUserMessage).toContain('new daily session');
  });

  it('updates sessionContext with current activities after delta computation', async () => {
    const freshActivities = [
      makeRecord({ entityId: 'task-new', status: 'TODO' }),
    ];

    mockActivityService.listCorrelatedActivity.mockResolvedValue({
      records: freshActivities,
    });

    const context = makeContext({
      lastSystemMessage: 'old message',
      lastUserActivities: [
        makeRecord({ entityId: 'task-old', status: 'DONE' }),
      ],
    });

    const tracker = createMutableContextHandle(context);
    await node.agentInput(tracker, undefined);

    // After agentInput, sessionContext should be updated with current activities
    const updatedContext = tracker.getContext();
    expect(updatedContext.sessionContext?.lastUserActivities).toEqual(
      freshActivities,
    );
  });

  it('includes activitySnapshot in request from restored session activities', async () => {
    const currentActivities = [
      makeRecord({ entityId: 'task-1', status: 'IN_PROGRESS' }),
    ];

    mockActivityService.listCorrelatedActivity.mockResolvedValue({
      records: currentActivities,
    });

    const context = makeContext(undefined);
    const tracker = createMutableContextHandle(context);
    const request = await node.agentInput(tracker, undefined);

    expect(request.activitySnapshot).toHaveLength(1);
    expect(request.activitySnapshot[0]!.entityId).toBe('task-1');
  });

  it('handles activity fetch failure gracefully, preserving prior snapshot', async () => {
    mockActivityService.listCorrelatedActivity.mockRejectedValue(
      new Error('Service unavailable'),
    );

    const previousActivities = [
      makeRecord({ entityId: 'task-1', status: 'TODO' }),
    ];

    const context = makeContext({
      lastSystemMessage: 'Previous message',
      lastUserActivities: previousActivities,
    });

    const tracker = createMutableContextHandle(context);
    const request = await node.agentInput(tracker, undefined);

    // When activity fetch fails, delta computation is skipped (try/catch
    // in computeAndSetActivityDelta logs a warning). The activitySnapshot
    // falls back to whatever was in sessionContext.lastUserActivities.
    expect(request.computedDelta.statusChanges).toHaveLength(0);
    expect(request.computedDelta.newSignals).toHaveLength(0);
    expect(request.activitySnapshot).toHaveLength(1);
    expect(request.activitySnapshot[0]!.entityId).toBe('task-1');
  });
});
