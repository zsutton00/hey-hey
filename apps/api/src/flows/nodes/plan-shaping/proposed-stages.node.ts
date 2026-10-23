import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import { PlanShapingProposedStagesPromptPayload } from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  FlowUserMessage,
  ExternalAgentActionSchemas,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  PlanFromDesignDocFlowContext,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PlanFromDesignDocSeedService } from 'src/services/plan/plan-from-design-doc-seed.service';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import {
  PLAN_SHAPING_ACTIONS,
  planShapingProposedStagesActions,
  planShapingProposedStagesCompletionPayloadSchema,
} from './schemas';

/**
 * `proposed-stages` EXTERNAL_AGENT node — produces the plan's stages at
 * theme fidelity.
 *
 * Entered as the start of the plan-from-design-doc workflow. Emits a
 * SYSTEM trigger message
 * (`data.triggersAgent.promptType = plan_shaping_proposed_stages`) asking
 * the CLI agent to propose the plan's stages, each carrying its step
 * themes. The agent creates the plan + stages + step themes as platform
 * proposals (plan-shaping MCP tools) and then emits `READY`.
 *
 * Stages land in a `proposed` status here by construction; per-step
 * refinement and the advance-to-next-stage gate are explicitly held for
 * later and are not part of this graph.
 */
@Injectable()
export class PlanShapingProposedStagesNode extends ExternalAgentNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.PROPOSED_STAGES;
  readonly title = 'Plan Shaping — Proposed Stages';

  readonly promptType = LocalPromptType.plan_shaping_proposed_stages;

  readonly actions: ExternalAgentActionSchemas =
    planShapingProposedStagesActions;

  private readonly logger = new Logger(PlanShapingProposedStagesNode.name);

  constructor(private readonly seedService: PlanFromDesignDocSeedService) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    this.logger.debug(
      'Clearing previous stage-review total before stage generation',
      {
        conversationId: tracker.getContext().core.conversationId,
        previousReview: tracker.getContext().proposedStagesReview,
      },
    );
    tracker.mutate((draft) => {
      draft.proposedStagesReview = undefined;
    });
    // Consume any feedback the user typed into the
    // `proposed-stages-feedback` gate when they clicked Continue
    // Revising. The agent only sees the feedback once.
    const carriedFeedback = tracker.getContext().proposedStagesFeedback?.trim();
    if (carriedFeedback) {
      tracker.mutate((draft) => {
        draft.proposedStagesFeedback = undefined;
      });
    }

    const context = tracker.getContext();
    const seed = await this.seedService.resolve(context.core.conversationId);

    this.logger.debug('Plan-shaping proposed-stages node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      hasCarriedFeedback: !!carriedFeedback,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Plan Shaping — Proposed Stages',
        required: false,
        influences: [],
      },
    ];

    const triggerPayload: PlanShapingProposedStagesPromptPayload = {
      designDocId: seed.designDocId,
      planId: seed.planId,
    };
    if (carriedFeedback) {
      triggerPayload.userMessage = carriedFeedback;
    }

    return {
      response: carriedFeedback
        ? 'Reworking the stages with your feedback…'
        : 'Getting started on your plan…',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'plan_shaping_proposed_stages_started',
        intentConfidence: 1,
        reasoning:
          'External agent proposing the plan stages at theme fidelity as platform proposals.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const data = userMessage.data;
    this.logger.debug('Validating stage completion total', {
      conversationId: tracker.getContext().core.conversationId,
      action: data?.action,
    });
    if (data?.action !== PLAN_SHAPING_ACTIONS.READY) return;
    const result = planShapingProposedStagesCompletionPayloadSchema.safeParse(
      data.payload,
    );
    if (!result.success) {
      this.logger.warn('Rejected stage completion total', {
        issues: result.error.issues,
      });
      throw result.error;
    }
    tracker.mutate((draft) => {
      draft.proposedStagesReview = {
        expectedStageCount: result.data.expectedStageCount,
      };
    });
    this.logger.debug('Captured decided stage total for review', {
      conversationId: tracker.getContext().core.conversationId,
      expectedStageCount: result.data.expectedStageCount,
    });
  }
}
