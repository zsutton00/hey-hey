import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  PlanGenerationVisualPreviewPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from '@hey-hey/contracts/api/models';
import {
  PlanShapingApprovedVisualEntityTypeEnum,
  type PlanShapingApprovedVisual,
} from '@hey-hey/contracts/agent-bridge/models';
import {
  FlowUserMessage,
  NodeResult,
  NodeType,
  PlanFromDesignDocFlowContext,
  QuestionsActionFlowData,
  QuestionsActionValidationError,
  QuestionsNodeBase,
  validateQuestionsAction,
} from 'src/types/flow-internal.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import {
  PLAN_SHAPING_ACTIONS,
  PlanShapingVisualPreviewFeedbackPayload,
  planShapingVisualPreviewFeedbackActions,
} from './schemas';
import {
  findFirstUnapprovedEntry,
  orderVisualEntries,
  resolveVisualReviewPosition,
  type VisualPreviewEntry,
} from './visual-preview-review';

/** The section holding each visual work item type's opening description. */
const VISUAL_SUMMARY_SECTION_KEY = {
  mockup: 'purpose',
  DIAGRAM: 'description',
} as const;

const firstParagraph = (markdown: string): string =>
  markdown
    .trim()
    .split(/\n\s*\n/)[0]
    ?.trim() ?? '';

