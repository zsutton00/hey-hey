import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from '@hey-hey/contracts/api/models';
import {
  JourneyStep,
  LocalPromptType,
  PlanShapingVisualPreviewEntryArtifactFamilyEnum,
  PlanShapingVisualPreviewEntryStatusEnum,
  PlanShapingVisualPreviewMaterializedEntityEntityTypeEnum,
  PlanShapingVisualPreviewRelationshipKindEnum,
  type PlanShapingVisualPreviewPromptPayload,
} from '@hey-hey/contracts/agent-bridge/models';
import {
  ExternalAgentActionSchemas,
  ExternalAgentValidationError,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  PlanFromDesignDocFlowContext,
} from 'src/types/flow-internal.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PlanFromDesignDocSeedService } from 'src/services/plan/plan-from-design-doc-seed.service';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import {
  PLAN_SHAPING_ACTIONS,
  planShapingVisualPreviewCompletionPayloadSchema,
  planShapingVisualPreviewActions,
} from './schemas';
import {
  findApprovedVisualChanges,
  findSubmissionViolation,
  findUnapprovedEntries,
  type ApprovedVisualSnapshot,
  type VisualPreviewEntry,
} from './visual-preview-review';

const MATERIALIZED_VISUAL_TYPES = ['mockup', 'DIAGRAM'] as const;

const UNTITLED_VISUAL = 'Untitled visual';

type VisualProposal = {
  id: string;
  conversationId: string | null;
  title: string | null;
  status: string;
  action: string;
  targetEntityId: string;
  targetEntityType: string;
};

const findMissingIds = (
  proposalIds: readonly string[],
  proposals: readonly VisualProposal[],
): string[] => {
  const knownIds = new Set(proposals.map((proposal) => proposal.id));
  return proposalIds.filter((proposalId) => !knownIds.has(proposalId));
};

