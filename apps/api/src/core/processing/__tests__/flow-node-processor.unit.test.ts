/* eslint-disable @typescript-eslint/unbound-method */
import { LocalPromptType } from 'src/generated/local';
import { Test, TestingModule } from '@nestjs/testing';
import { FlowNodeProcessor, flowNodeSet } from '../flow-node-processor.service';
import {
  IQueueService,
  QueueJob,
} from '../../queue/interfaces/queue.interface';
import { DomainEventPublisher } from '../../events/domain-event-publisher';
import { MessageService } from '../../../services/message.service';
import { ConversationService } from '../../../services/conversation.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import { IJobEnqueuer } from '../../../services/interfaces/job-enqueuer.interface';
import { IntentDetectorService } from '../../../services/intent-detector.service';
import { QUEUE_SERVICE_TOKEN } from '../../queue/queue.module';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../events/tokens';
import { JOB_ENQUEUER_TOKEN } from '../../../services/job.tokens';
import {
  FlowUserMessage,
  NodeType,
  ConversationNode,
} from '../../../types/flow-internal.types';
import { NodeRegistry } from '../../../flows/nodes/node-registry.service';
import {
  WorkflowId,
  ProjectId,
  OrganizationId,
  UserId,
  ConversationId,
  RequestId,
  MessageId,
  JobId,
} from '../../../types';
import {
  MessageStatus,
  QuestionsSystemMessageData,
  SystemMessageResponseType,
} from 'src/generated';
import { EVENT_TYPES } from '../../events/types/event.types';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { RedisService } from '../../redis/redis.service';
import { PromptBuilderService } from '../../../services/llm/prompt-builder.service';
import { FlowNodeErrorRecoveryService } from '../../../services/workflows/flow-node-error-recovery.service';
import { LLMClientService } from '../../../services/llm/llm-client.service';
import { ClaudeModel } from '../../../services/llm/llm-shared';
import { z } from 'zod';
import * as TestUtils from '../../../utils/testUtils';
import { FlowNodeQueueJob } from '../../../services/interfaces/job-enqueuer.interface';
const { testIds } = TestUtils;

