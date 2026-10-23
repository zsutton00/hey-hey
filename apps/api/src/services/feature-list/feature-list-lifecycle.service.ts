import { Injectable, Logger } from '@nestjs/common';
import {
  EntityType,
  FeatureListProposalNode,
  FeatureTag,
  Influence,
  OrganizationRole,
  RepositoryPlacementCandidateRoot,
  RepositoryPlacementCompletionTarget,
  RepositoryPlacementLineageFeature,
  RepositoryPlacementParentOverride,
  RepositoryPlacementReviewPayload,
  RepositoryPlacementStrategySubmission,
  TaskPriority,
  WorkStatus,
} from '../../generated';
import { buildFlowRequestorContext } from '../proposal/flow-requestor-context';
import { ProposalApprovalService } from '../proposal/proposal-approval.service';
import { ProposalGroupAuthoringService } from '../proposal/proposal-group-authoring.service';
import { ProposalGroupFinalizationService } from '../proposal/proposal-group-finalization.service';
import { ProposalGroupDecisionService } from '../proposal/proposal-group-decision.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { StampedCreateProposalDto } from '../proposal/proposal.types';
import type { RequestorContext } from '../../mcp/tools/requestor-context';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';
import type { FeatureGenerationResponse } from '../../flows/utils/shared-schemas';
import type {
  OnboardingFeatureInfluence,
  OnboardingFeaturePriority,
  OnboardingFeatureProposalState,
  OnboardingFeatureRefinement,
  RepositoryImportFlowContext,
  OnboardingPlacementAssignment,
  OnboardingPendingChildFeature,
  OnboardingPendingTopLevelFeature,
} from '../../types/flow-internal.types';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { MutableContextHandle } from '../../utils/mutable-context';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type FeatureGenerationTopLevel = FeatureGenerationResponse['topLevels'][number];
type FeatureGenerationInfluence =
  FeatureGenerationTopLevel['influences'][number];
type ActiveFeatureRecord = {
  id: string;
  name: string;
  tag: string | null;
  parentTaskId: string | null;
};

export class RepositoryPlacementValidationError extends Error {}

const PRIORITY_MAP: Record<OnboardingFeaturePriority, TaskPriority> = {
  low: TaskPriority.Low,
  medium: TaskPriority.Medium,
  high: TaskPriority.High,
  critical: TaskPriority.Critical,
};

/**
 * Owns the review-only feature-list lifecycle. Draft creation, retry-safe
 * re-entry, refinement replacement, and approval-time hierarchy materialization
 * all live here so onboarding nodes only translate inputs and render results.
 */
@Injectable()
export class FeatureListLifecycleService {
  private readonly logger = new Logger(FeatureListLifecycleService.name);

  constructor(
    private readonly proposalApprovalService: ProposalApprovalService,
    private readonly proposalGroupAuthoring: ProposalGroupAuthoringService,
    private readonly proposalGroupFinalization: ProposalGroupFinalizationService,
    private readonly proposalGroupDecision: ProposalGroupDecisionService,
    private readonly prisma: PrismaService,
  ) {}

