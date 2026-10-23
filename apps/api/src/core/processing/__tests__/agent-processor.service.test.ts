import { AgentProcessor, AgentProcessorSet } from '../agent-processor.service';
import { DomainEventPublisher } from '../../events/domain-event-publisher';
import { MastraClientService } from '../../../services/agents/mastra-client.service';
import { PromptBuilderService } from '../../../services/llm/prompt-builder.service';
import { AgentWorkflowJobData } from '../../../services/interfaces/job-enqueuer.interface';
import { AgentQueueJob } from '../../queue/interfaces/queue.interface';
import {
  FlowContext,
  FlowUserMessage,
  NodeType,
} from '../../../types/flow-internal.types';
import { EVENT_TYPES } from '../../events/types/event.types';
import { MessageStatus } from '../../../constants/message-status.constants';
import * as TestUtils from '../../../utils/testUtils';

describe('AgentProcessor', () => {
  const { testIds } = TestUtils;
  const organizationId = testIds.organization;
  const projectId = testIds.project;
  const workflowId = testIds.workflow;
  const conversationId = testIds.conversation;
  const requestId = testIds.request;
  const messageId = testIds.message;
  const userId = testIds.user;

  const flowContext: FlowContext = {
    flowId: 'flow-1',
    core: {
      workflowId,
      projectId,
      organizationId,
      conversationId,
      workflowAboutId: testIds.initiative,
      workflowAboutType: 'initiative',
      user: {
        id: userId,
        role: 'admin',
      },
      session: {
        startTime: new Date('2024-01-01T00:00:00Z'),
        interactionCount: 1,
      },
    },
    flowPath: {
      pathTaken: [],
      previousNode: undefined,
      previousTransition: undefined,
    },
  };

  const baseUserMessage: FlowUserMessage = {
    id: messageId,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    userId,
    type: 'UserMessage',
    content: 'hello world',
    timestamp: '2024-01-01T00:00:00Z',
  } as unknown as FlowUserMessage;

  let mastraClientService: jest.Mocked<MastraClientService>;
  let promptBuilderService: jest.Mocked<PromptBuilderService>;
  let eventPublisher: { publish: jest.Mock };
  let mockNodeExecutionService: any;
  let mockMessageService: any;
  let mockFlowExecutionService: { sendNodeResponseToWorkflow: jest.Mock };
  let mockEntityRegistryService: { getEntitiesByIds: jest.Mock };
  let mockConversationService: ReturnType<
    typeof TestUtils.createMockConversationService
  >;
  let mockTaskService: { findOneForAdapter: jest.Mock };
  let mockFlowRecoveryService: any;
  let agentProcessor: AgentProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    AgentProcessorSet.clear();

    mastraClientService = {
      executeAgent: jest.fn(),
    } as unknown as jest.Mocked<MastraClientService>;

    promptBuilderService = {
      buildAgentPrompts: jest.fn(),
    } as unknown as jest.Mocked<PromptBuilderService>;

    eventPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    mockNodeExecutionService = {
      getNode: jest.fn().mockReturnValue({
        node: {
          id: 'agent-node',
          type: 'AGENT',
          metadata: {},
          agentId: 'initiative-description',
        },
        routing: {},
      }),
      executePreviousNodePostProcess: jest.fn(),
    };

    mockMessageService = {
      getPendingMessageByRequest: jest.fn(),
      updateMessage: jest.fn(),
    };

    mockFlowExecutionService = {
      sendNodeResponseToWorkflow: jest.fn().mockResolvedValue(undefined),
    };

    mockEntityRegistryService = {
      getEntitiesByIds: jest.fn(),
    };

    mockTaskService = {
      findOneForAdapter: jest.fn(),
    };

    const mockEntitySummaryService = {
      getCurrentSummariesForEntities: jest.fn().mockResolvedValue([]),
    };

    mockFlowRecoveryService = {
      getCircuitBreakerKey: jest.fn((type, org) => `${type}_${org}`),
      recordCircuitBreakerSuccess: jest.fn(),
      recordCircuitBreakerFailure: jest.fn(),
      isCircuitOpen: jest.fn().mockReturnValue(false),
    };

    mockConversationService = TestUtils.createMockConversationService();

    agentProcessor = new AgentProcessor(
      eventPublisher as unknown as DomainEventPublisher,
      mockMessageService,
      mastraClientService,
      mockTaskService as any,
      promptBuilderService,
      mockNodeExecutionService,
      mockFlowExecutionService as any,
      mockConversationService as any,
      mockEntityRegistryService as any,
      mockEntitySummaryService as any,
      mockFlowRecoveryService,
    );
  });

  it('resolves agent prompts with PromptBuilderService before executing Mastra call', async () => {
    promptBuilderService.buildAgentPrompts.mockResolvedValue({
      systemPrompt: 'resolved-system',
      userPrompt: 'resolved-user',
    });

    mastraClientService.executeAgent.mockResolvedValue({
      status: 'completed',
      executionId: 'exec-1',
      executionTime: 10,
      result: {
        agentId: 'initiative-description',
        text: 'result text',
        summary: 'summary',
        changes: [] as Array<unknown>,
        reasoning: 'reasoning',
        confidence: 0.9,
      },
    } as any);

    const data: AgentWorkflowJobData = {
      type: 'agent_workflow',
      agentId: 'initiative-description',
      conversationId,
      context: flowContext,
      nodeId: 'agent-node',
      workflowAboutId: flowContext.core.workflowAboutId,
      workflowAboutType: flowContext.core.workflowAboutType,
      userMessage: baseUserMessage,
      userPrompt: 'template-user',
      options: {},
    };

    const job: AgentQueueJob = {
      id: 'job-1',
      data,
      queueName: 'agent',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      organizationId,
      projectId,
      requestId,
      workflowId,
      conversationId,
      userId,
      messageId,
      userMessage: baseUserMessage,
    } as unknown as AgentQueueJob;

    const result = await (agentProcessor as any).executeAgentWithProgress(
      job,
      data,
    );

    expect(promptBuilderService.buildAgentPrompts).toHaveBeenCalledWith(
      flowContext,
      'template-user',
      baseUserMessage,
    );

    expect(mastraClientService.executeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'resolved-user' }],
      }),
      expect.anything(),
      expect.anything(),
    );

    expect(result.agentResult.summary).toBe('summary');
  });

  describe('agent progress handling', () => {
    it('updates the pending system message with progress status details', async () => {
      mockMessageService.getPendingMessageByRequest.mockResolvedValue(
        'pending-msg-id',
      );

      const event = {
        id: 'event-1',
        type: EVENT_TYPES.AGENT.PROGRESS,
        aggregateId: requestId,
        payload: {
          payloadType: EVENT_TYPES.AGENT.PROGRESS,
          organizationId,
          projectId,
          requestId,
          workflowId,
          conversationId,
          userId,
          messageId,
          progress: 0.4,
          status: 'Loading data',
          executionTime: 1200,
          currentStep: 'Loading data',
        },
      };

      await agentProcessor.handleAgentProgressEvent(event as any);

      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        'pending-msg-id',
        organizationId,
        {
          status: MessageStatus.SystemProcessing,
          data: {
            type: 'QUESTIONS',
            response: 'Loading data',
            detectedIntent: '',
            intentConfidence: 0,
            uiElements: [] as Array<unknown>,
          },
        },
        {
          source: 'handleAgentProgressEvent',
          suppressConversationEvent: true,
        },
      );
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.MESSAGE.REALTIME,
          aggregateId: 'pending-msg-id',
          payload: expect.objectContaining({
            payloadType: EVENT_TYPES.MESSAGE.REALTIME,
            requestId,
            sequence: 1,
            kind: 'tool.progress',
            source: 'api',
          }),
        }),
      );
    });
  });

  describe('agent completion handling', () => {
    const buildAgentCompleteEvent = (overrides: Partial<any> = {}) => ({
      id: 'event-id',
      aggregateId: requestId,
      payload: {
        requestId,
        workflowId,
        conversationId,
        projectId,
        userId,
        organizationId,
        status: 'success' as const,
        result: {
          summary: 'Refined description',
          changes: [] as Array<unknown>,
          confidence: 0.9,
          reasoning: 'Agent completed successfully',
        },
        flowConfig: {
          nodeId: 'agent_analysis',
          nodeType: NodeType.AGENT,
          jobId: 'job-1',
          context: { ...flowContext, flowId: 'agent-flow' },
        },
        systemMessageData: {
          type: 'QUESTIONS',
          response: 'Refined description content',
          reasoning: 'Agent analysis completed',
          uiElements: [] as Array<unknown>,
          data: {},
        },
        userMessage: baseUserMessage,
        ...overrides,
      },
    });

    it('calls processAgentResponse when handler is available', async () => {
      const mockAgentNode = {
        id: 'agent_analysis',
        type: NodeType.AGENT as const,
        agentId: 'test-agent',
        processAgentResponse: jest.fn().mockResolvedValue({
          nextNodeId: 'next_node_id',
        }),
      };

      mockNodeExecutionService.getNode.mockReturnValue({
        node: mockAgentNode,
        routing: {},
      });

      const agentCompleteEvent = buildAgentCompleteEvent();

      await (agentProcessor as any).completeAgentNode(agentCompleteEvent);

      expect(mockAgentNode.processAgentResponse).toHaveBeenCalled();
    });

    it('merges custom systemMessageData from processAgentResponse', async () => {
      const customUIElement = {
        id: 'custom_ui',
        type: 'text_input',
        label: 'Custom Label',
      };

      const mockAgentNode = {
        id: 'starting_agent',
        type: NodeType.AGENT as const,
        agentId: 'test-agent',
        processAgentResponse: jest.fn().mockResolvedValue({
          nextNodeId: 'next_node_id',
          systemMessageData: {
            response: 'Custom agent response',
            uiElements: [customUIElement],
          },
        }),
      };

      mockNodeExecutionService.getNode.mockReturnValue({
        node: mockAgentNode,
        routing: {},
      });

      const agentCompleteEvent = buildAgentCompleteEvent({
        flowConfig: {
          nodeId: 'starting_agent',
          nodeType: NodeType.AGENT,
          jobId: 'job-1',
          context: { ...flowContext, flowId: 'adr-refinement' },
        },
        systemMessageData: {
          type: 'QUESTIONS',
          response: 'Generic agent response',
          reasoning: 'Agent completed',
          uiElements: [] as Array<unknown>,
        },
      });

      await (agentProcessor as any).completeAgentNode(agentCompleteEvent);

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            systemMessageData: expect.objectContaining({
              response: 'Custom agent response',
              uiElements: [customUIElement],
            }),
          }),
        }),
      );
    });

    it('converts bracketed entity IDs into mention tokens in system message responses', async () => {
      const mockAgentNode = {
        id: 'agent_analysis',
        type: NodeType.AGENT as const,
        agentId: 'test-agent',
        processAgentResponse: jest.fn().mockResolvedValue({
          nextNodeId: 'next_node_id',
          systemMessageData: {
            type: 'QUESTIONS',
            response:
              'Related initiative: [cadc709c-ee61-448b-9d65-55b80c6c82da]',
            uiElements: [] as Array<unknown>,
            detectedIntent: 'test',
            intentConfidence: 1,
          },
        }),
      };

      mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([
        {
          entityId: 'cadc709c-ee61-448b-9d65-55b80c6c82da',
          entityType: 'initiative',
          entityName: 'Important Initiative',
        },
      ]);

      mockNodeExecutionService.getNode.mockReturnValue({
        node: mockAgentNode,
        routing: {},
      });

      const agentCompleteEvent = buildAgentCompleteEvent({
        systemMessageData: {
          type: 'QUESTIONS',
          response:
            'Related initiative: [cadc709c-ee61-448b-9d65-55b80c6c82da]',
          uiElements: [] as Array<unknown>,
          detectedIntent: 'test',
          intentConfidence: 1,
        },
      });

      const result = await (agentProcessor as any).completeAgentNode(
        agentCompleteEvent,
      );

      expect(result?.response).toContain(
        '@[initiative:cadc709c-ee61-448b-9d65-55b80c6c82da|Important Initiative]',
      );
      const [, , systemMessageData] =
        mockFlowExecutionService.sendNodeResponseToWorkflow.mock.calls[0];
      expect(systemMessageData.response).toContain(
        '@[initiative:cadc709c-ee61-448b-9d65-55b80c6c82da|Important Initiative]',
      );
      expect(mockEntityRegistryService.getEntitiesByIds).toHaveBeenCalledWith({
        organizationId,
        entities: [
          {
            entityId: 'cadc709c-ee61-448b-9d65-55b80c6c82da',
          },
        ],
      });
    });

    it('handles non-agent nodes gracefully', async () => {
      const mockNonAgentNode = {
        id: 'regular_node',
        type: NodeType.LLM_QUESTIONS as const,
      };

      mockNodeExecutionService.getNode.mockReturnValue({
        node: mockNonAgentNode,
        routing: {},
      });

      const agentCompleteEvent = buildAgentCompleteEvent({
        flowConfig: {
          nodeId: 'regular_node',
          nodeType: NodeType.LLM_QUESTIONS,
          jobId: 'job-1',
          context: { ...flowContext, flowId: 'test-flow' },
        },
      });

      await expect(
        (agentProcessor as any).completeAgentNode(agentCompleteEvent),
      ).resolves.not.toThrow();

      expect(mockNodeExecutionService.getNode).toHaveBeenCalledWith(
        'test-flow',
        'regular_node',
      );
    });

    it('strips unresolved bracketed IDs while keeping resolved mentions', async () => {
      mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([
        {
          entityId: '11111111-1111-1111-1111-111111111111',
          entityType: 'task',
          entityName: 'Known Task',
        },
      ]);

      const systemMessage: any = {
        type: 'QUESTIONS',
        response:
          'Resolved [11111111-1111-1111-1111-111111111111] unknown [22222222-2222-2222-2222-222222222222]',
        uiElements: [] as Array<unknown>,
      };

      const sanitized = await (
        agentProcessor as any
      ).convertBracketedIdsToMentions(systemMessage, organizationId);

      expect(sanitized.response).toContain(
        '@[task:11111111-1111-1111-1111-111111111111|Known Task]',
      );
      expect(sanitized.response).not.toContain('2222');
    });

    it('sanitizes system message data before updating message records', async () => {
      const event = buildAgentCompleteEvent({
        status: 'success',
        flowConfig: undefined,
      });

      mockMessageService.getPendingMessageByRequest.mockResolvedValue(
        'pending-msg-id',
      );

      mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([
        {
          entityId: 'cadc709c-ee61-448b-9d65-55b80c6c82da',
          entityType: 'initiative',
          entityName: 'Initiative Name',
        },
      ]);

      const systemMessageData: any = {
        type: 'QUESTIONS',
        response: 'See [cadc709c-ee61-448b-9d65-55b80c6c82da]',
        uiElements: [] as Array<unknown>,
      };

      await agentProcessor.updateSystemMessageWithAgentResponse(
        event as any,
        systemMessageData,
      );

      expect(mockMessageService.updateMessage).toHaveBeenCalled();
      const [, , updateDto] = mockMessageService.updateMessage.mock.calls[0];
      expect(updateDto.data.response).toBe(
        'See @[initiative:cadc709c-ee61-448b-9d65-55b80c6c82da|Initiative Name]',
      );
    });
  });
});