@Injectable()
export class PlanShapingVisualPreviewFeedbackNode extends QuestionsNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK;
  readonly title = 'Plan Shaping — Visual Preview Feedback';
  readonly actions = planShapingVisualPreviewFeedbackActions;

  private readonly logger = new Logger(
    PlanShapingVisualPreviewFeedbackNode.name,
  );

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * Reads the live status of every visual in the current set. Visuals are
   * never dropped here: a rejected visual stays in place so the agent redraws
   * it at its position in the order.
   */
  private async readLiveStatuses(
    context: PlanFromDesignDocFlowContext,
  ): Promise<{
    entries: VisualPreviewEntry[];
    statusById: Map<string, string>;
  }> {
    const entries = context.visualPreviewEntries ?? [];
    const proposalIds = entries.map((entry) => entry.proposalId);
    const proposals = await this.prisma.db.proposal.findMany({
      where: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        id: { in: proposalIds },
      },
      select: { id: true, status: true },
    });
    const statusById = new Map(
      proposals.map((proposal) => [proposal.id, proposal.status]),
    );
    const missing = proposalIds.filter(
      (proposalId) => !statusById.has(proposalId),
    );
    if (missing.length > 0) {
      throw new Error(
        `[visual-preview-feedback] proposal identities are no longer available: ${missing.join(', ')}`,
      );
    }
    return { entries, statusById };
  }

  /**
   * Resolves each approved visual's Mockup/Diagram work item, title and
   * opening paragraph, in presentation order. A visual whose work item cannot
   * be resolved is left out so later agents never receive a half-populated
   * reference; visual review still shows it as its proposal card.
   */
  private async resolveApprovedVisuals(
    context: PlanFromDesignDocFlowContext,
    entries: readonly VisualPreviewEntry[],
  ): Promise<PlanShapingApprovedVisual[]> {
    const ordered = orderVisualEntries(entries);
    const proposals = await this.prisma.db.proposal.findMany({
      where: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        id: { in: ordered.map((entry) => entry.proposalId) },
        status: 'APPROVED',
        action: { not: 'DELETE' },
        targetEntityType: 'TASK',
      },
      select: { id: true, targetEntityId: true },
    });
    const targetByProposalId = new Map(
      proposals.map((proposal) => [proposal.id, proposal.targetEntityId]),
    );
    const workItems = await this.prisma.db.task.findMany({
      where: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        id: { in: [...targetByProposalId.values()] },
        type: { in: Object.keys(VISUAL_SUMMARY_SECTION_KEY) },
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        sections: {
          where: { key: { in: Object.values(VISUAL_SUMMARY_SECTION_KEY) } },
          select: { key: true, materializedMarkdown: true },
        },
      },
    });
    const workItemById = new Map(
      workItems.map((item) => [String(item.id), item]),
    );

    const approvedVisuals: PlanShapingApprovedVisual[] = [];
    for (const entry of ordered) {
      const workItem = workItemById.get(
        targetByProposalId.get(entry.proposalId) ?? '',
      );
      if (!workItem || workItem.name.trim().length === 0) continue;
      const summaryKey =
        VISUAL_SUMMARY_SECTION_KEY[
          workItem.type as keyof typeof VISUAL_SUMMARY_SECTION_KEY
        ];
      const summarySection = workItem.sections.find(
        (section) => section.key === summaryKey,
      );
      approvedVisuals.push({
        proposalId: entry.proposalId,
        entityId: workItem.id,
        entityType:
          workItem.type === 'DIAGRAM'
            ? PlanShapingApprovedVisualEntityTypeEnum.DIAGRAM
            : PlanShapingApprovedVisualEntityTypeEnum.MOCKUP,
        title: workItem.name.trim(),
        summary: firstParagraph(summarySection?.materializedMarkdown ?? ''),
      });
    }
    if (approvedVisuals.length !== ordered.length) {
      this.logger.warn('Approved visuals left out of planning context', {
        conversationId: context.core.conversationId,
        unresolvedProposalIds: ordered
          .map((entry) => entry.proposalId)
          .filter(
            (proposalId) =>
              !approvedVisuals.some(
                (visual) => visual.proposalId === proposalId,
              ),
          ),
      });
    }
    return approvedVisuals;
  }

  async execute(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const { entries, statusById } = await this.readLiveStatuses(context);
    if (entries.length === 0) {
      throw new Error(
        '[visual-preview-feedback] cannot execute without visual proposals',
      );
    }

    const position = resolveVisualReviewPosition(
      entries,
      statusById,
      context.visualPreviewSetComplete === true,
    );
    tracker.mutate((draft) => {
      draft.visualPreviewReviewProposalId =
        position.kind === 'visual' ? position.review.proposalId : undefined;
    });

    const reviewingOneVisual = position.kind === 'visual';
    const reviewFieldId = uuidv4();
    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.PlanGenerationVisualPreview,
        label: reviewingOneVisual
          ? 'Visual under review'
          : 'Complete visual plan',
        required: false,
        influences: [],
        payload: {
          responseType: 'plan_generation_visual_preview_v1',
          entries: position.presented,
        } satisfies PlanGenerationVisualPreviewPayload,
      },
      {
        id: reviewFieldId,
        type: ExtendedUIFieldType.Textarea,
        label: reviewingOneVisual
          ? 'Feedback on this visual'
          : 'Feedback on the visual plan',
        placeholder: reviewingOneVisual
          ? 'What should change in this visual?'
          : 'Which visuals should change, and how?',
        multiline: true,
        required: false,
        influences: [],
      },
    ];
    const secondaryActions: SecondaryActionConfig[] = [
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: 'Continue Revising',
        handler:
          SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
        fieldId: reviewFieldId,
        disabled: false,
        payload: {
          handlerType: 'plan_generation_visual_preview_continue_revising',
        },
      },
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: reviewingOneVisual ? 'Next Visual' : 'Confirm Visual Set',
        handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
        fieldId: reviewFieldId,
        disabled: false,
        payload: { handlerType: 'plan_generation_visual_preview_approve' },
      },
    ];

    this.logger.debug('Plan-shaping visual-preview-feedback node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      entryCount: entries.length,
      presentedCount: position.presented.length,
      reviewKind: position.kind,
      refinementRound: context.visualPreviewRound ?? 0,
    });

    const prompt = reviewingOneVisual
      ? 'Approve this visual to move on, or add feedback and choose Continue Revising to have it redrafted.'
      : 'Every visual is approved. Confirm the visual set to start stage selection, or ask for changes.';
    return {
      type: NodeType.QUESTIONS,
      message: context.visualPreviewApprovalFailure
        ? `${context.visualPreviewApprovalFailure}\n\n${prompt}`
        : prompt,
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
      action: keyof typeof planShapingVisualPreviewFeedbackActions;
      payload: PlanShapingVisualPreviewFeedbackPayload;
    };
    try {
      const result = validateQuestionsAction({
        nodeId: this.id,
        actions: planShapingVisualPreviewFeedbackActions,
        message: userMessage,
      });
      validated = {
        action: result.action,
        payload: result.payload as PlanShapingVisualPreviewFeedbackPayload,
      };
    } catch (error) {
      if (error instanceof QuestionsActionValidationError) {
        delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
        this.logger.warn('Visual-preview-feedback rejected', {
          conversationId: tracker.getContext().core.conversationId,
          reason: error.reason,
          action: error.action,
        });
        return;
      }
      throw error;
    }

    const context = tracker.getContext();
    const { entries, statusById } = await this.readLiveStatuses(context);
    if (entries.length === 0) {
      delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
      this.logger.warn(
        'Visual-preview-feedback rejected: no presentable proposals',
        { conversationId: context.core.conversationId },
      );
      return;
    }

    if (validated.action === PLAN_SHAPING_ACTIONS.REFINE) {
      const feedback = validated.payload.feedback.trim();
      const reviewProposalId = context.visualPreviewReviewProposalId;
      tracker.mutate((draft) => {
        draft.visualPreviewFeedback = feedback || undefined;
        draft.visualPreviewApprovalFailure = undefined;
        draft.visualPreviewRound = (draft.visualPreviewRound ?? 0) + 1;
        draft.visualPreviewTurnScope = reviewProposalId
          ? { kind: 'redraft', proposalId: reviewProposalId }
          : { kind: 'set_feedback' };
      });
      return;
    }

    if (validated.action !== PLAN_SHAPING_ACTIONS.APPROVED) {
      return;
    }

    // Moving past a visual requires that visual's live APPROVED status. The
    // answer never approves visuals itself.
    const reviewProposalId = context.visualPreviewReviewProposalId;
    if (reviewProposalId && statusById.get(reviewProposalId) !== 'APPROVED') {
      delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
      tracker.mutate((draft) => {
        draft.visualPreviewApprovalFailure =
          statusById.get(reviewProposalId) === 'REJECTED'
            ? 'This visual was rejected. Add feedback if you like and choose Continue Revising to have it redrafted.'
            : 'Approve this visual before moving on to the next one.';
      });
      this.logger.log('Visual-preview-feedback kept the visual under review', {
        conversationId: context.core.conversationId,
        proposalId: reviewProposalId,
        status: statusById.get(reviewProposalId),
      });
      return;
    }

    const advance = this.resolveAdvance(
      reviewProposalId,
      findFirstUnapprovedEntry(entries, statusById) !== undefined,
      context.visualPreviewSetComplete === true,
    );
    if (advance !== 'stages') {
      tracker.mutate((draft) => {
        draft.visualPreviewApprovalFailure = undefined;
        draft.visualPreviewAdvance = advance;
        if (advance === 'draft') {
          draft.visualPreviewTurnScope = { kind: 'next' };
        }
      });
      this.logger.log('Visual-preview-feedback moved on', {
        conversationId: context.core.conversationId,
        advance,
        reviewedProposalId: reviewProposalId,
      });
      return;
    }

    const approvedVisuals = await this.resolveApprovedVisuals(context, entries);
    tracker.mutate((draft) => {
      draft.visualPreviewApprovalFailure = undefined;
      draft.visualPreviewAdvance = 'stages';
      draft.visualPreviewAcceptedProposalIds = orderVisualEntries(entries).map(
        (entry) => entry.proposalId,
      );
      draft.visualPreviewApprovedVisuals = approvedVisuals;
    });
    this.logger.log('Visual-preview-feedback confirmed complete visual set', {
      conversationId: context.core.conversationId,
      entryCount: entries.length,
    });
  }

  /**
   * Decides where an accepted answer moves the run. A visual still awaiting
   * approval is reviewed next, already drafted. A set with no unapproved
   * visual asks the agent for the next one until the agent declares the set
   * complete; the complete set is then presented once more for confirmation.
   * Only confirming that presented complete set starts stage selection.
   */
  private resolveAdvance(
    reviewProposalId: string | undefined,
    hasUnapprovedVisual: boolean,
    setComplete: boolean,
  ): NonNullable<PlanFromDesignDocFlowContext['visualPreviewAdvance']> {
    if (hasUnapprovedVisual) {
      return 'review';
    }
    if (!setComplete) {
      return 'draft';
    }
    return reviewProposalId ? 'review' : 'stages';
  }

  async determineRoutingFromUserMessage(
    context: PlanFromDesignDocFlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const action = (userMessage.data ?? {}) as QuestionsActionFlowData;
    if (action.action === PLAN_SHAPING_ACTIONS.REFINE) {
      return PLAN_SHAPING_NODES.VISUAL_PREVIEW;
    }
    if (action.action !== PLAN_SHAPING_ACTIONS.APPROVED) {
      return PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK;
    }
    if (context.visualPreviewAdvance === 'stages') {
      return PLAN_SHAPING_NODES.PHASE_BREAKDOWN;
    }
    if (context.visualPreviewAdvance === 'draft') {
      return PLAN_SHAPING_NODES.VISUAL_PREVIEW;
    }
    return PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK;
  }
}