  async createOrReuseDraft(
    featureData: FeatureGenerationResponse,
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    nodeId: string,
  ): Promise<OnboardingFeatureProposalState> {
    const context = tracker.getContext();
    const existingState = context.onboardingFeatureProposal;

    const replacesOutline =
      existingState?.repositoryReviewPhase === 'outline' &&
      context.repositoryFeatureEnrichmentFinal?.outcome === 'success';
    if (replacesOutline && !existingState.structuredRefinement) {
      await this.rejectStaleDrafts(existingState, context, nodeId);
    }
    if (
      existingState &&
      !existingState.structuredRefinement &&
      !replacesOutline
    ) {
      this.logger.debug('Reusing saved feature-list draft state', {
        nodeId,
        projectId: context.core.projectId,
        conversationId: context.core.conversationId,
        topLevelCount: existingState.topLevels.length,
        proposalIds: existingState.topLevels.map(
          (topLevel) => topLevel.proposalId,
        ),
      });
      return existingState;
    }

    const organizationId = context.core.organizationId as OrganizationId;
    const projectId = context.core.projectId as ProjectId;
    const userId = context.core.user.id as UserId;
    const conversationId = context.core.conversationId as ConversationId;
    const requestorContext = buildFlowRequestorContext({
      organizationId,
      userId,
      conversationId,
      nodeId,
    });

    const group = await this.proposalGroupAuthoring.start(
      organizationId,
      projectId,
      { originatingConversationId: conversationId },
    );
    const topLevelDtos = featureData.topLevels.map((topLevel) =>
      this.buildFeatureProposalDto({
        name: topLevel.name,
        description: topLevel.description,
        tag: topLevel.tag,
        priority: topLevel.priority,
        influences: this.normalizeInfluences(topLevel.influences),
        parentTaskId: null,
        conversationId: context.core.conversationId,
        requestorContext,
      }),
    );

    this.logger.log('Creating review-only top-level feature drafts', {
      nodeId,
      count: topLevelDtos.length,
      organizationId,
      projectId,
      conversationId: context.core.conversationId,
      replacingProposalIds: existingState?.topLevels.map(
        (topLevel) => topLevel.proposalId,
      ),
    });

    let snapshot = await this.proposalGroupAuthoring.addMembers(
      organizationId,
      projectId,
      group.groupId,
      userId,
      group.currentRevision,
      topLevelDtos,
    );

    const rootMembers = snapshot.members.slice(0, featureData.topLevels.length);
    if (rootMembers.length !== featureData.topLevels.length) {
      throw new Error(
        `Feature-list draft creation returned ${rootMembers.length} members for ${featureData.topLevels.length} top-level features.`,
      );
    }

    const childDtos = featureData.topLevels.flatMap((topLevel, rootIndex) => {
      const reservedRootId = rootMembers[rootIndex]?.reservedEntityId;
      if (!reservedRootId) {
        throw new Error(
          `Missing reserved Feature identity for root ${rootIndex}.`,
        );
      }
      return topLevel.children.map((child) =>
        this.buildFeatureProposalDto({
          name: child.name,
          description: child.description,
          tag: child.tag,
          priority: child.priority,
          influences: this.normalizeInfluences(child.influences),
          parentTaskId: reservedRootId,
          conversationId: context.core.conversationId,
          requestorContext,
        }),
      );
    });
    snapshot = await this.proposalGroupAuthoring.addMembers(
      organizationId,
      projectId,
      group.groupId,
      userId,
      snapshot.currentRevision,
      childDtos,
    );

    const childMembers = snapshot.members.slice(rootMembers.length);
    let childOffset = 0;
    for (const [rootIndex, topLevel] of featureData.topLevels.entries()) {
      const rootMember = snapshot.members[rootIndex];
      if (!rootMember) throw new Error(`Missing root member ${rootIndex}.`);
      for (let index = 0; index < topLevel.children.length; index += 1) {
        const childMember = childMembers[childOffset];
        childOffset += 1;
        if (!childMember)
          throw new Error('Missing child proposal-group member.');
        snapshot = await this.proposalGroupAuthoring.replacePrerequisites(
          organizationId,
          projectId,
          group.groupId,
          childMember.memberId,
          {
            expectedRevision: snapshot.currentRevision,
            prerequisiteMemberIds: new Set([rootMember.memberId]),
          },
        );
      }
    }

    const proposalIdsByMember = await this.loadProposalIdsByMember(
      group.groupId,
    );

    const pendingTopLevels: OnboardingPendingTopLevelFeature[] =
      featureData.topLevels.map((topLevel, index) => {
        const member = snapshot.members[index];
        const reservedFeatureId = member?.reservedEntityId;
        const proposalId = member
          ? proposalIdsByMember.get(member.memberId)
          : undefined;
        if (!member || !reservedFeatureId || !proposalId) {
          throw new Error(
            `Missing proposal-group identity for top-level feature at index ${index}.`,
          );
        }

        const firstChildIndex = featureData.topLevels
          .slice(0, index)
          .reduce((count, candidate) => count + candidate.children.length, 0);

        return {
          candidateId: topLevel.candidateId,
          rootKey: reservedFeatureId,
          proposalId,
          proposalGroupMemberId: member.memberId,
          reservedFeatureId,
          name: topLevel.name,
          description: topLevel.description,
          tag: topLevel.tag,
          priority: topLevel.priority,
          reasoning: topLevel.reasoning ?? '',
          influences: this.normalizeInfluences(topLevel.influences),
          children: topLevel.children.map((child, childIndex) => {
            const childMember = childMembers[firstChildIndex + childIndex];
            const childProposalId = childMember
              ? proposalIdsByMember.get(childMember.memberId)
              : undefined;
            if (!childMember?.reservedEntityId || !childProposalId) {
              throw new Error('Missing child proposal-group identity.');
            }
            return {
              candidateId: child.candidateId,
              localId: childMember.reservedEntityId,
              proposalId: childProposalId,
              proposalGroupMemberId: childMember.memberId,
              reservedFeatureId: childMember.reservedEntityId,
              name: child.name,
              description: child.description,
              tag: child.tag,
              priority: child.priority,
              reasoning: child.reasoning ?? '',
              influences: this.normalizeInfluences(child.influences),
            };
          }),
        };
      });

    const newState: OnboardingFeatureProposalState = {
      ...(context.repositoryGrounding
        ? {
            repositoryReviewPhase: context.repositoryFeatureEnrichmentFinal
              ? ('enriched' as const)
              : ('outline' as const),
          }
        : {}),
      proposalGroupId: group.groupId,
      proposalGroupRevision: snapshot.currentRevision,
      narrative: featureData.narrative,
      topLevels: pendingTopLevels,
      structuredRefinement: undefined,
    };

    tracker.mutate((draft) => {
      draft.onboardingFeatureProposal = newState;
    });

    this.logger.log('Saved feature-list draft state', {
      nodeId,
      projectId,
      conversationId: context.core.conversationId,
      proposalIds: pendingTopLevels.map((topLevel) => topLevel.proposalId),
      childCount: pendingTopLevels.reduce(
        (count, topLevel) => count + topLevel.children.length,
        0,
      ),
    });

    return newState;
  }

