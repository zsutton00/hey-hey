import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProposalEdgeEndpointMode } from 'src/generated/model/proposalEdgeEndpointMode';
import {
  withDiagramDefaults,
  canonicalDiagramType,
} from '../tasks/diagram-metadata';
import type { Prisma } from '@prisma/client';
import type {
  AgentEdgeType,
  CreateProposalDto,
  ProjectedWorkItem,
  ProjectedWorkItemChangeSetIssue,
  ProjectedWorkItemChangeSetResponse,
  ProjectedWorkItemRelationship,
  ProjectedWorkItemSection,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetOperation,
  WorkItemChangeSetRelationshipIdentity,
  WorkItemChangeSetValidationRequest,
  WorkItemGraphLayoutValue,
  WorkItemCreateOperation,
  WorkItemLayoutClearOperation,
  WorkItemLayoutReplaceOperation,
  WorkItemRelationshipCreateOperation,
  WorkItemRelationshipDeleteOperation,
  WorkItemRelationshipUpdateOperation,
  WorkItemSectionClearOperation,
  WorkItemSectionReplaceOperation,
  WorkItemUpdateOperation,
} from 'src/generated';
import type { AgentEdge as GraphAgentEdge } from 'src/generated/graphs';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import {
  AgentEdgeType as GraphAgentEdgeType,
  type AgentEdgeType as GraphAgentEdgeTypeValue,
} from 'src/generated/graphs/model/agentEdgeType';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import {
  TaskSectionSchemaValidatorRegistry,
  resolveWorkItemSectionContentKind,
} from '../tasks/task-section-schema-validator.registry';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { WorkItemParentageValidator } from '../tasks/work-item-parentage-validator.service';
import { validateFeatureRequirementsSection } from '../tasks/feature-requirements-section.validator';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from './pending-edge.service';
import {
  createProjectionFindings,
  nodeKey,
  relKey,
  type ApplyOutcome,
  type IssueLayer,
  type ProjectedEdge,
  type ProjectedNode,
  type ProjectedTaskRecord,
  type ProjectionFindings,
  type ProjectionState,
} from './work-item-change-set-projection/projection-state';
import {
  deriveRequestFacts,
  namedExistingIds,
} from './work-item-change-set-projection/request-facts';
import {
  createLoadedData,
  planProjection,
  type RuleContext,
} from './work-item-change-set-projection/projection-rule';
import { PROJECTION_RULES } from './work-item-change-set-projection/rules';
import { ProjectionLoader } from './work-item-change-set-projection/projection-loader';

/**
 * The neighbourhood a caller needs beyond what validation reads. Validation-only
 * callers request none, so their projection reads only what active rules load.
 */
export type ProjectionView =
  | { kind: 'rootChildren'; includeExternalRelationships?: boolean }
  | { kind: 'sourceRefs'; refs: readonly WorkItemChangeSetIdentity[] };

/** The root's children and every relationship between them and the root. */
export const rootChildrenView: ProjectionView = { kind: 'rootChildren' };

export function sourceRefView(
  refs: readonly WorkItemChangeSetIdentity[],
): ProjectionView {
  return { kind: 'sourceRefs', refs };
}

export type WorkItemChangeSetProjectionSnapshots = {
  unavailableWorkItemIds: ReadonlySet<string>;
  /** Identity keys of every work item and relationship the projection held. */
  workItemKeys: string[];
  relationshipKeys: string[];
  prior: ProjectedWorkItemChangeSetResponse;
  target: ProjectedWorkItemChangeSetResponse;
};

export type PlanStageProposalCandidate = {
  proposalId?: string;
  proposal: CreateProposalDto;
};

export type ProjectedProposalTopology = {
  projection: ProjectedWorkItemChangeSetResponse;
  nodes: ProjectedWorkItem[];
  relationships: ProjectedWorkItemRelationship[];
  featureContractCitations: ReadonlyMap<string, ReadonlySet<string>>;
  participatingFeatureByWorkflowNode: ReadonlyMap<string, string>;
};

const SYSTEM_EMITTED_GRAPH_EDGE_TYPES = new Set<GraphAgentEdgeTypeValue>([
  GraphAgentEdgeType.ProposedTogether,
]);

