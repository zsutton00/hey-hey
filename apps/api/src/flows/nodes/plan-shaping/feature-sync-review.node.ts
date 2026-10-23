import { Injectable, Logger } from '@nestjs/common';
import {
  ExtendedUIFieldType,
  SecondaryActionConfig,
  SecondaryActionHandler,
  SecondaryActionPayload,
  UIElement,
  WorkflowReviewAction,
} from 'src/generated';
import {
  FlowUserMessage,
  NodeResult,
  NodeType,
  PlanFromDesignDocFlowContext,
  QuestionsActionValidationError,
  QuestionsNodeBase,
  validateQuestionsAction,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { v4 as uuidv4 } from 'uuid';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import {
  PlanShapingFeatureSyncReviewRevisionPayload,
  planShapingFeatureSyncReviewActions,
} from './schemas';

/**
 * `feature-sync-review` QUESTIONS gate — the one-shot input surface that sits
 * between `feature-sync-analyze` and `feature-sync-iterate`.
 *
 * It fires no agent and renders no content of its own: its sole job is to emit
 * the `plan_shaping_feature_sync_review` UI element (a feedback text area) plus
 * two buttons, then park on the user. The flagged items themselves are
 * presented by the agent turn — analyze on first contact, iterate on each
 * REVISED pass — not by this node. Emitting only the element is what makes
 * first contact and the loop render identically: the gate and the iterate CLI
 * handler both output the same element and nothing more.
 *
 * - "Revise" (`request_revisions`): stashes the text-area body onto
 *   `featureSyncPendingUserReply` and the per-item choices onto
 *   `featureSyncPendingDecisions`, then routes forward to
 *   `feature-sync-iterate`, whose first trigger surfaces both alongside the
 *   saved flagged items.
 * - "Done with Feature Sync" (`done`): routes to `proposed-stages` WITHOUT
 *   approving anything — per-proposal cards are the only accept surface.
 *
 * The gate is strictly one-shot: its only inbound edge is analyze's
 * DISCREPANCY, nothing ever routes back into it, and the repeat loop lives
 * entirely on `feature-sync-iterate`. The only self-loop is the
 * unrecognised-submission fallback in `determineRoutingFromUserMessage`.
 */
@Injectable()
export class PlanShapingFeatureSyncReviewNode extends QuestionsNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW;
  readonly title = 'Plan Shaping — Feature Sync Review';

  readonly actions = planShapingFeatureSyncReviewActions;

  private readonly logger = new Logger(PlanShapingFeatureSyncReviewNode.name);

  async execute(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();

    this.logger.debug('Plan-shaping feature-sync review gate entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
    });

    const reviewFieldId = uuidv4();
    const uiElements: UIElement[] = [
      {
        id: reviewFieldId,
        type: ExtendedUIFieldType.PlanShapingFeatureSyncReview,
        label: 'Review flagged items',
        required: false,
        influences: [],
      },
    ];

    const secondaryActions: SecondaryActionConfig[] = [
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: 'Dismiss',
        handler: SecondaryActionHandler.PlanShapingFeatureSyncReviewDone,
        fieldId: reviewFieldId,
        disabled: false,
        payload: {
          handlerType:
            SecondaryActionPayload.HandlerTypeEnum
              .PlanShapingFeatureSyncReviewDone,
        },
      },
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: 'Revise',
        handler:
          SecondaryActionHandler.PlanShapingFeatureSyncReviewRequestRevisions,
        fieldId: reviewFieldId,
        disabled: false,
        payload: {
          handlerType:
            SecondaryActionPayload.HandlerTypeEnum
              .PlanShapingFeatureSyncReviewRequestRevisions,
        },
      },
    ];

    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements,
      data: {
        type: 'QUESTIONS',
        detectedIntent: '',
        intentConfidence: 0,
        secondaryActions,
      },
    } as NodeResult;
  }

  async processUserResponse(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    let validated: { action: string; payload: unknown };
    try {
      validated = validateQuestionsAction({
        nodeId: this.id,
        actions: planShapingFeatureSyncReviewActions,
        message: userMessage,
      });
    } catch (error) {
      if (error instanceof QuestionsActionValidationError) {
        this.logger.warn(
          'Feature-sync-review: rejecting submission — schema validation failed',
          {
            conversationId: tracker.getContext().core.conversationId,
            reason: error.reason,
            action: error.action,
          },
        );
        return;
      }
      throw error;
    }

    if (validated.action === WorkflowReviewAction.Dismissed) {
      // "Ignore" — user declines to engage the flagged items. Routing alone
      // advances the gate; nothing is approved.
      return;
    }

    if (validated.action === WorkflowReviewAction.Refine) {
      // "Keep working on this" — stash the text-area body and per-item choices
      // for the first iterate trigger. Choices are advisory agent input only.
      const payload =
        validated.payload as PlanShapingFeatureSyncReviewRevisionPayload;
      const decisions = payload.decisions ?? [];
      tracker.mutate((draft) => {
        draft.featureSyncPendingUserReply = payload.feedback;
        draft.featureSyncPendingDecisions = decisions;
      });
      this.logger.debug(
        'Feature-sync-review: stashed user reply for the first iterate turn',
        {
          conversationId: tracker.getContext().core.conversationId,
          feedbackLength: payload.feedback.length,
          decisionCount: decisions.length,
        },
      );
    }
  }

  async determineRoutingFromUserMessage(
    _context: PlanFromDesignDocFlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const data = (userMessage.data ?? {}) as { action?: string };
    if (data.action === WorkflowReviewAction.Dismissed) {
      return PLAN_SHAPING_NODES.PROPOSED_STAGES;
    }
    if (data.action === WorkflowReviewAction.Refine) {
      return PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE;
    }
    // Unrecognised submission — the only case the gate self-loops. Normal
    // operation never routes back into this one-shot gate.
    return PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW;
  }
}
