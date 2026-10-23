import { NonInteractiveFlowNodeProcessor } from '../non-interactive-flow-node-processor.service';
import { DomainEventPublisher } from '../../events/domain-event-publisher';
import { EVENT_TYPES } from '../../events/types/event.types';
import { NodeExecutionService } from 'src/services/workflows/node-execution.service';
import { NodeRegistry } from 'src/flows/nodes/node-registry.service';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { LLMClientService } from 'src/services/llm/llm-client.service';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { LLMProviderName } from 'src/services/llm/llm-shared';
import { NonInteractiveFlowNodeQueueJob } from 'src/services/interfaces/job-enqueuer.interface';
import { FlowContext, NodeType } from 'src/types/flow-internal.types';
import { MockLlmSessionId } from 'src/types';
import * as TestUtils from '../../../utils/testUtils';

const { testIds } = TestUtils;

const flowContext: FlowContext = {
  core: {
    workflowId: testIds.workflow,
    projectId: testIds.project,
    organizationId: testIds.organization,
    conversationId: testIds.conversation,
    workflowAboutId: testIds.project,
    workflowAboutType: 'project',
    user: { id: testIds.user, role: 'system' },
    session: { startTime: new Date(), interactionCount: 0 },
  },
  flowId: 'flow-1',
  flowPath: { pathTaken: [] },
  mockLlmSessionId: '2a6810c4-f7a6-4c29-aef5-6e1f1396b1bf' as MockLlmSessionId,
};

const baseJob: NonInteractiveFlowNodeQueueJob = {
  id: testIds.job,
  queueName: 'non_interactive_flow_node',
  organizationId: testIds.organization,
  projectId: testIds.project,
  workflowId: testIds.workflow,
  requestId: testIds.request,
  createdAt: new Date(),
  data: {
    flowId: 'flow-1',
    nodeId: 'node-1',
    context: flowContext,
  },
};

describe('NonInteractiveFlowNodeProcessor', () => {
  let processor: NonInteractiveFlowNodeProcessor;
  let eventPublisher: jest.Mocked<DomainEventPublisher>;
  let nodeExecutionService: jest.Mocked<NodeExecutionService>;
  let nodeRegistry: jest.Mocked<NodeRegistry>;
  let promptBuilder: jest.Mocked<PromptBuilderService>;
  let llmClientService: jest.Mocked<LLMClientService>;
  let flowExecutionService: jest.Mocked<FlowExecutionService>;

  const mockNode = {
    id: 'node-1',
    type: NodeType.NON_INTERACTIVE,
    promptConfig: {
      systemPrompt: 'sys',
      userPrompt: '',
      responseSchema: {},
      modelCriteria: {
        provider: LLMProviderName.CLAUDE,
        anthropicTier: 'sonnet',
      },
    },
    processLlmResponse: jest.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    eventPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
      publishInTransaction: jest.fn(),
    } as unknown as jest.Mocked<DomainEventPublisher>;

    nodeExecutionService = {
      getNode: jest
        .fn()
        .mockReturnValue({ node: mockNode, routing: {} as any }),
    } as unknown as jest.Mocked<NodeExecutionService>;

    nodeRegistry = {
      get: jest.fn().mockReturnValue(mockNode as any),
    } as unknown as jest.Mocked<NodeRegistry>;

    promptBuilder = {
      buildPrompt: jest.fn().mockResolvedValue({
        fullPrompt: 'rendered prompt',
        temperature: 0.1,
      }),
    } as unknown as jest.Mocked<PromptBuilderService>;

    llmClientService = {
      callStructured: jest.fn().mockResolvedValue({
        content: { ok: true },
      }),
    } as unknown as jest.Mocked<LLMClientService>;

    flowExecutionService = {
      sendNodeResponseToWorkflow: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FlowExecutionService>;

    processor = new NonInteractiveFlowNodeProcessor(
      eventPublisher,
      nodeExecutionService,
      nodeRegistry,
      promptBuilder,
      llmClientService,
      flowExecutionService,
    );
  });

  it('publishes start/complete, calls LLM, and signals workflow', async () => {
    mockNode.processLlmResponse.mockResolvedValue({
      modifiedResult: { ok: true, cleaned: true },
      routingOverride: 'next-node',
    });

    await processor.processNonInteractiveFlowNode(baseJob);

    expect(mockNode.processLlmResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      undefined,
      expect.anything(),
    );
    expect(eventPublisher.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.START,
        aggregateId: baseJob.id,
        payload: expect.objectContaining({
          payloadType: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.START,
          projectId: baseJob.projectId,
        }),
      }),
    );
    expect(promptBuilder.buildPrompt).toHaveBeenCalledWith(
      mockNode,
      expect.anything(),
      undefined,
      undefined,
    );
    expect(llmClientService.callStructured).toHaveBeenCalledWith(
      'rendered prompt',
      expect.objectContaining({
        responseSchema: mockNode.promptConfig.responseSchema,
      }),
      expect.objectContaining({
        workflowId: baseJob.workflowId,
        mockLlmSessionId: '2a6810c4-f7a6-4c29-aef5-6e1f1396b1bf',
      }),
    );
    expect(
      flowExecutionService.sendNodeResponseToWorkflow,
    ).toHaveBeenCalledWith(
      baseJob.requestId,
      baseJob.workflowId,
      expect.objectContaining({ cleaned: true, nodeId: 'node-1' }),
      'next-node',
      false,
      expect.anything(),
    );
    expect(eventPublisher.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.COMPLETE,
        aggregateId: baseJob.id,
        payload: expect.objectContaining({
          payloadType: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.COMPLETE,
          projectId: baseJob.projectId,
        }),
      }),
    );
  });

  it('falls back to flow context when queue metadata is missing', async () => {
    const jobMissingIds = {
      ...baseJob,
      organizationId: undefined as any,
      projectId: undefined as any,
      workflowId: undefined as any,
    } as NonInteractiveFlowNodeQueueJob;

    await processor.processNonInteractiveFlowNode(jobMissingIds);

    expect(llmClientService.callStructured).toHaveBeenCalledWith(
      'rendered prompt',
      expect.anything(),
      expect.objectContaining({
        organizationId: flowContext.core.organizationId,
        projectId: flowContext.core.projectId,
        workflowId: flowContext.core.workflowId,
        conversationId: flowContext.core.conversationId,
        nodeType: NodeType.NON_INTERACTIVE,
      }),
    );
  });

  it('publishes error and signals workflow on failure', async () => {
    llmClientService.callStructured.mockRejectedValueOnce(new Error('boom'));

    await expect(
      processor.processNonInteractiveFlowNode(baseJob),
    ).rejects.toThrow('boom');

    expect(eventPublisher.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.ERROR,
        payload: expect.objectContaining({
          payloadType: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.ERROR,
          projectId: baseJob.projectId,
        }),
      }),
    );
    expect(
      flowExecutionService.sendNodeResponseToWorkflow,
    ).toHaveBeenCalledWith(
      baseJob.requestId,
      baseJob.workflowId,
      expect.objectContaining({ nodeId: 'node-1', status: 'failed' }),
      null,
      false,
      expect.anything(),
    );
  });
});
