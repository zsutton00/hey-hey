import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  UIElement,
  WorkflowReviewAction,
} from 'src/generated';
import { PlanShapingFeatureSyncIteratePromptPayload } from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  PlanFromDesignDocFlowContext,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { UserMessageExtractor } from 'src/utils/user-message-extractor';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import { FEATURE_SYNC_ACTIONS } from '../feature-sync/schemas';
import { assignDiscrepancyIds } from '../shared/feature-sync-discrepancy';
import {
  PlanShapingFeatureSyncReviewRevisionPayload,
  planShapingFeatureSyncIterateActions,
  planShapingRevisedDiscrepancyListPayloadSchema,
} from './schemas';

/**
 * `feature-sync-iterate` EXTERNAL_AGENT node — the self-looping review
 * surface that owns the repeat loop. Every trigger is self-sufficient: it
 * carries the saved flagged items (`featureSyncDiscrepancies`, with stable
 * ids, in display order), the user's per-item choices
 * (`featureSyncPendingDecisions`) and the pending reply
 * (`featureSyncPendingUserReply` → `userMessage`). It never relies on provider
 * session history to know what "item 6" is.
 *
 * - `REVISED { discrepancies: [...] }` (agent) — a fresh set was produced and
 *   replaces the saved items, keeping ids the agent echoed back. The
 *   CLI rides the `plan_shaping_feature_sync_review` element on this very agent
 *   output, so the node parks on the user (`parkOnUserResponse: true`) rather
 *   than re-firing the trigger.
 * - `FEATURE_SYNC_REVIEW_REQUEST_REVISIONS { feedback, decisions? }` (user) — the
 *   "Continue Revising" button on the review element the iterate output rides,
 *   the loop's equivalent of the gate's "Keep working on this".
 *   `processUserResponse` stashes `feedback` on `featureSyncPendingUserReply`
 *   and the choices on `featureSyncPendingDecisions`, and the flow self-loops back onto
 *   iterate WITHOUT `parkOnUserResponse`, so the trigger re-fires and the agent
 *   produces another revised set. Before this action was registered the engine
 *   rejected the token as `unknown_action` and the click dropped silently after
 *   the first revision — the bug this branch fixes.
 *
 * A free-text USER reply (no `action`) re-fires the agent via the
 * `acceptsUserMessages` self-loop: `processUserResponse` stashes the reply on
 * `featureSyncPendingUserReply` for the next `buildTriggerMessage`. The user's
 * Done is the only exit to stage proposal; `RESOLVED` is not a valid action.
 */
