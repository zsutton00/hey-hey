import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  PlanGenerationStageReviewElement,
  ExtendedUIFieldType,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from 'src/generated';
import {
  FlowUserMessage,
  PlanFromDesignDocFlowContext,
  NodeResult,
  NodeType,
  QuestionsActionFlowData,
  QuestionsActionValidationError,
  QuestionsNodeBase,
  validateQuestionsAction,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import { PlanStageBatchApprovalService } from 'src/services/proposal/plan-stage-batch-approval.service';
import { ConversationId, OrganizationId, ProjectId, UserId } from 'src/types';
import {
  PLAN_SHAPING_ACTIONS,
  PlanShapingProposedStagesFeedbackPayload,
  planShapingProposedStagesFeedbackActions,
} from './schemas';

/**
 * `proposed-stages-feedback` QUESTIONS gate — the user-driven review
 * surface that decides whether the proposed plan stages roll forward
 * into per-step refinement or loop back into another revision pass.
 *
 * On entry the node renders a single `plan_generation_stage_review`
 * UI element: a feedback textarea plus two action buttons —
 * `continue_revising` and `approve_all`. The user types optional
 * feedback, then clicks one button. The browser submits the form
 * with `data.action` set to the chosen discriminator and
 * `data.payload.feedback` carrying the textarea body.
 *
 * `processUserResponse` reads the action and:
 *
 * - On `continue_revising`: stashes the feedback on
 *   `PlanFromDesignDocFlowContext.proposedStagesFeedback` so the next
 *   `proposed-stages` entry can surface it as the agent prompt's
 *   `userMessage`. Routing returns `proposed-stages` so the agent runs
 *   another revision pass.
 *
 * - On `approve_all`: treats the canonical APPROVED submission as a
 *   readiness signal and routes directly to `visual-preview`. Proposal
 *   state remains under the authority of the individual proposal controls.
 *
 * The gate is QUESTIONS-style rather than EXTERNAL_AGENT because the
 * decision surface belongs to the user — the agent is not the
 * authoring side here. Routing is therefore expressed via
 * `determineRoutingFromUserMessage` reading the action discriminator.
 */
@Injectable()
export class PlanShapingProposedStagesFeedbackNode extends QuestionsNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK;
  readonly title = 'Plan Shaping — Proposed Stages Feedback';

  readonly actions = planShapingProposedStagesFeedbackActions;

  private readonly logger = new Logger(
    PlanShapingProposedStagesFeedbackNode.name,
  );

  constructor(
    private readonly batchApprovalService: PlanStageBatchApprovalService,
  ) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    this.logger.debug('Plan-shaping proposed-stages-feedback node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
    });

    if (!context.proposedStagesReview) {
      this.logger.error('Stage review requires the accepted completion total', {
        conversationId: context.core.conversationId,
      });
      throw new Error('Stage review requires the accepted completion total');
    }
    this.logger.debug('Projecting accepted stage total into review field', {
      conversationId: context.core.conversationId,
      expectedStageCount: context.proposedStagesReview.expectedStageCount,
    });
    const reviewFieldId = uuidv4();
    const uiElements: UIElement[] = [
      {
        id: reviewFieldId,
        type: ExtendedUIFieldType.PlanGenerationStageReview,
        label: 'Review the proposed stages',
        required: false,
        influences: [],
        payload: {
          expectedStageCount: context.proposedStagesReview.expectedStageCount,
        },
      } satisfies PlanGenerationStageReviewElement,
    ];

    const secondaryActions: SecondaryActionConfig[] = [
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: 'Continue Revising',
        handler:
          SecondaryActionHandler.PlanGenerationStageReviewContinueRevising,
        fieldId: reviewFieldId,
        disabled: false,
        payload: {
          handlerType: 'plan_generation_stage_review_continue_revising',
        },
      },
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: 'Ready for next step',
        handler: SecondaryActionHandler.PlanGenerationStageReviewApproveAll,
        fieldId: reviewFieldId,
        disabled: false,
        payload: {
          handlerType: 'plan_generation_stage_review_approve_all',
        },
      },
    ];

    return {
      type: NodeType.QUESTIONS,
      message:
        'Review the proposed stages. Add feedback and continue revising, or move on when you are ready.',
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
    let validated: {
      action: keyof typeof planShapingProposedStagesFeedbackActions;
      payload: PlanShapingProposedStagesFeedbackPayload;
    };
    try {
      const result = validateQuestionsAction({
        nodeId: this.id,
        actions: planShapingProposedStagesFeedbackActions,
        message: userMessage,
      });
      validated = {
        action: result.action,
        payload: result.payload as PlanShapingProposedStagesFeedbackPayload,
      };
    } catch (error) {
      if (error instanceof QuestionsActionValidationError) {
        delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
        this.logger.warn(
          'Proposed-stages-feedback: rejecting submission — schema validation failed',
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

    if (validated.action === PLAN_SHAPING_ACTIONS.REFINE) {
      if (!userMessage.userId) {
        throw new Error('Plan revision requires an authenticated user message');
      }
      const ctx = tracker.getContext();
      await this.batchApprovalService.withdrawForRevision({
        organizationId: ctx.core.organizationId as OrganizationId,
        projectId: ctx.core.projectId as ProjectId,
        conversationId: ctx.core.conversationId as ConversationId,
        userId: userMessage.userId as UserId,
      });
      const feedback = validated.payload.feedback.trim();
      tracker.mutate((draft) => {
        draft.proposedStagesFeedback = feedback || undefined;
      });
      this.logger.debug(
        'Proposed-stages-feedback: continue_revising captured',
        {
          conversationId: tracker.getContext().core.conversationId,
          hasFeedback: !!feedback,
        },
      );
      return;
    }
  }

  async determineRoutingFromUserMessage(
    _context: PlanFromDesignDocFlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    // Routing reads the action discriminator only — the payload was already
    // validated and consumed in processUserResponse.
    const data = (userMessage.data ?? {}) as QuestionsActionFlowData;
    const action = data.action;

    if (action === PLAN_SHAPING_ACTIONS.REFINE) {
      return PLAN_SHAPING_NODES.PROPOSED_STAGES;
    }
    if (action === PLAN_SHAPING_ACTIONS.APPROVED) {
      return PLAN_SHAPING_NODES.VISUAL_PREVIEW;
    }
    // Fallback: stay on this gate so the user can submit again. The default
    // transition in the flow template also points back to this gate.
    return PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK;
  }
}