@Injectable()
export class WorkItemChangeSetProjectorService {
  private readonly logger = new Logger(WorkItemChangeSetProjectorService.name);
  private readonly sectionValidators = new TaskSectionSchemaValidatorRegistry();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly workItemParentageValidator: WorkItemParentageValidator,
    private readonly agentEdgeClient: AgentEdgeClientService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  async project(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    request: WorkItemChangeSetValidationRequest;
    basis?: ProjectedWorkItemChangeSetResponse;
    overlayNodes?: readonly ProjectedWorkItem[];
    overlayRelationships?: readonly ProjectedWorkItemRelationship[];
    view?: ProjectionView;
    db?: AnyTransactionClient;
  }): Promise<ProjectedWorkItemChangeSetResponse> {
    return (await this.projectSnapshots(params)).target;
  }

  /**
   * Adapt ordinary TASK proposals into the generic Work Items projection so
   * PLAN_STAGE authoring uses the same complete-subtree validator as graph
   * change sets. Persisted DRAFT proposals are included because independent
   * create_work_item calls collectively describe the next reviewable Plan.
   */
  async projectPlanStageProposalCandidates(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    candidates: readonly PlanStageProposalCandidate[];
  }): Promise<ProjectedWorkItemChangeSetIssue[]> {
    const replacedProposalIds = new Set(
      params.candidates
        .map((candidate) => candidate.proposalId)
        .filter((id): id is string => id !== undefined),
    );

    const candidateUpdateTargetIds = params.candidates
      .filter((entry) => entry.proposal.action === 'UPDATE')
      .map((entry) => entry.proposal.targetEntityId);
    const candidateUpdateTargets = candidateUpdateTargetIds.length
      ? await this.prisma.db.task.findMany({
          where: {
            id: { in: [...new Set(candidateUpdateTargetIds)] },
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
            status: { not: 'ARCHIVED' },
          },
          select: { id: true, type: true, parentTaskId: true },
        })
      : [];
    const updateTargetById = new Map<
      string,
      (typeof candidateUpdateTargets)[number]
    >(candidateUpdateTargets.map((target) => [target.id, target]));
    const taskDependencyIssues = await this.projectPlanTaskDependencyIssues({
      organizationId: params.organizationId,
      projectId: params.projectId,
      candidates: params.candidates,
      updateTargetById,
    });

    const candidatePlanIds = new Set<string>();
    for (const candidate of params.candidates) {
      const updates = this.proposalUpdates(candidate.proposal);
      if (
        candidate.proposal.action === 'CREATE' &&
        updates['type'] === 'PLAN_STAGE' &&
        typeof updates['parentTaskId'] === 'string'
      ) {
        candidatePlanIds.add(updates['parentTaskId']);
      }
      if (candidate.proposal.action === 'UPDATE') {
        const target = updateTargetById.get(candidate.proposal.targetEntityId);
        if (target?.type !== 'PLAN_STAGE') continue;
        if (target.parentTaskId) candidatePlanIds.add(target.parentTaskId);
        if (typeof updates['parentTaskId'] === 'string') {
          candidatePlanIds.add(updates['parentTaskId']);
        }
      }
    }
    if (candidatePlanIds.size === 0) return taskDependencyIssues;

    const proposalSelect = {
      id: true,
      action: true,
      targetEntityId: true,
      targetEntityType: true,
      title: true,
      updates: true,
      edges: true,
    } satisfies Prisma.ProposalSelect;
    type SelectedProposal = Prisma.ProposalGetPayload<{
      select: typeof proposalSelect;
    }>;
    const persistedById = new Map<string, SelectedProposal>();
    const loadedPlanIds = new Set<string>();

    while (loadedPlanIds.size < candidatePlanIds.size) {
      const planIds = [...candidatePlanIds].filter(
        (planId) => !loadedPlanIds.has(planId),
      );
      planIds.forEach((planId) => loadedPlanIds.add(planId));

      const canonicalStages = await this.prisma.db.task.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          parentTaskId: { in: planIds },
          type: 'PLAN_STAGE',
          archivedAt: null,
          status: { not: 'ARCHIVED' },
        },
        select: { id: true, type: true, parentTaskId: true },
      });
      canonicalStages.forEach((stage) => {
        updateTargetById.set(stage.id, stage);
      });

      const planPredicates = planIds.map(
        (planId): Prisma.ProposalWhereInput => ({
          updates: { path: ['parentTaskId'], equals: planId },
        }),
      );
      const proposalPopulation: Prisma.ProposalWhereInput[] = [
        ...planIds.map(
          (planId): Prisma.ProposalWhereInput => ({
            action: 'CREATE',
            AND: [
              { updates: { path: ['type'], equals: 'PLAN_STAGE' } },
              { updates: { path: ['parentTaskId'], equals: planId } },
            ],
          }),
        ),
        ...planPredicates.map(
          (parentPredicate): Prisma.ProposalWhereInput => ({
            action: 'UPDATE',
            ...parentPredicate,
          }),
        ),
      ];
      if (canonicalStages.length > 0) {
        proposalPopulation.push({
          action: 'UPDATE',
          targetEntityId: { in: canonicalStages.map((stage) => stage.id) },
        });
      }

      const persisted = await this.prisma.db.proposal.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          status: 'DRAFT',
          targetEntityType: 'TASK',
          ...(replacedProposalIds.size > 0
            ? { id: { notIn: [...replacedProposalIds] } }
            : {}),
          OR: proposalPopulation,
        },
        select: proposalSelect,
      });

      const missingUpdateTargetIds = persisted
        .filter((proposal) => proposal.action === 'UPDATE')
        .map((proposal) => proposal.targetEntityId)
        .filter((targetId) => !updateTargetById.has(targetId));
      if (missingUpdateTargetIds.length > 0) {
        const updateTargets = await this.prisma.db.task.findMany({
          where: {
            id: { in: [...new Set(missingUpdateTargetIds)] },
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
            status: { not: 'ARCHIVED' },
          },
          select: { id: true, type: true, parentTaskId: true },
        });
        updateTargets.forEach((target) =>
          updateTargetById.set(target.id, target),
        );
      }

      for (const proposal of persisted) {
        const updates = this.proposalUpdates(
          proposal as unknown as CreateProposalDto,
        );
        const target = updateTargetById.get(proposal.targetEntityId);
        const isStageProposal =
          (proposal.action === 'CREATE' && updates['type'] === 'PLAN_STAGE') ||
          (proposal.action === 'UPDATE' && target?.type === 'PLAN_STAGE');
        if (!isStageProposal || replacedProposalIds.has(proposal.id)) continue;
        persistedById.set(proposal.id, proposal);
        if (proposal.action === 'UPDATE' && target?.parentTaskId) {
          candidatePlanIds.add(target.parentTaskId);
        }
        if (typeof updates['parentTaskId'] === 'string') {
          candidatePlanIds.add(updates['parentTaskId']);
        }
      }
    }

    const candidateProposalIds = new Set(
      params.candidates
        .map((candidate) => candidate.proposalId)
        .filter((proposalId): proposalId is string => proposalId !== undefined),
    );
    const referencedProposalIds = [
      ...[...persistedById.values()].map(
        (proposal) => proposal as unknown as CreateProposalDto,
      ),
      ...params.candidates.map((candidate) => candidate.proposal),
    ]
      .flatMap((proposal) => proposal.edges ?? [])
      .filter(
        (edge) =>
          edge.endpointMode !== ProposalEdgeEndpointMode.Proposal &&
          edge.edgeType === 'DEPENDS_ON' &&
          edge.targetEntityType === 'PROPOSAL',
      )
      .map((edge) => edge.targetEntityId)
      .filter(
        (proposalId) =>
          !persistedById.has(proposalId) &&
          !candidateProposalIds.has(proposalId),
      );
    if (referencedProposalIds.length > 0) {
      const referencedIdSet = new Set(referencedProposalIds);
      const referencedProposals = await this.prisma.db.proposal.findMany({
        where: {
          id: { in: [...referencedIdSet] },
          organizationId: params.organizationId,
          projectId: params.projectId,
          status: 'DRAFT',
          targetEntityType: 'TASK',
        },
        select: proposalSelect,
      });
      for (const proposal of referencedProposals) {
        if (referencedIdSet.has(proposal.id)) {
          persistedById.set(proposal.id, proposal);
        }
      }

      const referencedUpdateTargetIds = referencedProposals
        .filter((proposal) => proposal.action === 'UPDATE')
        .map((proposal) => proposal.targetEntityId)
        .filter((targetId) => !updateTargetById.has(targetId));
      if (referencedUpdateTargetIds.length > 0) {
        const updateTargets = await this.prisma.db.task.findMany({
          where: {
            id: { in: [...new Set(referencedUpdateTargetIds)] },
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
            status: { not: 'ARCHIVED' },
          },
          select: { id: true, type: true, parentTaskId: true },
        });
        updateTargets.forEach((target) =>
          updateTargetById.set(target.id, target),
        );
      }
    }

    const entries = [
      ...[...persistedById.values()].map((proposal) => ({
        proposalId: proposal.id,
        proposal: proposal as unknown as CreateProposalDto,
      })),
      ...params.candidates,
    ];

    const identityByEntry = new Map<
      PlanStageProposalCandidate,
      WorkItemChangeSetIdentity
    >();
    const identityByProposalId = new Map<string, WorkItemChangeSetIdentity>();
    entries.forEach((entry, index) => {
      const identity: WorkItemChangeSetIdentity =
        entry.proposal.action === 'CREATE'
          ? {
              refType: 'temporary',
              tempId: `proposal-${entry.proposalId ?? `candidate-${index}`}`,
            }
          : { refType: 'existing', id: entry.proposal.targetEntityId };
      identityByEntry.set(entry, identity);
      if (entry.proposalId) {
        identityByProposalId.set(entry.proposalId, identity);
      }
    });
    const entryByProposalId = new Map(
      entries
        .filter(
          (
            entry,
          ): entry is PlanStageProposalCandidate & { proposalId: string } =>
            entry.proposalId !== undefined,
        )
        .map((entry) => [entry.proposalId, entry]),
    );
    const entryByReservedTargetId = new Map(
      entries
        .filter(
          (entry) =>
            entry.proposal.action === 'CREATE' &&
            entry.proposal.targetEntityId !==
              '00000000-0000-0000-0000-000000000000',
        )
        .map((entry) => [entry.proposal.targetEntityId, entry]),
    );

    const issues: ProjectedWorkItemChangeSetIssue[] = [];
    for (const planId of [...candidatePlanIds].sort()) {
      const planEntries = entries.filter((entry) => {
        const updates = this.proposalUpdates(entry.proposal);
        if (entry.proposal.action === 'CREATE') {
          return (
            updates['type'] === 'PLAN_STAGE' &&
            updates['parentTaskId'] === planId
          );
        }
        const target = updateTargetById.get(entry.proposal.targetEntityId);
        return (
          target?.type === 'PLAN_STAGE' &&
          (target.parentTaskId === planId || updates['parentTaskId'] === planId)
        );
      });
      const planEntrySet = new Set(planEntries);
      const referencedEntries = planEntries
        .flatMap((entry) => entry.proposal.edges ?? [])
        .filter(
          (edge) =>
            edge.endpointMode !== ProposalEdgeEndpointMode.Proposal &&
            edge.edgeType === 'DEPENDS_ON' &&
            edge.targetEntityType === 'PROPOSAL',
        )
        .map((edge) =>
          edge.targetEntityType === 'PROPOSAL'
            ? entryByProposalId.get(edge.targetEntityId)
            : entryByReservedTargetId.get(edge.targetEntityId),
        )
        .filter(
          (
            entry,
          ): entry is PlanStageProposalCandidate & { proposalId: string } =>
            entry !== undefined && !planEntrySet.has(entry),
        );
      const projectedEntries = [...planEntries, ...new Set(referencedEntries)];
      const operations: WorkItemChangeSetOperation[] = [];

      projectedEntries.forEach((entry) => {
        const proposal = entry.proposal;
        const updates = this.proposalUpdates(proposal);
        const identity = identityByEntry.get(entry)!;

        if (proposal.action === 'CREATE') {
          operations.push({
            op: 'workItem.create',
            ref: identity as Extract<
              WorkItemChangeSetIdentity,
              { refType: 'temporary' }
            >,
            name: String((updates['name'] ?? proposal.title ?? '') as unknown),
            type: String(updates['type']) as WorkItemCreateOperation['type'],
            parent: {
              refType: 'existing',
              id: String(updates['parentTaskId']),
            },
            ...(typeof updates['status'] === 'string'
              ? {
                  status: updates[
                    'status'
                  ] as WorkItemCreateOperation['status'],
                }
              : {}),
          });
        } else {
          const update: WorkItemUpdateOperation = {
            op: 'workItem.update',
            ref: identity,
          };
          if (typeof updates['name'] === 'string')
            update.name = updates['name'];
          if (Object.prototype.hasOwnProperty.call(updates, 'parentTaskId')) {
            update.parent =
              typeof updates['parentTaskId'] === 'string'
                ? { refType: 'existing', id: updates['parentTaskId'] }
                : null;
          }
          if (typeof updates['status'] === 'string') {
            update.status = updates[
              'status'
            ] as WorkItemUpdateOperation['status'];
          }
          operations.push(update);
        }
        for (const section of this.proposalSections(updates)) {
          operations.push({
            op: 'section.replace',
            ref: identity,
            key: section.key,
            content: section.content,
          });
        }
      });

      planEntries.forEach((entry, entryIndex) => {
        const source = identityByEntry.get(entry)!;
        for (const [edgeIndex, edge] of (
          entry.proposal.edges ?? []
        ).entries()) {
          if (
            edge.endpointMode === ProposalEdgeEndpointMode.Proposal ||
            edge.edgeType !== 'DEPENDS_ON'
          )
            continue;
          const reservedTargetEntry = entryByReservedTargetId.get(
            edge.targetEntityId,
          );
          const target =
            edge.targetEntityType === 'PROPOSAL'
              ? (identityByProposalId.get(edge.targetEntityId) ?? {
                  refType: 'temporary' as const,
                  tempId: `unresolved-proposal-${edge.targetEntityId}`,
                })
              : reservedTargetEntry
                ? identityByEntry.get(reservedTargetEntry)!
                : {
                    refType: 'existing' as const,
                    id: edge.targetEntityId,
                  };
          operations.push({
            op: 'relationship.create',
            ref: {
              refType: 'temporary',
              tempId: `proposal-edge-${entry.proposalId ?? entryIndex}-${edgeIndex}`,
            },
            source,
            target,
            edgeType: 'DEPENDS_ON',
            category: 'meta',
            reasoning: edge.description ?? null,
          });
        }
      });

      const projection = await this.project({
        organizationId: params.organizationId,
        projectId: params.projectId,
        request: {
          root: { refType: 'existing', id: planId },
          operations,
        },
      });
      issues.push(...projection.issues);
    }
    const stageIssueKeys = new Set(
      issues.map((issue) => `${issue.field}\u0000${issue.code}`),
    );
    return [
      ...taskDependencyIssues.filter(
        (issue) => !stageIssueKeys.has(`${issue.field}\u0000${issue.code}`),
      ),
      ...issues,
    ];
  }

  /**
   * Plan Task dependency boundaries are otherwise only checked when a
   * proposal touches a PLAN_STAGE, so Task creates, reparents and DEPENDS_ON
   * declarations would first fail at approval. Project each such candidate
   * with the same root, parent and declared-edge operations that approval's
   * task change set uses, so field paths and endpoint conditions match.
   */
  private async projectPlanTaskDependencyIssues(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    candidates: readonly PlanStageProposalCandidate[];
    updateTargetById: ReadonlyMap<string, { type: string }>;
  }): Promise<ProjectedWorkItemChangeSetIssue[]> {
    const durableEdgeTypes = new Set([
      'DEPENDS_ON',
      'RELATED_TO',
      'DERIVES_FROM',
      'CONTRADICTS',
      'EVOLVES',
    ]);
    const issues: ProjectedWorkItemChangeSetIssue[] = [];
    for (const { proposal } of params.candidates) {
      if (proposal.targetEntityType !== 'TASK') continue;
      const updates = this.proposalUpdates(proposal);
      if (
        Object.prototype.hasOwnProperty.call(updates, 'operations') ||
        Object.prototype.hasOwnProperty.call(updates, 'initialRequirements') ||
        Object.prototype.hasOwnProperty.call(updates, 'requirementOps')
      ) {
        continue;
      }
      const edges = (proposal.edges ?? []).filter(
        (edge) => edge.endpointMode !== ProposalEdgeEndpointMode.Proposal,
      );
      // Approval leaves proposals with non-durable or non-Task declarations
      // on the legacy proposal-edge protocol, which never reaches this rule.
      if (
        edges.some(
          (edge) =>
            edge.targetEntityType !== 'TASK' ||
            !durableEdgeTypes.has(edge.edgeType),
        )
      ) {
        continue;
      }
      const declaresDependency = edges.some(
        (edge) => edge.edgeType === 'DEPENDS_ON',
      );
      const changesParent = Object.prototype.hasOwnProperty.call(
        updates,
        'parentTaskId',
      );
      if (!declaresDependency && !changesParent) continue;

      let root: WorkItemChangeSetIdentity;
      const operations: WorkItemChangeSetOperation[] = [];
      if (proposal.action === 'CREATE') {
        const type = updates['type'] ?? 'STANDARD';
        if (type !== 'STANDARD' || !declaresDependency) continue;
        root = { refType: 'temporary', tempId: 'root' };
        operations.push({
          op: 'workItem.create',
          ref: root,
          name:
            typeof updates['name'] === 'string'
              ? updates['name']
              : (proposal.title ?? ''),
          type: 'STANDARD',
          ...(typeof updates['parentTaskId'] === 'string'
            ? {
                parent: { refType: 'existing', id: updates['parentTaskId'] },
              }
            : {}),
        });
      } else if (proposal.action === 'UPDATE') {
        if (
          params.updateTargetById.get(proposal.targetEntityId)?.type !==
          'STANDARD'
        ) {
          continue;
        }
        root = { refType: 'existing', id: proposal.targetEntityId };
        const update: WorkItemUpdateOperation = {
          op: 'workItem.update',
          ref: root,
        };
        if (changesParent) {
          update.parent =
            typeof updates['parentTaskId'] === 'string'
              ? { refType: 'existing', id: updates['parentTaskId'] }
              : null;
        }
        operations.push(update);
      } else {
        continue;
      }
      edges.forEach((edge, index) => {
        operations.push({
          op: 'relationship.create',
          ref: { refType: 'temporary', tempId: `proposal-edge-${index}` },
          source: root,
          target: { refType: 'existing', id: edge.targetEntityId },
          edgeType: edge.edgeType as
            | 'DEPENDS_ON'
            | 'RELATED_TO'
            | 'DERIVES_FROM'
            | 'CONTRADICTS'
            | 'EVOLVES',
          category: 'meta',
          reasoning: edge.description ?? null,
        });
      });

      const projection = await this.project({
        organizationId: params.organizationId,
        projectId: params.projectId,
        request: { root, operations },
      });
      const boundaryIssues = projection.issues.filter(
        (issue) => issue.code === 'cross_boundary_dependency',
      );
      if (boundaryIssues.length > 0) {
        this.logger.debug(
          'Rejected cross-stage Plan Task dependency at authoring',
          {
            action: proposal.action,
            targetEntityId: proposal.targetEntityId,
            issueCount: boundaryIssues.length,
          },
        );
      }
      issues.push(...boundaryIssues);
    }
    return issues;
  }

  private proposalUpdates(
    proposal: CreateProposalDto,
  ): Record<string, unknown> {
    return proposal.updates !== null &&
      typeof proposal.updates === 'object' &&
      !Array.isArray(proposal.updates)
      ? (proposal.updates as Record<string, unknown>)
      : {};
  }

  private proposalSections(
    updates: Record<string, unknown>,
  ): Array<{ key: string; content: unknown }> {
    if (!Array.isArray(updates['sections'])) return [];
    const sections: unknown[] = updates['sections'];
    return sections.filter(
      (section): section is { key: string; content: unknown } =>
        section !== null &&
        typeof section === 'object' &&
        typeof (section as Record<string, unknown>)['key'] === 'string' &&
        Boolean(Object.prototype.hasOwnProperty.call(section, 'content')),
    );
  }

  async projectTopology(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    request: WorkItemChangeSetValidationRequest;
    basis?: ProjectedWorkItemChangeSetResponse;
    overlayNodes?: readonly ProjectedWorkItem[];
    overlayRelationships?: readonly ProjectedWorkItemRelationship[];
    view?: ProjectionView;
  }): Promise<ProjectedProposalTopology> {
    const projection = await this.project(params);
    return this.composeTopology({
      ...params,
      projection,
      additionalNodes: params.overlayNodes,
    });
  }

  async composeTopology(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    projection: ProjectedWorkItemChangeSetResponse;
    additionalNodes?: readonly ProjectedWorkItem[];
  }): Promise<ProjectedProposalTopology> {
    const projectedNodes = [
      params.projection.projectedRoot,
      ...params.projection.children,
      ...(params.additionalNodes ?? []),
    ];
    const nodeByKey = new Map(
      projectedNodes.map((node) => [this.identityKey(node.identity), node]),
    );
    const relationshipByKey = new Map<string, ProjectedWorkItemRelationship>();

    // The structural projector intentionally excludes ambient relationships
    // whose other endpoint falls outside the edited graph boundary. Topology
    // lint needs those one-hop relationships: a workflow step's canonical
    // FULFILLED_BY target is normally a task elsewhere in the feature tree.
    // Read them here without widening the blocking projection boundary, then
    // let proposed relationship state override the persisted snapshot below.
    const existingNodeIds = [...nodeByKey.values()]
      .filter((node) => !node.deleted && node.identity.refType === 'existing')
      .map((node) =>
        node.identity.refType === 'existing' ? node.identity.id : '',
      );
    if (existingNodeIds.length > 0) {
      const token = this.tokenFactory(params.organizationId, params.projectId);
      const ambientEdges = await this.agentEdgeClient.findIncident(
        params.organizationId,
        params.projectId,
        {
          nodeIds: new Set(existingNodeIds),
          types: new Set(this.incidentGraphAgentEdgeTypes()),
        },
        token,
      );
      const topologyState = this.createEmptyState();
      const workItemEdges = ambientEdges.filter(
        (edge) =>
          (edge.sourceEntityType === undefined ||
            edge.sourceEntityType === AgentEdgeEndpointEntityType.Task) &&
          (edge.targetEntityType === undefined ||
            edge.targetEntityType === AgentEdgeEndpointEntityType.Task),
      );
      workItemEdges.forEach((edge) =>
        this.hydrateRelationship(edge, topologyState),
      );
      topologyState.relationships.forEach((relationship, key) =>
        relationshipByKey.set(key, relationship),
      );

      const missingEndpointIds = [
        ...new Set(
          workItemEdges
            .flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId])
            .filter((id) => !nodeByKey.has(`existing:${id}`)),
        ),
      ];
      if (missingEndpointIds.length > 0) {
        const endpoints = await this.prisma.db.task.findMany({
          where: {
            id: { in: missingEndpointIds },
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
            status: { not: 'ARCHIVED' },
          },
          include: {
            sections: { orderBy: { order: 'asc' } },
            serviceRelations: { select: { serviceId: true } },
          },
        });
        for (const task of endpoints) {
          const identity = { refType: 'existing' as const, id: task.id };
          nodeByKey.set(
            this.identityKey(identity),
            this.taskToProjectedNode(task, identity, params.projectId),
          );
        }
      }
    }
    for (const relationship of params.projection.incidentRelationships) {
      relationshipByKey.set(
        this.relationshipKey(relationship.identity),
        relationship,
      );
    }

    const workflowNodes = [...nodeByKey.values()].filter(
      (node) =>
        !node.deleted &&
        ['DIAGRAM', 'DIAGRAM_ELEMENT'].includes(
          canonicalDiagramType(node.type),
        ),
    );
    const ancestorIds = new Set<string>();
    for (const node of workflowNodes) {
      let parent = node.parent;
      while (parent?.refType === 'existing') {
        const parentKey = this.identityKey(parent);
        const known = nodeByKey.get(parentKey);
        if (known) {
          parent = known.parent;
          continue;
        }
        ancestorIds.add(parent.id);
        break;
      }
    }

    while (ancestorIds.size > 0) {
      const unresolved = [...ancestorIds].filter(
        (id) => !nodeByKey.has(`existing:${id}`),
      );
      if (unresolved.length === 0) break;
      const ancestors = await this.prisma.db.task.findMany({
        where: {
          id: { in: unresolved },
          organizationId: params.organizationId,
          projectId: params.projectId,
          archivedAt: null,
          status: { not: 'ARCHIVED' },
        },
        include: {
          sections: { orderBy: { order: 'asc' } },
          serviceRelations: { select: { serviceId: true } },
        },
      });
      if (ancestors.length === 0) break;
      ancestorIds.clear();
      for (const task of ancestors) {
        const identity = { refType: 'existing' as const, id: task.id };
        const projected = this.taskToProjectedNode(
          task,
          identity,
          params.projectId,
        );
        nodeByKey.set(this.identityKey(identity), projected);
        if (
          projected.parent?.refType === 'existing' &&
          !nodeByKey.has(this.identityKey(projected.parent))
        ) {
          ancestorIds.add(projected.parent.id);
        }
      }
    }

    const featureContractCitations = new Map<string, ReadonlySet<string>>();
    const nodes = [...nodeByKey.values()];
    for (const feature of nodes.filter(
      (node) => !node.deleted && node.type === 'FEATURE',
    )) {
      const requirements = feature.sections.find(
        (section) => section.key === 'requirements',
      )?.content;
      if (requirements === undefined || requirements === null) {
        continue;
      }
      const parsed = validateFeatureRequirementsSection(requirements);
      if (!parsed.success) continue;
      featureContractCitations.set(
        this.identityKey(feature.identity),
        new Set(
          parsed.value.records.flatMap((record) =>
            record.contracts.map(({ entityId }) => `existing:${entityId}`),
          ),
        ),
      );
    }

    const participatingFeatureByWorkflowNode = new Map<string, string>();
    for (const node of workflowNodes) {
      let current: ProjectedNode | undefined = node;
      const visited = new Set<string>();
      while (current) {
        const currentKey = this.identityKey(current.identity);
        if (visited.has(currentKey)) break;
        visited.add(currentKey);
        if (current.type === 'FEATURE') {
          participatingFeatureByWorkflowNode.set(
            this.identityKey(node.identity),
            currentKey,
          );
          break;
        }
        current = current.parent
          ? (nodeByKey.get(this.identityKey(current.parent)) as
              | ProjectedNode
              | undefined)
          : undefined;
      }
    }

    return {
      projection: params.projection,
      nodes,
      relationships: [...relationshipByKey.values()],
      featureContractCitations,
      participatingFeatureByWorkflowNode,
    };
  }

  async projectSnapshots(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    request: WorkItemChangeSetValidationRequest;
    basis?: ProjectedWorkItemChangeSetResponse;
    overlayNodes?: readonly ProjectedWorkItem[];
    overlayRelationships?: readonly ProjectedWorkItemRelationship[];
    view?: ProjectionView;
    db?: AnyTransactionClient;
  }): Promise<WorkItemChangeSetProjectionSnapshots> {
    const state = this.createEmptyState();
    const findings = createProjectionFindings();
    for (const node of params.overlayNodes ?? []) {
      const key = this.identityKey(node.identity);
      state.nodes.set(key, { ...node });
      state.identityLabels[key] = node.label;
      findings.overlayNodes.add(key);
    }
    for (const relationship of params.overlayRelationships ?? []) {
      const key = this.relationshipKey(relationship.identity);
      state.relationships.set(key, { ...relationship });
      findings.overlayRelationships.add(key);
      state.identityLabels[key] = relationship.label;
    }

    const existingIds = [
      ...new Set([
        ...namedExistingIds(params.request),
        ...(params.view?.kind === 'sourceRefs'
          ? params.view.refs.flatMap((ref) =>
              ref.refType === 'existing' ? [ref.id] : [],
            )
          : []),
      ]),
    ].sort();
    this.logger.debug('Hydrating work-item change-set projection', {
      projectId: params.projectId,
      existingWorkItemCount: existingIds.length,
      operationCount: params.request.operations.length,
    });

    const named = await this.hydrateExistingNodes({
      organizationId: params.organizationId,
      projectId: params.projectId,
      ids: existingIds,
      deletionIds: new Set(
        params.request.operations.flatMap((operation) =>
          operation.op === 'workItem.delete' &&
          operation.ref.refType === 'existing'
            ? [operation.ref.id]
            : [],
        ),
      ),
      state,
      db: params.db,
    });
    findings.namedMissing = named.namedMissing;
    findings.namedUnavailable = named.namedUnavailable;
    if (params.basis) {
      this.restoreGraphBasis(state, params.basis);
      const basisKeys = new Set(
        [params.basis.projectedRoot, ...params.basis.children].map((node) =>
          this.identityKey(node.identity),
        ),
      );
      findings.namedMissing = findings.namedMissing.filter(
        (id) => !basisKeys.has(`existing:${id}`),
      );
      for (const key of basisKeys) findings.overlayNodes.add(key);
      for (const edge of params.basis.incidentRelationships)
        findings.overlayRelationships.add(this.relationshipKey(edge.identity));
    }
    const facts = deriveRequestFacts(params.request, state, named.parentTypes);
    const plan = planProjection({
      rules: PROJECTION_RULES,
      facts,
      registry: this.workItemTypeRegistry,
      projectId: params.projectId,
    });
    const loaded = createLoadedData();
    const loader = new ProjectionLoader({
      organizationId: params.organizationId,
      projectId: params.projectId,
      db: params.db ?? this.prisma.db,
      agentEdgeClient: this.agentEdgeClient,
      tokenFactory: this.tokenFactory,
      request: params.request,
      facts,
      state,
      loaded,
      writer: {
        writeTasks: (tasks) =>
          this.writeLoadedTasks(tasks, params.projectId, state),
        writeEdge: (edge) => this.hydrateRelationship(edge, state),
      },
      logger: this.logger,
    });
    const loadCounts = await loader.loadAll(plan.loads);
    let viewCounts: { nodes: number; edges: number } | undefined;
    if (params.view?.kind === 'rootChildren') {
      viewCounts = await loader.loadRootNeighbourhood(
        facts.root,
        this.incidentGraphAgentEdgeTypes(),
        params.view.includeExternalRelationships,
      );
    }
    for (const node of params.overlayNodes ?? []) {
      const key = this.identityKey(node.identity);
      state.nodes.set(key, { ...node });
      state.identityLabels[key] = node.label;
    }
    for (const relationship of params.overlayRelationships ?? []) {
      const key = this.relationshipKey(relationship.identity);
      state.relationships.set(key, { ...relationship });
      state.identityLabels[key] = relationship.label;
    }
    if (params.basis) {
      this.restoreGraphBasis(state, params.basis);
      const rootKey = this.identityKey(params.basis.projectedRoot.identity);
      loaded.children.set(
        rootKey,
        params.basis.children
          .filter((n) => !n.deleted)
          .map((n) => this.identityKey(n.identity)),
      );
      for (const edge of params.basis.incidentRelationships) {
        const key = this.relationshipKey(edge.identity);
        loaded.missingEdges.delete(key);
        loaded.storedEdgeTypes.set(key, edge.edgeType);
      }
    }
    this.logger.debug('Planned work-item change-set projection', {
      projectId: params.projectId,
      activeRuleIds: plan.active.map(({ rule }) => rule.id),
      loads: loadCounts,
      view: params.view?.kind ?? null,
      viewLoads: viewCounts ?? null,
      nodeCount: state.nodes.size,
      relationshipCount: state.relationships.size,
    });

    const prior = structuredClone(
      this.normalizeResponse(params.request.root, state),
    );

    findings.applied = this.applyOperations(
      params.request.operations,
      params.projectId,
      state,
    );
    const ruleContext: RuleContext = {
      facts,
      registry: this.workItemTypeRegistry,
      parentage: this.workItemParentageValidator,
      sectionValidators: this.sectionValidators,
      logger: this.logger,
      projectId: params.projectId,
      loaded,
      findings,
      addIssue: (...issue) => this.addIssue(state, ...issue),
      addWarning: (...warning) => this.addWarning(state, ...warning),
    };
    for (const { rule, scope } of plan.active) {
      rule.check(state, scope, ruleContext);
    }

    const target = this.normalizeResponse(params.request.root, state);
    this.logger.debug('Projected work-item change-set validation completed', {
      valid: target.valid,
      issueCount: target.issues.length,
      nodeCount: state.nodes.size,
      relationshipCount: state.relationships.size,
    });
    return {
      prior,
      target,
      unavailableWorkItemIds: state.unavailableWorkItemIds,
      workItemKeys: [...state.nodes.keys()].sort(),
      relationshipKeys: [...state.relationships.keys()].sort(),
    };
  }

  /** Restore the selected graph after loading current external validation context.
   * Live children/edges cannot leak into a refinement of a captured future.
   */
  private restoreGraphBasis(
    state: ProjectionState,
    basis: ProjectedWorkItemChangeSetResponse,
  ): void {
    const root = this.identityKey(basis.projectedRoot.identity);
    const owned = new Set([
      root,
      ...basis.children.map((n) => this.identityKey(n.identity)),
    ]);
    for (const [key, node] of state.nodes) {
      if (this.identityKey(node.parent) === root) {
        owned.add(key);
        state.nodes.delete(key);
        delete state.identityLabels[key];
      }
    }
    for (const [key, edge] of state.relationships) {
      if (
        owned.has(this.identityKey(edge.source)) ||
        owned.has(this.identityKey(edge.target))
      ) {
        state.relationships.delete(key);
        delete state.identityLabels[key];
      }
    }
    for (const node of [basis.projectedRoot, ...basis.children]) {
      const key = this.identityKey(node.identity);
      state.nodes.set(key, structuredClone(node));
      state.identityLabels[key] = node.label;
    }
    for (const edge of basis.incidentRelationships) {
      const key = this.relationshipKey(edge.identity);
      state.relationships.set(key, structuredClone(edge));
      state.identityLabels[key] = edge.label;
    }
  }

  /** Loaded neighbours of unavailable types are recorded, never projected. */
  private writeLoadedTasks(
    tasks: readonly ProjectedTaskRecord[],
    projectId: ProjectId,
    state: ProjectionState,
  ): void {
    for (const task of tasks) {
      if (!this.workItemTypeRegistry.getRulesForProject(task.type, projectId)) {
        state.unavailableWorkItemIds.add(task.id);
        continue;
      }
      const identity: WorkItemChangeSetIdentity = {
        refType: 'existing',
        id: task.id,
      };
      const key = this.identityKey(identity);
      state.nodes.set(key, this.taskToProjectedNode(task, identity, projectId));
      state.identityLabels[key] = task.name;
    }
  }

  async rehydrateCurrentProjection(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    rootWorkItemId: string;
  }): Promise<ProjectedWorkItemChangeSetResponse> {
    const state = this.createEmptyState();
    const tasks = await this.prisma.db.task.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        archivedAt: null,
        status: { not: 'ARCHIVED' },
        OR: [
          { id: params.rootWorkItemId },
          { parentTaskId: params.rootWorkItemId },
        ],
      },
      include: {
        sections: { orderBy: { order: 'asc' } },
        serviceRelations: { select: { serviceId: true } },
      },
    });

    for (const task of tasks) {
      if (
        !this.workItemTypeRegistry.getRulesForProject(
          task.type,
          params.projectId,
        )
      )
        continue;
      const identity: WorkItemChangeSetIdentity = {
        refType: 'existing',
        id: task.id,
      };
      const key = this.identityKey(identity);
      state.nodes.set(
        key,
        this.taskToProjectedNode(task, identity, params.projectId),
      );
      state.identityLabels[key] = task.name;
    }

    if (tasks.length > 0) {
      const token = this.tokenFactory(params.organizationId, params.projectId);
      const incidentEdges = await this.agentEdgeClient.findIncident(
        params.organizationId,
        params.projectId,
        {
          nodeIds: new Set(tasks.map((task) => task.id)),
          types: new Set(this.incidentGraphAgentEdgeTypes()),
        },
        token,
      );
      incidentEdges
        .filter(
          (edge) =>
            (edge.sourceEntityType === undefined ||
              edge.sourceEntityType === AgentEdgeEndpointEntityType.Task) &&
            (edge.targetEntityType === undefined ||
              edge.targetEntityType === AgentEdgeEndpointEntityType.Task),
        )
        .forEach((edge) => this.hydrateRelationship(edge, state));
    }

    return this.normalizeResponse(
      { refType: 'existing', id: params.rootWorkItemId },
      state,
    );
  }

  private createEmptyState(): ProjectionState {
    return {
      nodes: new Map(),
      relationships: new Map(),
      identityLabels: {},
      issues: [],
      warnings: [],
      layoutEntries: new Map(),
      deletedLayoutRoots: new Set(),
      unavailableWorkItemIds: new Set(),
    };
  }

  private incidentGraphAgentEdgeTypes(): GraphAgentEdgeTypeValue[] {
    return Object.values(GraphAgentEdgeType)
      .filter((type) => !SYSTEM_EMITTED_GRAPH_EDGE_TYPES.has(type))
      .sort();
  }

  private async hydrateExistingNodes(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    ids: string[];
    state: ProjectionState;
    deletionIds?: ReadonlySet<string>;
    db?: AnyTransactionClient;
  }): Promise<
    Pick<ProjectionFindings, 'namedMissing' | 'namedUnavailable'> & {
      parentTypes: Map<string, string | null>;
    }
  > {
    const findings = {
      namedMissing: [] as string[],
      namedUnavailable: [] as { id: string; type: string }[],
      parentTypes: new Map<string, string | null>(),
    };
    if (params.ids.length === 0) return findings;

    const include = {
      parentTask: { select: { type: true } },
      sections: { orderBy: { order: 'asc' } },
      serviceRelations: { select: { serviceId: true } },
    } satisfies Prisma.TaskInclude;
    const tasks: Prisma.TaskGetPayload<{ include: typeof include }>[] = await (
      params.db ?? this.prisma.db
    ).task.findMany({
      where: {
        id: { in: params.ids },
        organizationId: params.organizationId,
        projectId: params.projectId,
        archivedAt: null,
        status: { not: 'ARCHIVED' },
      },
      include,
    });
    const found = new Set<string>([
      ...tasks.map((task: ProjectedTaskRecord) => task.id),
      ...[...params.state.nodes.values()]
        .filter((node) => node.identity.refType === 'existing')
        .map((node) =>
          node.identity.refType === 'existing' ? node.identity.id : '',
        ),
    ]);
    findings.namedMissing.push(...params.ids.filter((id) => !found.has(id)));
    for (const task of tasks) {
      findings.parentTypes.set(
        `existing:${task.id}`,
        task.parentTask?.type ?? null,
      );
      const rules = this.workItemTypeRegistry.getRulesForProject(
        task.type,
        params.projectId,
      );
      if (!rules) params.state.unavailableWorkItemIds.add(task.id);
      if (!rules && !params.deletionIds?.has(task.id)) {
        if (!params.state.nodes.has(`existing:${task.id}`)) {
          findings.namedUnavailable.push({ id: task.id, type: task.type });
        }
        continue;
      }
      const identity: WorkItemChangeSetIdentity = {
        refType: 'existing',
        id: task.id,
      };
      const key = this.identityKey(identity);
      params.state.nodes.set(
        key,
        this.taskToProjectedNode(task, identity, params.projectId),
      );
      params.state.identityLabels[key] = task.name;
    }
    return findings;
  }

  private hydrateRelationship(
    edge: GraphAgentEdge,
    state: ProjectionState,
  ): void {
    const identity: WorkItemChangeSetRelationshipIdentity = {
      refType: 'existing',
      id: edge.id,
    };
    const relationship: ProjectedEdge = {
      identity,
      label: edge.type,
      source: { refType: 'existing', id: edge.sourceNodeId },
      ...(edge.sourceEntityType
        ? { sourceEntityType: edge.sourceEntityType }
        : {}),
      target: { refType: 'existing', id: edge.targetNodeId },
      ...(edge.targetEntityType
        ? { targetEntityType: edge.targetEntityType }
        : {}),
      edgeType: edge.type as AgentEdgeType,
      category: edge.category,
      direction: edge.direction ?? undefined,
      predicate: edge.predicate ?? null,
      reasoning: edge.reasoning,
      metadata: edge.metadata ?? null,
      deleted: false,
    };
    const key = this.relationshipKey(identity);
    state.relationships.set(key, relationship);
    state.identityLabels[key] = edge.type;
  }

  private taskToProjectedNode(
    task: ProjectedTaskRecord,
    identity: WorkItemChangeSetIdentity,
    projectId: ProjectId,
  ): ProjectedNode {
    return {
      identity,
      label: task.name,
      type: task.type,
      name: task.name,
      parent: task.parentTaskId
        ? { refType: 'existing', id: task.parentTaskId }
        : undefined,
      status: task.status,
      priority: task.priority ?? undefined,
      dueDate: task.dueDate?.toISOString() ?? null,
      assigneeId: task.assigneeId ?? null,
      tag: (task.tag ?? undefined) as ProjectedNode['tag'],
      serviceIds: new Set(
        task.serviceRelations.map((relation) => relation.serviceId).sort(),
      ),
      sections: task.sections
        .filter((section) => section.materializedMarkdown !== null)
        .map((section) => ({
          key: section.key,
          content: this.projectSectionContent(
            task.type,
            projectId,
            section.key,
            section.materializedMarkdown!,
          ),
        })),
      deleted: false,
    };
  }

  /**
   * Structured sections are persisted as JSON text but reviewed as values, so
   * every projected structured section holds the parsed value. Otherwise a
   * rehydrated graph never equals the reviewed graph it materialized.
   */
  private projectSectionContent(
    taskType: string,
    projectId: ProjectId,
    sectionKey: string,
    content: unknown,
  ): unknown {
    if (typeof content !== 'string') return content;
    // Deleting an orphan preserves its persisted sections without interpreting
    // them using a type definition that no longer exists.
    const definition = this.workItemTypeRegistry
      .getRulesForProject(taskType, projectId)
      ?.sectionDefinitions.find((section) => section.key === sectionKey);
    if (
      !definition ||
      resolveWorkItemSectionContentKind(definition) === 'markdown'
    ) {
      return content;
    }

    try {
      return JSON.parse(content) as unknown;
    } catch {
      // Preserve corrupt persisted content so normal projection validation can
      // report the section-specific issue instead of aborting hydration.
      return content;
    }
  }

  private applyOperations(
    operations: WorkItemChangeSetOperation[],
    projectId: ProjectId,
    state: ProjectionState,
  ): ApplyOutcome[] {
    const outcomes: ApplyOutcome[] = [];
    operations
      .map((operation, index) => ({ operation, index }))
      .sort((a, b) =>
        this.operationSortKey(a).localeCompare(this.operationSortKey(b)),
      )
      .forEach(({ operation, index }) => {
        this.logger.debug('Applying work-item change-set operation', {
          op: operation.op,
          originalIndex: index,
        });
        const workItemRef = operation.op.startsWith('relationship.')
          ? undefined
          : 'root' in operation
            ? operation.root
            : operation.ref;
        const node =
          workItemRef && state.nodes.get(this.identityKey(workItemRef));
        if (
          node &&
          operation.op !== 'workItem.delete' &&
          !this.workItemTypeRegistry.getRulesForProject(node.type, projectId)
        ) {
          outcomes.push({ kind: 'unavailableType', index, type: node.type });
          return;
        }
        switch (operation.op) {
          case 'workItem.create':
            this.applyCreate(operation, state);
            break;
          case 'workItem.update':
            this.applyUpdate(operation, state, outcomes);
            break;
          case 'workItem.delete':
            this.applyDelete(operation, state, outcomes);
            break;
          case 'section.replace':
            this.applySectionReplace(operation, projectId, state, outcomes);
            break;
          case 'section.clear':
            this.applySectionClear(operation, projectId, state, outcomes);
            break;
          case 'relationship.create':
            this.applyRelationshipCreate(operation, state);
            break;
          case 'relationship.update':
            this.applyRelationshipUpdate(operation, state, outcomes);
            break;
          case 'relationship.delete':
            this.applyRelationshipDelete(operation, state, outcomes);
            break;
          case 'layout.replace':
            this.applyLayoutReplace(operation, projectId, state, outcomes);
            break;
          case 'layout.clear':
            this.applyLayoutClear(operation, projectId, state, outcomes);
            break;
        }
      });
    return outcomes;
  }

  private operationSortKey(item: {
    operation: WorkItemChangeSetOperation;
    index: number;
  }): string {
    const order: Record<WorkItemChangeSetOperation['op'], number> = {
      'workItem.create': 0,
      'workItem.update': 1,
      'section.replace': 2,
      'section.clear': 3,
      'relationship.create': 4,
      'relationship.update': 5,
      'relationship.delete': 6,
      'layout.replace': 7,
      'layout.clear': 8,
      'workItem.delete': 9,
    };
    return `${order[item.operation.op]}:${this.operationIdentityKey(item.operation)}:${item.index}`;
  }

  private operationIdentityKey(operation: WorkItemChangeSetOperation): string {
    if ('ref' in operation) {
      const ref = operation.ref as
        | WorkItemChangeSetIdentity
        | WorkItemChangeSetRelationshipIdentity;
      return 'id' in ref || 'tempId' in ref
        ? `${ref.refType}:${'id' in ref ? ref.id : ref.tempId}`
        : operation.op;
    }
    if ('root' in operation) return this.identityKey(operation.root);
    return 'unknown';
  }

  private applyCreate(
    operation: WorkItemCreateOperation,
    state: ProjectionState,
  ): void {
    const key = this.identityKey(operation.ref);
    const node: ProjectedNode = {
      identity: operation.ref,
      label: operation.name,
      type: operation.type ?? 'STANDARD',
      name: operation.name,
      parent: operation.parent,
      status: operation.status,
      priority: operation.priority,
      dueDate: operation.dueDate ?? null,
      assigneeId: operation.assigneeId ?? null,
      tag: operation.tag,
      serviceIds: new Set(operation.serviceIds ?? []),
      sections: withDiagramDefaults(operation.type ?? 'STANDARD').map(
        (section) => ({ key: section.key, content: section.content }),
      ),
      deleted: false,
    };
    state.nodes.set(key, node);
    state.identityLabels[key] = operation.name;
  }

  private applyUpdate(
    operation: WorkItemUpdateOperation,
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const node = this.resolveNode(
      operation.ref,
      state,
      'workItem.update.ref',
      outcomes,
    );
    if (!node) return;
    if (operation.name !== undefined) {
      node.name = operation.name;
      node.label = operation.name;
      state.identityLabels[this.identityKey(operation.ref)] = operation.name;
    }
    if (Object.prototype.hasOwnProperty.call(operation, 'parent')) {
      node.parent = operation.parent ?? undefined;
    }
    if (operation.status !== undefined) node.status = operation.status;
    if (operation.priority !== undefined) node.priority = operation.priority;
    if (Object.prototype.hasOwnProperty.call(operation, 'dueDate')) {
      node.dueDate = operation.dueDate ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(operation, 'assigneeId')) {
      node.assigneeId = operation.assigneeId ?? null;
    }
    if (operation.tag !== undefined) node.tag = operation.tag;
    if (operation.serviceIds !== undefined) {
      node.serviceIds = new Set([...operation.serviceIds].sort());
    }
  }

  private applyDelete(
    operation: { ref: WorkItemChangeSetIdentity },
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const node = this.resolveNode(
      operation.ref,
      state,
      'workItem.delete.ref',
      outcomes,
    );
    if (node) node.deleted = true;
  }

  private applySectionReplace(
    operation: WorkItemSectionReplaceOperation,
    projectId: ProjectId,
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const node = this.resolveNode(
      operation.ref,
      state,
      'section.replace.ref',
      outcomes,
    );
    if (!node) return;
    const sections = new Map(
      node.sections.map((section) => [section.key, section]),
    );
    sections.set(operation.key, {
      key: operation.key,
      content: this.projectSectionContent(
        node.type,
        projectId,
        operation.key,
        operation.content,
      ),
    });
    node.sections = this.sortedSections([...sections.values()]);
  }

  private applySectionClear(
    operation: WorkItemSectionClearOperation,
    projectId: ProjectId,
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const node = this.resolveNode(
      operation.ref,
      state,
      'section.clear.ref',
      outcomes,
    );
    if (!node) return;
    if (
      !this.workItemTypeRegistry.getSectionDefinition(
        node.type,
        operation.key,
        projectId,
      )
    ) {
      outcomes.push({
        kind: 'unsupportedSectionClear',
        sectionKey: operation.key,
        type: node.type,
      });
      return;
    }
    if (node.type === 'FEATURE' && operation.key === 'requirements') {
      outcomes.push({ kind: 'requirementsSectionClear' });
      return;
    }
    const sections = new Map(
      node.sections.map((section) => [section.key, section]),
    );
    sections.delete(operation.key);
    node.sections = this.sortedSections([...sections.values()]);
  }

  private applyRelationshipCreate(
    operation: WorkItemRelationshipCreateOperation,
    state: ProjectionState,
  ): void {
    const key = this.relationshipKey(operation.ref);
    state.relationships.set(key, {
      identity: operation.ref,
      label: operation.edgeType,
      source: operation.source,
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      target: operation.target,
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      edgeType: operation.edgeType,
      category: operation.category,
      direction:
        'direction' in operation
          ? (operation.direction ?? undefined)
          : undefined,
      predicate:
        'predicate' in operation ? (operation.predicate ?? null) : null,
      reasoning: operation.reasoning ?? null,
      metadata: operation.metadata ?? null,
      deleted: false,
    });
    state.identityLabels[key] = operation.edgeType;
  }

  private applyRelationshipUpdate(
    operation: WorkItemRelationshipUpdateOperation,
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const edge = this.resolveRelationship(
      operation.ref,
      state,
      'relationship.update.ref',
      outcomes,
    );
    if (!edge) return;
    if (operation.source) {
      edge.source = operation.source;
      edge.sourceEntityType = AgentEdgeEndpointEntityType.Task;
    }
    if (operation.target) {
      edge.target = operation.target;
      edge.targetEntityType = AgentEdgeEndpointEntityType.Task;
    }
    if (operation.edgeType) {
      edge.edgeType = operation.edgeType;
      edge.label = operation.edgeType;
      state.identityLabels[this.relationshipKey(operation.ref)] =
        operation.edgeType;
    }
    if (operation.category !== undefined) edge.category = operation.category;
    if (Object.prototype.hasOwnProperty.call(operation, 'direction')) {
      edge.direction = operation.direction ?? undefined;
    }
    if (Object.prototype.hasOwnProperty.call(operation, 'predicate')) {
      edge.predicate = operation.predicate ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(operation, 'reasoning')) {
      edge.reasoning = operation.reasoning ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(operation, 'metadata')) {
      edge.metadata = operation.metadata ?? null;
    }
  }

  private applyRelationshipDelete(
    operation: WorkItemRelationshipDeleteOperation,
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const edge = this.resolveRelationship(
      operation.ref,
      state,
      'relationship.delete.ref',
      outcomes,
    );
    if (edge) edge.deleted = true;
  }

  private applyLayoutReplace(
    operation: WorkItemLayoutReplaceOperation,
    projectId: ProjectId,
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const root = this.resolveNode(
      operation.root,
      state,
      'layout.replace.root',
      outcomes,
    );
    if (!root) return;
    if (
      this.workItemTypeRegistry.getGraphCapability(root.type, projectId)?.layout
        .sectionKey !== operation.sectionKey
    ) {
      outcomes.push({
        kind: 'invalidLayoutSection',
        sectionKey: operation.sectionKey,
        type: root.type,
      });
      return;
    }
    const layout = {
      schemaVersion: 'work-item-graph-layout.v1',
      nodes: operation.entries.map((entry) => ({
        node:
          entry.node.refType === 'existing'
            ? {
                kind: 'persistedWorkItem' as const,
                workItemId: entry.node.id,
              }
            : {
                kind: 'temporaryWorkItem' as const,
                temporaryRef: entry.node.tempId,
              },
        position: entry.position,
      })),
    } satisfies WorkItemGraphLayoutValue;
    const sections = new Map(
      root.sections.map((section) => [section.key, section]),
    );
    sections.set(operation.sectionKey, {
      key: operation.sectionKey,
      content: layout,
    });
    root.sections = this.sortedSections([...sections.values()]);
    const rootKey = this.identityKey(operation.root);
    state.layoutEntries.set(
      rootKey,
      new Set(operation.entries.map((entry) => this.identityKey(entry.node))),
    );
  }

  private applyLayoutClear(
    operation: WorkItemLayoutClearOperation,
    projectId: ProjectId,
    state: ProjectionState,
    outcomes: ApplyOutcome[],
  ): void {
    const root = this.resolveNode(
      operation.root,
      state,
      'layout.clear.root',
      outcomes,
    );
    if (!root) return;
    if (
      this.workItemTypeRegistry.getGraphCapability(root.type, projectId)?.layout
        .sectionKey !== operation.sectionKey
    ) {
      outcomes.push({
        kind: 'invalidLayoutSection',
        sectionKey: operation.sectionKey,
        type: root.type,
      });
      return;
    }
    const sections = new Map(
      root.sections.map((section) => [section.key, section]),
    );
    sections.delete(operation.sectionKey);
    root.sections = this.sortedSections([...sections.values()]);
    state.deletedLayoutRoots.add(this.identityKey(operation.root));
    state.layoutEntries.delete(this.identityKey(operation.root));
  }

  private normalizeResponse(
    root: WorkItemChangeSetIdentity,
    state: ProjectionState,
  ): ProjectedWorkItemChangeSetResponse {
    const rootKey = this.identityKey(root);
    const rootNode =
      state.nodes.get(rootKey) ??
      ({
        identity: root,
        label: state.identityLabels[rootKey] ?? rootKey,
        type: 'STANDARD',
        name: state.identityLabels[rootKey] ?? rootKey,
        sections: [],
        deleted: true,
      } satisfies ProjectedNode);
    const children = [...state.nodes.values()]
      .filter((node) => this.identityKey(node.parent) === rootKey)
      .sort((a, b) =>
        this.identityKey(a.identity).localeCompare(
          this.identityKey(b.identity),
        ),
      );
    const incidentRelationships = [...state.relationships.values()]
      .filter(
        (relationship) =>
          this.identityKey(relationship.source) === rootKey ||
          this.identityKey(relationship.target) === rootKey ||
          children.some(
            (child) =>
              this.identityKey(child.identity) ===
                this.identityKey(relationship.source) ||
              this.identityKey(child.identity) ===
                this.identityKey(relationship.target),
          ),
      )
      .sort((a, b) =>
        this.relationshipKey(a.identity).localeCompare(
          this.relationshipKey(b.identity),
        ),
      );

    return {
      valid: state.issues.length === 0,
      projectedRoot: rootNode,
      children,
      sections: rootNode.sections,
      incidentRelationships,
      identityLabels: this.sortedLabels(state.identityLabels),
      issues: [...state.issues].sort((a, b) => a.field.localeCompare(b.field)),
      warnings: [...state.warnings].sort((a, b) =>
        a.field.localeCompare(b.field),
      ),
    };
  }

  /** Records an unresolved operation ref for `op.refResolves` instead of reporting it. */
  private resolveNode(
    identity: WorkItemChangeSetIdentity,
    state: ProjectionState,
    field: string,
    outcomes: ApplyOutcome[],
  ): ProjectedNode | null {
    const key = this.identityKey(identity);
    const node = state.nodes.get(key);
    if (!node) outcomes.push({ kind: 'unresolvedNode', field, key });
    return node ?? null;
  }

  private resolveRelationship(
    identity: WorkItemChangeSetRelationshipIdentity,
    state: ProjectionState,
    field: string,
    outcomes: ApplyOutcome[],
  ): ProjectedEdge | null {
    const key = this.relationshipKey(identity);
    const edge = state.relationships.get(key);
    if (!edge) outcomes.push({ kind: 'unresolvedRelationship', field, key });
    return edge ?? null;
  }

  private addIssue(
    state: ProjectionState,
    ...finding: Parameters<RuleContext['addIssue']>
  ): void {
    state.issues.push(this.toFinding(...finding));
  }

  private addWarning(
    state: ProjectionState,
    ...finding: Parameters<RuleContext['addWarning']>
  ): void {
    state.warnings.push(this.toFinding(...finding));
  }

  private toFinding(
    field: string,
    code: string,
    reason: string,
    layer: IssueLayer,
    suggestion?: string,
    metadata?: Record<string, unknown>,
  ): ProjectedWorkItemChangeSetIssue {
    return {
      field,
      code,
      reason,
      layer,
      ...(suggestion ? { suggestion } : {}),
      ...(metadata ? { metadata } : {}),
    };
  }

  private identityKey(identity: WorkItemChangeSetIdentity | undefined): string {
    return nodeKey(identity);
  }

  private relationshipKey(
    identity: WorkItemChangeSetRelationshipIdentity,
  ): string {
    return relKey(identity);
  }

  private sortedSections(
    sections: ProjectedWorkItemSection[],
  ): ProjectedWorkItemSection[] {
    return [...sections].sort((a, b) => a.key.localeCompare(b.key));
  }

  private sortedLabels(labels: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}
