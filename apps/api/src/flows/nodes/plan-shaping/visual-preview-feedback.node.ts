import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  PlanGenerationVisualPreviewPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from 'src/generated';
import {
  PlanShapingApprovedVisualEntityTypeEnum,
  type PlanShapingApprovedVisual,
} from 'src/generated/local';
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
import { ProposalApprovalService } from 'src/services/proposal/proposal-approval.service';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import {
  PLAN_SHAPING_ACTIONS,
  PlanShapingVisualPreviewFeedbackPayload,
  planShapingVisualPreviewFeedbackActions,
} from './schemas';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly proposalApprovalService: ProposalApprovalService,
  ) {
    super();
  }

  private async resolvePresentableEntries(
    context: PlanFromDesignDocFlowContext,
  ): Promise<
    NonNullable<PlanFromDesignDocFlowContext['visualPreviewEntries']>
  > {
    return (await this.readPresentableEntries(context)).entries;
  }

  private async readPresentableEntries(
    context: PlanFromDesignDocFlowContext,
  ): Promise<{
    entries: NonNullable<PlanFromDesignDocFlowContext['visualPreviewEntries']>;
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
    return {
      entries: entries.filter(
        (entry) => statusById.get(entry.proposalId) !== 'REJECTED',
      ),
      statusById,
    };
  }

  /**
   * Approves every still-DRAFT proposal in the current visual set. Successful
   * approvals are individual authoritative decisions and are kept even when a
   * sibling fails, so a retry only approves the remainder.
   */
  private async approveRemainingDrafts(
    context: PlanFromDesignDocFlowContext,
    entries: NonNullable<PlanFromDesignDocFlowContext['visualPreviewEntries']>,
    statusById: Map<string, string>,
  ): Promise<string[]> {
    const draftIds = entries
      .map((entry) => entry.proposalId)
      .filter((proposalId) => statusById.get(proposalId) === 'DRAFT');
    const failedIds: string[] = [];
    for (const proposalId of draftIds) {
      try {
        const result = await this.proposalApprovalService.approve(
          proposalId,
          context.core.organizationId,
          context.core.projectId,
          context.core.user.id,
        );
        if (!result.enacted) {
          failedIds.push(proposalId);
          this.logger.warn('Visual proposal approval was not enacted', {
            conversationId: context.core.conversationId,
            proposalId,
          });
        }
      } catch (error) {
        failedIds.push(proposalId);
        this.logger.error(
          'Visual proposal approval failed',
          error instanceof Error ? error : new Error(String(error)),
          {
            conversationId: context.core.conversationId,
            proposalId,
            includeErrorDetails: true,
          },
        );
      }
    }
    this.logger.log('Visual-preview remaining drafts approval finished', {
      conversationId: context.core.conversationId,
      draftCount: draftIds.length,
      failedCount: failedIds.length,
    });
    return failedIds;
  }

  /**
   * Resolves each approved visual's Mockup/Diagram work item, title and
   * opening paragraph, in presentation order. A visual whose work item cannot
   * be resolved is left out so later agents never receive a half-populated
   * reference; visual review still shows it as its proposal card.
   */
  private async resolveApprovedVisuals(
    context: PlanFromDesignDocFlowContext,
    entries: NonNullable<PlanFromDesignDocFlowContext['visualPreviewEntries']>,
  ): Promise<PlanShapingApprovedVisual[]> {
    const ordered = [...entries].sort(
      (a, b) => a.presentationOrder - b.presentationOrder,
    );
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
    const entries = await this.resolvePresentableEntries(context);
    if (entries.length === 0) {
      throw new Error(
        '[visual-preview-feedback] cannot execute without visual proposals',
      );
    }
    if (entries.length !== (context.visualPreviewEntries ?? []).length) {
      tracker.mutate((draft) => {
        draft.visualPreviewEntries = entries;
      });
    }

    const reviewFieldId = uuidv4();
    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.PlanGenerationVisualPreview,
        label: 'Current visual plan preview',
        required: false,
        influences: [],
        payload: {
          responseType: 'plan_generation_visual_preview_v1',
          entries,
        } satisfies PlanGenerationVisualPreviewPayload,
      },
      {
        id: reviewFieldId,
        type: ExtendedUIFieldType.Textarea,
        label: 'Feedback on the visual plan preview',
        placeholder: 'What should change in the visual plan preview?',
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
        label: 'Approve Visual Set',
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
      refinementRound: context.visualPreviewRound ?? 0,
    });

    const prompt =
      'Add feedback for the visual plan preview, or approve the set before stage selection begins.';
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

    const { entries: liveEntries, statusById } =
      await this.readPresentableEntries(tracker.getContext());
    if (liveEntries.length === 0) {
      delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
      this.logger.warn(
        'Visual-preview-feedback rejected: no presentable proposals',
        {
          conversationId: tracker.getContext().core.conversationId,
        },
      );
      return;
    }
    tracker.mutate((draft) => {
      draft.visualPreviewEntries = liveEntries;
    });

    if (validated.action === PLAN_SHAPING_ACTIONS.REFINE) {
      const feedback = validated.payload.feedback.trim();
      tracker.mutate((draft) => {
        draft.visualPreviewFeedback = feedback || undefined;
        draft.visualPreviewApprovalFailure = undefined;
        draft.visualPreviewRound = (draft.visualPreviewRound ?? 0) + 1;
      });
      return;
    }

    if (validated.action === PLAN_SHAPING_ACTIONS.APPROVED) {
      const failedIds = await this.approveRemainingDrafts(
        tracker.getContext(),
        liveEntries,
        statusById,
      );
      if (failedIds.length > 0) {
        delete (userMessage.data as Partial<QuestionsActionFlowData>).action;
        tracker.mutate((draft) => {
          draft.visualPreviewApprovalFailure = `${failedIds.length} of the remaining visual proposals could not be approved, so stage selection has not started. Approve Visual Set again to retry the proposals that are still drafts.`;
        });
        return;
      }
      const approvedVisuals = await this.resolveApprovedVisuals(
        tracker.getContext(),
        liveEntries,
      );
      tracker.mutate((draft) => {
        draft.visualPreviewApprovalFailure = undefined;
        draft.visualPreviewAcceptedProposalIds = liveEntries.map(
          (entry) => entry.proposalId,
        );
        draft.visualPreviewApprovedVisuals = approvedVisuals;
      });
      this.logger.log('Visual-preview-feedback approved complete visual set', {
        conversationId: tracker.getContext().core.conversationId,
        entryCount: tracker.getContext().visualPreviewEntries?.length ?? 0,
      });
    }
  }

  async determineRoutingFromUserMessage(
    _context: PlanFromDesignDocFlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const action = (userMessage.data ?? {}) as QuestionsActionFlowData;
    if (action.action === PLAN_SHAPING_ACTIONS.REFINE) {
      return PLAN_SHAPING_NODES.VISUAL_PREVIEW;
    }
    if (action.action === PLAN_SHAPING_ACTIONS.APPROVED) {
      return PLAN_SHAPING_NODES.PHASE_BREAKDOWN;
    }
    return PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK;
  }
}
