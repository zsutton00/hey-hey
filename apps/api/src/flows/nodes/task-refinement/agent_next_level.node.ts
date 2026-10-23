import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  Influence,
  TaskSectionInput,
  TaskSectionUpdateSource,
  UIElement,
  WorkStatus,
} from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import { MutableContext } from 'src/utils/mutable-context';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import {
  getTaskNextRefinementLevelFromStatus,
  getTaskNextStatus,
  getTaskPreviousRefinementLevel,
} from 'src/utils/task-refinement-profile.util';
import { MastraAgentResponse } from '../../../services/agents/mastra-client.service';
import {
  CompensationContext,
  CompensationResult,
  ProcessAgentResponseResult,
  TaskRefinementFlowContext,
} from '../../../types/flow-internal.types';
import { TASK_REFINEMENT_NODES } from '../../constants/node-ids';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';
import { getCommonAgentInput } from './agent-utils';
import {
  TaskRefinerNextLevelResponse,
  TaskRefinerNextLevelResponseSchema,
  TaskRefinerRequest,
} from './types';

// Configuration for this agent node
const config = {
  nodeId: 'agent_next_level',
  title: 'AI Next Level Generation',
} as const;

/**
 * Task Agent Next Level node - generates content for the next refinement level
 * System-initiated (no user message required) - triggered by /deepen endpoint
 */
@Injectable()
export class TaskRefinementAgentNextLevelNode extends AgentNodeBase<
  TaskRefinementFlowContext,
  (TaskRefinerRequest & Record<string, unknown>) | undefined
> {
  readonly id = TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL;
  readonly title = config.title;
  readonly responseSchema = TaskRefinerNextLevelResponseSchema;

  private readonly logger = new Logger(TaskRefinementAgentNextLevelNode.name);

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
    tracker: MutableContext<TaskRefinementFlowContext>,
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

    const levels = this.workItemTypeRegistry.getTaskRefinementLevels(
      task.type,
      context.core.projectId,
    );
    const nextSection = getTaskNextRefinementLevelFromStatus(
      task.status,
      levels,
    );
    const previousSection =
      nextSection && getTaskPreviousRefinementLevel(nextSection, levels);

    if (!nextSection) {
      this.logger.warn(
        'No next level available - task is at final refinement stage',
        {
          taskId: context.taskId,
          previousSection,
        },
      );
      return undefined;
    }

    // Determine generation type based on target field content
    const taskContent = materializedSectionsToContentMap(task.sections);
    const targetFieldValue = taskContent[nextSection];
    const isTargetEmpty =
      !targetFieldValue ||
      (typeof targetFieldValue === 'string' && targetFieldValue.trim() === '');

    const lastUserMessage = isTargetEmpty
      ? `Generate initial content for the ${nextSection} section based on the existing task information.`
      : `Update the ${nextSection} section to reflect changes made to the ${previousSection} section.`;

    const out = await getCommonAgentInput(
      context,
      { content: lastUserMessage, id: undefined },
      task,
      this.artifactService,
      this.initiativeService,
      this.workItemTypeRegistry,
      this.logger,
      { requiredOps: 1 },
    );

    return out as (TaskRefinerRequest & Record<string, unknown>) | undefined;
  };

  readonly userPrompt = '';

  async buildContext(
    tracker: MutableContext<TaskRefinementFlowContext>,
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
    agentResponse: MastraAgentResponse<TaskRefinerNextLevelResponse>,
    tracker: MutableContext<TaskRefinementFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      const context = tracker.getContext();
      this.logger.debug('Task next level agent response received:', {
        result: agentResponse.result,
      });

      // Validate agent response has result
      if (!agentResponse.result) {
        this.logger.error(
          'Task next level agent response missing result field:',
          {
            executionId: agentResponse.executionId,
            status: agentResponse.status,
            error: agentResponse.error,
          },
        );
        return {
          nextNodeId: TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'Task next level agent response missing result field',
        };
      }

      const task = await this.taskService.findOne(
        context.core.organizationId,
        context.taskId,
      );

      if (!task) {
        throw new Error(
          `Task ${context.taskId} not found in initiative ${context.initiativeId}`,
        );
      }

      const levels = this.workItemTypeRegistry.getTaskRefinementLevels(
        task.type,
        context.core.projectId,
      );
      const nextSection = getTaskNextRefinementLevelFromStatus(
        task.status,
        levels,
      );
      if (!nextSection) {
        this.logger.warn(
          'Task has no next section while processing agent response',
          {
            taskId: context.taskId,
            status: task.status,
          },
        );
        return {
          nextNodeId: TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'Task has no next section for refinement',
        };
      }

      // Validate response schema
      const parseResult = TaskRefinerNextLevelResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error('Task next level agent response validation failed:', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'Task next level agent response validation failed',
        };
      }

      const agentData = parseResult.data;

      // Get all ops targeting nextSection or any later sections
      const sectionOrder = levels;
      const nextSectionIndex = sectionOrder.indexOf(nextSection);
      const applicableSections = sectionOrder.slice(nextSectionIndex);

      const editableSections = [...sectionOrder] as const;
      type EditableSection = (typeof editableSections)[number];
      const isApplicableTarget = (
        target: string | undefined,
      ): target is EditableSection =>
        !!target &&
        editableSections.includes(target as EditableSection) &&
        applicableSections.includes(target as (typeof sectionOrder)[number]);

      type AgentOp = NonNullable<typeof agentData.ops>[number];
      const hasApplicableTarget = (
        op: AgentOp,
      ): op is AgentOp & { target: EditableSection } =>
        isApplicableTarget(op.target);

      const fieldUpdates = agentData.ops?.filter(hasApplicableTarget) || [];

      const sections: TaskSectionInput[] = fieldUpdates.map((update) => ({
        key: update.target,
        content: update.text,
        order: sectionOrder.indexOf(update.target),
      }));

      const update: {
        status: WorkStatus;
        sections?: TaskSectionInput[];
        sectionUpdateSource?: TaskSectionUpdateSource;
      } = {
        status: getTaskNextStatus(task.status, levels),
        sections: sections.length ? sections : undefined,
        sectionUpdateSource: sections.length
          ? TaskSectionUpdateSource.AgentSuggested
          : undefined,
      };

      this.logger.log('Task next level agent updating task', {
        taskId: context.taskId,
      });

      await this.taskService.update(
        context.core.organizationId,
        context.initiativeId,
        context.taskId,
        update,
      );

      // Build UI element for agent response
      const responseFieldId = uuidv4();
      const uiElement: UIElement = {
        id: responseFieldId,
        type: 'agent_response',
        label: 'Review the generated content',
        placeholder: 'Share your feedback...',
        required: false,
        influences: (agentData.influences || []) as Influence[],
      };

      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: responseFieldId,
        relatedEntities: agentData.relatedEntities,
      });

      this.logger.log('Task next level agent response processed:', {
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
            agentData.response ||
            'Here is the generated content for the next section:',
          ...(secondaryActions.length ? { secondaryActions } : {}),
          uiElements: [uiElement],
        },
      };
    } catch (error) {
      this.logger.error('Error in task next level agent processing:', error);
      return {
        nextNodeId: TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
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
        reason: `Agent generation timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
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

    // Max attempts - fallback to prompt input for manual handling
    if (attemptCount >= 3) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: TASK_REFINEMENT_NODES.PROMPT_INPUT,
        reason:
          'Task next level generation failed, falling back to manual input',
      };
    }

    return { action: 'FAIL' };
  }
}
