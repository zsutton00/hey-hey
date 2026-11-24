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
  describeApprovedVisualChanges,
  findUnapprovedEntries,
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
   * never dropped here: a rejected visual stays in place until the agent
   * redraws it or drops it.
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
    const setComplete = context.visualPreviewSetComplete === true;
    if (entries.length === 0 && !setComplete) {
      throw new Error(
        '[visual-preview-feedback] no visuals and the agent has not declared the set complete',
      );
    }

    const position = resolveVisualReviewPosition(
      entries,
      statusById,
      setComplete,
    );
    tracker.mutate((draft) => {
      draft.visualPreviewReviewProposalId =
        position.kind === 'visual' ? position.review[0]?.proposalId : undefined;
    });

    const reviewingVisuals = position.kind === 'visual';
    const reviewingSeveral = reviewingVisuals && position.review.length > 1;
    const reviewFieldId = uuidv4();
    // Visuals under review are decided on their proposal cards; the ordered
    // stepper appears only when the complete set is confirmed. The preview
    // element requires at least one visual, so an empty complete set is
    // confirmed without it.
    const previewElements: UIElement[] =
      reviewingVisuals || position.presented.length === 0
        ? []
        : [
            {
              id: uuidv4(),
              type: ExtendedUIFieldType.PlanGenerationVisualPreview,
              label: 'Complete visual plan',
              required: false,
              influences: [],
              payload: {
                responseType: 'plan_generation_visual_preview_v1',
                entries: position.presented,
              } satisfies PlanGenerationVisualPreviewPayload,
            },
          ];
    const uiElements: UIElement[] = [
      ...previewElements,
      {
        id: reviewFieldId,
        type: ExtendedUIFieldType.Textarea,
        label: reviewingSeveral
          ? 'Feedback on these visuals'
          : reviewingVisuals
            ? 'Feedback on this visual'
            : 'Feedback on the visual plan',
        placeholder: reviewingVisuals
          ? 'What should change? You can also ask about any other visual.'
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
        label: reviewingVisuals ? 'Next Visual' : 'Confirm Visual Set',
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

    const prompt = reviewingSeveral
      ? 'Approve these visuals to move on, or say what should change and choose Continue Revising.'
      : reviewingVisuals
        ? "Approve this visual to move on, or say what should change, or that it isn't needed, and choose Continue Revising."
        : entries.length === 0
          ? 'No visuals are planned. Confirm to start stage selection, or ask for visuals.'
          : 'Every visual is approved. Confirm the visual set to start stage selection, or ask for changes.';
    const message = [
      describeApprovedVisualChanges(context.visualPreviewApprovedChanges ?? []),
      context.visualPreviewApprovalFailure,
      prompt,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');
    return {
      type: NodeType.QUESTIONS,
      message,
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
    if (entries.length === 0 && context.visualPreviewSetComplete !== true) {
      delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
      this.logger.warn(
        'Visual-preview-feedback rejected: no visuals and the set is not complete',
        { conversationId: context.core.conversationId },
      );
      return;
    }

    if (validated.action === PLAN_SHAPING_ACTIONS.REFINE) {
      const feedback = validated.payload.feedback.trim();
      tracker.mutate((draft) => {
        draft.visualPreviewFeedback = feedback || undefined;
        draft.visualPreviewApprovalFailure = undefined;
        draft.visualPreviewApprovedChanges = undefined;
        draft.visualPreviewRound = (draft.visualPreviewRound ?? 0) + 1;
      });
      return;
    }

    if (validated.action !== PLAN_SHAPING_ACTIONS.APPROVED) {
      return;
    }

    // Moving on requires every presented visual's live APPROVED status, and
    // every visual that is not approved is presented. The answer never
    // approves visuals itself.
    const reviewProposalId = context.visualPreviewReviewProposalId;
    const unapproved = findUnapprovedEntries(entries, statusById);
    if (unapproved.length > 0) {
      const rejected = unapproved.filter(
        (entry) => statusById.get(entry.proposalId) === 'REJECTED',
      );
      delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
      tracker.mutate((draft) => {
        const subject = unapproved.length > 1 ? 'A visual here' : 'This visual';
        draft.visualPreviewApprovalFailure =
          rejected.length > 0
            ? `${subject} was rejected. Tell us what to change or that it isn't needed, and choose Continue Revising.`
            : unapproved.length > 1
              ? 'Approve every visual under review before moving on.'
              : 'Approve this visual before moving on to the next one.';
      });
      this.logger.log('Visual-preview-feedback kept visuals under review', {
        conversationId: context.core.conversationId,
        unapprovedProposalIds: unapproved.map((entry) => entry.proposalId),
        rejectedProposalIds: rejected.map((entry) => entry.proposalId),
      });
      return;
    }

    const advance = this.resolveAdvance(
      reviewProposalId,
      context.visualPreviewSetComplete === true,
    );
    if (advance !== 'stages') {
      tracker.mutate((draft) => {
        draft.visualPreviewApprovalFailure = undefined;
        draft.visualPreviewApprovedChanges = undefined;
        draft.visualPreviewAdvance = advance;
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
      draft.visualPreviewApprovedChanges = undefined;
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
   * Decides where an accepted answer moves the run once every visual is
   * approved. The agent is asked for the next visual until it declares the
   * set complete; the complete set is then presented once more for
   * confirmation. Only confirming that presented complete set starts stage
   * selection.
   */
  private resolveAdvance(
    reviewProposalId: string | undefined,
    setComplete: boolean,
  ): NonNullable<PlanFromDesignDocFlowContext['visualPreviewAdvance']> {
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