  toPlacementRoots(
    state: OnboardingFeatureProposalState,
  ): RepositoryPlacementCandidateRoot[] {
    return state.topLevels.map((root) => ({
      rootKey: root.rootKey,
      name: root.name,
      description: root.description,
      tag: root.tag,
      children: root.children.map((child) => ({
        childKey: child.localId,
        name: child.name,
        description: child.description,
        tag: child.tag,
      })),
    }));
  }

  toReviewNodes(
    state: OnboardingFeatureProposalState,
  ): FeatureListProposalNode[] {
    return state.topLevels.map((topLevel) => ({
      id: topLevel.proposalId,
      name: topLevel.name,
      description: topLevel.description,
      tag: topLevel.tag,
      children: topLevel.children.map((child) => ({
        id: child.localId,
        name: child.name,
        description: child.description,
        tag: child.tag,
        children: [],
      })),
    }));
  }

  async recordRefinement(
    refinement: OnboardingFeatureRefinement,
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    nodeId: string,
  ): Promise<void> {
    const context = tracker.getContext();
    const existingState = context.onboardingFeatureProposal;

    if (existingState) {
      await this.rejectStaleDrafts(existingState, context, nodeId);
    }

    tracker.mutate((draft) => {
      if (!draft.onboardingFeatureProposal) {
        throw new Error('Cannot refine a missing feature-list draft.');
      }

      draft.onboardingFeatureProposal.structuredRefinement = refinement;
    });

    this.logger.log(
      'Stored feature-list refinement for complete regeneration',
      {
        nodeId,
        projectId: context.core.projectId,
        conversationId: context.core.conversationId,
        sectionCount: Object.keys(refinement.sections).length,
        overallLength: refinement.overall.length,
      },
    );
  }

