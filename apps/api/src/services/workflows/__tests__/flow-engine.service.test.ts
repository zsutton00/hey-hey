/* eslint-disable @typescript-eslint/unbound-method */
import { LocalPromptType } from 'src/generated/local';
import { NodeExecutionService } from '../node-execution.service';
import { PromptBuilderService } from '../../llm/prompt-builder.service';
import { IntentDetectorService } from '../../intent-detector.service';
import { FlowSecurityService } from '../flow-security.service';
import { LlmProcessor } from '../../../core/processing/llm-processor.service';
import { LLMClientService } from '../../llm/llm-client.service';
import { MessageService } from '../../message.service';
import { JOB_ENQUEUER_TOKEN } from '../../job.tokens';
import { MutableContext } from '../../../utils/mutable-context';
import { NodeRegistry } from '../../../flows/nodes/node-registry.service';
import { ClaudeModel } from '../../llm/llm-shared';
import {
  FlowContext,
  FlowTemplate,
  INode,
  Intent,
  NodeResult,
  NodeRoutingConfig,
  NodeType,
} from '../../../types/flow-internal.types';
import {
  QuestionsSystemMessageData,
  SystemMessageData,
  SystemMessageResponseType,
} from '../../../generated';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import * as TestUtils from '../../../utils/testUtils';

const mockPromptBuilder = TestUtils.createMockPromptBuilderService();
const mockIntentDetector = TestUtils.createMockIntentDetectorService();
const mockFlowSecurityService = {
  validateFlowExecution: jest.fn(),
};
const mockLlmProcessor: Partial<LlmProcessor> = {};
const mockMessageService = TestUtils.createMockMessageService();
const mockJobEnqueuer = TestUtils.createMockJobEnqueuer();
const mockAppContext = TestUtils.createMockAppContext();
const mockLLMClientService = TestUtils.createMockLLMClientService();

const mockLLMResponse = {
  feedback: 'Test feedback',
  questions: [{ id: 'q1', question: 'Test question?' }],
  initialUnderstanding: { projectType: 'web-app', complexity: 'low' },
  initiatives: [{ id: 'init-1', title: 'Test Initiative' }],
  summary: { totalInitiatives: 1 },
  analysis: { complexity: 'medium' },
  followUpNeeded: false,
};

mockLLMClientService.callStructured.mockResolvedValue({
  content: {
    type: 'QUESTIONS',
    nodeId: 'test-node',
    response: JSON.stringify(mockLLMResponse),
    data: {},
    uiElements: [],
  },
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  costData: {
    model: ClaudeModel.CLAUDE_4_HAIKU_5,
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    inputCost: 0.1,
    outputCost: 0.2,
    totalCost: 0.3,
  },
});

const createNodeResult = (type: NodeType): NodeResult => {
  switch (type) {
    case NodeType.ACTION:
      return {
        type,
        message: 'Test message',
        data: { type: 'ACTION_COMPLETE' },
        uiElements: [],
      };
    case NodeType.CLASSIFICATION:
      return {
        type,
        message: 'Test message',
        data: {
          type: 'CLASSIFICATION',
          detectedIntent: '',
          intentConfidence: 0,
        },
        uiElements: [],
      };
    case NodeType.CONFIRM:
      return {
        type,
        message: 'Test message',
        data: {
          type: 'GENERIC_CONFIRM',
          detectedIntent: '',
          intentConfidence: 0,
        },
        uiElements: [],
      };
    case NodeType.FINALIZE:
      return {
        type,
        message: 'Test message',
        uiElements: [],
      };
    case NodeType.OPENER:
    case NodeType.QUESTIONS:
    case NodeType.LLM_QUESTIONS:
      return {
        type,
        message: 'Test message',
        data: {
          detectedIntent: '',
          intentConfidence: 0,
        },
        uiElements: [],
      };
    case NodeType.ANALYZE:
      return {
        type,
        message: 'Test message',
        data: {
          detectedIntent: '',
          intentConfidence: 0,
          analysis: {
            identifiedTechnologies: [],
            integrationComplexity: 'low',
            potentialChallenges: [],
            recommendations: [],
          },
        },
        uiElements: [],
      };
    case NodeType.GENERATE:
      return {
        type,
        message: 'Test message',
        data: {
          detectedIntent: '',
          intentConfidence: 0,
        },
        uiElements: [],
      };
    case NodeType.ERROR:
      return {
        type,
        message: 'Test message',
        data: {
          detectedIntent: '',
          intentConfidence: 0,
        },
        uiElements: [],
      };
    case NodeType.AGENT:
      return {
        type,
        message: 'Test message',
        data: {
          agentId: 'agent-1',
          executionId: 'exec-1',
          status: 'completed',
        },
        uiElements: [],
      };
    case NodeType.EXTERNAL_AGENT:
      return {
        type,
        message: 'Test message',
        data: {
          detectedIntent: '',
          intentConfidence: 0,
        },
        uiElements: [],
      };
    case NodeType.ROUTING:
      return {
        type,
        message: 'Test message',
        data: { temporary: false },
        uiElements: [],
      };
    case NodeType.NON_INTERACTIVE:
      return {
        type,
        message: 'Test message',
        data: { temporary: false },
        uiElements: [],
      };
    case NodeType.NOOP:
      return {
        type,
        message: 'Test message',
        data: {},
        uiElements: [],
      };
  }
};

