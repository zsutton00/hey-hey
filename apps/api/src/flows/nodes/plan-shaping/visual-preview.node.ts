import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import {
  JourneyStep,
  LocalPromptType,
  PlanShapingVisualPreviewEntryArtifactFamilyEnum,
  PlanShapingVisualPreviewEntryStatusEnum,
  PlanShapingVisualPreviewMaterializedEntityEntityTypeEnum,
  PlanShapingVisualPreviewRelationshipKindEnum,
  type PlanShapingVisualPreviewPromptPayload,
} from 'src/generated/local';
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

const MATERIALIZED_VISUAL_TYPES = ['mockup', 'DIAGRAM'] as const;

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

  private async resolveProposals(
    context: PlanFromDesignDocFlowContext,
    proposalIds: string[],
  ) {
    if (proposalIds.length === 0) return [];

    const proposals = await this.prisma.db.proposal.findMany({
      where: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        id: { in: proposalIds },
      },
      select: {
        id: true,
        status: true,
        action: true,
        targetEntityId: true,
        targetEntityType: true,
      },
    });
    const knownProposalIds = new Set(proposals.map((proposal) => proposal.id));
    const missingProposalIds = proposalIds.filter(
      (proposalId) => !knownProposalIds.has(proposalId),
    );
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
    proposals: ReadonlyArray<{
      id: string;
      status: string;
      action: string;
      targetEntityId: string;
      targetEntityType: string;
    }>,
  ): Promise<Map<string, string>> {
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
        select: { id: true },
      })) ?? [];
    const liveIds = new Set<string>(
      workItems.map((workItem) => String(workItem.id)),
    );
    return new Map(
      approved
        .filter((proposal) => liveIds.has(proposal.targetEntityId))
        .map((proposal) => [proposal.id, proposal.targetEntityId]),
    );
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
                entityId: materializedById.get(entry.proposalId)!,
                entityType:
                  PlanShapingVisualPreviewMaterializedEntityEntityTypeEnum.TASK,
              },
            }
          : {}),
      }));
    const feedback = context.visualPreviewFeedback?.trim();
    if (feedback) {
      tracker.mutate((draft) => {
        draft.visualPreviewFeedback = undefined;
      });
    }

    const payload = {
      designDocId: seed.designDocId,
      planId: seed.planId,
      featureId: seed.parentFeatureId,
      refinementRound: context.visualPreviewRound ?? 0,
      entries,
      acceptedProposalIds: context.visualPreviewAcceptedProposalIds ?? [],
      ...(feedback ? { feedback } : {}),
    } satisfies PlanShapingVisualPreviewPromptPayload;

    this.logger.debug('Plan-shaping visual-preview trigger prepared', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      refinementRound: payload.refinementRound,
      proposalCount: entries.length,
      statusCount: proposals.length,
      hasFeedback: Boolean(feedback),
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
        ? 'Reworking the visual plan preview with your feedback…'
        : 'Preparing the visual plan preview…',
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
    await this.resolveProposals(
      context,
      payload.entries.map((entry) => entry.proposalId),
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
      draft.journeySteps = stageHandoffSteps;
    });
    this.logger.debug('Visual-preview completion captured', {
      conversationId: context.core.conversationId,
      entryCount: payload.entries.length,
      refinementRound: payload.refinementRound,
      stageHandoffCount: stageHandoffSteps.length,
    });
  }
}
