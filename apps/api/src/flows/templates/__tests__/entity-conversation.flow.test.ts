import { entityConversationFlow } from '../entity-conversation.flow';
import { AgentSessionService } from '../../../services/agent-session.service';
import { TaskService } from '../../../services/tasks/task.service';
import {
  ConversationId,
  OrganizationId,
  PlanId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../types';
import { FlowContext } from '../../../types/flow-internal.types';

describe('entityConversationFlow.initialContextTransform', () => {
  const planId = 'plan-123' as PlanId;

  let baseContext: FlowContext;
  let taskService: { findOneForAdapter: jest.Mock };
  let agentSessionService: { applyDerivedTitleByConversation: jest.Mock };
  let appContext: { get: jest.Mock };

  beforeEach(() => {
    baseContext = {
      core: {
        workflowId: 'workflow-123' as WorkflowId,
        projectId: 'project-123' as ProjectId,
        organizationId: 'org-123' as OrganizationId,
        conversationId: 'conversation-123' as ConversationId,
        workflowAboutId: planId,
        workflowAboutType: 'task',
        user: { id: 'user-123' as UserId, role: 'member' },
        session: { startTime: new Date(), interactionCount: 0 },
      },
      flowId: 'entity-conversation',
      flowPath: { pathTaken: [] },
    } as FlowContext;

    taskService = {
      findOneForAdapter: jest
        .fn()
        .mockResolvedValue({ id: planId, type: 'PLAN', name: 'My Plan' }),
    };
    agentSessionService = {
      applyDerivedTitleByConversation: jest.fn().mockResolvedValue(undefined),
    };
    appContext = {
      get: jest.fn((token: unknown) => {
        if (token === TaskService) return taskService;
        if (token === AgentSessionService) return agentSessionService;
        throw new Error(`Unexpected service request: ${String(token)}`);
      }),
    };
  });

  it('applies a derived title for a PLAN work item', async () => {
    if (!entityConversationFlow.initialContextTransform) {
      throw new Error('Expected initialContextTransform');
    }

    const result = await entityConversationFlow.initialContextTransform(
      baseContext,
      planId,
      'task',
      appContext as never,
    );

    expect(result).toBe(baseContext);
    expect(taskService.findOneForAdapter).toHaveBeenCalledWith(
      planId,
      'org-123',
    );
    expect(
      agentSessionService.applyDerivedTitleByConversation,
    ).toHaveBeenCalledWith('org-123', 'conversation-123', 'Discuss My Plan');
  });

  it.each([
    'task',
    'feature',
    'bug',
    'goal',
    'contract',
    'task_monitor',
    'workflow',
    'workflow_step',
  ])(
    'accepts task-backed workflowAboutType="%s"',
    async (workflowAboutType) => {
      if (!entityConversationFlow.initialContextTransform) {
        throw new Error('Expected initialContextTransform');
      }

      const taskService = {
        findOneForAdapter: jest.fn().mockResolvedValue({ name: 'Work Item' }),
      };
      appContext.get.mockImplementation((token: unknown) => {
        if (token === TaskService) return taskService;
        if (token === AgentSessionService) return agentSessionService;
        throw new Error(`Unexpected service request: ${String(token)}`);
      });

      await expect(
        entityConversationFlow.initialContextTransform(
          baseContext,
          'work-item-123',
          workflowAboutType,
          appContext as never,
        ),
      ).resolves.toBe(baseContext);
      expect(taskService.findOneForAdapter).toHaveBeenCalledWith(
        'work-item-123',
        'org-123',
      );
    },
  );

  it('rejects unsupported workflowAboutType values', async () => {
    if (!entityConversationFlow.initialContextTransform) {
      throw new Error('Expected initialContextTransform');
    }

    await expect(
      entityConversationFlow.initialContextTransform(
        baseContext,
        planId,
        'unknown-type',
        appContext as never,
      ),
    ).rejects.toThrow(
      'Unsupported workflowAboutType "unknown-type" for entity conversation flow',
    );
  });
});
