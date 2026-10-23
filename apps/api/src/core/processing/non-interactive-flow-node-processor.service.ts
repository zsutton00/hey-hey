import { Inject, Injectable } from '@nestjs/common';
import { NodeRegistry } from 'src/flows/nodes/node-registry.service';
import {
  NonInteractiveFlowNodeStartEvent,
  SystemMessageData,
} from 'src/generated';
import { NonInteractiveFlowNodeQueueJob } from 'src/services/interfaces/job-enqueuer.interface';
import { LLMClientService } from 'src/services/llm/llm-client.service';
import type { ModelSelectionCriteria } from 'src/services/llm/llm-types';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { NodeExecutionService } from 'src/services/workflows/node-execution.service';
import {
  FlowContext,
  MutableContextHandle,
  NodeRoutingConfig,
  NodeType,
  NonInteractiveNodeBase,
  hasBeforeGeneration,
  hasProcessLlmResponse,
  hasShouldRun,
} from 'src/types/flow-internal.types';
import { errorToLoggable } from 'src/utils/logging.util';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../events/tokens';
import { EVENT_TYPES, JOB_STATUS } from '../events/types/event.types';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';

@Injectable()
export class NonInteractiveFlowNodeProcessor {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    NonInteractiveFlowNodeProcessor.name,
  );

  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
    private readonly nodeExecutionService: NodeExecutionService,
    private readonly nodeRegistry: NodeRegistry,
    private readonly promptBuilder: PromptBuilderService,
    private readonly llmClientService: LLMClientService,
    private readonly flowExecutionService: FlowExecutionService,
  ) {}

  async processNonInteractiveFlowNode(
    job: NonInteractiveFlowNodeQueueJob,
  ): Promise<void> {
    const { nodeId, flowId, context } = job.data;
    const tracker = createMutableContextHandle<FlowContext>(context);
    const resolvedContext = this.resolveExecutionContext(job, tracker);

    const event: Omit<NonInteractiveFlowNodeStartEvent, 'id'> = {
      type: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.START,
      aggregateId: job.id,
      payload: {
        payloadType: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.START,
        organizationId: resolvedContext.organizationId,
        projectId: resolvedContext.projectId,
        workflowId: resolvedContext.workflowId,
        flowId,
        nodeId,
      },
    };
    await this.eventPublisher.publish(event);

    try {
      // eslint-disable-next-line prefer-const
      let { node, routing } = this.resolveNode(flowId, nodeId);

      if (!node.promptConfig) {
        // Attempt to fetch a fresh instance from registry in case the flow template is stale
        const fallbackNode = this.nodeRegistry.get(
          this.nodeExecutionService.resolveNodeId(flowId, nodeId),
        ) as NonInteractiveNodeBase;
        if (!fallbackNode.promptConfig) {
          throw new Error(`Node ${nodeId} is not prompt-configurable`);
        }
        // Use the fallback node for prompt building
        node = fallbackNode;
      }

      const promptConfig = node.promptConfig;
      if (!promptConfig) {
        throw new Error(`Node ${nodeId} is not prompt-configurable`);
      }

      if (!promptConfig.responseSchema) {
        throw new Error(
          `Node ${nodeId} missing responseSchema for structured LLM call`,
        );
      }

      if (hasBeforeGeneration(node)) {
        await node.beforeGeneration(tracker, undefined);
      }

      if (hasShouldRun(node)) {
        const decision = await node.shouldRun(tracker);
        if (!decision.run) {
          const skipResult: SystemMessageData = {
            nodeId,
            status: 'skipped',
            message: decision.reason ?? 'Node skipped by shouldRun',
          } as unknown as SystemMessageData;

          await this.eventPublisher.publish({
            type: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.COMPLETE,
            aggregateId: job.id,
            payload: {
              payloadType: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.COMPLETE,
              organizationId: resolvedContext.organizationId,
              projectId: resolvedContext.projectId,
              workflowId: resolvedContext.workflowId,
              flowId,
              nodeId,
              result: skipResult,
            },
          });

          await this.flowExecutionService.sendNodeResponseToWorkflow(
            resolvedContext.requestId,
            resolvedContext.workflowId,
            skipResult,
            null,
            false,
            tracker,
          );

          return;
        }
      }

      const prompt = await this.promptBuilder.buildPrompt(
        node,
        tracker,
        undefined,
        routing?.transitions,
      );
      this.logger.log('[processNonInteractiveFlowNode] prompt built', {
        jobId: job.id,
        requestId: resolvedContext.requestId,
        workflowId: resolvedContext.workflowId,
        flowId,
        nodeId,
        promptLength: prompt.fullPrompt.length,
      });

      const modelCriteria = promptConfig.modelCriteria;

      this.logger.log(
        '[processNonInteractiveFlowNode] calling structured LLM',
        {
          jobId: job.id,
          requestId: resolvedContext.requestId,
          workflowId: resolvedContext.workflowId,
          flowId,
          nodeId,
          conversationId: resolvedContext.conversationId,
          organizationId: resolvedContext.organizationId,
          projectId: resolvedContext.projectId,
          modelCriteria,
        },
      );
      const llmResponse = await this.llmClientService.callStructured(
        prompt.fullPrompt,
        {
          modelCriteria,
          responseSchema: promptConfig.responseSchema,
          temperature: prompt.temperature ?? promptConfig.temperature,
          topP: promptConfig.topP,
          reasoningEffort: promptConfig.reasoningEffort,
          responseFormat: promptConfig.responseFormat,
          maxTokens: promptConfig.maxTokens,
          timeout: promptConfig.timeout,
          stream: false,
        },
        {
          organizationId: resolvedContext.organizationId,
          projectId: resolvedContext.projectId,
          workflowId: resolvedContext.workflowId,
          requestId: resolvedContext.requestId,
          conversationId: resolvedContext.conversationId,
          nodeId,
          nodeType: NodeType.NON_INTERACTIVE,
          mockLlmSessionId: tracker.getContext().mockLlmSessionId,
        },
      );
      this.logger.log(
        '[processNonInteractiveFlowNode] structured LLM returned',
        {
          jobId: job.id,
          requestId: resolvedContext.requestId,
          workflowId: resolvedContext.workflowId,
          flowId,
          nodeId,
          llmRequestId: llmResponse.requestId,
          hasUsage: !!llmResponse.usage,
          totalTokens: llmResponse.usage?.totalTokens,
          responseKeys:
            llmResponse.content &&
            typeof llmResponse.content === 'object' &&
            !Array.isArray(llmResponse.content)
              ? Object.keys(llmResponse.content as Record<string, unknown>)
              : [],
        },
      );

      let systemMessageData = llmResponse.content as SystemMessageData;
      let nextNodeId: string | null = null;

      // Allow nodes to post-process/validate LLM output before signaling
      if (hasProcessLlmResponse(node)) {
        const { modifiedResult, routingOverride } =
          await node.processLlmResponse(systemMessageData, undefined, tracker);

        if (modifiedResult) {
          systemMessageData = modifiedResult;
        }

        if (routingOverride) {
          nextNodeId = routingOverride;
        }
      }

      (systemMessageData as Record<string, unknown>).nodeId = nodeId;

      await this.eventPublisher.publish({
        type: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.COMPLETE,
        aggregateId: job.id,
        payload: {
          payloadType: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.COMPLETE,
          organizationId: resolvedContext.organizationId,
          projectId: resolvedContext.projectId,
          workflowId: resolvedContext.workflowId,
          flowId,
          nodeId,
          result: systemMessageData,
        },
      });

      await this.flowExecutionService.sendNodeResponseToWorkflow(
        resolvedContext.requestId,
        resolvedContext.workflowId,
        systemMessageData,
        nextNodeId,
        false,
        tracker,
      );
      this.logger.log(
        '[processNonInteractiveFlowNode] sent response signal to workflow',
        {
          jobId: job.id,
          requestId: resolvedContext.requestId,
          workflowId: resolvedContext.workflowId,
          flowId,
          nodeId,
          nextNodeId,
        },
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : errorToLoggable(error);

      this.logger.error(
        `[processNonInteractiveFlowNode] failed for job ${job.id}`,
        {
          error: errorMsg,
          nodeId,
          flowId,
        },
      );

      await this.eventPublisher.publish({
        type: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.ERROR,
        aggregateId: job.id,
        payload: {
          payloadType: EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE.ERROR,
          organizationId: resolvedContext.organizationId,
          projectId: resolvedContext.projectId,
          workflowId: resolvedContext.workflowId,
          flowId,
          nodeId,
          error: errorMsg,
        },
      });

      const errorData: SystemMessageData = {
        nodeId,
        status: JOB_STATUS.FAILED,
        message: errorMsg,
      } as unknown as SystemMessageData;

      await this.flowExecutionService.sendNodeResponseToWorkflow(
        resolvedContext.requestId,
        resolvedContext.workflowId,
        errorData,
        null,
        false,
        createMutableContextHandle<FlowContext>(context),
      );

      throw error;
    }
  }

  private resolveExecutionContext(
    job: NonInteractiveFlowNodeQueueJob,
    tracker: MutableContextHandle<FlowContext>,
  ) {
    const core = tracker.getContext().core;
    const organizationId = job.organizationId ?? core.organizationId;
    const projectId = job.projectId ?? core.projectId;
    const workflowId = job.workflowId ?? core.workflowId;
    const conversationId = job.conversationId ?? core.conversationId;
    const userId = job.userId ?? core.user?.id;

    if (!organizationId) {
      throw new Error(
        '[NonInteractiveFlowNodeProcessor] Missing organizationId for non-interactive LLM call',
      );
    }

    if (!projectId) {
      throw new Error(
        '[NonInteractiveFlowNodeProcessor] Missing projectId for non-interactive LLM call',
      );
    }

    return {
      organizationId,
      projectId,
      workflowId,
      conversationId,
      userId,
      requestId: job.requestId,
    };
  }

  private resolveNode(
    flowId: string,
    nodeId: string,
  ): { node: NonInteractiveNodeBase; routing?: NodeRoutingConfig } {
    const nodeEntry = this.nodeExecutionService.getNode(flowId, nodeId);
    if (nodeEntry) {
      if (nodeEntry.node.type !== NodeType.NON_INTERACTIVE) {
        throw new Error('Node type must be NON_INTERACTIVE');
      }
      return nodeEntry as {
        node: NonInteractiveNodeBase;
        routing?: NodeRoutingConfig;
      };
    }

    const node = this.nodeRegistry.get(
      this.nodeExecutionService.resolveNodeId(flowId, nodeId),
    );
    return { node, routing: undefined } as {
      node: NonInteractiveNodeBase;
      routing?: NodeRoutingConfig;
    };
  }
}