  async applyPlacementStrategy(
    strategy: RepositoryPlacementStrategySubmission,
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    nodeId: string,
  ): Promise<void> {
    const context = tracker.getContext();
    const state = this.requireDraft(context);
    if (strategy.action === 'INTELLIGENTLY_INTEGRATE') {
      tracker.mutate((draft) => {
        if (!draft.onboardingFeatureProposal) throw new Error('Missing draft.');
        draft.onboardingFeatureProposal.placementStrategy = strategy;
        draft.onboardingFeatureProposal.placementAssignments = undefined;
        draft.repositoryPlacementCompletion = undefined;
      });
      return;
    }

    let target: RepositoryPlacementCompletionTarget;
    let holderMemberId: string | undefined;
    let holderReservedFeatureId: string | undefined;
    let revision = state.proposalGroupRevision;

    if (strategy.action === 'ADD_AT_ROOT') {
      target = { kind: 'PROJECT_ROOT' };
    } else if (strategy.parent.targetType === 'EXISTING_FEATURE') {
      await this.assertExistingFeatureTargets(context, [
        strategy.parent.featureId,
      ]);
      target = {
        kind: 'EXISTING_FEATURE',
        featureId: strategy.parent.featureId,
      };
    } else {
      const holder = strategy.parent;
      const holderDto = this.buildFeatureProposalDto({
        name: holder.name,
        description: holder.description,
        tag: holder.tag,
        priority: 'medium',
        influences: [],
        parentTaskId: null,
        conversationId: context.core.conversationId,
        requestorContext: this.buildRequestorContext(context, nodeId),
      });
      const holderSnapshot = await this.proposalGroupAuthoring.addMember(
        context.core.organizationId,
        context.core.projectId,
        state.proposalGroupId,
        context.core.user.id,
        { expectedRevision: revision, proposal: holderDto },
      );
      revision = holderSnapshot.currentRevision;
      const holderMember = holderSnapshot.members.at(-1);
      if (!holderMember?.reservedEntityId) {
        throw new Error(
          'Pending holder did not receive a reserved Feature identity.',
        );
      }
      const proposalIds = await this.loadProposalIdsByMember(
        state.proposalGroupId,
      );
      const proposalId = proposalIds.get(holderMember.memberId);
      if (!proposalId)
        throw new Error('Pending holder proposal identity is missing.');
      holderMemberId = holderMember.memberId;
      holderReservedFeatureId = holderMember.reservedEntityId;
      target = {
        kind: 'EXISTING_FEATURE',
        featureId: holderMember.reservedEntityId as TaskId,
      };
      tracker.mutate((draft) => {
        if (!draft.onboardingFeatureProposal) throw new Error('Missing draft.');
        draft.onboardingFeatureProposal.pendingHolder = {
          targetType: holder.targetType,
          name: holder.name,
          description: holder.description,
          tag: holder.tag,
          proposalId,
          proposalGroupMemberId: holderMember.memberId,
          reservedFeatureId: holderMember.reservedEntityId!,
        };
      });
    }

    revision = await this.updateRootParents(
      context,
      state,
      state.topLevels.map((root) => ({ rootKey: root.rootKey, target })),
      revision,
      nodeId,
      holderMemberId && holderReservedFeatureId
        ? {
            memberId: holderMemberId,
            reservedFeatureId: holderReservedFeatureId,
          }
        : undefined,
    );
    tracker.mutate((draft) => {
      if (!draft.onboardingFeatureProposal) throw new Error('Missing draft.');
      draft.onboardingFeatureProposal.placementStrategy = strategy;
      draft.onboardingFeatureProposal.placementAssignments =
        state.topLevels.map((root) => ({ rootKey: root.rootKey, target }));
      draft.onboardingFeatureProposal.proposalGroupRevision = revision;
    });
  }

  async applyPlacementSuggestions(
    placements: OnboardingPlacementAssignment[],
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    nodeId: string,
  ): Promise<void> {
    const context = tracker.getContext();
    const state = this.requireDraft(context);
    this.assertPlacementKeys(state, placements, true);
    const pendingHolderId = state.pendingHolder?.reservedFeatureId;
    await this.assertExistingFeatureTargets(
      context,
      placements.flatMap((placement) =>
        placement.target.kind === 'EXISTING_FEATURE' &&
        placement.target.featureId !== pendingHolderId
          ? [placement.target.featureId]
          : [],
      ),
    );
    let revision = await this.updateRootParents(
      context,
      state,
      placements,
      state.proposalGroupRevision,
      nodeId,
      state.pendingHolder
        ? {
            memberId: state.pendingHolder.proposalGroupMemberId,
            reservedFeatureId: state.pendingHolder.reservedFeatureId,
          }
        : undefined,
    );
    const pendingHolderStillUsed = state.pendingHolder
      ? placements.some(
          (placement) =>
            placement.target.kind === 'EXISTING_FEATURE' &&
            placement.target.featureId ===
              state.pendingHolder?.reservedFeatureId,
        )
      : false;
    if (state.pendingHolder && !pendingHolderStillUsed) {
      const snapshot = await this.proposalGroupAuthoring.removeMember(
        context.core.organizationId,
        context.core.projectId,
        state.proposalGroupId,
        state.pendingHolder.proposalGroupMemberId,
        { expectedRevision: revision },
      );
      revision = snapshot.currentRevision;
    }
    tracker.mutate((draft) => {
      if (!draft.onboardingFeatureProposal) throw new Error('Missing draft.');
      draft.onboardingFeatureProposal.placementAssignments = placements;
      draft.onboardingFeatureProposal.proposalGroupRevision = revision;
      if (!pendingHolderStillUsed) {
        draft.onboardingFeatureProposal.pendingHolder = undefined;
      }
    });
  }

