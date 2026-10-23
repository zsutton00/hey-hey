import { EntityType } from '@prisma/client';
import { PlaceholderResolver } from '../placeholders/resolver.service';
import { StandardPlaceholderRegistry } from '../placeholders/registries/standard-placeholders.registry';
import { createMockPlaceholderContext } from '../../../utils/testUtils';
import { AgentProcessor } from '../../../core/processing/agent-processor.service';
import { AgentQueueJob } from '../../../core/queue/interfaces/queue.interface';
import { AgentWorkflowJobData } from '../../interfaces/job-enqueuer.interface';
import { FlowContext } from '../../../types/flow-internal.types';
import { z } from 'zod';

describe('Conversation mentions propagation', () => {
  it('carries mentions into prompts and agent requests', async () => {
    const mentions = [
      {
        entityId: 'init-1',
        entityType: EntityType.INITIATIVE,
        messageId: 'msg-1',
        conversationId: 'conv-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      {
        entityId: 'task-1',
        entityType: EntityType.TASK,
        messageId: 'msg-2',
        conversationId: 'conv-1',
        createdAt: new Date('2024-01-02T00:00:00Z'),
      },
    ];

    const messageServiceMock = {
      getMentionsForConversation: jest.fn().mockResolvedValue(mentions),
    };

    const entityRegistryServiceMock = {
      getEntitiesByIds: jest.fn().mockResolvedValue([
        {
          entityId: 'init-1',
          entityType: EntityType.INITIATIVE,
          entityName: 'Initiative One',
        },
        {
          entityId: 'task-1',
          entityType: EntityType.TASK,
          entityName: 'Task One',
        },
      ]),
    };

    const entitySummaryServiceMock = {
      getCurrentSummariesForEntities: jest.fn().mockResolvedValue([
        {
          entityType: EntityType.INITIATIVE,
          entityId: 'init-1',
          summary: 'Initiative summary',
          updatedAt: new Date('2024-01-03T00:00:00Z'),
        },
        {
          entityType: EntityType.TASK,
          entityId: 'task-1',
          summary: 'Task summary',
          updatedAt: new Date('2024-01-04T00:00:00Z'),
        },
      ]),
    };

    const registry = new StandardPlaceholderRegistry();
    const resolver = new PlaceholderResolver();

    const placeholderContext = createMockPlaceholderContext({
      services: {
        messageService: messageServiceMock,
        entityRegistryService: entityRegistryServiceMock,
        initiativeService: {
          findOneForAdapter: jest.fn().mockResolvedValue({
            id: 'init-1',
            name: 'Initiative One',
          }),
        },
      },
      userMessage: {
        id: 'msg-2',
        data: { message: 'Hi @[task:task-1|Task One]' },
        timestamp: new Date().toISOString(),
      },
    });

    const prompt = await resolver.resolve(
      'Mentions:\n${conversationMentions}',
      registry,
      placeholderContext,
      { throwOnMissing: false },
    );

    expect(prompt).toContain('MENTIONS (2');
    expect(prompt).toContain('@[task:task-1|Task One]');
    expect(messageServiceMock.getMentionsForConversation).toHaveBeenCalledWith(
      'test-conversation',
      'test-org',
    );

    const eventPublisherMock = {
      publish: jest.fn(),
      publishInTransaction: jest.fn(),
    };

    const mastraClientServiceMock = {
      executeAgentStructured: jest.fn().mockResolvedValue({
        status: 'completed',
        result: { summary: 'ok' },
      }),
      executeAgent: jest.fn(),
    };

    const promptBuilderServiceMock = {
      buildAgentPrompts: jest.fn(),
    };

    const taskServiceMock = {
      findOneForAdapter: jest.fn(),
    };

    const node = {
      id: 'node-1',
      type: 'agent',
      agentInput: jest.fn().mockResolvedValue({ input: true }),
      responseSchema: z.object({
        summary: z.string().optional(),
      }),
    };

    const nodeExecutionServiceMock = {
      getNode: jest.fn().mockReturnValue({ node }),
    };

    const processor = new AgentProcessor(
      eventPublisherMock as any,
      messageServiceMock as any,
      mastraClientServiceMock as any,
      taskServiceMock as any,
      promptBuilderServiceMock as any,
      nodeExecutionServiceMock as any,
      {} as any,
      {} as any,
      entityRegistryServiceMock as any,
      entitySummaryServiceMock as any,
      {} as any,
    );

    // Silence progress events for the test
    (processor as any).reportProgress = jest.fn();

    const flowContext: FlowContext = {
      flowId: 'flow-1',
      core: {
        workflowId: 'wf-1' as any,
        projectId: 'proj-1' as any,
        organizationId: 'org-1' as any,
        conversationId: 'conv-1' as any,
        workflowAboutId: 'task-1',
        workflowAboutType: 'task',
        user: { id: 'user-1' as any, role: 'member' },
        session: { startTime: new Date(), interactionCount: 1 },
      },
      flowPath: { pathTaken: [], previousNode: undefined },
    };

    const data: AgentWorkflowJobData = {
      type: 'agent_workflow',
      agentId: 'agent-1',
      conversationId: 'conv-1' as any,
      context: flowContext,
      nodeId: 'node-1',
      workflowAboutId: 'task-1',
      workflowAboutType: 'task',
      userPrompt: '',
    };

    const job: AgentQueueJob = {
      id: 'job-1' as any,
      queueName: 'agent' as any,
      requestId: 'req-1' as any,
      workflowId: 'wf-1' as any,
      organizationId: 'org-1' as any,
      projectId: 'proj-1' as any,
      createdAt: new Date(),
      data,
    };

    const result = await (processor as any).executeAgentWithProgress(job, data);

    expect(result.agentResult).toBeDefined();
    expect(
      entitySummaryServiceMock.getCurrentSummariesForEntities,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entities: expect.arrayContaining([
        { entityId: 'init-1', entityType: EntityType.INITIATIVE },
        { entityId: 'task-1', entityType: EntityType.TASK },
      ]),
    });
    const agentContext =
      mastraClientServiceMock.executeAgentStructured.mock.calls[0][0].context;

    expect(agentContext.mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'init-1',
          entityType: 'initiative',
          summary: 'Initiative summary',
        }),
        expect.objectContaining({
          entityId: 'task-1',
          entityType: 'task',
          messageId: 'msg-2',
          summary: 'Task summary',
        }),
      ]),
    );
  });
});
