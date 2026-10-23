import { EntityConversationWelcomeNode } from '../welcome.node';
import {
  EntityConversationFlowContext,
  NodeType,
} from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import {
  ConversationId,
  OrganizationId,
  PlanId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';

describe('EntityConversationWelcomeNode', () => {
  it('resolves a PLAN work item and returns a questions opener', async () => {
    const planId = 'plan-123' as PlanId;
    const organizationId = 'org-123' as OrganizationId;

    const node = new EntityConversationWelcomeNode(
      {
        findOneForAdapter: jest
          .fn()
          .mockResolvedValue({ type: 'PLAN', name: 'Launch Plan' }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const context: EntityConversationFlowContext = {
      core: {
        workflowId: 'workflow-123' as WorkflowId,
        projectId: 'project-123' as ProjectId,
        organizationId,
        conversationId: 'conversation-123' as ConversationId,
        workflowAboutId: planId,
        workflowAboutType: 'task',
        user: { id: 'user-123' as UserId, role: 'member' },
        session: { startTime: new Date(), interactionCount: 0 },
      },
      flowId: 'entity-conversation',
      flowPath: { pathTaken: [] },
    } as EntityConversationFlowContext;

    const result = await node.execute(
      createMutableContextHandle<EntityConversationFlowContext>(context),
    );

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.message).toContain('Launch Plan');
    expect(result.uiElements?.[0]?.label).toContain('task');
  });

  it('resolves a task-backed logical type with its own label', async () => {
    const taskService = {
      findOneForAdapter: jest.fn().mockResolvedValue({
        name: 'Live Workflow',
      }),
    };
    const node = new EntityConversationWelcomeNode(
      taskService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const context = {
      core: {
        workflowId: 'workflow-123',
        projectId: 'project-123',
        organizationId: 'org-123',
        conversationId: 'conversation-123',
        workflowAboutId: 'work-item-123',
        workflowAboutType: 'workflow',
        user: { id: 'user-123', role: 'member' },
        session: { startTime: new Date(), interactionCount: 0 },
      },
      flowId: 'entity-conversation',
      flowPath: { pathTaken: [] },
    } as unknown as EntityConversationFlowContext;

    const result = await node.execute(
      createMutableContextHandle<EntityConversationFlowContext>(context),
    );

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.message).toContain('Live Workflow');
    expect(result.uiElements?.[0]?.label).toContain('workflow');
  });
});
