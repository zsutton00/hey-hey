import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  WorkflowReviewAction,
  LocalStartupSessionPromptPayload,
  UIElement,
} from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import { TaskService } from 'src/services/tasks/task.service';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FeatureSyncFlowContext,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';
import { featureSyncCodingPlanActions } from './schemas';
import { CodingPlanReviewAnswerPayloadSchema } from 'src/generated/workflow-review.schemas';

/**
 * Coding-plan gate of the feature-sync flow.
 *
 * Entered from `analyze.NO_DISCREPANCY` or `iterate.RESOLVED`. Emits a
 * SYSTEM trigger message on entry (`data.triggersAgent.promptType =
 * startup_session`) carrying a `LocalStartupSessionPromptPayload`. The
 * payload carries no copy of the task: the CLI loads the focal work item
 * from the persisted Run entity reference, so the task's type is never
 * written into a closed wire enum.
 *
 * The node is an EXTERNAL_AGENT node that accepts two user-authored actions:
 *
 * - `REFINE` — the user requested another planning turn. The flow self-loops
 *   without parking so the node emits a new `startup_session` trigger; the
 *   canonical review payload remains on the conversation message for the
 *   planner to consume.
 * - `APPROVED` — the user has accepted the
 *   plan currently in the conversation tail. Routes to the terminal
 *   `implement` EXTERNAL_AGENT node so the conversation continues to carry
 *   a non-null `currentNodeId` while the CLI takes over execution.
 * Unlike `iterate`, this node does not duplicate plan state onto
 * `FeatureSyncFlowContext`; the plan lives only in conversation history.
 */
@Injectable()
export class FeatureSyncCodingPlanNode extends ExternalAgentNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.CODING_PLAN;
  readonly title = 'Coding Plan';

  readonly promptType = LocalPromptType.startup_session;

  readonly actions: ExternalAgentActionSchemas = featureSyncCodingPlanActions;

  private readonly logger = new Logger(FeatureSyncCodingPlanNode.name);

  constructor(private readonly taskService: TaskService) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const { organizationId } = context.core;

    if (!context.taskId) {
      throw new Error(
        'coding_plan requires context.taskId to assemble the startup_session payload',
      );
    }

    this.logger.debug('Feature sync coding-plan assembling payload', {
      conversationId: context.core.conversationId,
      taskId: context.taskId,
    });

    const task = await this.taskService.findOneForAdapter(
      context.taskId,
      organizationId,
    );
    if (!task) {
      throw new Error(
        `coding_plan could not find task ${context.taskId} for startup_session payload`,
      );
    }

    const payload = this.buildPayload(context.implementationReadiness);

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Feature Sync — Coding Plan',
        required: false,
        influences: [],
      },
    ];

    return {
      response: '',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload,
      },
      data: {
        detectedIntent: 'feature_sync_startup_session',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    // Parse the authoritative answer before recording routing settings;
    // the plan and accompanying feedback remain in conversation history.
    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;

    if (data.action === WorkflowReviewAction.Refine) {
      this.logger.debug('Feature sync coding-plan refinement requested', {
        conversationId: tracker.getContext().core.conversationId,
      });
      return;
    }

    if (data.action === WorkflowReviewAction.Approved) {
      const payload = CodingPlanReviewAnswerPayloadSchema.parse(data.payload);
      tracker.mutate((draft) => {
        delete draft.implementRuntime;
        delete draft.implementApprovalOperationId;
      });
      if (payload.provider !== undefined && payload.model !== undefined) {
        const runtime = {
          provider: payload.provider,
          model: payload.model,
          ...(payload.reasoningEffort !== undefined
            ? { reasoningEffort: payload.reasoningEffort }
            : {}),
          ...(payload.fastMode !== undefined
            ? { fastMode: payload.fastMode }
            : {}),
        } satisfies import('src/generated').ImplementRuntimeSelection;
        tracker.mutate((draft) => {
          draft.implementRuntime = runtime;
          draft.implementApprovalOperationId =
            userMessage.workflowAnswerOperationId;
        });
      }
      this.logger.debug('Feature sync coding-plan approved', {
        conversationId: tracker.getContext().core.conversationId,
      });
      return;
    }
  }

  private buildPayload(
    implementationReadiness: LocalStartupSessionPromptPayload['implementationReadiness'],
  ): LocalStartupSessionPromptPayload {
    return implementationReadiness ? { implementationReadiness } : {};
  }
}
