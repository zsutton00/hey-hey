import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  Influence,
  SecondaryActionConfig,
  SecondaryActionHandler,
  TaskContentApplyPayload,
  TaskContentApplyPayloadAllOfFields,
  UIElement,
} from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { MastraAgentResponse } from '../../../services/agents/mastra-client.service';
import {
  CompensationContext,
  CompensationResult,
  FlowUserMessage,
  ProcessAgentResponseResult,
  TaskRefinementFlowContext,
} from '../../../types/flow-internal.types';
import { TASK_REFINEMENT_NODES } from '../../constants/node-ids';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';
import { getCommonAgentInput } from './agent-utils';
import {
  TaskRefinerRequest,
  TaskRefinerResponse,
  TaskRefinerResponseSchema,
} from './types';

// Configuration for this agent node
const config = {
  useNextLevel: false,
  nodeId: 'agent_editor',
  title: 'AI Agent Editor',
} as const;

/**
 * Task Agent Editor node - provides conversational refinement for task fields
 * Simplified version that uses operations-based response pattern like initiatives
 */
@Injectable()
export class TaskRefinementAgentEditorNode extends AgentNodeBase<
  TaskRefinementFlowContext,
  (TaskRefinerRequest & Record<string, unknown>) | undefined
> {
  readonly id = TASK_REFINEMENT_NODES.AGENT_EDITOR;
  readonly title = config.title;
  readonly responseSchema = TaskRefinerResponseSchema;
  readonly startMessage = 'Reviewing task...';

  private readonly logger = new Logger(TaskRefinementAgentEditorNode.name);

  constructor(
    private taskService: TaskService,
    private artifactService: ArtifactService,
    private initiativeService: InitiativeService,
    private workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {
    super();
  }

  readonly agentId = 'task-refiner';

  readonly agentInput = async (
    tracker: MutableContextHandle<TaskRefinementFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<(TaskRefinerRequest & Record<string, unknown>) | undefined> => {
    const context = tracker.getContext();
    const task = await this.taskService.findOne(
      context.core.organizationId,
      context.taskId,
    );
    if (!task) {
      this.logger.warn('Task not found while building agent input', {
        taskId: context.taskId,
        organizationId: context.core.organizationId,
      });
      return undefined;
    }

    const lastUserMessage = latestUserMessage
      ? MessageContentExtractor.extractMessageContent(latestUserMessage)
      : '';

    const input = await getCommonAgentInput(
      context,
      { content: lastUserMessage, id: latestUserMessage?.id },
      task,
      this.artifactService,
      this.initiativeService,
      this.workItemTypeRegistry,
      this.logger,
    );

    return input as (TaskRefinerRequest & Record<string, unknown>) | undefined;
  };

  readonly userPrompt = '';

  async buildContext(
    tracker: MutableContextHandle<TaskRefinementFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      taskId: context.taskId,
      initiativeId: context.initiativeId,
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<TaskRefinerResponse>,
    tracker: MutableContextHandle<TaskRefinementFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      const context = tracker.getContext();
      this.logger.debug('Task agent response received:', {
        result: agentResponse.result,
      });

      // Validate agent response has result
      if (!agentResponse.result) {
        this.logger.error('Task agent response missing result field:', {
          executionId: agentResponse.executionId,
          status: agentResponse.status,
          error: agentResponse.error,
        });
        return {
          nextNodeId: TASK_REFINEMENT_NODES.AGENT_EDITOR,
          errorMsg: 'Task agent response missing result field',
        };
      }

      // Validate response schema
      const parseResult = TaskRefinerResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error('Task agent response validation failed:', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: TASK_REFINEMENT_NODES.AGENT_EDITOR,
          errorMsg: 'Task agent response validation failed',
        };
      }

      const agentData = parseResult.data;
      const responseFieldId = uuidv4();
      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: responseFieldId,
        relatedEntities: agentData.relatedEntities,
      });

      // Convert ops to fields format for TaskContentApplyPayload
      if (agentData.ops?.length) {
        const isTaskFieldKey = (
          target: string | undefined,
        ): target is TaskContentApplyPayloadAllOfFields.KeyEnum =>
          target === TaskContentApplyPayloadAllOfFields.KeyEnum.Description ||
          target ===
            TaskContentApplyPayloadAllOfFields.KeyEnum.AcceptanceCriteria;

        type AgentOp = NonNullable<typeof agentData.ops>[number];
        const hasTaskFieldKey = (
          op: AgentOp,
        ): op is AgentOp & {
          target: TaskContentApplyPayloadAllOfFields.KeyEnum;
        } => isTaskFieldKey(op.target);

        const fields = agentData.ops.filter(hasTaskFieldKey).map((op) => ({
          key: op.target,
          content: op.text,
        }));

        if (fields.length && context.initiativeId) {
          const payload: TaskContentApplyPayload = {
            initiativeId: context.initiativeId,
            handlerType: 'task_content_apply',
            fields,
          };

          // Add secondary action for applying edits
          secondaryActions.push({
            id: uuidv4(),
            type: SecondaryActionConfig.TypeEnum.FieldAction,
            presentation: SecondaryActionConfig.PresentationEnum.Inline,
            label: 'Apply Proposed Edits',
            fieldId: 'agent_response',
            handler: SecondaryActionHandler.TaskContentApply,
            payload,
          });
        }
      }

      // Build UI element for agent response
      const uiElement: UIElement = {
        id: responseFieldId,
        type: 'agent_response',
        label: agentData.ops?.length
          ? 'Review the proposed edits'
          : "What's next",
        placeholder: `Share your feedback${agentData.ops?.length ? ' or approve the changes...' : ''}`,
        required: false,
        influences: (agentData.influences || []) as Influence[],
      };

      this.logger.log('Task agent response processed:', {
        executionId: agentResponse.executionId,
        operationsCount: agentData.ops?.length,
        hasInfluences: !!agentData.influences?.length,
        sectionCompleteConfidence: agentData.sectionCompleteConfidence,
      });

      return {
        nextNodeId: TASK_REFINEMENT_NODES.AGENT_EDITOR,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          title: this.title,
          response:
            agentData.response || 'Here are my suggested edits to the task:',
          uiElements: [uiElement],
          secondaryActions,
        },
      };
    } catch (error) {
      this.logger.error('Error in task agent processing:', error);
      return {
        nextNodeId: TASK_REFINEMENT_NODES.AGENT_EDITOR,
        errorMsg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async compensate(
    _context: TaskRefinementFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Agent timeouts - longer delay, more retries for complex reasoning
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 10000 + attemptCount * 5000; // Progressive: 10s, 15s, 20s
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Agent analysis timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
      };
    }

    // Agent service issues - try with extended delay
    if (errorClassification.type === 'RETRYABLE' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'Agent service issue, retrying with extended delay',
      };
    }

    // Rate limiting - agent-specific delays
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 20000, // Longer delay for agent rate limits
        reason: 'Agent rate limited, extended delay before retry',
      };
    }

    // Max attempts - fallback to agent editor to handle manually
    if (attemptCount >= 3) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: TASK_REFINEMENT_NODES.AGENT_EDITOR,
        reason: 'Task agent editor failed, falling back to manual refinement',
      };
    }

    return { action: 'FAIL' };
  }
}