  async buildPlacementReview(
    context: Readonly<RepositoryImportFlowContext>,
  ): Promise<RepositoryPlacementReviewPayload> {
    const state = this.requireIntelligentPlacementDraft(context);
    const placements = state.placementAssignments ?? [];
    this.assertPlacementKeys(state, placements, true);
    const activeFeatures = await this.loadActiveFeatures(context);
    this.assertTargetsInFeatureMap(
      placements.map((placement) => placement.target),
      activeFeatures,
    );
    const placementByRoot = new Map(
      placements.map((placement) => [placement.rootKey, placement]),
    );

    return {
      roots: this.toPlacementRoots(state).map((root) => {
        const placement = placementByRoot.get(root.rootKey);
        if (!placement) {
          throw new RepositoryPlacementValidationError(
            `Missing placement for root ${root.rootKey}.`,
          );
        }
        return {
          root,
          selectedParent: placement.target,
          selectedParentLineage: this.buildFeatureLineage(
            placement.target,
            activeFeatures,
          ),
        };
      }),
    } satisfies RepositoryPlacementReviewPayload;
  }

  async applyPlacementOverrides(
    overrides: RepositoryPlacementParentOverride[],
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    nodeId: string,
  ): Promise<void> {
    const context = tracker.getContext();
    const state = this.requireIntelligentPlacementDraft(context);
    const assignments = state.placementAssignments ?? [];
    this.assertPlacementKeys(state, assignments, true);
    this.assertPlacementKeys(state, overrides, false);

    const activeFeatures = await this.loadActiveFeatures(context);
    const mergedByRoot = new Map(
      assignments.map((assignment) => [assignment.rootKey, assignment]),
    );
    for (const override of overrides) {
      mergedByRoot.set(override.rootKey, {
        rootKey: override.rootKey,
        target: override.target,
      });
    }
    const merged = state.topLevels.map((root) => {
      const assignment = mergedByRoot.get(root.rootKey);
      if (!assignment) {
        throw new RepositoryPlacementValidationError(
          `Missing placement for root ${root.rootKey}.`,
        );
      }
      return assignment;
    });
    this.assertPlacementKeys(state, merged, true);
    this.assertTargetsInFeatureMap(
      merged.map((assignment) => assignment.target),
      activeFeatures,
    );

    const revision = await this.updateRootParents(
      context,
      state,
      overrides,
      state.proposalGroupRevision,
      nodeId,
    );
    tracker.mutate((draft) => {
      if (!draft.onboardingFeatureProposal) throw new Error('Missing draft.');
      draft.onboardingFeatureProposal.placementAssignments = merged;
      draft.onboardingFeatureProposal.proposalGroupRevision = revision;
    });
  }

