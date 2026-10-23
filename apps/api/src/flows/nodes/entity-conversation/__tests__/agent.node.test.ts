import { EntityConversationTaskRequestEntityTypeEnum } from 'src/generated/agents/models';
import { EntityConversationAgentNode } from '../agent.node';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import {
  EntityConversationFlowContext,
  FlowUserMessage,
} from '../../../../types/flow-internal.types';
import {
  ConversationId,
  OrganizationId,
  PlanId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';

describe('EntityConversationAgentNode', () => {
  it('builds a task request payload for a PLAN work item', async () => {
    const organizationId = 'org-123' as OrganizationId;
    const planId = 'plan-123' as PlanId;

    const node = new EntityConversationAgentNode(
      {
        findOneForAdapter: jest.fn().mockResolvedValue({
          type: 'PLAN',
          name: 'Launch Plan',
          sections: [
            {
              key: 'description',
              materializedMarkdown: 'Release with staged rollout',
            },
          ],
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    jest
      .spyOn(node as any, 'loadRecentConversationMessages')
      .mockResolvedValue([]);

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

    const userMessage = {
      id: 'msg-123',
      data: 'What is next?',
    } as unknown as FlowUserMessage;

    const payload = await node.agentInput(
      createMutableContextHandle<EntityConversationFlowContext>(context),
      userMessage,
    );

    expect(payload.entityType).toBe(
      EntityConversationTaskRequestEntityTypeEnum.task,
    );
    expect(payload.entity).toEqual({
      title: 'Launch Plan',
      taskType: 'PLAN',
      description: 'Release with staged rollout',
    });
  });

  it('builds a task payload for a task-backed logical type', async () => {
    const node = new EntityConversationAgentNode(
      {
        findOneForAdapter: jest.fn().mockResolvedValue({
          type: 'CONTRACT',
          name: 'Provider Promise',
          sections: [
            {
              key: 'description',
              materializedMarkdown: 'A durable provider-controlled promise.',
            },
          ],
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(node as any, 'loadRecentConversationMessages')
      .mockResolvedValue([]);
    const context = {
      core: {
        workflowId: 'workflow-123',
        projectId: 'project-123',
        organizationId: 'org-123',
        conversationId: 'conversation-123',
        workflowAboutId: 'work-item-123',
        workflowAboutType: 'contract',
        user: { id: 'user-123', role: 'member' },
        session: { startTime: new Date(), interactionCount: 0 },
      },
      flowId: 'entity-conversation',
      flowPath: { pathTaken: [] },
    } as unknown as EntityConversationFlowContext;

    const payload = await node.agentInput(
      createMutableContextHandle<EntityConversationFlowContext>(context),
      {
        id: 'msg-123',
        data: 'What is promised?',
      } as unknown as FlowUserMessage,
    );

    expect(payload.entityType).toBe(
      EntityConversationTaskRequestEntityTypeEnum.task,
    );
    expect(payload.entity).toEqual({
      taskType: 'CONTRACT',
      title: 'Provider Promise',
      description: 'A durable provider-controlled promise.',
    });
  });
});