@Injectable()
export class PlanShapingFeatureSyncIterateNode extends ExternalAgentNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE;
  readonly title = 'Plan Shaping — Feature Sync Iterate';

  readonly promptType = LocalPromptType.plan_shaping_feature_sync_iterate;

  // Opt into the EXTERNAL_AGENT free-text self-loop in
  // `resolveExternalAgentRouting`: an actionless USER reply (the textarea on
  // the review surface) is a legitimate completion shape on this node —
  // `processUserResponse` stashes it on context for the next
  // `buildTriggerMessage` to surface, and the routing layer self-loops the
  // node instead of running the per-action validator.
  readonly acceptsUserMessages = true;

  readonly actions: ExternalAgentActionSchemas =
    planShapingFeatureSyncIterateActions;

  private readonly logger = new Logger(PlanShapingFeatureSyncIterateNode.name);

  async buildTriggerMessage(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();

    this.logger.debug('Plan-shaping feature-sync iterate node entered', {
      conversationId: context.core.conversationId,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Plan Shaping — Feature Sync Iterate',
        required: false,
        influences: [],
      },
    ];

    const discrepancies = context.featureSyncDiscrepancies;
    const decisions = context.featureSyncPendingDecisions;
    if (discrepancies === undefined || decisions === undefined) {
      const missingContext = [
        ...(discrepancies === undefined ? ['featureSyncDiscrepancies'] : []),
        ...(decisions === undefined ? ['featureSyncPendingDecisions'] : []),
      ];
      this.logger.error(
        'Plan-shaping feature-sync iterate context is incomplete',
        {
          conversationId: context.core.conversationId,
          missingContext,
        },
      );
      throw new Error(
        `Plan-shaping feature-sync iterate requires saved ${missingContext.join(' and ')}`,
      );
    }

    const triggerPayload: PlanShapingFeatureSyncIteratePromptPayload = {
      discrepancies,
      decisions,
    };

    if (context.featureSyncPendingUserReply) {
      triggerPayload.userMessage = context.featureSyncPendingUserReply;
    }
    tracker.mutate((draft) => {
      delete draft.featureSyncPendingUserReply;
      delete draft.featureSyncPendingDecisions;
    });

    if (triggerPayload.discrepancies.length === 0) {
      this.logger.warn(
        'Plan-shaping feature-sync iterate trigger has no saved flagged items',
        { conversationId: context.core.conversationId },
      );
    }

    this.logger.debug(
      'Plan-shaping feature-sync iterate trigger payload built',
      {
        conversationId: context.core.conversationId,
        itemIds: triggerPayload.discrepancies.map((item) => item.id),
        decisionCount: triggerPayload.decisions.length,
        carriedUserMessage: triggerPayload.userMessage !== undefined,
      },
    );

    return {
      response:
        'Working through the surfaced discrepancies. Will either resolve them or surface a revised set for another pass.',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'plan_shaping_feature_sync_iterate_started',
        intentConfidence: 1,
        reasoning:
          'External agent iterating on plan-shaping feature-sync discrepancies before stages are proposed.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;

    // REVISED replaces the saved items. processUserResponse runs before the
    // engine validator, so only a well-formed list mutates context; ids the
    // agent echoed back are kept so the user's choices stay attached.
    if (data.action === FEATURE_SYNC_ACTIONS.REVISED) {
      const parsed = planShapingRevisedDiscrepancyListPayloadSchema.safeParse(
        data.payload,
      );
      if (!parsed.success) {
        return;
      }
      const context = tracker.getContext();
      const revised = assignDiscrepancyIds(
        parsed.data.discrepancies,
        context.featureSyncDiscrepancies,
      );
      tracker.mutate((draft) => {
        draft.featureSyncDiscrepancies = revised;
      });
      this.logger.debug(
        'Plan-shaping feature-sync iterate refreshed flagged items',
        {
          conversationId: context.core.conversationId,
          itemIds: revised.map((item) => item.id),
        },
      );
      return;
    }

    // "Continue Revising" on the review element the iterate output rides — the
    // loop's equivalent of the gate's "Keep working on this". The button
    // dispatches the FEATURE_SYNC_REVIEW_REQUEST_REVISIONS action with a
    // `{ feedback, decisions? }` payload; stash both so the next trigger
    // surfaces them and the agent produces another revised set.
    //
    // No payload validation here: this is an EXTERNAL_AGENT node, so the engine
    // re-validates `data.payload` against the registered
    // `featureSyncReviewRevisionPayloadSchema` in `resolveExternalAgentRouting`
    // immediately after this runs — a malformed payload throws `invalid_payload`
    // there, keeps the node paused for retry, and discards this context
    // mutation. (The gate hand-parses because QUESTIONS nodes self-validate; an
    // EXTERNAL_AGENT node gets engine validation for free.)
    if (data.action === WorkflowReviewAction.Refine) {
      const { feedback, decisions = [] } =
        data.payload as PlanShapingFeatureSyncReviewRevisionPayload;
      tracker.mutate((draft) => {
        draft.featureSyncPendingUserReply = feedback;
        draft.featureSyncPendingDecisions = decisions;
      });
      this.logger.debug(
        'Plan-shaping feature-sync iterate stashed Continue Revising feedback',
        {
          conversationId: tracker.getContext().core.conversationId,
          feedbackLength: feedback.length,
          decisionCount: decisions.length,
        },
      );
      return;
    }

    // Free-text reply typed into the review surface's textarea. Stash for the
    // next entry's `acceptsUserMessages` self-loop to surface as
    // `triggerPayload.userMessage`.
    if (!data.action) {
      const reply = UserMessageExtractor.extractContentFromData(
        userMessage.data,
        '',
      );
      if (reply) {
        tracker.mutate((draft) => {
          draft.featureSyncPendingUserReply = reply;
          draft.featureSyncPendingDecisions = [];
        });
        this.logger.debug(
          'Plan-shaping feature-sync iterate captured free-text user reply',
          {
            conversationId: tracker.getContext().core.conversationId,
            replyLength: reply.length,
          },
        );
      }
    }
  }
}