  async approve(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    nodeId: string,
  ): Promise<void> {
    const context = tracker.getContext();
    const state = context.onboardingFeatureProposal;
    if (!state || state.topLevels.length === 0) {
      this.logger.warn(
        'Ignoring feature-list approval without pending drafts',
        {
          nodeId,
          projectId: context.core.projectId,
          conversationId: context.core.conversationId,
        },
      );
      return;
    }

    const organizationId = context.core.organizationId as OrganizationId;
    const projectId = context.core.projectId as ProjectId;
    const userId = context.core.user.id as UserId;
    const conversationId = context.core.conversationId as ConversationId;
    this.logger.log('Materializing approved feature-list hierarchy', {
      nodeId,
      organizationId,
      projectId,
      conversationId: context.core.conversationId,
      topLevelCount: state.topLevels.length,
      childCount: state.topLevels.reduce(
        (count, topLevel) => count + topLevel.children.length,
        0,
      ),
    });

    const finalized = await this.proposalGroupFinalization.finalize(
      organizationId,
      projectId,
      state.proposalGroupId,
      await this.toAuthenticatedUser(context),
      { expectedRevision: state.proposalGroupRevision },
    );
    if (finalized.outcome !== 'FINALIZED') {
      throw new Error(
        `Feature-list proposal group failed finalization: ${finalized.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    const approval = await this.proposalGroupDecision.approveAll({
      groupId: state.proposalGroupId,
      organizationId,
      projectId,
      userId,
    });
    const rejectedDecisions = approval.results.filter(
      (result) =>
        result.outcome === 'FAILED' ||
        result.outcome === 'NOT_ELIGIBLE' ||
        result.outcome === 'ALREADY_REJECTED' ||
        (result.outcome === 'ALREADY_TERMINAL' &&
          result.executionState !== 'APPLIED'),
    );
    if (rejectedDecisions.length > 0) {
      throw new Error(
        `Feature-list grouped approval failed for ${rejectedDecisions.length} member(s).`,
      );
    }

    const memberStates = await this.prisma.db.proposalGroupMember.findMany({
      where: { groupId: state.proposalGroupId },
      select: { executionState: true, proposalId: true },
    });
    const unapplied = memberStates.filter(
      (member) => member.executionState !== 'APPLIED',
    );
    if (
      memberStates.length !== approval.results.length ||
      unapplied.length > 0
    ) {
      throw new Error(
        `Feature-list grouped approval has ${unapplied.length} unapplied member(s).`,
      );
    }

    const materializedProposals = await this.prisma.db.proposal.findMany({
      where: {
        id: { in: memberStates.map((member) => member.proposalId) },
        organizationId,
        projectId,
      },
      select: { targetEntityId: true },
    });
    // The approval group may carry non-Feature members; only Features are
    // valid parents for first-work tasks.
    const materializedFeatures = await this.prisma.db.task.findMany({
      where: {
        id: {
          in: materializedProposals.map((proposal) => proposal.targetEntityId),
        },
        organizationId,
        projectId,
        type: 'FEATURE',
      },
      select: { id: true },
    });
    const materializedFeatureIds = materializedFeatures.map(
      (feature) => feature.id,
    );

    tracker.mutate((draft) => {
      draft.repositoryImportMaterializedFeatureIds = materializedFeatureIds;
      if (
        context.repositoryGrounding?.prerequisites.entryMode ===
        'existing_project'
      ) {
        draft.repositoryGroundingCompletion = undefined;
      } else {
        draft.onboardingFeatureProposal = undefined;
        draft.repositoryGroundingCompletion = undefined;
      }
    });

    this.logger.log('Approved feature-list hierarchy materialized', {
      nodeId,
      projectId,
      conversationId: context.core.conversationId,
      groupId: state.proposalGroupId,
      memberCount: approval.results.length,
      materializedFeatureCount: materializedFeatureIds.length,
    });
  }

  private async rejectStaleDrafts(
    state: OnboardingFeatureProposalState,
    context: Readonly<RepositoryImportFlowContext>,
    nodeId: string,
  ): Promise<void> {
    if (state.topLevels.length === 0) {
      return;
    }

    const organizationId = context.core.organizationId as OrganizationId;
    const projectId = context.core.projectId as ProjectId;
    const userId = context.core.user.id as UserId;

    this.logger.log('Retiring stale feature-list drafts before regeneration', {
      nodeId,
      projectId,
      proposalIds: state.topLevels.map((topLevel) => topLevel.proposalId),
    });

    for (const topLevel of state.topLevels) {
      try {
        await this.proposalApprovalService.reject(
          topLevel.proposalId,
          organizationId,
          projectId,
          userId,
          'Superseded by refinement regeneration',
        );
      } catch (error) {
        this.logger.warn('Failed to retire stale feature-list draft', {
          nodeId,
          proposalId: topLevel.proposalId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private requireDraft(
    context: Readonly<RepositoryImportFlowContext>,
  ): OnboardingFeatureProposalState {
    const state = context.onboardingFeatureProposal;
    if (!state || state.topLevels.length === 0) {
      throw new Error(
        'Repository placement requires a pending feature-list draft.',
      );
    }
    return state;
  }

  private requireIntelligentPlacementDraft(
    context: Readonly<RepositoryImportFlowContext>,
  ): OnboardingFeatureProposalState {
    const state = this.requireDraft(context);
    if (state.placementStrategy?.action !== 'INTELLIGENTLY_INTEGRATE') {
      throw new RepositoryPlacementValidationError(
        'Contextual placement review requires intelligent integration.',
      );
    }
    return state;
  }

  private assertPlacementKeys(
    state: OnboardingFeatureProposalState,
    placements: Array<{ rootKey: string }>,
    requireComplete: boolean,
  ): void {
    const knownRoots = new Set(state.topLevels.map((root) => root.rootKey));
    const childKeys = new Set(
      state.topLevels.flatMap((root) =>
        root.children.map((child) => child.localId),
      ),
    );
    const seen = new Set<string>();
    for (const placement of placements) {
      if (seen.has(placement.rootKey)) {
        throw new RepositoryPlacementValidationError(
          'Duplicate root placement.',
        );
      }
      if (childKeys.has(placement.rootKey)) {
        throw new RepositoryPlacementValidationError(
          'Child placement is not allowed.',
        );
      }
      if (!knownRoots.has(placement.rootKey)) {
        throw new RepositoryPlacementValidationError('Unknown root placement.');
      }
      seen.add(placement.rootKey);
    }
    if (requireComplete && seen.size !== knownRoots.size) {
      throw new RepositoryPlacementValidationError(
        'Every root requires exactly one placement.',
      );
    }
  }

  private buildRequestorContext(
    context: Readonly<RepositoryImportFlowContext>,
    nodeId: string,
  ): RequestorContext {
    return buildFlowRequestorContext({
      organizationId: context.core.organizationId,
      userId: context.core.user.id,
      conversationId: context.core.conversationId,
      nodeId,
    });
  }

  private async loadProposalIdsByMember(
    groupId: string,
  ): Promise<Map<string, string>> {
    const members = await this.prisma.db.proposalGroupMember.findMany({
      where: { groupId },
      select: { id: true, proposalId: true },
    });
    return new Map(members.map((member) => [member.id, member.proposalId]));
  }

  private async assertExistingFeatureTargets(
    context: Readonly<RepositoryImportFlowContext>,
    featureIds: string[],
  ): Promise<void> {
    const unique = [...new Set(featureIds)];
    if (unique.length === 0) return;
    const features = await this.prisma.db.task.findMany({
      where: {
        id: { in: unique },
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        archivedAt: null,
        status: { notIn: [WorkStatus.Archived, WorkStatus.Superseded] },
      },
      select: { id: true },
    });
    const found = new Set<string>(features.map((feature) => feature.id));
    const invalid = unique.filter((featureId) => !found.has(featureId));
    if (invalid.length > 0) {
      throw new RepositoryPlacementValidationError(
        `Placement targets must be active Features in this project: ${invalid.join(', ')}`,
      );
    }
  }

  private async loadActiveFeatures(
    context: Readonly<RepositoryImportFlowContext>,
  ): Promise<Map<string, ActiveFeatureRecord>> {
    const features = await this.prisma.db.task.findMany({
      where: {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        archivedAt: null,
        status: { notIn: [WorkStatus.Archived, WorkStatus.Superseded] },
      },
      select: { id: true, name: true, tag: true, parentTaskId: true },
    });
    return new Map(
      (features as ActiveFeatureRecord[]).map((feature) => [
        feature.id,
        feature,
      ]),
    );
  }

  private assertTargetsInFeatureMap(
    targets: RepositoryPlacementCompletionTarget[],
    activeFeatures: Map<string, ActiveFeatureRecord>,
  ): void {
    const invalid = [
      ...new Set(
        targets.flatMap((target) =>
          target.kind === 'EXISTING_FEATURE' ? [target.featureId] : [],
        ),
      ),
    ].filter((featureId) => !activeFeatures.has(featureId));
    if (invalid.length > 0) {
      throw new RepositoryPlacementValidationError(
        `Placement targets must be active Features in this project: ${invalid.join(', ')}`,
      );
    }
  }

  private buildFeatureLineage(
    target: RepositoryPlacementCompletionTarget,
    activeFeatures: Map<string, ActiveFeatureRecord>,
  ): RepositoryPlacementLineageFeature[] {
    if (target.kind === 'PROJECT_ROOT') return [];
    const lineage: RepositoryPlacementLineageFeature[] = [];
    const visited = new Set<string>();
    let featureId: string | null = target.featureId;
    while (featureId) {
      if (visited.has(featureId)) {
        throw new RepositoryPlacementValidationError(
          'Existing Feature lineage contains a cycle.',
        );
      }
      visited.add(featureId);
      const feature = activeFeatures.get(featureId);
      if (!feature) {
        throw new RepositoryPlacementValidationError(
          'Selected parent must have a complete active Feature lineage.',
        );
      }
      if (!Object.values(FeatureTag).includes(feature.tag as FeatureTag)) {
        throw new RepositoryPlacementValidationError(
          `Feature ${feature.id} has no valid Feature tag.`,
        );
      }
      lineage.unshift({
        featureId: feature.id as TaskId,
        name: feature.name,
        tag: feature.tag as FeatureTag,
        ...(feature.parentTaskId
          ? { parentFeatureId: feature.parentTaskId as TaskId }
          : {}),
      });
      featureId = feature.parentTaskId;
    }
    return lineage;
  }

  private async updateRootParents(
    context: Readonly<RepositoryImportFlowContext>,
    state: OnboardingFeatureProposalState,
    placements: OnboardingPlacementAssignment[],
    initialRevision: number,
    nodeId: string,
    holder?: { memberId: string; reservedFeatureId: string },
  ): Promise<number> {
    let revision = initialRevision;
    for (const placement of placements) {
      const root = state.topLevels.find(
        (candidate) => candidate.rootKey === placement.rootKey,
      );
      if (!root) {
        throw new RepositoryPlacementValidationError(
          `Unknown root placement ${placement.rootKey}.`,
        );
      }
      const parentTaskId =
        placement.target.kind === 'EXISTING_FEATURE'
          ? placement.target.featureId
          : null;
      let snapshot = await this.proposalGroupAuthoring.updateMember(
        context.core.organizationId,
        context.core.projectId,
        state.proposalGroupId,
        root.proposalGroupMemberId,
        context.core.user.id,
        {
          expectedRevision: revision,
          proposal: this.buildFeatureProposalDto({
            name: root.name,
            description: root.description,
            tag: root.tag,
            priority: root.priority,
            influences: root.influences,
            parentTaskId,
            conversationId: context.core.conversationId,
            requestorContext: this.buildRequestorContext(context, nodeId),
          }),
        },
      );
      revision = snapshot.currentRevision;
      snapshot = await this.proposalGroupAuthoring.replacePrerequisites(
        context.core.organizationId,
        context.core.projectId,
        state.proposalGroupId,
        root.proposalGroupMemberId,
        {
          expectedRevision: revision,
          prerequisiteMemberIds: new Set(
            holder && parentTaskId === holder.reservedFeatureId
              ? [holder.memberId]
              : [],
          ),
        },
      );
      revision = snapshot.currentRevision;
    }
    return revision;
  }

  private async toAuthenticatedUser(
    context: Readonly<RepositoryImportFlowContext>,
  ): Promise<AuthenticatedUser> {
    const role = context.core.user.role.toUpperCase();
    if (!isOrganizationRole(role)) {
      throw new Error(
        `Unsupported onboarding organization role ${context.core.user.role}.`,
      );
    }
    const user = await this.prisma.db.user.findUnique({
      where: { id: context.core.user.id },
      select: {
        email: true,
        name: true,
        isDevAdmin: true,
        devAdminMode: true,
      },
    });
    if (!user) {
      throw new Error('Onboarding proposal requestor no longer exists.');
    }
    return {
      userId: context.core.user.id,
      email: user.email,
      name: user.name,
      currentOrgId: context.core.organizationId,
      orgMemberships: [{ orgId: context.core.organizationId, role }],
      isDevAdmin: user.isDevAdmin,
      devAdminMode: user.devAdminMode,
    };
  }

  private buildFeatureProposalDto(args: {
    name: string;
    description: string;
    tag: FeatureTag;
    priority: OnboardingFeaturePriority;
    influences: OnboardingFeatureInfluence[];
    parentTaskId: string | null;
    conversationId: string;
    requestorContext: RequestorContext;
  }): StampedCreateProposalDto {
    const influences: Influence[] = args.influences.map((influence) => ({
      entityId: influence.entityId,
      entityType: influence.entityType as EntityType,
      reasoning: influence.reasoning,
      reasonType: influence.reasonType,
      ...(influence.confidence != null
        ? { confidence: influence.confidence }
        : {}),
    }));

    const updates = {
      name: args.name,
      type: WORK_ITEM_TYPE_KEYS.Feature,
      status: WorkStatus.Active,
      tag: args.tag,
      priority: PRIORITY_MAP[args.priority],
      sections: [
        {
          key: 'description',
          content: args.description,
          order: 0,
        },
      ],
      ...(args.parentTaskId ? { parentTaskId: args.parentTaskId } : {}),
    };

    return {
      type: 'SINGLE',
      action: 'CREATE',
      eli5: 'Creates this feature from the reviewed feature list.',
      targetEntityId: NIL_UUID,
      targetEntityType: 'TASK',
      title: args.name,
      updates,
      influences,
      conversationId: args.conversationId,
      requestorContext: args.requestorContext,
    };
  }

  private normalizeInfluences(
    raw: FeatureGenerationInfluence[] | undefined,
  ): OnboardingFeatureInfluence[] {
    return (raw ?? []).map((influence) => ({
      entityId: influence.entityId,
      entityType: influence.entityType,
      reasoning: influence.reasoning ?? '',
      reasonType: influence.reasonType,
      confidence: influence.confidence ?? null,
    }));
  }
}

function isOrganizationRole(value: string): value is OrganizationRole {
  return Object.values(OrganizationRole).some((role) => role === value);
}
