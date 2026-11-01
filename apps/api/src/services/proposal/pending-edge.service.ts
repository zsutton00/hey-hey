import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  ProposalEdgeType as PrismaProposalEdgeType,
  ProposalStatus as PrismaProposalStatus,
  TargetEntityType as PrismaTargetEntityType,
} from '@prisma/client';
import type { Proposal } from '@prisma/client';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import { AgentEdgeClientService } from 'src/services/agent-edge-client.service';
import type {
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from 'src/types';
import type { ProposalEdgeDeclaration } from 'src/generated/model/proposalEdgeDeclaration';
import { ProposalEdgeTargetType } from 'src/generated/model/proposalEdgeTargetType';
import { ProposalEdgeEndpointMode } from 'src/generated/model/proposalEdgeEndpointMode';
import type { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import type { AgentEdgeCategory } from 'src/generated/graphs/model/agentEdgeCategory';
import type { AgentEdgeDirection } from 'src/generated/graphs/model/agentEdgeDirection';
import type { CreateAgentEdgeDto } from 'src/generated/graphs/model/createAgentEdgeDto';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import { normalizeMentionTypeAlias } from 'src/services/mentions/mention-type-aliases';
import { WorkStatus } from 'src/generated';
import {
  TaskService,
  type TaskUpdatePostCommit,
} from 'src/services/tasks/task.service';
import { v4 as uuidv4 } from 'uuid';
import { performance } from 'node:perf_hooks';
import {
  toRequirementCitationEdgeDto,
  type RequirementCitationEdge,
} from '../tasks/feature-requirement-citation-edges';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from '../service-token-factory';
export {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from '../service-token-factory';

const ALIAS_TO_EDGE_TARGET_TYPE: Record<string, ProposalEdgeTargetType> = {
  task: ProposalEdgeTargetType.Task,
  'design-doc': ProposalEdgeTargetType.DesignDoc,
  proposal: ProposalEdgeTargetType.Proposal,
};

/** Well-known UUID for edges created by the proposal edge materialization system. */
export const SYSTEM_EDGE_SESSION_ID = '00000000-0000-0000-0000-edgema7e1a1e';

/**
 * An edge that has been resolved (both sides have entity IDs)
 * and is ready to be materialized in the graph service.
 */
export interface MaterializableEdge {
  /** Stable caller-supplied identity for retry-safe graph publication. */
  id?: string;
  sourceEntityId: string;
  sourceEntityType: AgentEdgeEndpointEntityType;
  targetEntityId: string;
  targetEntityType: AgentEdgeEndpointEntityType;
  edgeType: string;
  category?: AgentEdgeCategory;
  direction?: AgentEdgeDirection;
  predicate?: string;
  actionLabel?: string;
  description?: string;
}

export interface MaterializedProposalEdge {
  edgeId: string;
  sourceEntityId: string;
  sourceEntityType: AgentEdgeEndpointEntityType;
  targetEntityId: string;
  targetEntityType: AgentEdgeEndpointEntityType;
  edgeType: string;
}

function graphEndpointTypeForProposalTarget(
  targetEntityType: PrismaTargetEntityType | string,
): AgentEdgeEndpointEntityType {
  switch (targetEntityType) {
    case PrismaTargetEntityType.TASK:
      return AgentEdgeEndpointEntityType.Task;
    case PrismaTargetEntityType.DESIGN_DOC:
      return AgentEdgeEndpointEntityType.DesignDoc;
    case PrismaTargetEntityType.CONVERSATION:
      return AgentEdgeEndpointEntityType.Conversation;
    default:
      throw new BadRequestException(
        `Proposal target entity type ${targetEntityType} cannot be used as a graph edge endpoint.`,
      );
  }
}

function graphEndpointTypeForProposalEdgeTarget(
  targetEntityType: ProposalEdgeTargetType,
): AgentEdgeEndpointEntityType {
  if (targetEntityType === ProposalEdgeTargetType.Task) {
    return AgentEdgeEndpointEntityType.Task;
  }
  if (targetEntityType === ProposalEdgeTargetType.DesignDoc) {
    return AgentEdgeEndpointEntityType.DesignDoc;
  }
  if (targetEntityType === ProposalEdgeTargetType.Proposal) {
    return AgentEdgeEndpointEntityType.Proposal;
  }
  throw new BadRequestException(
    `Proposal edge target entity type ${targetEntityType} cannot be used as a graph edge endpoint.`,
  );
}
export interface PendingEdgeTaskPostCommit {
  taskId: TaskId;
  postCommit: TaskUpdatePostCommit;
}

export interface PendingEdgeProcessingOptions {
  onTaskPostCommit?: (postCommit: PendingEdgeTaskPostCommit) => void;
}

@Injectable()
export class PendingEdgeService {
  private readonly logger = new Logger(PendingEdgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly taskService: TaskService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  /** Store a change-set proposal's deferred entity edge with its handoff
   * checkpoint after publication. */
  async storeDeferredEntityEdgeAfterChangeSetPublication(
    tx: AnyTransactionClient,
    params: {
      organizationId: string;
      projectId: string;
      sourceProposalId: string;
      sourceEntityId: string;
      targetProposalId: string;
      edgeType: PrismaProposalEdgeType;
      description?: string;
    },
  ): Promise<void> {
    await tx.pendingProposalEdge.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        sourceProposalId: params.sourceProposalId,
        sourceEntityId: params.sourceEntityId,
        targetProposalId: params.targetProposalId,
        edgeType: params.edgeType,
        description: params.description ?? null,
      },
    });
  }

  /** Resolve deferred entity edges from published change sets when their
   * target proposal is approved. Keep the pending row until Graph confirms
   * the link so a retry can finish an interrupted sweep. */
  async resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal(
    proposal: Proposal,
    resultingEntityId: string,
  ): Promise<void> {
    const pending = await this.prisma.db.pendingProposalEdge.findMany({
      where: { targetProposalId: proposal.id },
    });
    for (const edge of pending) {
      const source = await this.prisma.db.proposal.findUniqueOrThrow({
        where: { id: edge.sourceProposalId },
      });
      let materializable: MaterializableEdge = {
        id: edge.id,
        sourceEntityId: edge.sourceEntityId,
        sourceEntityType: graphEndpointTypeForProposalTarget(
          source.targetEntityType,
        ),
        targetEntityId: resultingEntityId,
        targetEntityType: graphEndpointTypeForProposalTarget(
          proposal.targetEntityType,
        ),
        edgeType: edge.edgeType,
        description: edge.description ?? undefined,
      };
      if (edge.edgeType === 'SUPERSEDES') {
        const sourceIsPredecessor = this.proposalSetsStatusToSuperseded(source);
        const predecessorId = sourceIsPredecessor
          ? edge.sourceEntityId
          : resultingEntityId;
        const successorId = sourceIsPredecessor
          ? resultingEntityId
          : edge.sourceEntityId;
        if (!sourceIsPredecessor) {
          const postCommits: PendingEdgeTaskPostCommit[] = [];
          await this.prisma.db.$transaction(async (tx) => {
            await this.materializeSupersedesTransition(
              tx,
              proposal,
              predecessorId,
              successorId,
              edge.description ?? undefined,
              [],
              {
                onTaskPostCommit: (postCommit) => postCommits.push(postCommit),
              },
            );
          });
          for (const postCommit of postCommits) {
            await this.taskService.runUpdatePostCommit(
              proposal.organizationId as OrganizationId,
              postCommit.taskId,
              postCommit.postCommit,
            );
          }
        }
        materializable = {
          ...materializable,
          sourceEntityId: predecessorId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: successorId,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
        };
      }
      const token = this.tokenFactory(
        proposal.organizationId as OrganizationId,
        proposal.projectId as ProjectId,
      );
      const existing = await this.agentEdgeClient
        .get(
          proposal.organizationId as OrganizationId,
          proposal.projectId as ProjectId,
          edge.id,
          token,
        )
        .catch((error: unknown) => {
          if (
            (error as { response?: { status?: number } }).response?.status ===
            404
          )
            return null;
          throw error;
        });
      if (existing) {
        if (
          existing.sourceNodeId !== materializable.sourceEntityId ||
          existing.targetNodeId !== materializable.targetEntityId ||
          existing.type !== materializable.edgeType
        ) {
          throw new InternalServerErrorException(
            'Existing deferred edge identity has different endpoints or type.',
          );
        }
      } else {
        await this.materializeEdges(
          proposal.organizationId as OrganizationId,
          proposal.projectId as ProjectId,
          [materializable],
          source.conversationId,
        );
      }
      await this.prisma.db.pendingProposalEdge.deleteMany({
        where: { id: edge.id },
      });
    }
  }

  /**
   * Process declared edges when a proposal is approved.
   *
   * For each declared edge on the proposal:
   * - If the target proposal is already APPROVED with a resolved entity ID,
   *   queue the edge for post-commit materialization.
   * - Otherwise, store it as a pending edge for later resolution.
   *
   * Also checks if any existing pending edges reference this proposal as
   * their target — those can now be resolved too.
   *
   * Returns a list of edges ready for materialization (to be executed
   * after the transaction commits).
   */
  async processDeclaredEdges(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
    options?: PendingEdgeProcessingOptions,
  ): Promise<MaterializableEdge[]> {
    const edges = proposal.edges as unknown as ProposalEdgeDeclaration[] | null;
    const materializableEdges: MaterializableEdge[] = [];

    if (edges && edges.length > 0) {
      this.logger.log('Processing declared edges for approved proposal', {
        proposalId: proposal.id,
        edgeCount: edges.length,
      });

      for (const edge of edges) {
        if (edge.endpointMode === ProposalEdgeEndpointMode.Proposal) continue;
        await this.processSingleEdge(
          tx,
          proposal,
          resultingEntityId,
          edge,
          materializableEdges,
          options,
        );
      }
    }

    // Resolve any existing pending edges that target this proposal
    const resolvedFromPending = await this.resolveEdgesTargeting(
      tx,
      proposal,
      resultingEntityId,
      options,
    );
    materializableEdges.push(...resolvedFromPending);

    return materializableEdges;
  }

  private async processSingleEdge(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
    edge: ProposalEdgeDeclaration,
    materializableEdges: MaterializableEdge[],
    options?: PendingEdgeProcessingOptions,
  ): Promise<void> {
    const normalizedWire = normalizeMentionTypeAlias(edge.targetEntityType);
    const canonicalType = ALIAS_TO_EDGE_TARGET_TYPE[normalizedWire];
    if (!canonicalType) {
      this.logger.warn(
        'Declared edge has unknown target entity type; skipping',
        {
          proposalId: proposal.id,
          targetEntityId: edge.targetEntityId,
          targetEntityType: edge.targetEntityType,
          edgeType: edge.edgeType,
        },
      );
      return;
    }

    const canonicalEdge: ProposalEdgeDeclaration =
      canonicalType === edge.targetEntityType
        ? edge
        : { ...edge, targetEntityType: canonicalType };

    switch (canonicalType) {
      case ProposalEdgeTargetType.Task:
      case ProposalEdgeTargetType.DesignDoc:
        await this.processEntityEdge(
          tx,
          proposal,
          resultingEntityId,
          canonicalEdge,
          materializableEdges,
          options,
        );
        return;
      case ProposalEdgeTargetType.Proposal:
        await this.processProposalEdge(
          tx,
          proposal,
          resultingEntityId,
          canonicalEdge,
          materializableEdges,
          options,
        );
        return;
    }
  }

  private async processEntityEdge(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
    edge: ProposalEdgeDeclaration,
    materializableEdges: MaterializableEdge[],
    options?: PendingEdgeProcessingOptions,
  ): Promise<void> {
    if (this.isSuccessorAuthoredSupersedes(proposal, edge)) {
      await this.processSupersedesEntityEdge(
        tx,
        proposal,
        resultingEntityId,
        edge,
        materializableEdges,
        options,
      );
      return;
    }

    const exists = await this.entityExists(
      tx,
      edge.targetEntityType,
      edge.targetEntityId,
      proposal.organizationId,
      proposal.projectId,
    );

    if (!exists) {
      this.logger.warn('Declared edge references unknown entity; skipping', {
        proposalId: proposal.id,
        targetEntityId: edge.targetEntityId,
        targetEntityType: edge.targetEntityType,
        edgeType: edge.edgeType,
      });
      return;
    }

    if (edge.edgeType === 'TRACKS') {
      const tracksEdge: MaterializableEdge = {
        id: uuidv4(),
        sourceEntityId: edge.targetEntityId,
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetEntityId: resultingEntityId,
        targetEntityType: graphEndpointTypeForProposalTarget(
          proposal.targetEntityType,
        ),
        edgeType: edge.edgeType,
        description: edge.description,
      };
      materializableEdges.push(tracksEdge);

      this.logger.log(
        'Compound TRACKS attachment queued for post-commit publication',
        {
          proposalId: proposal.id,
          sourceEntityId: edge.targetEntityId,
          targetEntityId: resultingEntityId,
        },
      );
      return;
    }

    materializableEdges.push({
      id: uuidv4(),
      sourceEntityId: resultingEntityId,
      sourceEntityType: graphEndpointTypeForProposalTarget(
        proposal.targetEntityType,
      ),
      targetEntityId: edge.targetEntityId,
      targetEntityType: graphEndpointTypeForProposalEdgeTarget(
        edge.targetEntityType,
      ),
      edgeType: edge.edgeType,
      description: edge.description,
    });

    this.logger.log(
      'Edge to existing entity queued for post-commit publication',
      {
        proposalId: proposal.id,
        targetEntityId: edge.targetEntityId,
        targetEntityType: edge.targetEntityType,
        edgeType: edge.edgeType,
      },
    );
  }

  private async processProposalEdge(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
    edge: ProposalEdgeDeclaration,
    materializableEdges: MaterializableEdge[],
    options?: PendingEdgeProcessingOptions,
  ): Promise<void> {
    const targetProposal = await tx.proposal.findFirst({
      where: { id: edge.targetEntityId },
      select: {
        id: true,
        status: true,
        targetEntityId: true,
        targetEntityType: true,
      },
    });

    if (!targetProposal) {
      this.logger.warn('Declared edge references unknown proposal; skipping', {
        proposalId: proposal.id,
        targetEntityId: edge.targetEntityId,
        edgeType: edge.edgeType,
      });
      return;
    }

    if (
      this.isSuccessorAuthoredSupersedes(proposal, edge) &&
      targetProposal.targetEntityType !== 'TASK'
    ) {
      throw new BadRequestException(
        'A declared SUPERSEDES relationship must target a predecessor work item; ' +
          `proposal ${targetProposal.id} materializes ${targetProposal.targetEntityType}.`,
      );
    }

    if (
      targetProposal.status === ('APPROVED' as PrismaProposalStatus) &&
      targetProposal.targetEntityId
    ) {
      if (this.isSuccessorAuthoredSupersedes(proposal, edge)) {
        await this.materializeSupersedesTransition(
          tx,
          proposal,
          targetProposal.targetEntityId,
          resultingEntityId,
          edge.description,
          materializableEdges,
          options,
        );
        return;
      }

      materializableEdges.push({
        id: uuidv4(),
        sourceEntityId: resultingEntityId,
        sourceEntityType: graphEndpointTypeForProposalTarget(
          proposal.targetEntityType,
        ),
        targetEntityId: targetProposal.targetEntityId,
        targetEntityType: graphEndpointTypeForProposalTarget(
          targetProposal.targetEntityType,
        ),
        edgeType: edge.edgeType,
        description: edge.description,
      });

      this.logger.log(
        'Edge to approved proposal queued for post-commit publication',
        {
          proposalId: proposal.id,
          targetEntityId: edge.targetEntityId,
          resolvedEntityId: targetProposal.targetEntityId,
          edgeType: edge.edgeType,
        },
      );
      return;
    }

    await tx.pendingProposalEdge.create({
      data: {
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        sourceProposalId: proposal.id,
        sourceEntityId: resultingEntityId,
        targetProposalId: edge.targetEntityId,
        edgeType: edge.edgeType as PrismaProposalEdgeType,
        description: edge.description ?? null,
      },
    });

    this.logger.log('Stored pending edge for unapproved proposal', {
      proposalId: proposal.id,
      targetEntityId: edge.targetEntityId,
      edgeType: edge.edgeType,
    });
  }

  private async entityExists(
    tx: AnyTransactionClient,
    entityType: ProposalEdgeTargetType,
    entityId: string,
    organizationId: string,
    projectId: string,
  ): Promise<boolean> {
    if (entityType === ProposalEdgeTargetType.Task) {
      const task = await tx.task.findFirst({
        where: { id: entityId, organizationId, projectId },
        select: { id: true },
      });
      return !!task;
    }

    if (entityType === ProposalEdgeTargetType.DesignDoc) {
      const doc = await tx.designDoc.findFirst({
        where: { id: entityId, organizationId },
        select: { id: true },
      });
      return !!doc;
    }

    return false;
  }

  private async processSupersedesEntityEdge(
    tx: AnyTransactionClient,
    proposal: Proposal,
    successorTaskId: string,
    edge: ProposalEdgeDeclaration,
    materializableEdges: MaterializableEdge[],
    options?: PendingEdgeProcessingOptions,
  ): Promise<void> {
    if (edge.targetEntityType !== ProposalEdgeTargetType.Task) {
      throw new BadRequestException(
        'A declared SUPERSEDES relationship must target a predecessor work item.',
      );
    }

    await this.materializeSupersedesTransition(
      tx,
      proposal,
      edge.targetEntityId,
      successorTaskId,
      edge.description,
      materializableEdges,
      options,
    );
  }

  private async materializeSupersedesTransition(
    tx: AnyTransactionClient,
    proposal: Proposal,
    predecessorTaskId: string,
    successorTaskId: string,
    description: string | undefined,
    materializableEdges: MaterializableEdge[],
    options?: PendingEdgeProcessingOptions,
  ): Promise<void> {
    if (proposal.targetEntityType !== 'TASK') {
      throw new BadRequestException(
        'A declared SUPERSEDES relationship can only be materialized from a work-item proposal.',
      );
    }
    if (predecessorTaskId === successorTaskId) {
      throw new BadRequestException('A task cannot supersede itself.');
    }

    const predecessor = await tx.task.findFirst({
      where: {
        id: predecessorTaskId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        type: true,
        initiativeId: true,
      },
    });
    if (!predecessor) {
      throw new BadRequestException(
        `Declared SUPERSEDES predecessor task ${predecessorTaskId} was not found.`,
      );
    }
    if (predecessor.status === WorkStatus.Superseded) {
      this.logger.log(
        'Declared SUPERSEDES predecessor already superseded; skipping idempotent materialization',
        {
          proposalId: proposal.id,
          predecessorTaskId,
          successorTaskId,
        },
      );
      return;
    }

    const successor = await tx.task.findFirst({
      where: {
        id: successorTaskId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
    if (!successor) {
      throw new BadRequestException(
        `Declared SUPERSEDES successor task ${successorTaskId} was not found.`,
      );
    }

    const edgeDescription =
      description ??
      `Task "${predecessor.name}" is superseded by "${successor.name}".`;
    materializableEdges.push({
      id: uuidv4(),
      sourceEntityId: predecessorTaskId,
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetEntityId: successorTaskId,
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      edgeType: 'SUPERSEDES',
      description: edgeDescription,
    });
    const updateResult = await this.taskService.updateInTransaction(
      tx,
      proposal.organizationId as OrganizationId,
      predecessor.initiativeId as InitiativeId | null,
      predecessorTaskId as TaskId,
      { status: WorkStatus.Superseded },
      proposal.requestorId as UserId,
    );
    options?.onTaskPostCommit?.({
      taskId: predecessorTaskId as TaskId,
      postCommit: updateResult.postCommit,
    });

    this.logger.log(
      'Declared SUPERSEDES transition queued for post-commit publication',
      {
        proposalId: proposal.id,
        predecessorTaskId,
        successorTaskId,
      },
    );
  }

  private isSuccessorAuthoredSupersedes(
    proposal: Proposal,
    edge: ProposalEdgeDeclaration,
  ): boolean {
    if (edge.edgeType !== 'SUPERSEDES') {
      return false;
    }
    return !this.proposalSetsStatusToSuperseded(proposal);
  }

  private proposalSetsStatusToSuperseded(
    proposal: Pick<Proposal, 'updates'>,
  ): boolean {
    const status =
      proposal.updates !== null && typeof proposal.updates === 'object'
        ? (proposal.updates as Record<string, unknown>).status
        : undefined;
    return status === WorkStatus.Superseded;
  }

  /**
   * Find pending edges that reference the given proposal as their target.
   * Now that the target proposal is approved with an entity ID, these
   * edges can be materialized.
   *
   * Deletes the pending edge records and returns them as materializable.
   */
  private async resolveEdgesTargeting(
    tx: AnyTransactionClient,
    proposal: Proposal,
    targetEntityId: string,
    options?: PendingEdgeProcessingOptions,
  ): Promise<MaterializableEdge[]> {
    const proposalId = proposal.id;
    const pendingEdges = await tx.pendingProposalEdge.findMany({
      where: { targetProposalId: proposalId },
    });

    if (pendingEdges.length === 0) {
      return [];
    }

    this.logger.log('Resolving pending edges targeting approved proposal', {
      proposalId,
      targetEntityId,
      count: pendingEdges.length,
    });

    const materializable: MaterializableEdge[] = [];
    for (const pendingEdge of pendingEdges) {
      if (pendingEdge.edgeType === 'SUPERSEDES') {
        const sourceProposal = await tx.proposal.findFirst({
          where: { id: pendingEdge.sourceProposalId },
          select: { id: true, targetEntityType: true, updates: true },
        });
        if (
          sourceProposal &&
          this.proposalSetsStatusToSuperseded(sourceProposal)
        ) {
          materializable.push({
            id: uuidv4(),
            sourceEntityId: pendingEdge.sourceEntityId,
            sourceEntityType: graphEndpointTypeForProposalTarget(
              sourceProposal.targetEntityType,
            ),
            targetEntityId,
            targetEntityType: graphEndpointTypeForProposalTarget(
              proposal.targetEntityType,
            ),
            edgeType: pendingEdge.edgeType,
            description: pendingEdge.description ?? undefined,
          });
          continue;
        }
        await this.materializeSupersedesTransition(
          tx,
          proposal,
          targetEntityId,
          pendingEdge.sourceEntityId,
          pendingEdge.description ?? undefined,
          materializable,
          options,
        );
        continue;
      }
      const sourceProposal = await tx.proposal.findFirst({
        where: { id: pendingEdge.sourceProposalId },
        select: { id: true, targetEntityType: true },
      });
      if (!sourceProposal) {
        throw new BadRequestException(
          `Pending proposal edge ${pendingEdge.id} references missing source proposal ${pendingEdge.sourceProposalId}.`,
        );
      }
      materializable.push({
        id: uuidv4(),
        sourceEntityId: pendingEdge.sourceEntityId,
        sourceEntityType: graphEndpointTypeForProposalTarget(
          sourceProposal.targetEntityType,
        ),
        targetEntityId,
        targetEntityType: graphEndpointTypeForProposalTarget(
          proposal.targetEntityType,
        ),
        edgeType: pendingEdge.edgeType,
        description: pendingEdge.description ?? undefined,
      });
    }

    await tx.pendingProposalEdge.deleteMany({
      where: { targetProposalId: proposalId },
    });

    return materializable;
  }

  /**
   * Remove all pending edges that reference a proposal (as source or
   * target). Called when a proposal is rejected to prevent orphans.
   */
  async cleanupForProposal(
    tx: AnyTransactionClient,
    proposalId: string,
  ): Promise<void> {
    const deleted = await tx.pendingProposalEdge.deleteMany({
      where: {
        OR: [
          { sourceProposalId: proposalId },
          { targetProposalId: proposalId },
        ],
      },
    });

    if (deleted.count > 0) {
      this.logger.log('Cleaned up pending edges for rejected proposal', {
        proposalId,
        deletedCount: deleted.count,
      });
    }
  }

  /**
   * Materialize resolved edges in the graph service.
   * Called after the transaction commits to avoid HTTP calls inside a tx.
   *
   * Resolves the agent session from the proposal's conversationId for
   * edge provenance. Falls back to a static system UUID if no session
   * is found.
   */
  /** Citation writes must succeed before the requirements transaction commits. */
  async materializeRequirementCitationEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    edges: RequirementCitationEdge[],
    onCreated: (edge: MaterializedProposalEdge) => void,
  ): Promise<void> {
    if (edges.length === 0) return;
    const results = await this.agentEdgeClient.createBatch(
      organizationId,
      projectId,
      edges.map(toRequirementCitationEdgeDto),
      this.tokenFactory(organizationId, projectId),
    );
    for (const result of results) {
      if (!result.success) continue;
      const edge = edges[result.index]!;
      onCreated({
        edgeId: edge.id,
        sourceEntityId: edge.featureId,
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetEntityId: edge.entityId,
        targetEntityType: edge.entityType,
        edgeType: 'DEPENDS_ON',
      });
    }
    const failures = results.filter((result) => !result.success);
    if (failures.length > 0) {
      throw new InternalServerErrorException(
        `Failed to create ${failures.length} requirement citation edge(s) in graph service.`,
      );
    }
  }

  async materializeEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    edges: MaterializableEdge[],
    conversationId?: string | null,
  ): Promise<void> {
    if (edges.length === 0) {
      return;
    }
    const totalStartedAt = performance.now();

    const token = this.tokenFactory(organizationId, projectId);
    const sessionId = await this.resolveAgentSessionId(conversationId);

    this.logger.log('Materializing edges in graph service', {
      organizationId,
      projectId,
      edgeCount: edges.length,
      agentSessionId: sessionId,
    });

    const failures: Array<{
      sourceEntityId: string;
      targetEntityId: string;
      edgeType: string;
      error: string;
    }> = [];

    let results;
    const graphStartedAt = performance.now();
    let graphRequestElapsedMs: number;
    try {
      results = await this.agentEdgeClient.createBatch(
        organizationId,
        projectId,
        edges.map((edge) => this.toCreateAgentEdgeDto(edge, sessionId)),
        token,
      );
    } catch (error) {
      results = edges.map((_edge, index) => ({
        index,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      graphRequestElapsedMs = performance.now() - graphStartedAt;
    }

    for (const result of results) {
      const edge = edges[result.index]!;
      if (result.success) {
        this.logger.log('Edge materialized', {
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          edgeType: edge.edgeType,
        });
      } else {
        this.logger.error('Failed to materialize edge', {
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          edgeType: edge.edgeType,
          error: result.error,
        });
        failures.push({
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          edgeType: edge.edgeType,
          error:
            result.error ?? 'Graph batch result omitted its failure error.',
        });
      }
    }

    if (failures.length > 0) {
      this.logger.error('Proposal edge materialization failed', {
        organizationId,
        projectId,
        failedEdgeCount: failures.length,
        failures,
      });
      this.logMaterializationTiming(
        edges.length,
        failures.length,
        graphRequestElapsedMs,
        performance.now() - totalStartedAt,
      );
      throw new InternalServerErrorException(
        `Failed to materialize ${failures.length} proposal edge(s) in graph service.`,
      );
    }
    this.logMaterializationTiming(
      edges.length,
      0,
      graphRequestElapsedMs,
      performance.now() - totalStartedAt,
    );
  }

  private logMaterializationTiming(
    edgeCount: number,
    failureCount: number,
    graphRequestElapsedMs: number,
    totalElapsedMs: number,
  ): void {
    this.logger.log('Proposal edge materialization timing', {
      edgeCount,
      failureCount,
      outcome:
        failureCount === 0
          ? 'success'
          : failureCount === edgeCount
            ? 'failure'
            : 'mixed',
      graphRequestCount: 1,
      graphTransactionCount: edgeCount,
      graphStatementCount: edgeCount * 2,
      graphRequestElapsedMs,
      checkpointPersistenceElapsedMs: 0,
      totalElapsedMs,
    });
  }

  async rollbackMaterializedEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    edges: MaterializedProposalEdge[],
    reason: string,
  ): Promise<void> {
    if (edges.length === 0) {
      return;
    }

    const token = this.tokenFactory(organizationId, projectId);
    for (const edge of edges) {
      try {
        await this.agentEdgeClient.delete(
          organizationId,
          projectId,
          edge.edgeId,
          token,
          reason,
        );
      } catch (error) {
        this.logger.error('Failed to roll back materialized proposal edge', {
          edgeId: edge.edgeId,
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          edgeType: edge.edgeType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Delete edges by stable identity after enactment commits. Unlike rollback,
   * a failure propagates so a durable publication checkpoint stays retryable;
   * deleting an already-absent identity succeeds.
   */
  async deleteEdgesById(
    organizationId: OrganizationId,
    projectId: ProjectId,
    edgeIds: readonly string[],
    reason: string,
  ): Promise<void> {
    if (edgeIds.length === 0) {
      return;
    }
    const token = this.tokenFactory(organizationId, projectId);
    this.logger.log('Deleting edges by identity', {
      organizationId,
      projectId,
      edgeCount: edgeIds.length,
    });
    for (const edgeId of edgeIds) {
      await this.agentEdgeClient.delete(
        organizationId,
        projectId,
        edgeId,
        token,
        reason,
      );
    }
  }

  private toCreateAgentEdgeDto(
    edge: MaterializableEdge,
    sessionId: string,
  ): CreateAgentEdgeDto {
    return {
      ...(edge.id ? { id: edge.id } : {}),
      sourceNodeId: edge.sourceEntityId,
      sourceEntityType: edge.sourceEntityType,
      targetNodeId: edge.targetEntityId,
      targetEntityType: edge.targetEntityType,
      type: edge.edgeType as AgentEdgeType,
      ...(edge.category ? { category: edge.category } : {}),
      ...(edge.direction ? { direction: edge.direction } : {}),
      ...(edge.predicate !== undefined ? { predicate: edge.predicate } : {}),
      ...(edge.actionLabel !== undefined
        ? { actionLabel: edge.actionLabel }
        : {}),
      reasoning:
        edge.description ?? `Declared via proposal edge (${edge.edgeType})`,
      createdBySessionId: sessionId,
    } satisfies CreateAgentEdgeDto;
  }

  private async resolveAgentSessionId(
    conversationId?: string | null,
  ): Promise<string> {
    if (!conversationId) {
      return SYSTEM_EDGE_SESSION_ID;
    }

    try {
      const session = await this.prisma.db.agentSession.findFirst({
        where: { conversationId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });

      if (session) {
        return session.id;
      }
    } catch (error) {
      this.logger.warn('Failed to resolve agent session for edge provenance', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return SYSTEM_EDGE_SESSION_ID;
  }
}