@Injectable()
export class PlanShapingVisualPreviewNode extends ExternalAgentNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.VISUAL_PREVIEW;
  readonly title = 'Plan Shaping — Visual Preview';
  readonly promptType = LocalPromptType.plan_shaping_visual_preview;
  readonly acceptsUserMessages = false;
  readonly actions: ExternalAgentActionSchemas =
    planShapingVisualPreviewActions;

  private readonly logger = new Logger(PlanShapingVisualPreviewNode.name);

  constructor(
    private readonly seedService: PlanFromDesignDocSeedService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  private async findProposals(
    context: PlanFromDesignDocFlowContext,
    proposalIds: readonly string[],
  ): Promise<VisualProposal[]> {
    if (proposalIds.length === 0) {
      return [];
    }

    return this.prisma.db.proposal.findMany({
      where: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        id: { in: [...proposalIds] },
      },
      select: {
        id: true,
        conversationId: true,
        title: true,
        status: true,
        action: true,
        targetEntityId: true,
        targetEntityType: true,
      },
    });
  }

  private async resolveProposals(
    context: PlanFromDesignDocFlowContext,
    proposalIds: string[],
  ): Promise<VisualProposal[]> {
    const proposals = await this.findProposals(context, proposalIds);
    const missingProposalIds = findMissingIds(proposalIds, proposals);
    if (missingProposalIds.length > 0) {
      throw new Error(
        `[visual-preview] proposal identities are no longer available: ${missingProposalIds.join(', ')}`,
      );
    }
    return proposals;
  }

  /**
   * Resolves the live Mockup/Diagram work item each APPROVED visual proposal
   * was enacted as. Unresolvable entries are omitted so the reviewer falls
   * back to the proposal card instead of losing the visual from the set.
   */
  private async resolveMaterializedVisuals(
    context: PlanFromDesignDocFlowContext,
    proposals: readonly VisualProposal[],
  ): Promise<Map<string, { entityId: string; name: string }>> {
    const approved = proposals.filter(
      (proposal) =>
        proposal.status === 'APPROVED' &&
        proposal.action !== 'DELETE' &&
        proposal.targetEntityType === 'TASK' &&
        Boolean(proposal.targetEntityId),
    );
    if (approved.length === 0) return new Map();

    const workItems =
      (await this.prisma.db.task.findMany({
        where: {
          organizationId: context.core.organizationId,
          projectId: context.core.projectId,
          id: { in: approved.map((proposal) => proposal.targetEntityId) },
          type: { in: [...MATERIALIZED_VISUAL_TYPES] },
          archivedAt: null,
        },
        select: { id: true, name: true },
      })) ?? [];
    const nameById = new Map<string, string>(
      workItems.map((workItem) => [String(workItem.id), workItem.name]),
    );
    return new Map(
      approved
        .filter((proposal) => nameById.has(proposal.targetEntityId))
        .map((proposal) => [
          proposal.id,
          {
            entityId: proposal.targetEntityId,
            name: nameById.get(proposal.targetEntityId)!,
          },
        ]),
    );
  }

  private rejectSubmission(
    context: PlanFromDesignDocFlowContext,
    submittedEntries: readonly VisualPreviewEntry[],
    message: string,
  ): never {
    this.logger.warn('Visual-preview completion rejected', {
      conversationId: context.core.conversationId,
      previousProposalIds: (context.visualPreviewEntries ?? []).map(
        (entry) => entry.proposalId,
      ),
      submittedProposalIds: submittedEntries.map((entry) => entry.proposalId),
      violation: message,
    });
    throw new ExternalAgentValidationError({
      nodeId: this.id,
      action: PLAN_SHAPING_ACTIONS.READY,
      reason: 'invalid_payload',
      issues: [{ code: 'custom', path: ['entries'], message }],
    });
  }

  /**
   * The approved visuals to compare this submission against. Runs triggered
   * before the snapshot was recorded fall back to the previous visuals whose
   * proposals are still approved.
   */
  private approvedBeforeTurn(
    context: PlanFromDesignDocFlowContext,
    previousProposals: readonly VisualProposal[],
  ): ApprovedVisualSnapshot[] {
    if (context.visualPreviewApprovedBeforeTurn) {
      return context.visualPreviewApprovedBeforeTurn;
    }

    return previousProposals
      .filter((proposal) => proposal.status === 'APPROVED')
      .map((proposal) => ({
        proposalId: proposal.id,
        title: proposal.title?.trim() || UNTITLED_VISUAL,
        targetEntityId: proposal.targetEntityId,
      }));
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const seed = await this.seedService.resolve(context.core.conversationId);
    if (!seed.parentFeatureId) {
      throw new Error(
        `[visual-preview] cannot execute: plan ${seed.planId} has no parentTaskId (parentFeatureId)`,
      );
    }

    const currentEntries = context.visualPreviewEntries ?? [];
    const proposalIds = currentEntries.map((entry) => entry.proposalId);
    const proposals = await this.resolveProposals(context, proposalIds);
    const statusById = new Map(
      proposals.map((proposal) => [proposal.id, proposal.status]),
    );
    const materializedById = await this.resolveMaterializedVisuals(
      context,
      proposals,
    );
    const entries: PlanShapingVisualPreviewPromptPayload['entries'] =
      currentEntries.map((entry) => ({
        proposalId: entry.proposalId,
        artifactFamily:
          entry.artifactFamily === 'mockup'
            ? PlanShapingVisualPreviewEntryArtifactFamilyEnum.mockup
            : PlanShapingVisualPreviewEntryArtifactFamilyEnum.diagram,
        presentationOrder: entry.presentationOrder,
        status:
          statusById.get(entry.proposalId) === 'APPROVED'
            ? PlanShapingVisualPreviewEntryStatusEnum.APPROVED
            : statusById.get(entry.proposalId) === 'REJECTED'
              ? PlanShapingVisualPreviewEntryStatusEnum.REJECTED
              : PlanShapingVisualPreviewEntryStatusEnum.DRAFT,
        ...(entry.relationship
          ? {
              relationship: {
                kind:
                  entry.relationship.kind === 'depends_on'
                    ? PlanShapingVisualPreviewRelationshipKindEnum.depends_on
                    : PlanShapingVisualPreviewRelationshipKindEnum.refines,
                proposalId: entry.relationship.proposalId,
              },
            }
          : {}),
        ...(materializedById.has(entry.proposalId)
          ? {
              materializedEntity: {
                entityId: materializedById.get(entry.proposalId)!.entityId,
                entityType:
                  PlanShapingVisualPreviewMaterializedEntityEntityTypeEnum.TASK,
              },
            }
          : {}),
      }));
    const approvedBeforeTurn: ApprovedVisualSnapshot[] = proposals
      .filter((proposal) => proposal.status === 'APPROVED')
      .map((proposal) => ({
        proposalId: proposal.id,
        title:
          materializedById.get(proposal.id)?.name.trim() ||
          proposal.title?.trim() ||
          UNTITLED_VISUAL,
        targetEntityId: proposal.targetEntityId,
      }));
    const feedback = context.visualPreviewFeedback?.trim();
    tracker.mutate((draft) => {
      draft.visualPreviewFeedback = undefined;
      draft.visualPreviewApprovedBeforeTurn = approvedBeforeTurn;
    });

    const reviewEntry = findUnapprovedEntries(currentEntries, statusById)[0];
    const payload = {
      designDocId: seed.designDocId,
      planId: seed.planId,
      featureId: seed.parentFeatureId,
      refinementRound: context.visualPreviewRound ?? 0,
      entries,
      acceptedProposalIds: context.visualPreviewAcceptedProposalIds ?? [],
      ...(feedback ? { feedback } : {}),
      ...(reviewEntry ? { reviewProposalId: reviewEntry.proposalId } : {}),
      setComplete: context.visualPreviewSetComplete === true,
    } satisfies PlanShapingVisualPreviewPromptPayload;

    this.logger.debug('Plan-shaping visual-preview trigger prepared', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      refinementRound: payload.refinementRound,
      proposalCount: entries.length,
      statusCount: proposals.length,
      hasFeedback: Boolean(feedback),
      underReview: Boolean(reviewEntry),
      setComplete: payload.setComplete,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Plan Shaping — Visual Preview',
        required: false,
        influences: [],
      },
    ];

    return {
      response: feedback
        ? 'Working on the visuals with your feedback…'
        : reviewEntry
          ? 'Revising the visuals under review…'
          : 'Preparing the next visual…',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload,
      },
      data: {
        detectedIntent: 'plan_shaping_visual_preview_started',
        intentConfidence: 1,
        reasoning:
          'External agent shaping persistent Mockup and Diagram proposals before plan stage selection.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const data: unknown = userMessage.data;
    if (typeof data !== 'object' || data === null || !('action' in data)) {
      return;
    }
    if (data.action !== PLAN_SHAPING_ACTIONS.READY) return;

    const parsedPayload =
      planShapingVisualPreviewCompletionPayloadSchema.safeParse(
        'payload' in data ? data.payload : undefined,
      );
    if (!parsedPayload.success) {
      throw new ExternalAgentValidationError({
        nodeId: this.id,
        action: PLAN_SHAPING_ACTIONS.READY,
        reason: 'invalid_payload',
        issues: parsedPayload.error.issues,
      });
    }
    const payload = parsedPayload.data;

    const context = tracker.getContext();
    const expectedRefinementRound = context.visualPreviewRound ?? 0;
    if (payload.refinementRound !== expectedRefinementRound) {
      throw new ExternalAgentValidationError({
        nodeId: this.id,
        action: PLAN_SHAPING_ACTIONS.READY,
        reason: 'invalid_payload',
        issues: [
          {
            code: 'custom',
            path: ['refinementRound'],
            message: `Expected refinement round ${expectedRefinementRound}, received ${payload.refinementRound}.`,
          },
        ],
      });
    }
    const submittedIds = payload.entries.map((entry) => entry.proposalId);
    const submittedProposals = await this.findProposals(context, submittedIds);
    const unknownIds = findMissingIds(submittedIds, submittedProposals);
    if (unknownIds.length > 0) {
      this.rejectSubmission(
        context,
        payload.entries,
        `These proposals do not exist in this project: ${unknownIds.join(', ')}. Submit only visuals whose proposals exist.`,
      );
    }

    const previousEntries = context.visualPreviewEntries ?? [];
    const previousProposals = await this.findProposals(
      context,
      previousEntries.map((entry) => entry.proposalId),
    );
    const violation = findSubmissionViolation({
      previousEntries,
      submittedEntries: payload.entries,
      ownStatusById: new Map(
        previousProposals
          .filter(
            (proposal) =>
              proposal.conversationId === context.core.conversationId,
          )
          .map((proposal) => [proposal.id, proposal.status]),
      ),
      setComplete: payload.setComplete === true,
    });
    if (violation) {
      this.rejectSubmission(context, payload.entries, violation);
    }

    const approvedChanges = findApprovedVisualChanges(
      this.approvedBeforeTurn(context, previousProposals),
      submittedProposals,
    );

    let stageHandoffSteps = context.journeySteps;
    if (!stageHandoffSteps || stageHandoffSteps.length === 0) {
      const seed = await this.seedService.resolve(context.core.conversationId);
      const stages = await this.prisma.db.task.findMany({
        where: {
          organizationId: context.core.organizationId,
          projectId: context.core.projectId,
          parentTaskId: seed.planId,
          type: 'PLAN_STAGE',
          archivedAt: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      });
      if (stages.length === 0) {
        throw new Error(
          `[visual-preview] cannot hand off to phase breakdown: plan ${seed.planId} has no durable stages`,
        );
      }
      stageHandoffSteps = stages.map(
        (stage): JourneyStep => ({
          id: `visual-preview-stage-${stage.id}`,
          stageId: stage.id,
          title: `Visual plan for ${stage.name}`,
          description:
            'Use the approved visual plan set to shape the implementation work for this durable plan stage.',
          isUserInteractive: false,
          implementationNotes: [],
        }),
      );
    }

    tracker.mutate((draft) => {
      draft.visualPreviewEntries = payload.entries;
      draft.visualPreviewRound = payload.refinementRound;
      draft.visualPreviewSetComplete = payload.setComplete === true;
      draft.journeySteps = stageHandoffSteps;
      draft.visualPreviewApprovedBeforeTurn = undefined;
      draft.visualPreviewApprovedChanges = [
        ...(draft.visualPreviewApprovedChanges ?? []).filter(
          (earlier) =>
            !approvedChanges.some(
              (change) => change.proposalId === earlier.proposalId,
            ),
        ),
        ...approvedChanges,
      ];
    });
    this.logger.debug('Visual-preview completion captured', {
      conversationId: context.core.conversationId,
      entryCount: payload.entries.length,
      refinementRound: payload.refinementRound,
      setComplete: payload.setComplete === true,
      approvedChanges: approvedChanges.map(({ proposalId, change }) => ({
        proposalId,
        change,
      })),
      stageHandoffCount: stageHandoffSteps.length,
    });
  }
}