const createTestNode = (
  overrides: Partial<INode<FlowContext>> &
    Pick<INode<FlowContext>, 'id' | 'type'>,
): INode<FlowContext> => {
  const { id, type, ...rest } = overrides;
  return {
    id,
    type,
    twoPhase: rest.twoPhase ?? false,
    execute:
      rest.execute ?? jest.fn().mockResolvedValue(createNodeResult(type)),
    ...rest,
  };
};

const mockContext = TestUtils.createMockFlowContext({
  flowId: 'flowId',
  flowPath: {
    pathTaken: [],
    previousNode: undefined,
  },
});

const mockUserMessage = TestUtils.createMockFlowUserMessage({
  data: { message: 'Hello, I want to create a project' },
});

const mockIntent: Intent = {
  type: 'continue',
  confidence: 0.8,
  userData: { message: 'Hello, I want to create a project' },
};

describe('FlowEngineService', () => {
  let service: NodeExecutionService;
  let intentDetector: jest.Mocked<IntentDetectorService>;
  let nodeRegistry: NodeRegistry;

  beforeEach(async () => {
    const setup = await createServiceTestingModule({
      providers: [
        NodeExecutionService,
        PromptBuilderService,
        IntentDetectorService,
        FlowSecurityService,
        LlmProcessor,
        LLMClientService,
        MessageService,
        NodeRegistry,
        { provide: 'APP_CONTEXT', useValue: mockAppContext },
      ],
      overrides: [
        [PromptBuilderService, mockPromptBuilder],
        [IntentDetectorService, mockIntentDetector],
        [FlowSecurityService, mockFlowSecurityService],
        [LlmProcessor, mockLlmProcessor],
        [LLMClientService, mockLLMClientService],
        [MessageService, mockMessageService],
        [JOB_ENQUEUER_TOKEN, mockJobEnqueuer],
      ],
    });

    service = setup.module.get<NodeExecutionService>(NodeExecutionService);
    intentDetector = setup.module.get(IntentDetectorService);
    nodeRegistry = setup.module.get(NodeRegistry);
    nodeRegistry.clear();

    mockFlowSecurityService.validateFlowExecution.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerFlow', () => {
    it('should register a flow successfully', () => {
      const mockFlow: FlowTemplate<FlowContext> = {
        id: 'test-flow',
        name: 'Test Flow',
        description: 'A test flow',
        version: 1,
        startNode: 'start',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          start: {
            transitions: {
              continue: { nextNodeId: 'end', description: 'Continue' },
              default: { nextNodeId: 'end', description: 'Default' },
            },
          },
          end: {
            nextNode: 'end',
          },
          recovery: {
            nextNode: 'end',
          },
        },
      };

      service.registerFlow(mockFlow);

      const registeredFlow = service.getFlow('test-flow');
      expect(registeredFlow).toEqual(mockFlow);
    });
  });

  describe('getFlow', () => {
    it('should return undefined for non-existent flow', () => {
      const flow = service.getFlow('non-existent');
      expect(flow).toBeUndefined();
    });
  });

  describe('getPreviousNode', () => {
    it('should return null when no previous node in context', () => {
      const context = TestUtils.createMockFlowContext({
        flowId: 'test-flow',
        flowPath: {
          pathTaken: ['current-node'],
          previousNode: undefined, // No previous node
        },
      });

      const result = service.getPreviousNode(context, 'test-flow');
      expect(result).toBeNull();
    });

    it('should return previous node when it exists', () => {
      const previousNode = createTestNode({
        id: 'previous-node',
        type: NodeType.LLM_QUESTIONS,
        twoPhase: true,
      });

      const flow: FlowTemplate<FlowContext> = {
        id: 'test-flow',
        name: 'Test Flow',
        description: 'Test',
        version: 1,
        startNode: 'start',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          'previous-node': {
            transitions: {
              continue: { nextNodeId: 'end', description: 'Continue' },
              default: { nextNodeId: 'end', description: 'Default' },
            },
          },
          end: {
            nextNode: 'end',
          },
          recovery: {
            nextNode: 'end',
          },
        },
      };

      service.registerFlow(flow);

      const context = TestUtils.createMockFlowContext({
        flowId: 'test-flow',
        flowPath: {
          pathTaken: ['previous-node', 'current-node'],
          previousNode: 'previous-node',
        },
      });

      nodeRegistry.register(previousNode);
      const result = service.getPreviousNode(context, 'test-flow');
      expect(result).toBe(previousNode);
      expect(result?.id).toBe('previous-node');
    });

    it('should return null when previous node does not exist in flow', () => {
      const context = TestUtils.createMockFlowContext({
        flowId: 'test-flow',
        flowPath: {
          pathTaken: ['non-existent-node', 'current-node'],
          previousNode: 'non-existent-node',
        },
      });

      const result = service.getPreviousNode(context, 'test-flow');
      expect(result).toBeNull();
    });
  });

  describe('executeNode', () => {
    it('should execute a non-LLM node successfully', async () => {
      const mockNode = createTestNode({
        id: 'test-node',
        type: NodeType.ACTION,
        execute: jest.fn().mockResolvedValue({
          type: NodeType.ACTION,
          message: 'Test message',
          data: { type: 'ACTION_COMPLETE', test: 'data' },
          uiElements: [],
        }),
      });

      nodeRegistry.register(mockNode);

      const flowTemplate: FlowTemplate<FlowContext> = {
        id: 'flowId',
        name: 'Test Flow',
        description: '',
        version: 1,
        startNode: 'test-node',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          'test-node': { nextNode: 'next-node' },
        },
      };

      service.registerFlow(flowTemplate);

      const tracker = MutableContext.fromPatch(
        TestUtils.createMockFlowContext({
          flowId: 'flowId',
          flowPath: { pathTaken: [], previousNode: undefined },
        }),
      );

      const result = await service.executeNode(
        'test-node',
        tracker,
        flowTemplate.nodes['test-node']!,
        undefined,
      );

      expect(mockNode.execute).toHaveBeenCalled();
      expect(result.result.message).toBe('Test message');
      expect(result.nextNodeId).toBe('next-node');
    });

    it('should execute an LLM node successfully', async () => {
      const mockNode = createTestNode({
        id: 'llm-node',
        type: NodeType.LLM_QUESTIONS,
        twoPhase: true,
        execute: jest.fn().mockResolvedValue({
          type: NodeType.LLM_QUESTIONS,
          message: 'Test feedback',
          data: { detectedIntent: '', intentConfidence: 0 },
          uiElements: [],
        }),
      });

      nodeRegistry.register(mockNode);

      const flowTemplate: FlowTemplate<FlowContext> = {
        id: 'flowId',
        name: 'Test Flow',
        description: '',
        version: 1,
        startNode: 'llm-node',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          'llm-node': {
            transitions: {
              continue: { nextNodeId: 'next-node', description: '' },
              default: { nextNodeId: 'default-node', description: '' },
            },
          },
        },
      };

      service.registerFlow(flowTemplate);

      const tracker = MutableContext.fromPatch(
        TestUtils.createMockFlowContext({
          flowId: 'flowId',
          flowPath: { pathTaken: [], previousNode: undefined },
          lastIntent: mockIntent,
        }),
      );

      intentDetector.mapIntentToTransition.mockReturnValue('continue');

      const result = await service.executeNode(
        'llm-node',
        tracker,
        flowTemplate.nodes['llm-node']!,
        mockUserMessage,
      );

      expect(mockNode.execute).toHaveBeenCalled();
      expect(result.result.message).toBe('Test feedback');
      expect(result.nextNodeId).toBe('next-node');
    });

    it('should handle node execution errors', async () => {
      const mockNode = createTestNode({
        id: 'error-node',
        type: NodeType.ACTION,
        execute: jest
          .fn()
          .mockRejectedValue(new Error('Node execution failed')),
      });

      nodeRegistry.register(mockNode);

      const flowTemplate: FlowTemplate<FlowContext> = {
        id: 'flowId',
        name: 'Test Flow',
        description: '',
        version: 1,
        startNode: 'error-node',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          'error-node': { nextNode: 'end' },
        },
      };

      service.registerFlow(flowTemplate);

      const tracker = MutableContext.fromPatch(
        TestUtils.createMockFlowContext({
          flowId: 'flowId',
          flowPath: { pathTaken: [], previousNode: undefined },
        }),
      );

      await expect(
        service.executeNode(
          'error-node',
          tracker,
          flowTemplate.nodes['error-node']!,
          undefined,
        ),
      ).rejects.toThrow('Node execution failed');
    });

    it('should update context with LLM response data', async () => {
      const mockNode = createTestNode({
        id: 'llm-node',
        type: NodeType.GENERATE,
        execute: jest
          .fn()
          .mockImplementation((trackerHandle: MutableContext<FlowContext>) => {
            const ctx = trackerHandle.getContext() as FlowContext & {
              projectData?: {
                initiatives?: Array<{ id: string; title: string }>;
                technicalAnalysis?: { complexity: string };
                initialUnderstanding?: { projectType: string };
              };
            };
            ctx.projectData = ctx.projectData || {};
            ctx.projectData.initiatives = [
              { id: 'init-1', title: 'Test Initiative' },
            ];
            ctx.projectData.technicalAnalysis = { complexity: 'medium' };
            ctx.projectData.initialUnderstanding = { projectType: 'web-app' };
            return {
              type: NodeType.GENERATE,
              message: 'Test response',
              data: {
                detectedIntent: '',
                intentConfidence: 0,
                initiatives: ctx.projectData.initiatives,
              },
              uiElements: [],
            };
          }),
      });

      nodeRegistry.register(mockNode);

      const flowTemplate: FlowTemplate<FlowContext> = {
        id: 'flowId',
        name: 'Test Flow',
        description: '',
        version: 1,
        startNode: 'llm-node',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          'llm-node': { nextNode: 'end' },
        },
      };

      service.registerFlow(flowTemplate);

      const tracker = MutableContext.fromPatch(
        TestUtils.createMockFlowContext({
          flowId: 'flowId',
          flowPath: { pathTaken: [], previousNode: undefined },
        }),
      );

      await service.executeNode(
        'llm-node',
        tracker,
        flowTemplate.nodes['llm-node']!,
        undefined,
      );

      const updatedContext = tracker.getContext() as FlowContext & {
        projectData?: {
          initiatives?: Array<{ id: string; title: string }>;
          technicalAnalysis?: { complexity: string };
          initialUnderstanding?: { projectType: string };
        };
      };

      expect(updatedContext.projectData?.initiatives).toEqual([
        { id: 'init-1', title: 'Test Initiative' },
      ]);
      expect(updatedContext.projectData?.technicalAnalysis).toEqual({
        complexity: 'medium',
      });
      expect(updatedContext.projectData?.initialUnderstanding).toEqual({
        projectType: 'web-app',
      });
    });
  });

  describe('applyContextTransform', () => {
    it('should apply context transform when available', async () => {
      const mockFlow: FlowTemplate<FlowContext> = {
        id: 'test-flow',
        name: 'Test Flow',
        description: 'Test',
        version: 1,
        startNode: 'start',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          start: {
            nextNode: 'end',
          },
          end: {
            nextNode: 'end',
          },
          recovery: {
            nextNode: 'end',
          },
        },
        contextTransforms: {
          'test-node': jest.fn().mockResolvedValue({
            ...mockContext,
            transformed: true,
          }),
        },
      };

      service.registerFlow(mockFlow);

      const result = await service.applyContextTransform(
        'test-flow',
        'test-node',
        mockContext,
      );

      expect(mockFlow.contextTransforms!['test-node']).toHaveBeenCalledWith(
        mockContext,
      );
      expect(
        (result as FlowContext & { transformed: boolean }).transformed,
      ).toBe(true);
    });

    it('should return original context when no transform exists', async () => {
      const mockFlow: FlowTemplate<FlowContext> = {
        id: 'test-flow',
        name: 'Test Flow',
        description: 'Test',
        version: 1,
        startNode: 'start',
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          start: {
            nextNode: 'end',
          },
          end: {
            nextNode: 'end',
          },
          recovery: {
            nextNode: 'end',
          },
        },
      };

      service.registerFlow(mockFlow);

      const result = await service.applyContextTransform(
        'test-flow',
        'non-existent-node',
        mockContext,
      );

      expect(result).toBe(mockContext);
    });

    it('should return original context for non-existent flow', async () => {
      const result = await service.applyContextTransform(
        'non-existent-flow',
        'test-node',
        mockContext,
      );

      expect(result).toBe(mockContext);
    });
  });

  describe('determineNextNode', () => {
    it('should return undefined when no intent and no nextNode', async () => {
      const routingConfig: NodeRoutingConfig = {
        transitions: {
          continue: { nextNodeId: 'end', description: '' },
          default: { nextNodeId: 'default-node', description: '' },
        },
      };

      const contextWithoutIntent = TestUtils.createMockFlowContext({
        ...mockContext,
        lastIntent: undefined,
      });

      const result = await service.determineNextNode(
        undefined, // no intent
        routingConfig,
        contextWithoutIntent,
      );

      expect(result).toBeUndefined();
    });

    it('should use transition function when intent matches', async () => {
      const routingConfig: NodeRoutingConfig = {
        transitions: {
          continue: { nextNodeId: 'next-node', description: '' },
          back: { nextNodeId: 'prev-node', description: '' },
          default: { nextNodeId: 'default-node', description: '' },
        },
      };

      const contextWithIntent = TestUtils.createMockFlowContext({
        ...mockContext,
        lastIntent: mockIntent,
      });
      intentDetector.mapIntentToTransition.mockReturnValue('continue');

      const result = await service.determineNextNode(
        mockIntent,
        routingConfig,
        contextWithIntent,
      );

      expect(intentDetector.mapIntentToTransition).toHaveBeenCalledWith(
        mockIntent,
        ['continue', 'back', 'default'],
      );
      expect(result).toBe('next-node');
    });

    it('should return undefined when transition key not found', async () => {
      const routingConfig: NodeRoutingConfig = {
        transitions: {
          continue: { nextNodeId: 'next-node', description: '' },
          default: { nextNodeId: 'default-node', description: '' },
        },
      };

      const contextWithIntent = TestUtils.createMockFlowContext({
        ...mockContext,
        lastIntent: mockIntent,
      });
      intentDetector.mapIntentToTransition.mockReturnValue('unknown');

      const result = await service.determineNextNode(
        mockIntent,
        routingConfig,
        contextWithIntent,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('executePreClassify', () => {
    const mockUserMessage = TestUtils.createMockFlowUserMessage({
      data: {
        action: 'generate_tasks',
        comment: 'Test message',
      },
    });

    it('should return undefined for non-classification nodes', async () => {
      const mockNode = createTestNode({
        id: 'test-node',
        type: NodeType.LLM_QUESTIONS,
        twoPhase: true,
      });

      nodeRegistry.register(mockNode);

      const result = await service.executePreClassify(
        mockNode.id,
        mockContext,
        mockUserMessage,
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined for classification nodes without preClassify method', async () => {
      const mockClassificationNode = createTestNode({
        id: 'classify-node',
        type: NodeType.CLASSIFICATION,
        twoPhase: true,
      });

      nodeRegistry.register(mockClassificationNode);

      const result = await service.executePreClassify(
        mockClassificationNode.id,
        mockContext,
        mockUserMessage,
      );

      expect(result).toBeUndefined();
    });

    it('should execute preClassify method successfully and return routing override', async () => {
      const mockPreClassifyResult = {
        routingOverride: {
          nextNodeId: 'next-node',
          reason: 'Magic string detected',
        },
      };

      const mockPreClassify = jest
        .fn()
        .mockResolvedValue(mockPreClassifyResult);

      nodeRegistry.register(
        createTestNode({
          id: 'classify-node',
          type: NodeType.CLASSIFICATION,
          twoPhase: true,
          preClassify: mockPreClassify,
        }),
      );

      const result = await service.executePreClassify(
        'classify-node',
        mockContext,
        mockUserMessage,
      );
      expect(mockPreClassify).toHaveBeenCalledWith(
        mockUserMessage,
        mockContext,
      );
      expect(result).toEqual(mockPreClassifyResult);
    });

    it('should handle preClassify method returning undefined', async () => {
      const mockPreClassify = jest.fn().mockResolvedValue(undefined);

      nodeRegistry.register(
        createTestNode({
          id: 'classify-node',
          type: NodeType.CLASSIFICATION,
          twoPhase: true,
          preClassify: mockPreClassify,
        }),
      );

      const result = await service.executePreClassify(
        'classify-node',
        mockContext,
        mockUserMessage,
      );

      expect(result).toBeUndefined();
    });

    it('should handle preClassify method without routing override', async () => {
      const mockPreClassifyResult = {
        // No routingOverride property
      };

      const mockPreClassify = jest
        .fn()
        .mockResolvedValue(mockPreClassifyResult);

      nodeRegistry.register(
        createTestNode({
          id: 'classify-node',
          type: NodeType.CLASSIFICATION,
          twoPhase: true,
          preClassify: mockPreClassify,
        }),
      );

      const result = await service.executePreClassify(
        'classify-node',
        mockContext,
        mockUserMessage,
      );

      expect(result).toEqual(mockPreClassifyResult);
    });

    it('should handle errors in preClassify method gracefully', async () => {
      const mockError = new Error('PreClassify failed');
      const mockPreClassify = jest.fn().mockRejectedValue(mockError);

      nodeRegistry.register(
        createTestNode({
          id: 'classify-node',
          type: NodeType.CLASSIFICATION,
          twoPhase: true,
          preClassify: mockPreClassify,
        }),
      );

      const result = await service.executePreClassify(
        'classify-node',
        mockContext,
        mockUserMessage,
      );

      expect(result).toBeUndefined();
      // Should not throw, fallback to normal LLM classification
    });

    it('should handle user message validation errors', async () => {
      const mockPreClassify = jest.fn();

      const mockClassificationNode = createTestNode({
        id: 'classify-node',
        type: NodeType.CLASSIFICATION,
        twoPhase: true,
        preClassify: mockPreClassify,
      });

      const result = await service.executePreClassify(
        mockClassificationNode.id,
        mockContext,
        mockUserMessage,
      );

      expect(mockPreClassify).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should log routing override details when returned', async () => {
      const mockPreClassifyResult = {
        routingOverride: {
          nextNodeId: 'task_generation_generate',
          reason:
            'User clicked Generate Tasks button - bypassing LLM classification',
        },
      };

      const mockPreClassify = jest
        .fn()
        .mockResolvedValue(mockPreClassifyResult);
      const loggerDebugSpy = jest.spyOn(service['logger'], 'debug');

      nodeRegistry.register(
        createTestNode({
          id: 'task_generation_classify',
          type: NodeType.CLASSIFICATION,
          twoPhase: true,
          preClassify: mockPreClassify,
        }),
      );

      await service.executePreClassify(
        'task_generation_classify',
        mockContext,
        mockUserMessage,
      );

      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Injectable preClassify returned routing override for node task_generation_classify',
        {
          nextNodeId: 'task_generation_generate',
          reason:
            'User clicked Generate Tasks button - bypassing LLM classification',
        },
      );
    });
  });

  describe('buildPendingMessageData with UIHints', () => {
    it('should include uiHints in pending message for opener nodes with uiHints', () => {
      const nodeWithUIHints = createTestNode({
        id: 'test-opener',
        type: NodeType.OPENER,
        twoPhase: true,
        uiHints: {
          expectedElements: [
            {
              type: 'text_input',
              count: 2,
              label: 'Project Details',
              required: true,
            },
          ],
          estimatedCount: 2,
          layoutHint: 'form',
        },
      });

      const result = (
        service as unknown as {
          buildPendingMessageData: (node: INode) => SystemMessageData;
        }
      ).buildPendingMessageData(nodeWithUIHints) as QuestionsSystemMessageData;

      expect(result).toEqual({
        type: 'QUESTIONS',
        nodeId: 'test-opener',
        response: 'Welcome! How can I help you today?',
        detectedIntent: '',
        intentConfidence: 0,
        uiElements: [],
        uiHints: {
          expectedElements: [
            {
              type: 'text_input',
              count: 2,
              label: 'Project Details',
              required: true,
            },
          ],
          estimatedCount: 2,
          layoutHint: 'form',
        },
      });
    });

    it('should include uiHints in pending message for action nodes with uiHints', () => {
      const actionNodeWithUIHints = createTestNode({
        id: 'test-action',
        type: NodeType.ACTION,
        uiHints: {
          expectedElements: [
            {
              type: 'team_members',
              count: 1,
              label: 'Team Member Emails',
              required: false,
            },
          ],
          estimatedCount: 1,
          layoutHint: 'form',
        },
      });

      const result = (
        service as unknown as {
          buildPendingMessageData: (node: INode) => SystemMessageData;
        }
      ).buildPendingMessageData(
        actionNodeWithUIHints,
      ) as QuestionsSystemMessageData;

      expect(result).toEqual({
        type: 'QUESTIONS',
        nodeId: 'test-action',
        response: 'Processing action node...',
        detectedIntent: '',
        intentConfidence: 0,
        uiElements: [],
        uiHints: {
          expectedElements: [
            {
              type: 'team_members',
              count: 1,
              label: 'Team Member Emails',
              required: false,
            },
          ],
          estimatedCount: 1,
          layoutHint: 'form',
        },
      });
    });

    it('should use startMessage when provided', () => {
      const nodeWithStartMessage = createTestNode({
        id: 'test-start-message',
        type: NodeType.GENERATE,
        startMessage: 'Drafting your response...',
      });

      const result = (
        service as unknown as {
          buildPendingMessageData: (node: INode) => SystemMessageData;
        }
      ).buildPendingMessageData(
        nodeWithStartMessage,
      ) as QuestionsSystemMessageData;

      expect(result).toEqual({
        type: 'QUESTIONS',
        nodeId: 'test-start-message',
        response: 'Drafting your response...',
        detectedIntent: '',
        intentConfidence: 0,
        uiElements: [],
      });
    });

    it('should not include uiHints for nodes without uiHints', () => {
      const nodeWithoutUIHints = createTestNode({
        id: 'test-no-hints',
        type: NodeType.OPENER,
        twoPhase: true,
      });

      const result = (
        service as unknown as {
          buildPendingMessageData: (node: INode) => SystemMessageData;
        }
      ).buildPendingMessageData(
        nodeWithoutUIHints,
      ) as QuestionsSystemMessageData;

      expect(result).toEqual({
        type: 'QUESTIONS',
        nodeId: 'test-no-hints',
        response: 'Welcome! How can I help you today?',
        detectedIntent: '',
        intentConfidence: 0,
        uiElements: [],
      });
      expect(result).not.toHaveProperty('uiHints');
    });

    it('should handle complex uiHints with multiple elements', () => {
      const complexUIHintsNode = createTestNode({
        id: 'complex-hints',
        type: NodeType.ACTION,
        uiHints: {
          expectedElements: [
            {
              type: 'text_input',
              count: 3,
              label: 'Project Information',
              required: true,
            },
            {
              type: 'integration_selector',
              count: 1,
              label: 'Select Integrations',
              required: false,
            },
            {
              type: 'team_members',
              count: 2,
              label: 'Team Members',
              required: false,
            },
          ],
          estimatedCount: 6,
          layoutHint: 'grid',
        },
      });

      const result = (
        service as unknown as {
          buildPendingMessageData: (node: INode) => SystemMessageData;
        }
      ).buildPendingMessageData(
        complexUIHintsNode,
      ) as QuestionsSystemMessageData;

      expect(result.uiHints).toEqual({
        expectedElements: [
          {
            type: 'text_input',
            count: 3,
            label: 'Project Information',
            required: true,
          },
          {
            type: 'integration_selector',
            count: 1,
            label: 'Select Integrations',
            required: false,
          },
          {
            type: 'team_members',
            count: 2,
            label: 'Team Members',
            required: false,
          },
        ],
        estimatedCount: 6,
        layoutHint: 'grid',
      });
    });
  });
});
