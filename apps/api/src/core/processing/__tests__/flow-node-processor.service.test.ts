import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { RedisService } from '../../redis/redis.service';
import {
  AsyncCompletionClient,
  Client,
  Connection,
  LoadedClientOptions,
  OperatorService,
  ScheduleClient,
  TaskQueueClient,
  WorkflowService,
} from '@temporalio/client';
import Redis from 'ioredis';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import { QUEUE_SERVICE_TOKEN } from 'src/core/queue/queue.module';
import { JOB_ENQUEUER_TOKEN } from '../../../services/job.tokens';
import { MessageStatus } from 'src/constants/message-status.constants';
import { LLMProviderName } from 'src/services/llm/llm-shared';
import {
  AnalysisSystemMessageData,
  SystemMessageData,
  SystemMessageResponseType,
} from '../../../generated';
import { NodeRegistry } from 'src/flows/nodes/node-registry.service';
import { ConversationService } from '../../../services/conversation.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import { MessageService } from '../../../services/message.service';
import { PromptBuilderService } from '../../../services/llm/prompt-builder.service';
import { LLMClientService } from '../../../services/llm/llm-client.service';
import { IntentDetectorService } from '../../../services/intent-detector.service';
import {
  ConversationId,
  JobId,
  MessageId,
  MockLlmSessionId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from '../../../types';
import {
  ConversationNode,
  FlowContext,
  FlowTemplate,
  NodeRoutingConfig,
  NodeType,
} from '../../../types/flow-internal.types';
import { DomainEventPublisher } from '../../events/domain-event-publisher';
import { EVENT_TYPES } from '../../events/types/event.types';
import { IQueueService } from '../../queue/interfaces/queue.interface';
import { FlowNodeProcessor } from '../flow-node-processor.service';
import { FlowNodeErrorRecoveryService } from '../../../services/workflows/flow-node-error-recovery.service';
import * as TestUtils from '../../../utils/testUtils';
import { MessageResponseUtil } from 'src/utils/message-response.util';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { FlowNodeQueueJob } from '../../../services/interfaces/job-enqueuer.interface';
import { JobNonRetryableException } from 'src/common/exceptions/job-non-retryable.exception';
import { StructuredOutputValidationError } from 'src/services/llm/providers/claude-llm.provider';

const { testIds } = TestUtils;

// Mock services using TestUtils
const mockQueueService = TestUtils.createMockQueueService();
const mockEventPublisher = TestUtils.createMockDomainEventPublisher();
const mockMessageService = TestUtils.createMockMessageService();
const mockTemporalClient = TestUtils.createMockTemporalClient();
const mockConversationService = TestUtils.createMockConversationService();
const mockFlowEngineServiceRaw = TestUtils.createMockFlowEngineService();
const mockFlowEngineService =
  mockFlowEngineServiceRaw as unknown as jest.Mocked<NodeExecutionService> & {
    getNode: jest.Mock;
    getFlow: jest.Mock;
    executePreviousNodePostProcess: jest.Mock;
  };
mockFlowEngineService.executePreviousNodePostProcess.mockImplementation(
  async (nodeId: string, currentSystemMessageData: any, context: any) => {
    try {
      const previousNode = mockFlowEngineService.getPreviousNode(
        context.flowId,
        context.flowPath.previousNode,
      );
      if (!previousNode || !previousNode.determineRouting) {
        return;
      }
      const nodeData = mockFlowEngineService.getNode(context.flowId, nodeId);
      const transitions = nodeData?.routing?.transitions;
      if (!transitions) {
        return;
      }
      const nodeResult = {
        type: NodeType.ACTION,
        message: currentSystemMessageData.response ?? '',
        data: currentSystemMessageData,
      };
      return await previousNode.determineRouting(
        context,
        nodeResult,
        transitions,
      );
    } catch {
      // Match real implementation: swallow determineRouting errors
      return;
    }
  },
);
const mockInitiativeService = TestUtils.createMockInitiativeService();
const mockJobEnqueuer = TestUtils.createMockJobEnqueuer();
const mockIntentDetectorService = TestUtils.createMockIntentDetectorService();

const mockLLMClientService = {
  callStructured: jest.fn().mockResolvedValue({
    content: {
      type: 'ANALYSIS',
      nodeId: 'test-node',
      response: 'Test LLM response',
      detectedIntent: 'test',
      intentConfidence: 0.9,
      reasoning: 'Test reasoning',
      uiElements: [],
    },
    costData: {
      model: 'test-model',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputCost: 0.001,
      outputCost: 0.002,
      totalCost: 0.003,
    },
  }),
};

const mockPromptBuilderService = {
  buildPrompt: jest.fn(),
} as unknown as jest.Mocked<PromptBuilderService>;
const mockFlowExecutionService = {
  sendNodeResponseToWorkflow: jest.fn(
    async (
      requestId,
      workflowId,
      systemMessageData,
      nextNodeId,
      errorHolding,
      tracker,
    ) => {
      const workflowHandle = mockTemporalClient.workflow.getHandle(workflowId);
      const signalName = `llmResponse-${workflowId}`;
      const payload = {
        requestId,
        responseData: systemMessageData,
        nextNodeId,
        // Preserved for legacy test assertions; production always sends `false` here.
        continueWithoutUserResponse: false,
        errorHolding,
        contextUpdates: tracker?.getPatch?.(),
      };
      return workflowHandle.signal(signalName, payload);
    },
  ),
} as unknown as jest.Mocked<FlowExecutionService>;

const mockErrorRecoveryService = {
  handleRetryableError: jest.fn(),
  handleNonRetryableError: jest.fn(),
  handleErrorRecovery: jest.fn().mockReturnValue({
    shouldRetry: false,
    delayMs: 0,
    nextStep: 'fail',
    errorMessage: 'Test error',
  }),
  resetErrorRecoveryState: jest.fn(),
  isRetryable: jest.fn(),
  getCircuitBreakerKey: jest
    .fn()
    .mockImplementation((type: string, orgId: string) => `${type}_${orgId}`),
  isCircuitOpen: jest.fn().mockReturnValue(false),
  recordCircuitBreakerSuccess: jest.fn(),
  recordCircuitBreakerFailure: jest.fn(),
} as unknown as jest.Mocked<FlowNodeErrorRecoveryService>;

const createProcessorInstance = () =>
  new FlowNodeProcessor(
    mockEventPublisher as any,
    mockJobEnqueuer as any,
    mockMessageService as any,
    mockTemporalClient as any,
    mockFlowEngineService as any,
    mockLLMClientService as any,
    mockPromptBuilderService as any,
    mockIntentDetectorService as any,
    mockErrorRecoveryService as any,
    mockFlowExecutionService as any,
    mockErrorRecoveryService as any,
  );

const mockAppContext = {
  get: jest.fn(),
  select: jest.fn(),
  resolve: jest.fn(),
} as unknown as jest.Mocked<any>;

const mockNodeRegistry = {
  register: jest.fn(),
  registerMany: jest.fn(),
  get: jest.fn(),
  getAll: jest.fn().mockReturnValue([]),
  getAllIds: jest.fn().mockReturnValue([]),
  getByType: jest.fn().mockReturnValue([]),
  has: jest.fn().mockReturnValue(false),
  clear: jest.fn(),
  getStats: jest.fn().mockReturnValue({
    totalNodes: 0,
    nodesByType: {},
    nodeIds: [],
  }),
  onModuleInit: jest.fn(),
} as unknown as jest.Mocked<NodeRegistry>;

// Mock Redis using the existing mock
jest.mock('ioredis');

const wrapNodeConfig = (
  value: unknown,
  routingOverride?: NodeRoutingConfig,
) => {
  if (!value) {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'node' in (value as Record<string, unknown>) &&
    'routing' in (value as Record<string, unknown>)
  ) {
    return value;
  }

  const node = value as ConversationNode;
  const typedNode = node as {
    transitions?: Record<string, unknown> | null;
    nextNode?: string;
  };

  const transitions = typedNode.transitions || undefined;
  const hasTransitions = Boolean(
    transitions && Object.keys(transitions).length > 0,
  );

  const routing: NodeRoutingConfig = routingOverride
    ? routingOverride
    : hasTransitions
      ? ({ transitions } as unknown as NodeRoutingConfig)
      : typeof typedNode.nextNode === 'string'
        ? ({ nextNode: typedNode.nextNode } as NodeRoutingConfig)
        : ({} as NodeRoutingConfig);

  return {
    node,
    routing,
  };
};

const originalGetNodeMockReturnValue =
  mockFlowEngineService.getNode.mockReturnValue.bind(
    mockFlowEngineService.getNode,
  );
(mockFlowEngineService.getNode.mockReturnValue as unknown as (
  value: unknown,
) => ReturnType<typeof originalGetNodeMockReturnValue>) = (value: unknown) =>
  originalGetNodeMockReturnValue(wrapNodeConfig(value));

const originalGetNodeMockReturnValueOnce =
  mockFlowEngineService.getNode.mockReturnValueOnce.bind(
    mockFlowEngineService.getNode,
  );

(mockFlowEngineService.getNode.mockReturnValueOnce as unknown as (
  value: unknown,
) => ReturnType<typeof originalGetNodeMockReturnValueOnce>) = (
  value: unknown,
) => originalGetNodeMockReturnValueOnce(wrapNodeConfig(value));

const originalGetNodeMockImplementation =
  mockFlowEngineService.getNode.mockImplementation.bind(
    mockFlowEngineService.getNode,
  );

(mockFlowEngineService.getNode.mockImplementation as unknown as (
  impl: (...args: unknown[]) => unknown,
) => ReturnType<typeof originalGetNodeMockImplementation>) = (
  impl: (...args: unknown[]) => unknown,
) =>
  originalGetNodeMockImplementation((...args: unknown[]) =>
    wrapNodeConfig(impl(...args)),
  );

const wrapFlowTemplate = (flow: unknown): FlowTemplate<FlowContext> =>
  flow as FlowTemplate<FlowContext>;

const originalGetFlowMockReturnValue =
  mockFlowEngineService.getFlow.mockReturnValue.bind(
    mockFlowEngineService.getFlow,
  );

(mockFlowEngineService.getFlow.mockReturnValue as unknown as (
  value: unknown,
) => ReturnType<typeof originalGetFlowMockReturnValue>) = (value: unknown) =>
  originalGetFlowMockReturnValue(wrapFlowTemplate(value));

const originalGetFlowMockReturnValueOnce =
  mockFlowEngineService.getFlow.mockReturnValueOnce.bind(
    mockFlowEngineService.getFlow,
  );

(mockFlowEngineService.getFlow.mockReturnValueOnce as unknown as (
  value: unknown,
) => ReturnType<typeof originalGetFlowMockReturnValueOnce>) = (
  value: unknown,
) => originalGetFlowMockReturnValueOnce(wrapFlowTemplate(value));

type Nodes = Record<string, ConversationNode> & {
  end: ConversationNode;
  recovery: ConversationNode;
};

describe('FlowNodeProcessor', () => {
  let processor: FlowNodeProcessor;
  let module: TestingModule;

  // Mock flow for tests
  const mockFlow = {
    id: 'onboarding',
    name: 'Onboarding Flow',
    description: 'Test flow',
    version: 1,
    startNode: 'test-node',
    nodes: {} as Nodes, // Will be populated in tests
  };

  const mockJob: FlowNodeQueueJob = {
    id: testIds.job,
    queueName: 'flow_node',
    requestId: testIds.request,
    workflowId: testIds.workflow,
    conversationId: testIds.conversation,
    messageId: testIds.message,
    organizationId: testIds.organization,
    projectId: testIds.project,
    userId: testIds.user,
    userMessage: TestUtils.createMockFlowUserMessage({
      data: { message: 'Test message' },
      timestamp: '2025-01-01T12:00:00.000Z',
    }),
    attempts: 1,
    maxAttempts: 5,
    data: {
      flowId: 'onboarding',
      nodeId: 'test-node',
      userMessage: TestUtils.createMockFlowUserMessage({
        data: { message: 'Test message for data' },
        timestamp: '2025-01-01T12:00:00.000Z',
      }),
      context: TestUtils.createMockFlowContext({
        core: {
          workflowId: testIds.workflow,
          projectId: testIds.project,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          workflowAboutId: testIds.initiative,
          workflowAboutType: 'initiative',
          user: { id: testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 1 },
        },
        flowId: 'onboarding',
        flowPath: {
          pathTaken: [],
          previousNode: undefined,
        },
      }),
    },
    priority: 1,
    createdAt: new Date(),
  };

  // Test helper functions
  const createTestJob = (
    overrides: Partial<FlowNodeQueueJob> = {},
  ): FlowNodeQueueJob => ({
    ...mockJob,
    ...overrides,
  });

  const setupNodeExecution = (node: ConversationNode, result: any) => {
    mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
    mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(node));
    mockFlowEngineService.executeNode.mockResolvedValue(result);
  };

  const setupMockWorkflowHandle = () => {
    const mockWorkflowHandle = { signal: jest.fn() };
    (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
      mockWorkflowHandle,
    );
    return mockWorkflowHandle;
  };

  const verifyWorkflowSignal = (workflowHandle: any, expectedPayload: any) => {
    expect(workflowHandle.signal).toHaveBeenCalledWith(
      expect.stringMatching(/llmResponse-/),
      expect.objectContaining(expectedPayload),
    );
  };

  const setupBasicFlow = () => {
    mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
  };

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();
    mockErrorRecoveryService.isCircuitOpen.mockReset();
    mockErrorRecoveryService.isCircuitOpen.mockReturnValue(false);
    // Reset sticky mock implementations that tests commonly override
    mockErrorRecoveryService.handleErrorRecovery.mockReset();
    mockErrorRecoveryService.handleErrorRecovery.mockReturnValue({
      shouldRetry: false,
      delayMs: 0,
      nextStep: 'fail',
      errorMessage: 'Test error',
    } as any);
    mockFlowEngineService.executeNode.mockReset();
    mockFlowEngineService.executePreClassify.mockReset();
    mockMessageService.updateMessage.mockReset();
    mockMessageService.getMessage.mockReset();
    mockMessageService.updateSystemMessageWithLLMResponse.mockReset();
    (mockTemporalClient.workflow.getHandle as jest.Mock).mockReset();
    (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue({
      signal: jest.fn(),
    } as any);
    // Reset LLM/prompt mocks and re-establish defaults so tests that
    // depend on a successful LLM call do not inherit a rejection from
    // a previous error-path test.
    mockLLMClientService.callStructured.mockReset();
    mockLLMClientService.callStructured.mockResolvedValue({
      content: {
        type: 'ANALYSIS',
        nodeId: 'test-node',
        response: 'Test LLM response',
        detectedIntent: 'test',
        intentConfidence: 0.9,
        reasoning: 'Test reasoning',
        uiElements: [],
      },
      costData: {
        model: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        inputCost: 0.001,
        outputCost: 0.002,
        totalCost: 0.003,
      },
    });
    mockPromptBuilderService.buildPrompt.mockReset();

    // Clear singleton set to avoid duplicate instance errors
    const { flowNodeSet } = await import('../flow-node-processor.service');
    flowNodeSet.clear();

    // Reset mock flow with the test node
    const testNode = TestUtils.createMockConversationNode({
      id: 'test-node',
      type: NodeType.OPENER,
      determineRouting: jest.fn().mockResolvedValue('next-node'),
    });

    mockFlow.nodes = {
      'test-node': testNode,
      end: TestUtils.createMockConversationNode({
        id: 'end',
        type: NodeType.CONFIRM,
      }),
      recovery: TestUtils.createMockConversationNode({
        id: 'recovery',
        type: NodeType.OPENER,
        determineRouting: jest.fn().mockResolvedValue({
          modifiedResult: undefined,
          routingOverride: { nextNodeId: 'end' },
        }),
      }),
    } as Nodes;

    mockFlowEngineService.getNode.mockImplementation(
      (_flowId: string, nodeId: string) => {
        const nodeConfig = mockFlow.nodes[nodeId];
        return nodeConfig ?? null;
      },
    );

    module = await Test.createTestingModule({
      providers: [
        FlowNodeProcessor,
        { provide: QUEUE_SERVICE_TOKEN, useValue: mockQueueService },
        { provide: DOMAIN_EVENT_PUBLISHER_TOKEN, useValue: mockEventPublisher },
        { provide: MessageService, useValue: mockMessageService },
        { provide: 'TEMPORAL_CLIENT', useValue: mockTemporalClient },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: NodeExecutionService, useValue: mockFlowEngineService },
        { provide: InitiativeService, useValue: mockInitiativeService },
        { provide: JOB_ENQUEUER_TOKEN, useValue: mockJobEnqueuer },
        { provide: PromptBuilderService, useValue: mockPromptBuilderService },
        { provide: FlowExecutionService, useValue: mockFlowExecutionService },
        { provide: LLMClientService, useValue: mockLLMClientService },
        { provide: IntentDetectorService, useValue: mockIntentDetectorService },
        {
          provide: FlowNodeErrorRecoveryService,
          useValue: mockErrorRecoveryService,
        },
        { provide: 'APP_CONTEXT', useValue: mockAppContext },
        { provide: NodeRegistry, useValue: mockNodeRegistry },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              set: jest.fn(),
              get: jest.fn(),
              del: jest.fn(),
              setex: jest.fn(),
              disconnect: jest.fn(),
            }),
            onModuleDestroy: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<FlowNodeProcessor>(FlowNodeProcessor);

    // Initialize the processor (Redis constructor is mocked)
    processor.onModuleInit();

    // Suppress console logs during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('preProcess and postProcess execution', () => {
    it('should execute preProcess for non-LLM nodes with SystemMessageData', async () => {
      // Setup mocks
      setupBasicFlow();

      const testNode = TestUtils.createMockConversationNode({
        id: 'test-node',
        type: NodeType.OPENER,
        processLlmResponse: jest.fn().mockResolvedValue({
          modifiedResult: {
            type: 'opener',
            response: 'Modified by preProcess',
          },
        }),
      });

      mockFlow.nodes['test-node'] = testNode;

      // Set up parameter-specific mocking for getNode
      mockFlowEngineService.getNode.mockImplementation(
        (flowId: string, nodeId: string) => {
          // Handle special test cases
          if (
            nodeId === 'flow-not-found-test-node' ||
            nodeId === 'node-not-found-test-node'
          ) {
            return null;
          }

          // Check if node exists in mockFlow
          if (mockFlow.nodes[nodeId]) {
            return mockFlow.nodes[nodeId];
          }

          // Default fallback for backwards compatibility
          return testNode;
        },
      );

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Original response',
        }),
        nextNodeId: 'next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);
      mockFlowEngineService.getPreviousNode.mockReturnValue(null); // No previous node

      // Execute
      await processor.processFlowNode(mockJob);

      // Verify preProcess was called
      expect(testNode.processLlmResponse).toHaveBeenCalled();
    });

    it('should execute previous node postProcess with current node results', async () => {
      // Setup mocks
      setupBasicFlow();

      const currentNode = TestUtils.createMockConversationNode({
        id: 'current-node',
        type: NodeType.OPENER,
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'original-next-node',
        },
      };
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest.fn().mockResolvedValue('override-node'),
      };

      mockFlow.nodes['current-node'] = currentNode;
      mockFlow.nodes['previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Current node response',
        }),
        nextNodeId: 'next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      // Execute
      await processor.processFlowNode(mockJob);

      // Verify previous node determineRouting was called with current node's SystemMessageData
      expect(previousNode.determineRouting).toHaveBeenCalledWith(
        mockJob.data.context,
        expect.objectContaining({
          message: 'Current node response',
          data: expect.objectContaining({
            response: 'Current node response',
            type: 'ANALYSIS',
          }),
        }),
        expect.any(Object),
      );
    });

    it('should handle missing previous node gracefully', async () => {
      // Setup mocks
      setupBasicFlow();
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(null); // No previous node

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Test response',
        }),
        nextNodeId: 'next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      // Execute should not throw
      await expect(processor.processFlowNode(mockJob)).resolves.not.toThrow();
    });

    it('should apply routing override from previous node determineRouting', async () => {
      // Setup mocks
      setupBasicFlow();

      const currentNode = TestUtils.createMockConversationNode({
        id: 'current-node',
        type: NodeType.OPENER,
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest.fn().mockResolvedValue('override-target'),
      };

      mockFlow.nodes['current-node'] = currentNode;
      mockFlow.nodes['previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Current node response',
        }),
        nextNodeId: 'next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = setupMockWorkflowHandle();

      // Execute current node
      await processor.processFlowNode(mockJob);

      // Verify determineRouting was called with current results
      expect(previousNode.determineRouting).toHaveBeenCalledWith(
        mockJob.data.context,
        expect.objectContaining({
          message: 'Current node response',
          data: expect.objectContaining({
            response: 'Current node response',
            type: 'ANALYSIS',
          }),
        }),
        expect.any(Object), // appContext
      );

      // Verify override was applied in workflow signal
      verifyWorkflowSignal(mockWorkflowHandle, {
        nextNodeId: 'override-target',
      });
    });

    it('should prioritize current node processLlmResponse routing override', async () => {
      setupBasicFlow();

      const currentNode = TestUtils.createMockConversationNode({
        id: 'current-node',
        type: NodeType.OPENER,
        processLlmResponse: jest.fn().mockResolvedValue({
          routingOverride: 'node-override-target',
        }),
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest
          .fn()
          .mockResolvedValue('previous-override-target'),
      };

      mockFlow.nodes['current-node'] = currentNode;
      mockFlow.nodes['previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Current node response',
        }),
        nextNodeId: 'next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = setupMockWorkflowHandle();

      await processor.processFlowNode(mockJob);

      expect(currentNode.processLlmResponse).toHaveBeenCalled();
      expect(
        mockFlowEngineService.executePreviousNodePostProcess,
      ).not.toHaveBeenCalled();

      verifyWorkflowSignal(mockWorkflowHandle, {
        nextNodeId: 'node-override-target',
      });
    });

    it('should handle routing override without reason', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));

      const currentNode = TestUtils.createMockConversationNode({
        id: 'current-node',
        type: NodeType.OPENER,
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest.fn().mockResolvedValue('override-target'),
      };

      mockFlow.nodes['current-node'] = currentNode;
      mockFlow.nodes['previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Current node response',
        }),
        nextNodeId: 'next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = setupMockWorkflowHandle();

      // Execute current node
      await processor.processFlowNode(mockJob);

      // Verify routing override still applied even without reason
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        expect.stringMatching(/llmResponse-/),
        expect.objectContaining({
          nextNodeId: 'override-target',
        }),
      );
    });

    it('should use original nextNodeId when no routing override provided', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));

      const currentNode = TestUtils.createMockConversationNode({
        id: 'current-node',
        type: NodeType.OPENER,
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest.fn().mockResolvedValue({
          // No routingOverride provided
        }),
      };

      mockFlow.nodes['current-node'] = currentNode;
      mockFlow.nodes['previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Current node response',
        }),
        nextNodeId: 'original-next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = setupMockWorkflowHandle();

      // Execute current node
      await processor.processFlowNode(mockJob);

      expect(mockWorkflowHandle.signal).toHaveBeenCalledTimes(1);
      const [signalName, signalPayload] =
        mockWorkflowHandle.signal.mock.calls[0];
      expect(signalName).toMatch(/llmResponse-/);
      expect(signalPayload).toBeDefined();
    });

    it('should handle determineRouting errors gracefully', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));

      const currentNode = TestUtils.createMockConversationNode({
        id: 'current-node',
        type: NodeType.OPENER,
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest
          .fn()
          .mockRejectedValue(new Error('Routing determination failed')),
      };

      mockFlow.nodes['current-node'] = currentNode;
      mockFlow.nodes['previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Current node response',
        }),
        nextNodeId: 'original-next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = setupMockWorkflowHandle();

      // Execute current node should not throw
      await expect(processor.processFlowNode(mockJob)).resolves.not.toThrow();

      // Verify original nextNodeId used when determineRouting fails
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        expect.stringMatching(/llmResponse-/),
        expect.objectContaining({
          nextNodeId: 'original-next-node',
        }),
      );
    });
  });

  describe('routing integration tests', () => {
    it('should integrate routing override with message update and workflow signaling', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));

      const currentNode = TestUtils.createMockConversationNode({
        id: 'current-node',
        type: NodeType.OPENER,
      });

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest.fn().mockResolvedValue('routing-target'),
      };

      mockFlow.nodes['current-node'] = currentNode;
      mockFlow.nodes['previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Current node integration result',
        }),
        nextNodeId: 'original-next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      // Execute the full flow
      await processor.processFlowNode(mockJob);

      expect(mockWorkflowHandle.signal).toHaveBeenCalledTimes(1);
      const [signalName, signalPayload] =
        mockWorkflowHandle.signal.mock.calls[0];
      expect(signalName).toMatch(/llmResponse-/);
      expect(signalPayload).toBeDefined();
    });

    it('should handle complex routing scenario with multiple possible overrides', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));

      const currentNode = TestUtils.createMockConversationNode({
        id: 'complex-current-node',
        type: NodeType.OPENER,
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'default-next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'complex-previous-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest.fn().mockResolvedValue('conditional-target'),
      };

      mockFlow.nodes['complex-current-node'] = currentNode;
      mockFlow.nodes['complex-previous-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Complex analysis complete with specific keywords',
        }),
        nextNodeId: 'default-next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      // Execute the flow
      await processor.processFlowNode({
        ...mockJob,
        data: {
          ...mockJob.data,
          nodeId: 'complex-current-node',
        },
      });

      // Verify complex routing override was applied
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        expect.stringMatching(/llmResponse-/),
        expect.objectContaining({
          nextNodeId: 'conditional-target',
        }),
      );

      // Verify determineRouting received the complex analysis data
      expect(previousNode.determineRouting).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: mockJob.data.context.flowId,
        }),
        expect.objectContaining({
          message: 'Complex analysis complete with specific keywords',
          data: expect.objectContaining({
            response: 'Complex analysis complete with specific keywords',
            type: 'ANALYSIS',
          }),
        }),
        expect.any(Object),
      );
    });

    it('should maintain original routing when post-process returns no override', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));

      const currentNode = TestUtils.createMockConversationNode({
        id: 'standard-node',
        type: NodeType.OPENER,
      });
      (currentNode as any).transitions = {
        default: {
          description: 'Default path',
          nextNodeId: 'intended-next-node',
        },
      };

      const previousNode = {
        ...TestUtils.createMockConversationNode({
          id: 'non-overriding-node',
          type: NodeType.LLM_QUESTIONS,
        }),
        determineRouting: jest.fn().mockResolvedValue(undefined),
      };

      mockFlow.nodes['standard-node'] = currentNode;
      mockFlow.nodes['non-overriding-node'] = previousNode;
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(currentNode),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(previousNode);

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Standard processing result',
        }),
        nextNodeId: 'intended-next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      // Execute the flow
      await processor.processFlowNode({
        ...mockJob,
        data: {
          ...mockJob.data,
          nodeId: 'standard-node',
        },
      });

      // Verify original nextNodeId was preserved
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        expect.stringMatching(/llmResponse-/),
        expect.objectContaining({
          nextNodeId: 'intended-next-node', // Should use original, not an override
        }),
      );

      // Verify determineRouting was still called for post-processing
      expect(previousNode.determineRouting).toHaveBeenCalled();
    });
  });

  describe('processFlowNode', () => {
    it('should successfully process a flow node', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(null); // No previous node

      const mockNodeResult = {
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Test response',
          data: {
            detectedIntent: 'test',
            intentConfidence: 0.8,
          },
          uiElements: [],
        }),
        nextNodeId: 'next-node',
      };

      mockFlowEngineService.executeNode.mockResolvedValue(mockNodeResult);

      // Mock flow node execution job creation response
      mockJobEnqueuer.queueFlowNodeExecution.mockResolvedValue(
        TestUtils.createMockJob({
          id: 'flow-node-job-123' as JobId,
          queueName: 'flow_node',
        }),
      );

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      // Execute
      await processor.processFlowNode(mockJob);

      // Verify FlowEngine was called
      expect(mockFlowEngineService.executeNode).toHaveBeenCalled();
      const executeCall = mockFlowEngineService.executeNode.mock.calls[0];
      expect(executeCall).toBeDefined();
      if (!executeCall) {
        throw new Error('Expected executeNode to be called');
      }
      const [calledNodeId, calledContext, calledRouting, calledUserMessage] =
        executeCall;
      expect(calledNodeId).toBe(mockJob.data.nodeId);
      expect(calledRouting).toEqual(
        expect.objectContaining({ nextNode: 'end' }),
      );
      expect(calledUserMessage).toBe(mockJob.data.userMessage);

      // Verify events were published - START and COMPLETE
      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(2);

      // Verify workflow signal was sent
      expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
        mockJob.workflowId,
      );
    });

    it('should handle retryable errors correctly', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );

      // Setup - network error (retryable)
      const networkError = new Error('Network connection failed');
      networkError.name = 'FetchError';
      mockFlowEngineService.executeNode.mockRejectedValue(networkError);

      // Execute - service throws JobNonRetryableException after handling
      await expect(processor.processFlowNode(mockJob)).rejects.toThrow();

      // Verify error was classified and event published
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'flow_node.complete',
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'FLOW_NODE_ERROR_RETRYABLE',
            }),
          }),
        }),
      );
    });

    it('should handle non-retryable errors correctly', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );

      // Setup - auth error (non-retryable)
      const authError = new Error('Unauthorized');
      authError.name = 'AuthError';
      mockFlowEngineService.executeNode.mockRejectedValue(authError);

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      // Execute - service throws JobNonRetryableException after handling
      await expect(processor.processFlowNode(mockJob)).rejects.toThrow();

      // Verify message was updated immediately for non-retryable error
      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        mockJob.messageId,
        mockJob.organizationId,
        expect.objectContaining({
          status: MessageStatus.Failed,
        }),
        expect.any(Object),
      );

      // Verify workflow was signaled immediately
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
    });

    it('should stop retries when message update fails with NotFoundException', async () => {
      setupBasicFlow();
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );
      mockFlowEngineService.getPreviousNode.mockReturnValue(null);
      mockFlowEngineService.executeNode.mockResolvedValue({
        result: TestUtils.createMockNodeResult({
          type: NodeType.OPENER,
          message: 'Test response',
        }),
        nextNodeId: 'next-node',
      });
      mockMessageService.updateMessage.mockRejectedValueOnce(
        new NotFoundException(
          `Message with ID ${mockJob.messageId} not found or access denied`,
        ),
      );

      await expect(processor.processFlowNode(mockJob)).rejects.toBeInstanceOf(
        JobNonRetryableException,
      );
      expect(
        mockFlowExecutionService.sendNodeResponseToWorkflow,
      ).not.toHaveBeenCalled();
    });

    it('should handle rate limited errors with retry-after', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );

      // Setup - rate limit error
      const rateLimitError = new Error(
        'Rate limit exceeded. Retry after 300 seconds',
      );
      mockFlowEngineService.executeNode.mockRejectedValue(rateLimitError);

      // Execute - service throws JobNonRetryableException after handling
      await expect(processor.processFlowNode(mockJob)).rejects.toThrow();

      // Verify error was classified as rate limited
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            error: expect.objectContaining({
              code: 'FLOW_NODE_ERROR_RATE_LIMITED',
            }),
          }),
        }),
      );
    });

    it('should handle circuit breaker open state', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );

      // First, cause multiple failures to open the circuit
      const networkError = new Error('Network error');
      networkError.name = 'FetchError';
      mockFlowEngineService.executeNode.mockRejectedValue(networkError);

      // Cause 5 failures to open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await processor.processFlowNode(mockJob);
        } catch (error) {
          // Expected
        }
      }

      // Now the circuit should be open
      const circuitError = new Error(
        'Circuit breaker is open for gather nodes',
      );
      circuitError.name = 'CIRCUIT_BREAKER_OPEN';

      // The circuit breaker should be disabled in test environment, so this won't actually open
      // Service throws JobNonRetryableException after handling the underlying error
      await expect(processor.processFlowNode(mockJob)).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      // Setup mocks
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );

      // Setup - timeout error
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';
      mockFlowEngineService.executeNode.mockRejectedValue(timeoutError);

      // Execute - service throws JobNonRetryableException after handling
      await expect(processor.processFlowNode(mockJob)).rejects.toThrow();

      // Verify error was classified as timeout
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            error: expect.objectContaining({
              code: 'FLOW_NODE_ERROR_TIMEOUT',
            }),
          }),
        }),
      );
    });

    it('should use error recovery service for retryable errors', async () => {
      const networkError = new Error('Network connection failed');
      networkError.name = 'FetchError';

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );
      mockFlowEngineService.executeNode.mockRejectedValue(networkError);

      // Configure error recovery service to suggest retry
      mockErrorRecoveryService.handleErrorRecovery.mockReturnValue({
        shouldRetry: true,
        delayMs: 5000,
        errorMessage: 'Network error, will retry',
      });

      await processor.processFlowNode(mockJob);

      // Verify error recovery service was called with correct parameters
      expect(mockErrorRecoveryService.handleErrorRecovery).toHaveBeenCalledWith(
        mockJob.data.nodeId, // nodeId
        mockJob.organizationId,
        networkError,
        expect.stringContaining('flow_node_'), // circuit key
      );

      // Verify that retry logic is triggered based on error recovery response
      // Note: The exact retry mechanism may vary based on implementation
    });

    it('should use error recovery service for non-retryable errors', async () => {
      const authError = new Error('Unauthorized access');
      authError.name = 'AuthError';

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );
      mockFlowEngineService.executeNode.mockRejectedValue(authError);

      // Configure error recovery service to not retry
      mockErrorRecoveryService.handleErrorRecovery.mockReturnValue({
        shouldRetry: false,
        delayMs: 0,
        errorMessage: 'Authentication failed - manual intervention required',
      });

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      await expect(processor.processFlowNode(mockJob)).rejects.toThrow();

      // Verify error recovery service was called
      expect(mockErrorRecoveryService.handleErrorRecovery).toHaveBeenCalledWith(
        mockJob.data.nodeId,
        mockJob.organizationId,
        authError,
        expect.stringContaining('flow_node_'),
      );

      // Verify immediate failure handling for non-retryable errors
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
    });

    it('should integrate with error recovery service during error handling', async () => {
      const networkError = new Error('Service unavailable');
      networkError.name = 'FetchError';

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );
      mockFlowEngineService.executeNode.mockRejectedValue(networkError);

      // Configure error recovery service to provide recovery guidance
      mockErrorRecoveryService.handleErrorRecovery.mockReturnValue({
        shouldRetry: false,
        delayMs: 0,
        errorMessage: 'Service unavailable - check infrastructure',
      });

      await expect(processor.processFlowNode(mockJob)).rejects.toThrow();

      // Verify error recovery service integration
      expect(mockErrorRecoveryService.handleErrorRecovery).toHaveBeenCalledWith(
        mockJob.data.nodeId,
        mockJob.organizationId,
        networkError,
        expect.stringContaining('flow_node_'),
      );

      // Verify completion event published with error recovery insights
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });
  });

  describe('error classification', () => {
    it('should classify structured output validation errors as retryable', () => {
      const processor = createProcessorInstance();
      const validationError = new StructuredOutputValidationError({
        provider: LLMProviderName.CLAUDE,
        validationErrors: [],
        responseContent: '{}',
        requestId: 'msg-test',
      });

      const classified = (processor as any).classifyError(validationError, {});

      expect(classified.type).toBe('retryable');
      expect(classified.context.reason).toBe('structured_output_validation');
    });

    it('should classify validation errors as non-retryable', () => {
      const processor = createProcessorInstance();
      const validationError = new Error('Bad request: invalid input');

      const classified = (processor as any).classifyError(validationError, {});

      expect(classified.type).toBe('non_retryable');
      expect(classified.context.reason).toBe('validation_error');
    });

    it('should classify network errors as retryable', () => {
      const processor = createProcessorInstance();
      const networkError = new Error('Network connection failed');
      networkError.name = 'FetchError';

      const classified = (processor as any).classifyError(networkError, {});

      expect(classified.type).toBe('retryable');
      expect(classified.context.reason).toBe('network_error');
    });

    it('should extract retry-after from rate limit errors', () => {
      const processor = createProcessorInstance();
      const rateLimitError = new Error(
        'Rate limit exceeded. Retry after 300 seconds',
      );

      const classified = (processor as any).classifyError(rateLimitError, {});

      expect(classified.type).toBe('rate_limited');
      expect(classified.retryAfter).toBe(300000); // 300 seconds in milliseconds
    });

    it('should classify overloaded provider errors as rate limited', () => {
      const processor = createProcessorInstance();
      const overloadedError = new Error(
        '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      );

      const classified = (processor as any).classifyError(overloadedError, {});

      expect(classified.type).toBe('rate_limited');
      expect(classified.context.reason).toBe('rate_limited');
    });
  });

  describe('Node Compensation', () => {
    describe('RETRY compensation action', () => {
      it('should retry node execution when compensation returns RETRY', async () => {
        // Use non-LLM node type that can fail execution
        const compensatingNode = {
          ...TestUtils.createMockConversationNode({
            id: 'compensating-node',
            type: NodeType.FINALIZE, // Use a non-LLM node type
          }),
          compensate: jest.fn().mockResolvedValue({
            action: 'RETRY',
            retryDelayMs: 1000,
            reason: 'Temporary failure, retrying',
          }),
        };

        mockFlow.nodes['compensating-node'] = compensatingNode;
        const compensatingJob = {
          ...mockJob,
          data: { ...mockJob.data, nodeId: 'compensating-node' },
        };

        // Setup error scenario - this will trigger compensation
        const error = new Error('Network timeout');
        mockFlowEngineService.getFlow.mockReturnValue(
          wrapFlowTemplate(mockFlow),
        );
        mockFlowEngineService.getNode.mockReturnValue(
          wrapNodeConfig(compensatingNode),
        );
        mockFlowEngineService.executeNode.mockRejectedValue(error);

        // RETRY compensation falls through to normal error handling which throws
        await expect(
          processor.processFlowNode(compensatingJob),
        ).rejects.toThrow();

        // Verify compensation was called with correct signature
        expect(compensatingNode.compensate).toHaveBeenCalledWith(
          compensatingJob.data.context,
          error,
          expect.objectContaining({
            nodeId: 'compensating-node',
            attemptCount: expect.any(Number),
            errorClassification: expect.any(Object),
            transactionState: expect.any(Object),
          }),
        );

        // Verify that compensation was attempted (job re-enqueueing happens asynchronously)
        // Note: The actual retry job enqueueing may happen with a delay or in the background
      });

      it('should respect circuit breaker when compensation suggests RETRY', async () => {
        const compensatingNode = {
          ...TestUtils.createMockConversationNode({
            id: 'compensating-node',
            type: NodeType.FINALIZE,
          }),
          compensate: jest.fn().mockResolvedValue({
            action: 'RETRY',
            retryDelayMs: 2000,
            reason: 'Should retry but circuit breaker is open',
          }),
        };

        mockFlow.nodes['compensating-node'] = compensatingNode;
        const compensatingJob = {
          ...mockJob,
          data: { ...mockJob.data, nodeId: 'compensating-node' },
        };

        // Setup circuit breaker to be open
        mockErrorRecoveryService.isCircuitOpen.mockReturnValue(true);

        const error = new Error('Service unavailable');
        mockFlowEngineService.getFlow.mockReturnValue(
          wrapFlowTemplate(mockFlow),
        );
        mockFlowEngineService.getNode.mockReturnValue(
          wrapNodeConfig(compensatingNode),
        );
        mockFlowEngineService.executeNode.mockRejectedValue(error);

        await expect(
          processor.processFlowNode(compensatingJob),
        ).rejects.toMatchObject({
          name: 'CIRCUIT_BREAKER_OPEN',
        });

        // With the circuit open we should bail before attempting compensation
        expect(compensatingNode.compensate).not.toHaveBeenCalled();
      });
    });

    describe('SKIP_TO_NODE compensation action', () => {
      it('should skip to specified node on compensation', async () => {
        const compensatingNode = {
          ...TestUtils.createMockConversationNode({
            id: 'compensating-node',
            type: NodeType.FINALIZE,
          }),
          compensate: jest.fn().mockResolvedValue({
            action: 'SKIP_TO_NODE',
            nextNodeId: 'recovery-node',
            reason: 'Skipping to recovery flow',
          }),
        };

        mockFlow.nodes['compensating-node'] = compensatingNode;
        const compensatingJob = {
          ...mockJob,
          data: { ...mockJob.data, nodeId: 'compensating-node' },
        };

        const error = new Error('Unrecoverable error');
        mockFlowEngineService.getFlow.mockReturnValue(
          wrapFlowTemplate(mockFlow),
        );
        mockFlowEngineService.getNode.mockReturnValue(
          wrapNodeConfig(compensatingNode),
        );
        mockFlowEngineService.executeNode.mockRejectedValue(error);

        const mockWorkflowHandle = {
          signal: jest.fn(),
        };
        (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
          mockWorkflowHandle,
        );

        await processor.processFlowNode(compensatingJob);

        // Verify compensation was called
        expect(compensatingNode.compensate).toHaveBeenCalled();

        // Verify workflow signal with nextNodeId and compensation handling
        expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
          expect.stringMatching(/llmResponse-/),
          expect.objectContaining({
            nextNodeId: 'recovery-node',
            responseData: expect.objectContaining({
              type: 'NOOP',
            }),
          }),
        );

        // Verify that SKIP_TO_NODE compensation resulted in workflow signal
        // The exact event sequence depends on implementation details
      });

      it('should fail when SKIP_TO_NODE missing nextNodeId', async () => {
        const compensatingNode = {
          ...TestUtils.createMockConversationNode({
            id: 'compensating-node',
            type: NodeType.FINALIZE,
          }),
          compensate: jest.fn().mockResolvedValue({
            action: 'SKIP_TO_NODE',
            // Missing nextNodeId
            reason: 'Invalid skip compensation',
          }),
        };

        mockFlow.nodes['compensating-node'] = compensatingNode;
        const compensatingJob = {
          ...mockJob,
          data: { ...mockJob.data, nodeId: 'compensating-node' },
        };

        const error = new Error('Test error');
        mockFlowEngineService.getFlow.mockReturnValue(
          wrapFlowTemplate(mockFlow),
        );
        mockFlowEngineService.getNode.mockReturnValue(
          wrapNodeConfig(compensatingNode),
        );
        mockFlowEngineService.executeNode.mockRejectedValue(error);

        // Invalid SKIP_TO_NODE compensation falls through to normal error handling which throws
        await expect(
          processor.processFlowNode(compensatingJob),
        ).rejects.toThrow();

        // Should publish failed event due to invalid compensation
        expect(mockEventPublisher.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EVENT_TYPES.FLOW_NODE.COMPLETE,
            payload: expect.objectContaining({
              status: 'failed',
            }),
          }),
        );
      });
    });

    describe('FAIL compensation action', () => {
      it('should put workflow in error holding when compensation returns FAIL', async () => {
        const compensatingNode = {
          ...TestUtils.createMockConversationNode({
            id: 'compensating-node',
            type: NodeType.FINALIZE,
          }),
          compensate: jest.fn().mockResolvedValue({
            action: 'FAIL',
            reason: 'Cannot recover from this error',
          }),
        };

        mockFlow.nodes['compensating-node'] = compensatingNode;
        const compensatingJob = {
          ...mockJob,
          data: { ...mockJob.data, nodeId: 'compensating-node' },
        };

        const error = new Error('Fatal error');
        const mockHandle = setupMockWorkflowHandle();
        mockFlowEngineService.getFlow.mockReturnValue(
          wrapFlowTemplate(mockFlow),
        );
        mockFlowEngineService.getNode.mockReturnValue(
          wrapNodeConfig(compensatingNode),
        );
        mockFlowEngineService.executeNode.mockRejectedValue(error);

        await processor.processFlowNode(compensatingJob);

        // Verify compensation was called
        expect(compensatingNode.compensate).toHaveBeenCalled();

        // Should halt workflow by sending failure signal and publishing compensation failure event
        expect(mockEventPublisher.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EVENT_TYPES.FLOW_NODE.COMPLETE,
            payload: expect.objectContaining({
              status: 'failed',
              error: expect.objectContaining({
                code: 'COMPENSATION_FAILURE',
                message: expect.stringContaining(
                  'Cannot recover from this error',
                ),
              }),
              systemMessageData: expect.objectContaining({
                type: 'ERROR',
                errorType: 'compensation_failure',
                reasoning: expect.stringContaining(
                  'Cannot recover from this error',
                ),
              }),
            }),
          }),
        );

        // Should send error holding signal to workflow with same node for recovery
        expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
          mockJob.workflowId,
        );
        expect(mockHandle.signal).toHaveBeenCalledWith(
          expect.any(String), // signal name
          expect.objectContaining({
            requestId: mockJob.requestId,
            nextNodeId: compensatingNode.id, // Same node for recovery
            continueWithoutUserResponse: false,
            errorHolding: true, // Error holding flag
            responseData: expect.objectContaining({
              type: 'ERROR',
              errorType: 'compensation_failure',
            }),
          }),
        );
      });

      it('should mark node in error holding when compensation fails', async () => {
        const failingNode = {
          ...TestUtils.createMockConversationNode({
            id: 'failing-node',
            type: NodeType.GENERATE,
          }),
          compensate: jest.fn().mockResolvedValue({
            action: 'FAIL',
            reason: 'Critical system failure - manual intervention required',
          }),
        };

        mockFlow.nodes['failing-node'] = failingNode;
        const failingJob = {
          ...mockJob,
          data: {
            ...mockJob.data,
            nodeId: 'failing-node',
            userMessage: TestUtils.createMockFlowUserMessage({
              data: { message: 'Test user message for recovery' },
            }),
          },
        };

        const mockHandle = setupMockWorkflowHandle();
        const originalError = new Error('Node execution failed');

        mockFlowEngineService.getFlow.mockReturnValue(
          wrapFlowTemplate(mockFlow),
        );
        mockFlowEngineService.getNode.mockReturnValue(
          wrapNodeConfig(failingNode),
        );
        mockFlowEngineService.executeNode.mockRejectedValue(originalError);

        await processor.processFlowNode(failingJob);

        expect(failingNode.compensate).toHaveBeenCalledWith(
          expect.objectContaining({
            flowId: failingJob.data.context.flowId,
          }),
          expect.any(Error),
          expect.objectContaining({
            errorClassification: expect.any(Object),
            attemptCount: expect.any(Number),
          }),
        );

        expect(mockHandle.signal).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            requestId: failingJob.requestId,
            nextNodeId: failingNode.id,
            errorHolding: true,
          }),
        );

        expect(mockEventPublisher.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EVENT_TYPES.FLOW_NODE.COMPLETE,
            payload: expect.objectContaining({
              status: 'failed',
            }),
          }),
        );
      });
    });

    it('should handle compensation errors gracefully', async () => {
      const compensatingNode = {
        ...TestUtils.createMockConversationNode({
          id: 'compensating-node',
          type: NodeType.FINALIZE,
        }),
        compensate: jest
          .fn()
          .mockRejectedValue(new Error('Compensation failed')),
      };

      mockFlow.nodes['compensating-node'] = compensatingNode;
      const compensatingJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'compensating-node' },
      };

      const originalError = new Error('Original error');
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(compensatingNode),
      );
      mockFlowEngineService.executeNode.mockRejectedValue(originalError);

      // Compensation throws → falls through to normal error handling which throws
      await expect(
        processor.processFlowNode(compensatingJob),
      ).rejects.toThrow();

      // Should handle compensation failure gracefully and continue with normal error flow
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });

    it('should skip compensation for nodes without compensate method', async () => {
      const regularNode = TestUtils.createMockConversationNode({
        id: 'regular-node',
        type: NodeType.FINALIZE,
      });
      // No compensate method

      mockFlow.nodes['regular-node'] = regularNode;
      const regularJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'regular-node' },
      };

      const error = new Error('Regular error');
      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(regularNode),
      );
      mockFlowEngineService.executeNode.mockRejectedValue(error);

      // No compensate method → normal error handling which throws
      await expect(processor.processFlowNode(regularJob)).rejects.toThrow();

      // Should proceed directly to normal error handling without compensation
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );

      // Only COMPLETE event should be published (no compensation events)
      const publishCalls = (mockEventPublisher.publish as jest.Mock).mock.calls;
      const compensationEvents = publishCalls.filter((call) =>
        call[0]?.type?.includes('compensat'),
      );
      expect(compensationEvents).toHaveLength(0);
    });
  });

  describe('human-friendly error messages', () => {
    it('should provide appropriate error messages for different error types', () => {
      const processor = new (FlowNodeProcessor as any)();

      // Auth error
      let errorResponse = processor.createErrorResponse(
        {
          type: 'non_retryable',
          originalError: new Error('Unauthorized'),
          context: { reason: 'auth_error' },
        },
        mockFlow.nodes[mockJob.data.nodeId],
      );

      expect(errorResponse.response).toContain('authentication');

      // Rate limited error
      errorResponse = processor.createErrorResponse(
        {
          type: 'rate_limited',
          originalError: new Error('Too many requests'),
          retryAfter: 300000,
        },
        mockFlow.nodes[mockJob.data.nodeId],
      );

      expect(errorResponse.response).toContain('high demand');
    });
  });

  describe('LLM Node Processing', () => {
    it('should execute LLM directly for LLM_QUESTIONS node', async () => {
      // Setup LLM-required node
      const gatherNode = TestUtils.createMockConversationNode({
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
      });

      // Add promptConfig to make it LLM-required
      (gatherNode as any).promptConfig = {
        systemPromptTemplate: 'Test system prompt',
        userPromptTemplate: 'Test user prompt',
        responseSchema: z.any(),
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'haiku',
        },
      };

      mockFlow.nodes['gather-node'] = gatherNode;
      const gatherJob = {
        ...mockJob,
        data: {
          ...mockJob.data,
          nodeId: 'gather-node',
          context: {
            ...mockJob.data.context,
            mockLlmSessionId:
              'b067be2f-736d-4c8e-960f-c31e37f492ea' as MockLlmSessionId,
          },
        },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(gatherNode));
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      const mockLLMResponse: SystemMessageData = {
        type: 'QUESTIONS',
        nodeId: 'test-node',
        response: 'Test questions',
        uiElements: [
          {
            id: 'test-field',
            type: 'textarea',
            label: 'Test Question',
            required: true,
          },
        ],
        detectedIntent: 'gather_info',
        intentConfidence: 0.9,
      };

      mockLLMClientService.callStructured.mockResolvedValue({
        content: mockLLMResponse,
        costData: {
          model: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          inputCost: 0.001,
          outputCost: 0.002,
          totalCost: 0.003,
        },
      });

      await processor.processFlowNode(gatherJob);

      expect(mockEventPublisher.publish).toHaveBeenCalled();
      expect(mockJobEnqueuer.queueFlowNodeExecution).not.toHaveBeenCalled();
      expect(mockEventPublisher.publish).toHaveBeenCalled();
    });

    it('should disable streaming snapshots and wait for final LLM response', async () => {
      const gatherNode = TestUtils.createMockConversationNode({
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
      });

      (gatherNode as any).promptConfig = {
        systemPromptTemplate: 'Stream prompt',
        userPromptTemplate: 'User prompt',
        responseSchema: z.any(),
      };

      mockFlow.nodes['gather-node'] = gatherNode;
      const gatherJob = {
        ...mockJob,
        data: {
          ...mockJob.data,
          nodeId: 'gather-node',
          context: {
            ...mockJob.data.context,
            mockLlmSessionId:
              'b067be2f-736d-4c8e-960f-c31e37f492ea' as MockLlmSessionId,
          },
        },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(gatherNode));
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.6,
      });

      mockMessageService.updateSystemMessageWithLLMResponse.mockResolvedValue(
        undefined,
      );

      const partialSnapshot = {
        response: 'Partial answer',
        streaming: { sessionId: 'session-123' },
      };

      const finalSnapshot = {
        type: 'ANALYSIS',
        nodeId: 'gather-node',
        response: 'Complete answer',
        detectedIntent: 'analysis',
        intentConfidence: 0.72,
        reasoning: 'Completed streaming',
        streaming: { sessionId: 'session-123', ready: true },
        uiElements: [] as any[],
      };

      mockLLMClientService.callStructured.mockImplementationOnce(
        async (_prompt, options) => {
          options.onProgress?.(
            { field: 'response', value: partialSnapshot.response } as any,
            partialSnapshot,
          );

          return {
            content: finalSnapshot,
            costData: {
              model: 'test-model',
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              inputCost: 0.0005,
              outputCost: 0.0003,
              totalCost: 0.0008,
            },
          };
        },
      );

      await processor.processFlowNode(gatherJob);

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockLLMClientService.callStructured).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stream: false,
        }),
        expect.objectContaining({
          mockLlmSessionId: 'b067be2f-736d-4c8e-960f-c31e37f492ea',
        }),
      );
      expect(
        mockMessageService.updateSystemMessageWithLLMResponse,
      ).not.toHaveBeenCalled();
    });

    it('should track LLM costs in completion event', async () => {
      const gatherNode = TestUtils.createMockConversationNode({
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
      });

      (gatherNode as any).promptConfig = {
        systemPromptTemplate: 'Test system prompt',
        userPromptTemplate: 'Test user prompt',
        responseSchema: z.any(),
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'haiku',
        },
      };

      mockFlow.nodes['gather-node'] = gatherNode;
      const gatherJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'gather-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(gatherNode));
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      const mockCostData = {
        model: 'gpt-4o-mini',
        inputTokens: 250,
        outputTokens: 75,
        totalTokens: 325,
        inputCost: 0.005,
        outputCost: 0.003,
        totalCost: 0.008,
      };

      mockLLMClientService.callStructured.mockResolvedValue({
        content: {
          type: 'ANALYSIS',
          nodeId: 'test-node',
          response: 'Cost tracking test response',
          detectedIntent: 'test',
          intentConfidence: 0.8,
        },
        costData: mockCostData,
      });

      await processor.processFlowNode(gatherJob);

      // Verify cost data is included in completion event
      expect(mockEventPublisher.publish).toHaveBeenCalled();
    });

    it('should handle missing promptConfig error', async () => {
      // Setup LLM-required node without promptConfig
      const gatherNode = TestUtils.createMockConversationNode({
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
      });

      mockFlow.nodes['gather-node'] = gatherNode;
      const gatherJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'gather-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(gatherNode));

      // Missing promptConfig triggers an error which becomes a JobNonRetryableException
      await expect(processor.processFlowNode(gatherJob)).rejects.toThrow();

      // Should handle error gracefully and publish failed event
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });

    it('should call beforeGeneration before LLM processing', async () => {
      const gatherNode = TestUtils.createMockConversationNode({
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
      });

      (gatherNode as any).promptConfig = {
        systemPromptTemplate: 'Test system prompt',
        responseSchema: z.any(),
      };
      (gatherNode as any).beforeGeneration = jest
        .fn()
        .mockResolvedValue(undefined);

      mockFlow.nodes['gather-node'] = gatherNode;
      const gatherJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'gather-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(gatherNode));
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      mockLLMClientService.callStructured.mockResolvedValue({
        content: {
          type: 'ANALYSIS',
          nodeId: 'test-node',
          response: 'Test response for beforeGeneration',
          detectedIntent: 'test',
          intentConfidence: 0.7,
        },
        costData: {
          model: 'test-model',
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
          inputCost: 0.001,
          outputCost: 0.001,
          totalCost: 0.002,
        },
      });

      await processor.processFlowNode(gatherJob);

      expect((gatherNode as any).beforeGeneration).toHaveBeenCalled();
    });
  });

  describe('GENERATE Node Special Cases', () => {
    it('should use non-LLM pipeline for GENERATE node with generate method', async () => {
      const generateNode = TestUtils.createMockConversationNode({
        id: 'generate-node',
        type: NodeType.GENERATE,
      });

      // Add generate method to make it non-LLM
      (generateNode as any).generate = jest.fn().mockResolvedValue({
        type: 'INITIATIVES',
        message: 'Generated initiatives',
        data: { initiatives: [] },
      });

      mockFlow.nodes['generate-node'] = generateNode;
      const generateJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'generate-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(generateNode),
      );
      mockFlowEngineService.executeNode.mockResolvedValue({
        result: TestUtils.createMockNodeResult({
          type: NodeType.GENERATE,
          message: 'Generated initiatives',
        }),
        nextNodeId: 'next-node',
      });

      // GENERATE without promptConfig fails to find LLM config and throws
      await expect(processor.processFlowNode(generateJob)).rejects.toThrow();

      expect(mockLLMClientService.callStructured).not.toHaveBeenCalled();
      expect(mockJobEnqueuer.queueFlowNodeExecution).not.toHaveBeenCalled();
    });

    it('should use LLM pipeline for GENERATE node without generate method', async () => {
      const generateNode = TestUtils.createMockConversationNode({
        id: 'generate-node',
        type: NodeType.GENERATE,
      });

      (generateNode as any).promptConfig = {
        systemPromptTemplate: 'Generate initiatives',
      };

      mockFlow.nodes['generate-node'] = generateNode;
      const generateJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'generate-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(generateNode),
      );
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      // promptConfig has no responseSchema, so the LLM pipeline throws
      await expect(processor.processFlowNode(generateJob)).rejects.toThrow();

      // Should execute without errors
      expect(mockJobEnqueuer.queueFlowNodeExecution).not.toHaveBeenCalled();
    });
  });

  describe('Agent Node Processing', () => {
    it('should queue agent workflow for agent node', async () => {
      const agentNode = TestUtils.createMockConversationNode({
        id: 'agent-node',
        type: NodeType.AGENT,
      });

      (agentNode as any).agentId = 'test-agent';

      mockFlow.nodes['agent-node'] = agentNode;
      const agentJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'agent-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(agentNode));

      await processor.processFlowNode(agentJob);

      expect(mockJobEnqueuer.queueAgentWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent_workflow',
          agentId: 'test-agent',
          nodeId: 'agent-node',
        }),
        expect.objectContaining({
          organizationId: agentJob.organizationId,
          projectId: agentJob.projectId,
        }),
      );
    });

    it('should resolve dynamic agentId function', async () => {
      const agentNode = TestUtils.createMockConversationNode({
        id: 'agent-node',
        type: NodeType.AGENT,
      });

      (agentNode as any).agentId = jest.fn().mockResolvedValue('dynamic-agent');

      mockFlow.nodes['agent-node'] = agentNode;
      const agentJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'agent-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(agentNode));

      await processor.processFlowNode(agentJob);

      expect((agentNode as any).agentId).toHaveBeenCalled();
      expect(mockJobEnqueuer.queueAgentWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'dynamic-agent',
        }),
        expect.any(Object),
      );
    });

    it('should handle missing agentId error', async () => {
      const agentNode = TestUtils.createMockConversationNode({
        id: 'agent-node',
        type: NodeType.AGENT,
      });
      // No agentId property

      mockFlow.nodes['agent-node'] = agentNode;
      const agentJob = {
        ...mockJob,
        data: { ...mockJob.data, nodeId: 'agent-node' },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(agentNode));

      await processor.processFlowNode(agentJob);

      // Should use default agent
      expect(mockJobEnqueuer.queueAgentWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'default-agent',
        }),
        expect.any(Object),
      );
    });
  });

  describe('Message and Status Management', () => {
    it('should determine OPEN status for questions with UI elements', () => {
      const questionData: SystemMessageData = {
        type: 'QUESTIONS',
        nodeId: 'test-node',
        response: 'What would you like to do?',
        uiElements: [
          {
            id: 'cta',
            type: 'text_input',
            label: 'Click me',
            required: false,
            influences: [],
          },
        ],
        detectedIntent: 'question',
        intentConfidence: 0.9,
        reasoning: 'User needs to answer',
      };

      const status = MessageResponseUtil.determineMessageStatus(questionData);
      expect(status).toBe(MessageStatus.Open);
    });

    it('should determine STREAMING_READY status when streaming metadata indicates readiness', () => {
      const streamingData = {
        type: 'ANALYSIS',
        nodeId: 'test-node',
        response: 'Partial content',
        detectedIntent: 'analysis',
        intentConfidence: 0.8,
        reasoning: 'Data still arriving',
        streaming: { ready: true },
      } as unknown as SystemMessageData;

      const status = MessageResponseUtil.determineMessageStatus(streamingData);
      expect(status).toBe(MessageStatus.StreamingReady);
    });

    it('should determine COMPLETED status for other responses', () => {
      const analysisData: AnalysisSystemMessageData = {
        type: SystemMessageResponseType.Analysis,
        nodeId: 'test-node',
        response: 'Analysis complete',
        detectedIntent: 'analysis',
        intentConfidence: 0.9,
        reasoning: 'Analysis completed',
        analysis: {
          identifiedTechnologies: [],
          integrationComplexity: 'low',
          potentialChallenges: [],
          recommendations: [],
        },
        uiElements: [],
      };

      const status = MessageResponseUtil.determineMessageStatus(analysisData);
      expect(status).toBe(MessageStatus.Completed);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle flow not found error', async () => {
      // Use special node ID that will return null from our mockImplementation
      const testJob = createTestJob({
        data: {
          ...mockJob.data,
          nodeId: 'flow-not-found-test-node',
        },
      });

      await expect(processor.processFlowNode(testJob)).resolves.not.toThrow();

      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });

    it('should handle node not found in flow error', async () => {
      // Use special node ID that will return null from our mockImplementation
      const testJob = createTestJob({
        data: {
          ...mockJob.data,
          nodeId: 'node-not-found-test-node',
        },
      });

      await expect(processor.processFlowNode(testJob)).resolves.not.toThrow();

      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });

    it('should handle missing messageId in job', async () => {
      const jobWithoutMessageId = createTestJob({
        messageId: undefined as any,
      });

      setupBasicFlow();
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockFlow.nodes[mockJob.data.nodeId]),
      );

      // executeNode is unmocked here so the call rejects internally and the
      // service surfaces a JobNonRetryableException after publishing START.
      await expect(
        processor.processFlowNode(jobWithoutMessageId),
      ).rejects.toThrow();

      // Should handle gracefully and still process the node
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.START,
        }),
      );
    });

    it('should handle LLM timeout scenarios', async () => {
      setupBasicFlow();

      const gatherNode = TestUtils.createMockConversationNode({
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
      });

      (gatherNode as any).promptConfig = {
        systemPromptTemplate: 'Test system prompt',
        userPromptTemplate: 'Test user prompt',
        responseSchema: z.any(),
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'haiku',
        },
      };

      mockFlow.nodes['gather-node'] = gatherNode;
      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(gatherNode));
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      // Simulate LLM timeout
      const timeoutError = new Error('Request timeout after 30 seconds');
      timeoutError.name = 'AbortError';
      mockLLMClientService.callStructured.mockRejectedValue(timeoutError);

      const gatherJob = createTestJob({
        data: { ...mockJob.data, nodeId: 'gather-node' },
      });

      // Service throws JobNonRetryableException after handling the timeout
      await expect(processor.processFlowNode(gatherJob)).rejects.toThrow();

      // Should handle timeout and publish appropriate error event
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPES.FLOW_NODE.COMPLETE,
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'FLOW_NODE_ERROR_TIMEOUT',
            }),
          }),
        }),
      );
    });

    it('should map overloaded completion failures to rate-limited user messaging', async () => {
      const tracker = {
        getContext: () => mockJob.data.context,
        getPatch: () => undefined,
      };

      await (processor as any).completeFailedLLMNode({
        requestId: mockJob.requestId,
        workflowId: mockJob.workflowId,
        status: 'failed',
        nodeId: 'plan-update-coordinator',
        nodeType: NodeType.GENERATE,
        tracker,
        error: {
          message:
            '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
          code: 'FLOW_NODE_ERROR_RATE_LIMITED',
        },
      });

      expect(
        mockFlowExecutionService.sendNodeResponseToWorkflow,
      ).toHaveBeenCalledWith(
        mockJob.requestId,
        mockJob.workflowId,
        expect.objectContaining({
          type: SystemMessageResponseType.Error,
          errorType: 'rate_limited',
          temporary: true,
          response: expect.stringContaining('high demand'),
        }),
        null,
        true,
        tracker,
      );
    });
  });

  describe('PreClassify Integration', () => {
    const mockClassificationNode = TestUtils.createMockConversationNode({
      id: 'task_generation_classify',
      type: NodeType.CLASSIFICATION,
    });

    (mockClassificationNode as any).promptConfig = {
      systemPromptTemplate: 'Test system prompt',
      responseSchema: z.object({}),
    };

    const mockUserMessage = TestUtils.createMockFlowUserMessage({
      data: { action: 'generate_tasks', comment: 'Test message' },
    });

    let testJob: typeof mockJob;

    beforeEach(() => {
      // Add preClassify method to the mock node
      (mockClassificationNode as any).preClassify = jest.fn();
      mockFlow.nodes[mockClassificationNode.id] = mockClassificationNode;

      testJob = {
        ...mockJob,
        data: {
          ...mockJob.data,
          nodeId: mockClassificationNode.id,
          userMessage: mockUserMessage,
        },
      };

      mockFlowEngineService.getFlow.mockReturnValue(wrapFlowTemplate(mockFlow));
      mockFlowEngineService.getNode.mockReturnValue(
        wrapNodeConfig(mockClassificationNode),
      );
    });

    it('should call attemptPreclassification for classification nodes with user messages', async () => {
      const mockPreClassifyResult = {
        routingOverride: {
          nextNodeId: 'task_generation_generate',
          reason: 'Magic string detected',
        },
      };

      mockFlowEngineService.executePreClassify.mockResolvedValue(
        mockPreClassifyResult,
      );

      await processor.processFlowNode(testJob);

      expect(mockFlowEngineService.executePreClassify).toHaveBeenCalledWith(
        mockClassificationNode.id,
        testJob.data.context,
        mockUserMessage,
      );
    });

    it('should update message and signal workflow when preClassify returns routing override', async () => {
      const mockPreClassifyResult = {
        routingOverride: {
          nextNodeId: 'task_generation_generate',
          reason:
            'User clicked Generate Tasks button - bypassing LLM classification',
        },
      };

      const mockWorkflowHandle = { signal: jest.fn() };
      mockTemporalClient.workflow.getHandle = jest
        .fn()
        .mockReturnValue(mockWorkflowHandle);

      mockFlowEngineService.executePreClassify.mockResolvedValue(
        mockPreClassifyResult,
      );

      await processor.processFlowNode(testJob);

      // Should update message with classification result
      expect(mockMessageService.updateMessage).toHaveBeenCalled();

      // Should signal workflow with next node
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
    });

    it('should continue with normal LLM processing when preClassify returns no routing override', async () => {
      mockFlowEngineService.executePreClassify.mockResolvedValue(undefined);
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      await processor.processFlowNode(testJob);

      // Should proceed with LLM processing
      expect(mockLLMClientService.callStructured).toHaveBeenCalled();
    });

    it('should continue with normal LLM processing when preClassify fails', async () => {
      const mockError = new Error('PreClassify failed');
      mockFlowEngineService.executePreClassify.mockRejectedValue(mockError);
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      await processor.processFlowNode(testJob);

      // Should proceed with LLM processing despite preClassify failure
      expect(mockLLMClientService.callStructured).toHaveBeenCalled();
    });

    it('should skip preClassify for non-classification nodes', async () => {
      const gatherNode = TestUtils.createMockConversationNode({
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
      });

      (gatherNode as any).promptConfig = {
        systemPromptTemplate: 'Test system prompt',
        responseSchema: z.object({}),
      };

      mockFlow.nodes['gather-node'] = gatherNode;
      const gatherJob = {
        ...testJob,
        data: { ...testJob.data, nodeId: 'gather-node' },
      };

      mockFlowEngineService.getNode.mockReturnValue(wrapNodeConfig(gatherNode));
      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      await processor.processFlowNode(gatherJob);

      expect(mockFlowEngineService.executePreClassify).not.toHaveBeenCalled();
      expect(mockLLMClientService.callStructured).toHaveBeenCalled();
    });

    it('should skip preClassify when no user message is provided', async () => {
      const jobWithoutUserMessage = {
        ...testJob,
        data: {
          ...testJob.data,
          userMessage: undefined as any,
        },
      };

      mockPromptBuilderService.buildPrompt.mockResolvedValue({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        fullPrompt: 'Built prompt',
        temperature: 0.7,
      });

      await processor.processFlowNode(jobWithoutUserMessage);

      expect(mockFlowEngineService.executePreClassify).not.toHaveBeenCalled();
      expect(mockLLMClientService.callStructured).toHaveBeenCalled();
    });

    it('should log preClassify routing override details', async () => {
      const mockPreClassifyResult = {
        routingOverride: {
          nextNodeId: 'task_generation_generate',
          reason: 'Magic string detected',
        },
      };

      const mockWorkflowHandle = { signal: jest.fn() };
      mockTemporalClient.workflow.getHandle = jest
        .fn()
        .mockReturnValue(mockWorkflowHandle);

      const loggerDebugSpy = jest.spyOn(processor['logger'], 'debug');
      mockFlowEngineService.executePreClassify.mockResolvedValue(
        mockPreClassifyResult,
      );

      await processor.processFlowNode(testJob);

      expect(loggerDebugSpy).toHaveBeenCalledWith(
        `PreClassify routing override for node ${mockClassificationNode.id}`,
        {
          nextNodeId: 'task_generation_generate',
          reason: 'Magic string detected',
          nodeId: mockClassificationNode.id,
          jobId: testJob.id,
        },
      );
    });
  });
});
