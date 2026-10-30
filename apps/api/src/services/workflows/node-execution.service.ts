import {
  forwardRef,
  INestApplicationContext,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import { templates } from 'src/flows';
import { MessageStatus } from '../../constants/message-status.constants';
import { v4 as uuidv4 } from 'uuid';
import {
  addToServiceChain,
  enrichEventContext,
  trackProcessingTime,
} from '../../core/events/context-utils';
import { WithWorkflowContext } from '../../core/events/observable-event.context';
import { QueueJob } from '../../core/queue/interfaces/queue.interface';
import { RETIRED_PLAN_SHAPING_NODE_REDIRECTS } from '../../flows/constants/node-ids';
import { NodeRegistry } from '../../flows/nodes/node-registry.service';
import {
  CreateSystemMessage,
  MessageRecordDto,
  MessageResponseDto,
  SystemMessageData,
  SystemMessageResponseType,
  UserMessage,
} from '../../generated';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from '../../types';
import {
  AgentHandoffNodeBase,
  FlowContext,
  FlowTemplate,
  FlowUserMessage,
  INode,
  Intent,
  isExternalAgentNode,
  MutableContextHandle,
  NodeResult,
  NodeRoutingConfig,
  NodeType,
  RoutingResult,
} from '../../types/flow-internal.types';
import {
  applyContextPatch,
  createMutableContextHandle,
} from '../../utils/mutable-context';
import { convertNodeResultToSystemMessage } from '../../utils/node-result-to-system-message.util';
import { LLMResponsePayload } from '../../workflows/conversation-workflow-state';
import { IntentDetectorService } from '../intent-detector.service';
import { IJobEnqueuer } from '../interfaces/job-enqueuer.interface';
import { JOB_ENQUEUER_TOKEN } from '../job.tokens';
import { LLMClientService } from '../llm/llm-client.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';
import { MessageService } from '../message.service';
import { AgentOperationWorkflowAnswerService } from '../agent-operation/agent-operation-workflow-answer.service';
import { FlowSecurityService } from './flow-security.service';

type StartFlowNodeParams = {
  node: INode;
  context: FlowContext;
  conversationId: ConversationId;
  workflowId: WorkflowId;
  projectId: ProjectId;
  organizationId: OrganizationId;
  requestId: RequestId;
  userMessageId?: MessageId;
  parentMessageId?: MessageId;
  options?: {
    appendMessage?: boolean;
  };
};

@Injectable()
export class NodeExecutionService implements OnModuleInit {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    NodeExecutionService.name,
  );
  // All flows use FlowTemplate format (Injectable nodes with routing config)
  private flows: Map<string, FlowTemplate<FlowContext>> = new Map();

  constructor(
    private intentDetector: IntentDetectorService,
    private flowSecurity: FlowSecurityService,
    @Inject(forwardRef(() => MessageService))
    private messageService: MessageService,
    @Inject(JOB_ENQUEUER_TOKEN) private jobEnqueuer: IJobEnqueuer,
    @Inject('APP_CONTEXT') private appContext: INestApplicationContext,
    private nodeRegistry: NodeRegistry,
    private promptBuilder: PromptBuilderService,
    private llmClientService: LLMClientService,
  ) {}

  onModuleInit() {
    for (const template of templates) {
      this.registerFlow(template as FlowTemplate<FlowContext>);
    }
  }

  registerFlow<T extends FlowContext = FlowContext>(
    flow: FlowTemplate<T>,
  ): void {
    // Templates are keyed by flow id ALONE. `version` is informational —
    // logged here for operability but never part of the lookup key, so a
    // redeployed graph silently replaces the prior one under the same id and
    // is adopted live by in-flight executions (Temporal re-resolves node
    // config from current code every step). Any rewire that retargets or
    // deletes transitions must therefore account for executions parked
    // mid-graph. See docs/conversation-workflows/WORKFLOW-SYSTEM.md
    // ("Flow Template Resolution & Live Adoption").
    this.flows.set(flow.id, flow as unknown as FlowTemplate<FlowContext>);
    this.logger.log(`Registered flow: ${flow.id} v${flow.version}`);
  }

  getFlow(flowId: string): FlowTemplate<FlowContext> | undefined {
    // Resolution is by flow id only — `version` is never consulted.
    return this.flows.get(flowId);
  }

  /**
   * Map a persisted node id onto the id current code serves. Parked
   * conversations keep the id they stopped on, so a node removed from a
   * live template must resume somewhere rather than fail lookup.
   */
  resolveNodeId(flowId: string, nodeId: string): string {
    const redirect = RETIRED_PLAN_SHAPING_NODE_REDIRECTS[nodeId];
    if (!redirect) return nodeId;
    this.logger.warn('Redirecting retired node id', {
      flowId,
      retiredNodeId: nodeId,
      redirectNodeId: redirect,
    });
    return redirect;
  }

  getNode(
    flowId: string,
    requestedNodeId: string,
  ): { node: INode; routing: NodeRoutingConfig } | undefined {
    const flow = this.flows.get(flowId);
    if (!flow) return undefined;

    const nodeId = this.resolveNodeId(flowId, requestedNodeId);

    const routingConfig = flow.nodes[nodeId];
    if (!routingConfig) return undefined;

    // Get the Injectable node instance from registry
    const node = this.nodeRegistry.get(nodeId);
    if (!node) return undefined;

    return {
      node,
      routing: routingConfig,
    };
  }

  /**
   * Get the previous node Injectable instance from flow context
   */
  getPreviousNode(context: FlowContext, flowId: string): INode | null {
    const persistedPreviousNodeId = context.flowPath.previousNode;
    if (!persistedPreviousNodeId) {
      return null;
    }
    const previousNodeId = this.resolveNodeId(flowId, persistedPreviousNodeId);

    // Get Injectable node from registry
    if (this.nodeRegistry.has(previousNodeId)) {
      return this.nodeRegistry.get(previousNodeId);
    }

    return null;
  }

  /**
   * Start a flow node execution by creating a message and queuing a job
   * This orchestrates the flow node execution with proper message tracking
   */
  @WithWorkflowContext((...args) => {
    const [params] = args as [StartFlowNodeParams];
    return {
      sourceService: 'FlowEngineService',
      sourceMethod: 'startFlowNode',
      context: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        workflowId: params.workflowId,
        conversationId: params.conversationId,
        userId: params.context.core.user.id,
        requestId: params.requestId,
      },
      metadata: {
        flowId: params.context.flowId,
        nodeId: params.node.id,
        nodeType: params.node.type,
        requestId: params.requestId,
      },
    };
  })
  async startFlowNode(params: StartFlowNodeParams): Promise<{
    job: QueueJob | undefined;
    message: MessageRecordDto;
    immediateResponse?: LLMResponsePayload;
  }> {
    // Enrich context with flow orchestration metadata
    const orchestrationStartTime = Date.now();
    enrichEventContext({
      flowId: params.context.flowId,
      nodeId: params.node.id,
      nodeType: params.node.type,
      requestId: params.requestId,
      orchestrationStartTime,
    });

    // Add this service to the service call chain for tracing
    addToServiceChain('FlowEngineService');

    // EXTERNAL_AGENT nodes are pure trigger-producers: their work is to
    // construct a `triggersAgent` envelope and emit it on the SYSTEM
    // message that opens the node. Routing happens later when the agent
    // replies. Run that path inline (no placeholder, no worker job, no
    // follow-up `updateMessage`) so the trigger payload is present on the
    // SAME `messageAdded` event the websocket bridge gates on. See
    // ExternalAgentNodeBase.buildTriggerMessage for the contract that
    // makes this safe by construction.
    if (
      isExternalAgentNode(params.node) ||
      params.node instanceof AgentHandoffNodeBase
    ) {
      return this.startExternalAgentNode(params, orchestrationStartTime);
    }

    // TODO: Add transaction support when MessageService supports it
    // For now, we'll create the message and job sequentially

    // 1. Build pending message data based on node type
    const messageData = this.buildPendingMessageData(params.node);
    this.logger.debug(
      `built pending message data for conversation ${params.conversationId}`,
      { messageData, appendMessage: params.options?.appendMessage },
    );

    // 2. Create the pending message
    let message: MessageResponseDto;

    if (params.options?.appendMessage) {
      // Use appendMessageToConversation for sequential flow
      const messageDataWithoutParent = {
        workflowId: params.workflowId,
        projectId: params.projectId,
        type: 'SYSTEM' as const,
        status: MessageStatus.SystemProcessing,
        data: messageData,
      };

      message = await this.messageService.appendMessageToConversation(
        params.conversationId,
        messageDataWithoutParent,
        params.organizationId,
        'startFlowNode',
      );
    } else {
      // Use explicit parent control
      const createMessageDto = {
        conversationId: params.conversationId,
        workflowId: params.workflowId,
        projectId: params.projectId,
        type: 'SYSTEM' as const,
        status: MessageStatus.SystemProcessing,
        data: messageData,
        parentMessageId: params.parentMessageId || undefined,
      };

      message = await this.messageService.addMessage(
        createMessageDto,
        params.organizationId,
        'startFlowNode',
      );
    }

    this.logger.debug(
      `added message data for conversation ${params.conversationId}`,
      { messageId: message.id },
    );

    let userMessage: FlowUserMessage | undefined;
    if (params.userMessageId) {
      userMessage = (await this.messageService.getMessage(
        params.userMessageId,
        params.context.core.organizationId,
      )) as UserMessage as FlowUserMessage;
      if (userMessage) {
        userMessage.nodeId = params.node.id;
      }
    }

    // 3. Queue the job with messageId
    const job = await this.jobEnqueuer.queueFlowNodeExecution(
      {
        node: params.node,
        context: params.context,
        messageId: message.id,
        userMessage,
      },
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        requestId: params.requestId,
        workflowId: params.workflowId,
        nodeId: params.node.id,
        conversationId: params.conversationId,
        userId: params.context.core.user.id,
        messageId: message.id,
        userMessage,
      },
    );

    await this.messageService.setPendingMessage(
      { requestId: params.requestId, jobId: job.id },
      message.id,
    );

    this.logger.log(`Started flow node execution`, {
      nodeId: params.node.id,
      nodeType: params.node.type,
      messageId: message.id,
      jobId: job.id,
    });

    // Track orchestration completion time and enrich context with results
    trackProcessingTime('orchestration', orchestrationStartTime);
    enrichEventContext({
      messageId: message.id,
      jobId: job.id,
    });

    return { job, message };
  }

  /**
   * Queue a non-interactive flow node execution.
   * This reuses the same flow/node lookup as conversational nodes but skips
   * conversation message creation and simply enqueues the job.
   */
  @WithWorkflowContext((...args) => {
    const [params] = args as [
      {
        flowId: string;
        nodeId: string;
        context: FlowContext;
        organizationId: OrganizationId;
        projectId: ProjectId;
        workflowId: WorkflowId;
        requestId: RequestId;
        conversationId: ConversationId;
        userId: UserId;
      },
    ];

    return {
      sourceService: 'FlowEngineService',
      sourceMethod: 'startNonInteractiveFlowNode',
      context: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        workflowId: params.workflowId,
        conversationId: params.conversationId,
        userId: params.userId,
        requestId: params.requestId,
      },
      metadata: {
        flowId: params.flowId,
        nodeId: params.nodeId,
        requestId: params.requestId,
      },
    };
  })
  async startNonInteractiveFlowNode(params: {
    flowId: string;
    nodeId: string;
    context: FlowContext;
    organizationId: OrganizationId;
    projectId: ProjectId;
    workflowId: WorkflowId;
    requestId: RequestId;
    conversationId: ConversationId;
    userId: UserId;
  }): Promise<{ job: QueueJob }> {
    const { flowId, nodeId, context } = params;

    enrichEventContext({
      flowId,
      nodeId,
      requestId: params.requestId,
    });

    addToServiceChain('FlowEngineService');

    const nodeData = this.getNode(flowId, nodeId);
    if (!nodeData) {
      throw new Error(`Node ${nodeId} not found for flow ${flowId}`);
    }

    const job = await this.jobEnqueuer.queueNonInteractiveFlowNodeExecution(
      {
        flowId,
        nodeId,
        context,
      },
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        requestId: params.requestId,
        workflowId: params.workflowId,
        conversationId: params.conversationId,
        userId: params.userId,
      },
    );

    this.logger.log(`Started non-interactive flow node execution`, {
      nodeId,
      flowId,
      jobId: job.id,
    });

    return { job };
  }

  /**
   * Inline-execute an EXTERNAL_AGENT node and write its trigger as a
   * single Completed SYSTEM message. No placeholder, no job queue, no
   * follow-up update — `triggersAgent` is present on the create event the
   * websocket bridge emits to the owner room. Context mutations made via
   * the tracker propagate through the activity's `updatedContext` return.
   * The `immediateResponse` mirrors the `LLMResponsePayload` shape the
   * worker would have signaled for this node, so the workflow's wait
   * condition can be satisfied without changing its loop logic.
   */
  private async startExternalAgentNode(
    params: StartFlowNodeParams,
    orchestrationStartTime: number,
  ): Promise<{
    job: undefined;
    message: MessageRecordDto;
    immediateResponse: LLMResponsePayload;
  }> {
    if (
      !isExternalAgentNode(params.node) &&
      !(params.node instanceof AgentHandoffNodeBase)
    ) {
      throw new Error(
        `startExternalAgentNode called on non-EXTERNAL_AGENT node ${params.node.id}`,
      );
    }

    this.logger.debug(
      `[startExternalAgentNode] building trigger inline for ${params.node.id}`,
      {
        conversationId: params.conversationId,
        workflowId: params.workflowId,
        nodeId: params.node.id,
        requestId: params.requestId,
      },
    );

    const tracker = createMutableContextHandle(params.context);
    const built = await params.node.buildTriggerMessage(tracker);

    this.logger.debug(
      `[startExternalAgentNode] built trigger inline for ${params.node.id}`,
      {
        message: built,
      },
    );

    // Pre-generate the SYSTEM message id so we can stamp `triggerMessageId`
    // onto the trigger body before the row is written. `buildTriggerMessage`
    // returns an `UnstampedAgentTrigger` (no id) — this seam is the one
    // place that knows the row id, so it's the one place that fuses it in.
    // `TriggerEmitter` validates the persisted body has
    // `triggerMessageId === messageId` before signing.
    const pregeneratedMessageId = uuidv4() as MessageId;
    const stampedTrigger = {
      ...built.triggersAgent,
      triggerMessageId: pregeneratedMessageId,
    } as SystemMessageData['triggersAgent'];

    // Reuse the worker's NodeResult→SystemMessageData conversion so the
    // shape written here is identical to the shape the worker would have
    // signaled. The structural shape is the EXTERNAL_AGENT NodeResult
    // variant — the cast is the seam between the new contract's loose
    // `data?: Record<string, unknown>` and the variant's specific Omit.
    const nodeResultShape = {
      type: NodeType.EXTERNAL_AGENT,
      message: built.response,
      uiElements: built.uiElements,
      triggersAgent: stampedTrigger,
      data: built.data ?? { detectedIntent: '', intentConfidence: 0 },
    } as unknown as NodeResult;
    const systemMessageData = convertNodeResultToSystemMessage(
      nodeResultShape,
      params.node.type,
      params.node.id,
    );

    const baseMessage = {
      id: pregeneratedMessageId,
      workflowId: params.workflowId,
      projectId: params.projectId,
      type: 'SYSTEM' as const,
      status: MessageStatus.Completed,
      data: systemMessageData,
    };

    const sourceMessage = params.userMessageId
      ? await this.messageService.getMessage(
          params.userMessageId,
          params.organizationId,
        )
      : null;
    const sourceData =
      sourceMessage?.type === 'USER' ? sourceMessage.data : null;
    const workflowAnswerOperationId =
      sourceData &&
      typeof sourceData === 'object' &&
      typeof sourceData['workflowAnswerOperationId'] === 'string'
        ? sourceData['workflowAnswerOperationId']
        : null;
    let message: MessageRecordDto;
    if (workflowAnswerOperationId) {
      const workflowAnswerService = this.appContext.get(
        AgentOperationWorkflowAnswerService,
        { strict: false },
      );
      message = await workflowAnswerService.bindWorkflowTriggerAndDispatch({
        operationId: workflowAnswerOperationId,
        triggerMessage: {
          ...baseMessage,
          conversationId: params.conversationId,
          parentMessageId: params.userMessageId ?? params.parentMessageId,
        },
      });
    } else if (params.options?.appendMessage) {
      message = await this.messageService.appendMessageToConversation(
        params.conversationId,
        baseMessage,
        params.organizationId,
        'startFlowNode:externalAgent',
      );
    } else {
      message = await this.messageService.addMessage(
        {
          ...baseMessage,
          conversationId: params.conversationId,
          parentMessageId: params.parentMessageId || undefined,
        },
        params.organizationId,
        'startFlowNode:externalAgent',
      );
    }

    const persistedSystemData = message.data as SystemMessageData;

    this.logger.debug(
      `[startExternalAgentNode] message created with triggersAgent`,
      {
        conversationId: params.conversationId,
        messageId: message.id,
        nodeId: params.node.id,
        promptType: built.triggersAgent.promptType,
      },
    );

    // Surface tracker mutations onto the caller's context so the Temporal
    // activity's `updatedContext` return carries them back to the workflow.
    const contextUpdates = tracker.getPatch();
    if (contextUpdates.length > 0) {
      applyContextPatch(params.context, contextUpdates);
    }

    // The workflow consumes this via state.pendingLLMResponse — same
    // shape the worker-driven path would have signaled. nextNodeId is
    // intentionally absent: EXTERNAL_AGENT routes on agent reply, not on
    // entry.
    const immediateResponse: LLMResponsePayload = {
      requestId: params.requestId,
      responseData: persistedSystemData,
      contextUpdates,
    };

    trackProcessingTime('orchestration', orchestrationStartTime);
    enrichEventContext({
      messageId: message.id,
    });

    this.logger.log(`Started external-agent flow node`, {
      nodeId: params.node.id,
      nodeType: params.node.type,
      messageId: message.id,
      promptType: built.triggersAgent.promptType,
    });

    return { job: undefined, message, immediateResponse };
  }

  /**
   * Build pending message data for a flow node
   */
  private buildPendingMessageData(node: INode): SystemMessageData {
    // For opener nodes, we should have the full message content
    if (node.type === NodeType.OPENER) {
      // Opener nodes have their message content defined in the action
      return {
        type: 'QUESTIONS',
        nodeId: node.id,
        response: 'Welcome! How can I help you today?',
        detectedIntent: '',
        intentConfidence: 0,
        uiElements: [],
        ...(node.uiHints && { uiHints: node.uiHints }),
      };
    }

    // For other nodes, create a processing message
    const startMessage = node.startMessage ?? `Processing ${node.type} node...`;
    return {
      type: 'QUESTIONS',
      nodeId: node.id,
      response: startMessage,
      detectedIntent: '',
      intentConfidence: 0,
      uiElements: [],
      ...(node.uiHints ? { uiHints: node.uiHints } : {}),
    };
  }

  /**
   * Execute previous node's determineRouting with current node's results
   */
  async executePreviousNodePostProcess(
    nodeId: string,
    currentSystemMessageData: SystemMessageData,
    context: Readonly<FlowContext>,
  ): Promise<string | undefined> {
    try {
      // Get previous node
      const previousNode = this.getPreviousNode(context, context.flowId);

      if (!previousNode || !previousNode.determineRouting) {
        this.logger.debug(
          '[executePreviousNodePostProcess] No previous node or determineRouting to execute',
          {
            previousNodeId: context.flowPath.previousNode,
            hasPreviousNode: !!previousNode,
            hasPostProcess: !!previousNode?.determineRouting,
          },
        );
        return;
      }

      const nodeData = this.getNode(context.flowId, nodeId);
      if (!nodeData?.routing?.transitions) {
        return;
      }

      this.logger.debug(
        '[executePreviousNodePostProcess] Executing previous node determineRouting',
        {
          previousNodeId: previousNode.id,
          currentFlowPath: context.flowPath.pathTaken,
        },
      );

      // Execute previous node's determineRouting
      // Note: determineRouting now returns string | undefined, not RoutingResult
      // The NodeResult would need to be constructed from currentSystemMessageData
      const nodeResult: NodeResult = {
        type: NodeType.ACTION,
        message: currentSystemMessageData.response || '',
        data: currentSystemMessageData,
      };

      const nextNodeId = await previousNode.determineRouting(
        context,
        nodeResult,
        nodeData.routing.transitions,
      );

      // Handle routing override (informational for now)
      if (nextNodeId) {
        this.logger.log(
          '[executePreviousNodePostProcess] Previous node determineRouting provided routing override',
          {
            previousNodeId: previousNode.id,
            nextNodeId,
          },
        );

        return nextNodeId;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorType =
        error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.error('Previous node determineRouting execution failed', {
        error: errorMessage,
        previousNodeId: context.flowPath.previousNode,
        errorType,
      });

      // Non-fatal error - don't break current node execution
    }
  }

  /**
   * Execute an Injectable node
   *
   * This method executes nodes that extend INode and use proper DI.
   * Routing configuration is provided by the flow template.
   */
  @WithWorkflowContext((...args) => {
    const [nodeId, context] = args as [
      string,
      FlowContext,
      NodeRoutingConfig,
      FlowUserMessage | undefined,
    ];
    return {
      sourceService: 'FlowEngineService',
      sourceMethod: 'executeInjectableNode',
      context: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        workflowId: context.core.workflowId,
        conversationId: context.core.conversationId,
        userId: context.core.user.id,
      },
      metadata: {
        nodeId,
        flowId: context.flowId,
      },
    };
  })
  async executeNode(
    nodeId: string,
    tracker: MutableContextHandle<FlowContext>,
    routingConfig: NodeRoutingConfig,
    userMessage?: FlowUserMessage,
  ): Promise<{ result: NodeResult; nextNodeId?: string }> {
    // Get the Injectable node from registry
    const context = tracker.getContext();
    const nodeData = this.getNode(context.flowId, nodeId);
    if (!nodeData?.node || !nodeData.routing) {
      const flow = this.getFlow(context.flowId);
      const availableNodes = flow ? Object.keys(flow.nodes ?? {}) : [];
      throw new Error(
        `Node ${nodeId} configuration missing in flow ${context.flowId}. Available nodes: ${availableNodes.join(', ')}`,
      );
    }
    const { node, routing } = nodeData;

    // Enrich context with node execution metadata
    enrichEventContext({
      nodeId: node.id,
      nodeType: node.type,
      executionType: 'injectable',
    });

    addToServiceChain('FlowEngineService');

    this.logger.debug(
      `Executing Injectable node: ${node.id} (type: ${node.type})`,
    );

    try {
      // Validate user has permission to execute this flow
      await this.flowSecurity.validateFlowExecution(
        context.core.user.id,
        node.id,
        context.core.organizationId,
      );

      // Call preProcess lifecycle hook if defined
      if (node.preProcess) {
        await node.preProcess(tracker);
      }

      // Execute the node
      const result = await node.execute(tracker, userMessage);

      // Call postProcess lifecycle hook if defined
      if (node.postProcess) {
        await node.postProcess(tracker, result);
      }

      // Determine next node
      let nextNodeId: string | undefined;

      // First check if node has custom routing logic (only for transition-based routing)
      if (node.determineRouting && routing.transitions) {
        nextNodeId = await node.determineRouting(
          context,
          result,
          routing.transitions,
        );
      }

      // Validate: detect misconfiguration where node has determineRouting but config uses nextNode
      if (node.determineRouting && !routing.transitions) {
        throw new Error(
          `Node ${node.id} implements determineRouting but flow config uses static nextNode. ` +
            `To use dynamic routing, configure the node with transitions instead of nextNode in the flow template.`,
        );
      }

      // If no custom routing, use routingConfig from flow template
      if (!nextNodeId) {
        if (routingConfig.nextNode) {
          nextNodeId = routingConfig.nextNode;
        } else if (routingConfig.transitions) {
          nextNodeId = await this.determineNextNode(
            context.lastIntent,
            routingConfig,
            context,
            userMessage,
          );
        }
      }

      return { result, nextNodeId };
    } catch (error) {
      this.logger.error(`Error executing Injectable node ${node.id}:`, error);
      throw error;
    }
  }

  /**
   * Execute preClassify method on ClassificationNode if available
   * This allows classification nodes to bypass LLM calls for magic strings/known patterns
   *
   * Only supports Injectable nodes - factory function nodes have been removed.
   */
  async executePreClassify(
    nodeId: string,
    context: FlowContext,
    userMessage: FlowUserMessage,
  ): Promise<RoutingResult | undefined> {
    this.logger.debug(`Checking preClassify for node: ${nodeId}`);

    // Check if node is registered as Injectable in NodeRegistry
    if (!this.nodeRegistry.has(nodeId)) {
      this.logger.debug(`Node ${nodeId} not found in NodeRegistry`);
      return undefined;
    }

    const injectableNode = this.nodeRegistry.get(nodeId);

    // Check if Injectable node has preClassify method
    if (!injectableNode.preClassify) {
      return undefined;
    }

    this.logger.debug(`Using Injectable node preClassify for ${nodeId}`);

    try {
      const result = await injectableNode.preClassify(userMessage, context);

      if (result?.routingOverride) {
        this.logger.debug(
          `Injectable preClassify returned routing override for node ${nodeId}`,
          {
            nextNodeId: result.routingOverride.nextNodeId,
            reason: result.routingOverride.reason,
          },
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error in Injectable preClassify for node ${nodeId}:`,
        error,
      );
      // Don't throw - fall back to normal LLM classification
      return undefined;
    }
  }

  @WithWorkflowContext((...args) => {
    const [intent, _routingConfig, context] = args as [
      Intent | null | undefined,
      NodeRoutingConfig,
      FlowContext,
      FlowUserMessage | undefined,
    ];
    return {
      sourceService: 'FlowEngineService',
      sourceMethod: 'determineNextNode',
      context: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        workflowId: context.core.workflowId,
        conversationId: context.core.conversationId,
        userId: context.core.user.id,
      },
      metadata: {
        nodeId: context.flowPath.previousNode || undefined,
        flowId: context.flowId,
        intentType: intent?.type,
        intentConfidence: intent?.confidence,
      },
    };
  })
  async determineNextNode(
    intent: Intent | null | undefined,
    routingConfig: NodeRoutingConfig,
    _context: FlowContext,
    _userMessage?: FlowUserMessage,
  ): Promise<string | undefined> {
    // Enrich context with routing decision metadata
    enrichEventContext({
      intentType: intent?.type || 'no-intent',
      intentConfidence: intent?.confidence || 0,
    });

    // Add this service to the service call chain for tracing
    addToServiceChain('FlowEngineService');

    this.logger.debug('starting determineNextNode', {
      intent,
      hasNextNode: !!routingConfig.nextNode,
      hasTransitions: !!routingConfig.transitions,
    });

    // Fixed nextNode routing
    if (routingConfig.nextNode) {
      return routingConfig.nextNode;
    }

    // For intent-based routing, use transitions
    if (!intent || !routingConfig.transitions) {
      return undefined;
    }

    // Get available transitions
    const transitions = routingConfig.transitions;
    const availableTransitions = Object.keys(transitions);

    // Map intent to transition
    const transitionKey = this.intentDetector.mapIntentToTransition(
      intent,
      availableTransitions,
    );

    // Get transition definition
    const transitionDef = transitions[transitionKey];
    if (transitionDef) {
      const nextId = transitionDef.nextNodeId;
      this.logger.debug(
        `Transition: ${intent.type} -> ${transitionKey} -> ${nextId}`,
        {
          description: transitionDef.description,
          condition: transitionDef.condition,
        },
      );
      if (nextId) {
        this.logger.debug('determineNextNode found nextId', {
          transitionKey,
          availableTransitions,
          nextId,
          description: transitionDef.description,
        });
        return nextId;
      }
    }

    this.logger.debug('determineNextNode did not find nextId', {
      transitionKey,
      availableTransitions,
      hasTransitionDef: !!transitionDef,
    });

    return undefined;
  }

  async applyContextTransform(
    flowId: string,
    nodeId: string,
    context: FlowContext,
  ): Promise<FlowContext> {
    const flow = this.flows.get(flowId);
    if (!flow || !flow.contextTransforms?.[nodeId]) {
      return context;
    }

    try {
      this.logger.debug(`Applying context transform for node: ${nodeId}`);
      const transformedContext = await flow.contextTransforms[nodeId](context);
      return transformedContext;
    } catch (error) {
      this.logger.error(
        `Error applying context transform for node ${nodeId}:`,
        error,
      );
      return context;
    }
  }
}