describe('FlowNodeProcessor Unit Tests', () => {
  let processor: FlowNodeProcessor;
  let mockJobEnqueuer: jest.Mocked<IJobEnqueuer>;
  let mockEventPublisher: jest.Mocked<DomainEventPublisher>;
  let mockMessageService: jest.Mocked<MessageService>;
  let mockQueueService: jest.Mocked<IQueueService>;
  let mockConversationService: jest.Mocked<ConversationService>;
  let mockFlowEngineService: jest.Mocked<NodeExecutionService>;
  let mockInitiativeService: jest.Mocked<InitiativeService>;
  let mockPromptBuilderService: jest.Mocked<PromptBuilderService>;
  let mockIntentDetectorService: jest.Mocked<IntentDetectorService>;
  let mockFlowNodeErrorRecoveryService: jest.Mocked<FlowNodeErrorRecoveryService>;
  let mockLLMClientService: jest.Mocked<LLMClientService>;
  let mockFlowExecutionService: jest.Mocked<FlowExecutionService>;
  let mockTemporalClient: jest.Mocked<any>;
  let mockRedis: jest.Mocked<{
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  }>;

  beforeEach(async () => {
    // Clear singleton set before each test
    flowNodeSet.clear();

    // Clear all mocks
    jest.clearAllMocks();

    // Create mocks using TestUtils
    mockJobEnqueuer = TestUtils.createMockJobEnqueuer();
    mockJobEnqueuer.queueFlowNodeExecution.mockResolvedValue({
      id: 'flow-job-123' as JobId,
      queueName: 'flow_node',
      organizationId: testIds.organization,
      projectId: testIds.project,
      data: {},
      createdAt: new Date(),
    });

    mockEventPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
      publishInTransaction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DomainEventPublisher>;

    mockMessageService = {
      updateMessage: jest.fn().mockResolvedValue({}),
      getMessage: jest.fn().mockResolvedValue({
        id: 'msg-123',
        data: {
          type: 'QUESTIONS',
          response: 'Test response',
          data: {},
          uiElements: [],
        },
      }),
      updateSystemMessageWithLLMResponse: jest
        .fn()
        .mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MessageService>;

    mockQueueService = {
      getJob: jest.fn().mockResolvedValue({
        id: 'job-123',
        queueName: 'flow_node',
      }),
    } as unknown as jest.Mocked<IQueueService>;

    mockConversationService = TestUtils.createMockConversationService() as any;
    mockFlowEngineService = TestUtils.createMockFlowEngineService() as any;
    (mockFlowEngineService as any).getNode = jest
      .fn()
      .mockImplementation((flowId: string, nodeId: string) => {
        const nodeType =
          nodeId === 'opener-node' ? NodeType.OPENER : NodeType.LLM_QUESTIONS;
        return {
          node: {
            id: nodeId,
            type: nodeType,
            promptConfig: { systemPromptTemplate: '', userPromptTemplate: '' },
            action: jest.fn(),
          } as any,
          routing: {},
        };
      });
    (mockFlowEngineService as any).executeInjectableNode = jest
      .fn()
      .mockResolvedValue({
        result: {
          message: 'Welcome!',
          data: {},
          type: NodeType.OPENER,
          uiElements: [],
        },
      });
    mockInitiativeService = TestUtils.createMockInitiativeService() as any;
    mockPromptBuilderService =
      TestUtils.createMockPromptBuilderService() as any;
    mockPromptBuilderService.buildPrompt.mockResolvedValue({
      systemPrompt: 'Test system prompt',
      userPrompt: 'User message: Test message',
      fullPrompt: 'Test system prompt\n\nUser message: Test message',
      temperature: 0.7,
    });
    mockIntentDetectorService =
      TestUtils.createMockIntentDetectorService() as any;
    mockFlowNodeErrorRecoveryService =
      TestUtils.createMockFlowNodeErrorRecoveryService() as any;
    mockLLMClientService = TestUtils.createMockLLMClientService() as any;
    mockTemporalClient = TestUtils.createMockTemporalClient() as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlowNodeProcessor,
        {
          provide: QUEUE_SERVICE_TOKEN,
          useValue: mockQueueService,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
        {
          provide: JOB_ENQUEUER_TOKEN,
          useValue: mockJobEnqueuer,
        },
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
        {
          provide: 'TEMPORAL_CLIENT',
          useValue: mockTemporalClient,
        },
        {
          provide: ConversationService,
          useValue: mockConversationService,
        },
        {
          provide: NodeExecutionService,
          useValue: mockFlowEngineService,
        },
        {
          provide: NodeRegistry,
          useValue: { getNode: jest.fn(), registerNode: jest.fn() },
        },
        {
          provide: InitiativeService,
          useValue: mockInitiativeService,
        },
        {
          provide: PromptBuilderService,
          useValue: mockPromptBuilderService,
        },
        {
          provide: IntentDetectorService,
          useValue: mockIntentDetectorService,
        },
        {
          provide: FlowNodeErrorRecoveryService,
          useValue: mockFlowNodeErrorRecoveryService,
        },
        {
          provide: LLMClientService,
          useValue: mockLLMClientService,
        },
        {
          provide: FlowExecutionService,
          useValue: { sendNodeResponseToWorkflow: jest.fn() },
        },
        {
          provide: 'APP_CONTEXT',
          useValue: {
            get: jest.fn().mockImplementation((token) => {
              if (token === IntentDetectorService) {
                return mockIntentDetectorService;
              }
              return {};
            }),
          },
        },
        createRedisServiceMock(),
      ],
    }).compile();

    processor = module.get<FlowNodeProcessor>(FlowNodeProcessor);
    mockFlowExecutionService = module.get(
      FlowExecutionService,
    ) as jest.Mocked<FlowExecutionService>;

    // Get the Redis mock from the RedisService
    const redisService = module.get<RedisService>(RedisService);
    mockRedis = redisService.getClient() as unknown as jest.Mocked<{
      get: jest.Mock;
      set: jest.Mock;
      del: jest.Mock;
    }>;

    // Configure FlowEngineService specific mocks
    (mockFlowEngineService as any).getFlow.mockReturnValue({
      nodes: {
        'test-node': {
          nextNode: 'next-node',
        },
        'opener-node': {
          nextNode: 'next-node',
        },
      },
    } as any);

    (mockFlowEngineService as any).getNode.mockImplementation(
      (flowId: string, nodeId: string) => {
        if (nodeId === 'test-node' || nodeId === 'node-id') {
          return {
            id: nodeId,
            type: NodeType.LLM_QUESTIONS,
            promptConfig: {
              systemPromptTemplate: 'Test system prompt',
              responseSchema: z.any(),
              temperature: 0.7,
            },
            transitions: [
              { condition: () => true, nextNodeId: 'next-node' },
              { condition: () => false, nextNodeId: 'fallback-node' },
            ],
            action: jest.fn().mockResolvedValue({
              message: 'Test prompt',
              data: {},
              uiElements: [],
            }),
          } as any;
        }
        if (nodeId === 'opener-node') {
          return {
            id: 'opener-node',
            type: NodeType.OPENER,
            nextNode: 'next-node',
            action: jest.fn().mockResolvedValue({
              message: 'Welcome!',
              data: {},
              uiElements: [],
            }),
          } as any;
        }
        if (nodeId === 'node-123') {
          return {
            id: 'node-123',
            type: NodeType.LLM_QUESTIONS,
            promptConfig: {
              systemPromptTemplate: 'Test system prompt',
              responseSchema: z.any(),
              temperature: 0.7,
            },
            transitions: [
              { condition: () => true, nextNodeId: 'next-node' },
              { condition: () => false, nextNodeId: 'fallback-node' },
            ],
            action: jest.fn().mockResolvedValue({
              message: 'Test prompt',
              data: {},
              uiElements: [],
            }),
          } as any;
        }
        return null;
      },
    );

    (mockFlowEngineService as any).executeInjectableNode.mockResolvedValue({
      result: {
        message: 'Welcome!',
        data: {},
        uiElements: [],
      },
      nextNodeId: null,
    });

    (mockFlowEngineService as any).getPreviousNode.mockReturnValue(null);
    (mockFlowEngineService as any).determineNextNode.mockResolvedValue(
      'next-node',
    );
  });

  afterEach(async () => {
    // Clean up singleton
    if (processor) {
      processor.onModuleDestroy();
    }
    flowNodeSet.clear();
  });

  describe('requiresLLM', () => {
    it('should return true for LLM_QUESTIONS nodes', () => {
      const gatherNode = {
        id: 'test',
        type: NodeType.LLM_QUESTIONS,
      } as ConversationNode;
      const result = processor['requiresLLM'](gatherNode);
      expect(result).toBe(true);
    });

    it('should return true for ANALYZE nodes', () => {
      const analyzeNode = {
        id: 'test',
        type: NodeType.ANALYZE,
      } as ConversationNode;
      const result = processor['requiresLLM'](analyzeNode);
      expect(result).toBe(true);
    });

    it('should return true for GENERATE nodes', () => {
      const generateNode = {
        id: 'test',
        type: NodeType.GENERATE,
      } as ConversationNode;
      const result = processor['requiresLLM'](generateNode);
      expect(result).toBe(true);
    });

    it('should return false for OPENER nodes', () => {
      const openerNode = {
        id: 'test',
        type: NodeType.OPENER,
      } as ConversationNode;
      const result = processor['requiresLLM'](openerNode);
      expect(result).toBe(false);
    });

    it('should return false for CONFIRM nodes', () => {
      const confirmNode = {
        id: 'test',
        type: NodeType.CONFIRM,
      } as ConversationNode;
      const result = processor['requiresLLM'](confirmNode);
      expect(result).toBe(false);
    });

    it('should return false for ACTION nodes', () => {
      const actionNode = {
        id: 'test',
        type: NodeType.ACTION,
      } as ConversationNode;
      const result = processor['requiresLLM'](actionNode);
      expect(result).toBe(false);
    });
  });

  describe('processFlowNode', () => {
    const mockFlowNodeJob: FlowNodeQueueJob = {
      id: 'job-123' as JobId,
      queueName: 'flow_node' as const,
      requestId: 'req-123' as RequestId,
      workflowId: 'wf-123' as WorkflowId,
      conversationId: 'conv-123' as ConversationId,
      messageId: 'msg-123' as MessageId,
      organizationId: 'org-123' as OrganizationId,
      projectId: 'proj-123' as ProjectId,
      userId: 'user-123' as UserId,
      userMessage: TestUtils.createMockFlowUserMessage({
        data: { message: 'Test message' },
      }),
      attempts: 1,
      maxAttempts: 5,
      data: {
        flowId: 'test-flow',
        nodeId: 'test-node',
        context: TestUtils.createMockFlowContext({
          core: {
            workflowId: 'wf-123' as WorkflowId,
            projectId: 'proj-123' as ProjectId,
            organizationId: 'org-123' as OrganizationId,
            conversationId: 'conv-123' as ConversationId,
            workflowAboutId: 'about-id',
            workflowAboutType: 'initiative',
            user: { id: 'user-123' as UserId, role: 'user' },
            session: { startTime: new Date(), interactionCount: 1 },
          },
          flowId: 'flowId',
        }),
        userMessage: TestUtils.createMockFlowUserMessage({
          data: { message: 'Test message' },
        }),
      },
      priority: 1,
      createdAt: new Date(),
    };

    it('should process LLM-requiring nodes directly', async () => {
      // Update the mock LLM response to include costData
      const mockLLMResponse = {
        type: 'QUESTIONS',
        response: 'Test LLM response',
        data: {},
        uiElements: [] as Array<any>,
      };

      mockLLMClientService.callStructured.mockResolvedValue({
        content: mockLLMResponse,
        costData: {
          model: ClaudeModel.CLAUDE_4_SONNET_6,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          inputCost: 0.001,
          outputCost: 0.002,
          totalCost: 0.003,
        },
      });

      (mockFlowEngineService as any).getNode.mockReturnValue({
        node: {
          id: 'test-node',
          type: NodeType.LLM_QUESTIONS,
          promptConfig: {
            systemPromptTemplate: '',
            userPromptTemplate: '',
            responseSchema: z.any(),
          },
        },
        routing: {},
      });

      // Execute
      await processor.processFlowNode(mockFlowNodeJob);

      // Verify FLOW_NODE.START event published and LLM invoked
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: EVENT_TYPES.FLOW_NODE.START }),
      );
      expect(mockJobEnqueuer.queueFlowNodeExecution).not.toHaveBeenCalled();
      expect(mockEventPublisher.publish).toHaveBeenCalled();
    });

    it('should disable streaming for flow-node LLM execution', async () => {
      const firstChunk: QuestionsSystemMessageData = {
        type: 'QUESTIONS',
        response: 'Partial response',
        detectedIntent: 'test',
        intentConfidence: 0.1,
        uiElements: [] as Array<any>,
      };

      const finalChunk: QuestionsSystemMessageData = {
        type: 'QUESTIONS',
        response: 'Final response',
        detectedIntent: 'test',
        intentConfidence: 0.9,
        uiElements: [] as Array<any>,
      };

      async function* createStream() {
        yield {
          content: firstChunk,
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
        yield {
          content: finalChunk,
          usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
          costData: {
            model: ClaudeModel.CLAUDE_4_SONNET_6,
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
            inputCost: 0.001,
            outputCost: 0.002,
            totalCost: 0.003,
          },
        };
      }

      mockLLMClientService.callStructured.mockImplementation(
        async (_prompt, options) => {
          if (options?.onProgress) {
            for await (const chunk of createStream()) {
              if (chunk.content) {
                options.onProgress(chunk.content);
              }
            }
          }
          return {
            content: finalChunk,
            usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
            costData: {
              model: ClaudeModel.CLAUDE_4_SONNET_6,
              inputTokens: 12,
              outputTokens: 8,
              totalTokens: 20,
              inputCost: 0.001,
              outputCost: 0.002,
              totalCost: 0.003,
            },
          };
        },
      );

      (mockFlowEngineService as any).getNode.mockReturnValue({
        node: {
          id: 'test-node',
          type: NodeType.LLM_QUESTIONS,
          promptConfig: {
            systemPromptTemplate: '',
            userPromptTemplate: '',
            responseSchema: z.any(),
          },
        },
        routing: {},
      });

      await processor.processFlowNode(mockFlowNodeJob);

      expect(mockLLMClientService.callStructured).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stream: false,
        }),
        expect.any(Object),
      );
      expect(
        mockMessageService.updateSystemMessageWithLLMResponse,
      ).not.toHaveBeenCalled();
    });

    it('should rethrow processLlmResponse failures instead of returning raw payload', async () => {
      const error = new Error('post-processing failed');
      const node = {
        id: 'test-node',
        type: NodeType.LLM_QUESTIONS,
        processLlmResponse: jest.fn().mockRejectedValue(error),
      } as any;

      await expect(
        processor['executeNodeProcessLlmResponse'](
          node,
          { response: 'raw' } as any,
          undefined,
          {
            getContext: () => mockFlowNodeJob.data.context,
          } as any,
          'test-node',
          undefined,
          mockFlowNodeJob.messageId,
        ),
      ).rejects.toThrow('post-processing failed');
    });

    it('should complete with failed response when processLlmResponse throws in completion', async () => {
      const node = {
        id: 'test-node',
        type: NodeType.LLM_QUESTIONS,
        processLlmResponse: jest
          .fn()
          .mockRejectedValue(new Error('invalid llm payload')),
      } as any;

      (mockFlowEngineService as any).getNode.mockReturnValue({
        node,
        routing: {},
      });

      await processor['completeLLMNode']({
        requestId: mockFlowNodeJob.requestId,
        workflowId: mockFlowNodeJob.workflowId,
        status: 'success',
        messageId: mockFlowNodeJob.messageId as MessageId,
        organizationId: mockFlowNodeJob.organizationId,
        nodeId: 'test-node',
        nodeType: NodeType.LLM_QUESTIONS,
        tracker: {
          getContext: () => mockFlowNodeJob.data.context,
        } as any,
        flowId: mockFlowNodeJob.data.flowId,
        systemMessageData: { response: 'raw payload' } as any,
      });

      expect(
        mockFlowExecutionService.sendNodeResponseToWorkflow,
      ).toHaveBeenCalledWith(
        mockFlowNodeJob.requestId,
        mockFlowNodeJob.workflowId,
        expect.objectContaining({
          type: SystemMessageResponseType.Error,
        }),
        null,
        true,
        expect.anything(),
      );
    });

    it('should execute directly for non-LLM nodes', async () => {
      // Change node type to OPENER (non-LLM)
      const nonLLMJob: FlowNodeQueueJob = {
        id: 'job-123' as JobId,
        queueName: 'flow_node' as const,
        requestId: 'req-123' as RequestId,
        workflowId: 'wf-123' as WorkflowId,
        conversationId: 'conv-123' as ConversationId,
        messageId: 'msg-123' as MessageId,
        organizationId: 'org-123' as OrganizationId,
        projectId: 'proj-123' as ProjectId,
        userId: 'user-123' as UserId,
        userMessage: TestUtils.createMockFlowUserMessage({
          data: { message: 'test message' },
        }),
        attempts: 1,
        maxAttempts: 5,
        createdAt: new Date(),
        data: {
          flowId: 'test-flow',
          nodeId: 'opener-node',
          context: TestUtils.createMockFlowContext({
            core: {
              workflowId: 'wf-123' as WorkflowId,
              projectId: 'proj-123' as ProjectId,
              organizationId: 'org-123' as OrganizationId,
              conversationId: 'conv-123' as ConversationId,
              workflowAboutId: 'about-id',
              workflowAboutType: 'initiative',
              user: { id: 'user-123' as UserId, role: 'user' },
              session: { startTime: new Date(), interactionCount: 0 },
            },
            flowId: 'flow-123',
          }),
          userMessage: TestUtils.createMockFlowUserMessage(),
        },
      };

      // Mock flow engine to return OPENER node
      const mockFlowEngine = processor[
        'nodeExecutionService'
      ] as jest.Mocked<NodeExecutionService>;
      mockFlowEngine.getFlow.mockReturnValue({
        id: 'test-flow',
        name: 'Test Flow',
        description: 'Test flow',
        version: 1,
        nodes: {
          'opener-node': {
            nextNode: 'next-node',
          },
        },
        startNode: 'opener-node',
        terminalPromptType: LocalPromptType.free_form,
      });

      // Mock pending message
      mockRedis.get.mockResolvedValueOnce('msg-123');

      (mockFlowEngineService as any).getNode.mockReturnValue({
        node: {
          id: 'opener-node',
          type: NodeType.OPENER,
          promptConfig: { systemPromptTemplate: '', userPromptTemplate: '' },
          action: jest.fn(),
        },
        routing: {},
      });

      (mockFlowEngineService as any).executeNode.mockResolvedValue({
        result: {
          type: NodeType.OPENER,
          message: 'Welcome!',
          data: {},
          uiElements: [],
        },
        nextNodeId: 'next-node',
      });

      // Execute
      await processor.processFlowNode(nonLLMJob);

      // Verify no LLM client call for non-LLM node
      expect(mockLLMClientService.callStructured).not.toHaveBeenCalled();
      expect(mockMessageService.updateMessage).toHaveBeenCalled();
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
        }),
      );
    });
  });
});
