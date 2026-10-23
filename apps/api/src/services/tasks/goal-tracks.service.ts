import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WorkStatus } from '@prisma/client';

import {
  AgentEdgeResponseDto,
  AttachToGoalDto,
  AttachToGoalResponseDto,
  DetachFromGoalDto,
  DetachFromGoalResponseDto,
  EntityType,
  OpenItemRef,
  TrackedEntitySnapshot,
  WorkItemTypeTrackingLinkRevocationImpactDto,
} from 'src/generated';
import type { AgentEdge, CreateAgentEdgeDto } from 'src/generated/graphs';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentSessionId, OrganizationId, ProjectId, TaskId } from 'src/types';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';
import { v5 as uuidv5 } from 'uuid';

/**
 * Identity of a tracking link. A link is unique per (sourceType, source,
 * target) — the key records which kind of item is doing the tracking, so
 * a future non-GOAL source tracking the same target is a distinct link.
 */
export interface TrackingLinkKey {
  readonly sourceType: WorkItemTypeKey;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}

export interface RevokedTrackingSourceEdge {
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourceTypeKey: string;
}

export interface ClearRevokedTrackingSourceEdgesResult {
  readonly clearedLinkCount: number;
  readonly clearedEdges: readonly RevokedTrackingSourceEdge[];
}

export function computeTrackingLinkKey(key: TrackingLinkKey): string {
  return `${key.sourceType}:${key.sourceNodeId}:${key.targetNodeId}`;
}

@Injectable()
export class GoalTracksService {
  private readonly logger = new Logger(GoalTracksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  /** Promotion uses the same active, target-owned policy as attachToGoal. */
  async eligibleGoalMembers(
    organizationId: OrganizationId,
    projectId: ProjectId,
    members: OpenItemRef[],
  ): Promise<OpenItemRef[]> {
    const sourceType = WORK_ITEM_TYPE_KEYS.Goal;
    if (!this.workItemTypeRegistry.isTrackingSource(sourceType, projectId)) {
      throw new BadRequestException('GOAL is not an eligible tracking source.');
    }
    const targets = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        projectId,
        archivedAt: null,
        id: {
          in: members
            .filter((member) => member.entityType === EntityType.Task)
            .map((member) => member.entityId),
        },
      },
      select: { id: true, type: true },
    });
    const eligible = new Set(
      targets
        .filter((target) =>
          this.workItemTypeRegistry.isTrackingSourceAllowed(
            target.type,
            EntityType.Task,
            sourceType,
            projectId,
          ),
        )
        .map((target) => target.id as string),
    );
    return members.filter(
      (member) =>
        member.entityType === EntityType.Task && eligible.has(member.entityId),
    );
  }

  async attachToGoal(
    organizationId: OrganizationId,
    projectId: ProjectId,
    goalId: TaskId,
    dto: AttachToGoalDto,
    createdBySessionId: AgentSessionId | null,
    userToken: string | null,
  ): Promise<AttachToGoalResponseDto> {
    this.logger.log('attachToGoal called', {
      organizationId,
      projectId,
      goalId,
      targetEntityId: dto.targetEntityId,
      targetEntityType: dto.targetEntityType,
      origin: createdBySessionId ? 'agent-session' : 'user',
    });

    const token = this.requireToken(userToken);

    const source = await this.loadTrackingSource(organizationId, goalId);
    const target = await this.loadTargetSnapshot(
      organizationId,
      source.type,
      dto.targetEntityId,
      dto.targetEntityType,
      source.projectId,
    );

    const existing = await this.findExistingTracksEdge(
      organizationId,
      projectId,
      {
        sourceType: source.type,
        sourceNodeId: goalId,
        targetNodeId: dto.targetEntityId,
      },
      token,
    );

    if (existing) {
      this.logger.log('attachToGoal idempotent re-attach', {
        goalId,
        targetEntityId: dto.targetEntityId,
        edgeId: existing.id,
      });
      return {
        edge: this.toEdgeResponse(existing),
        target,
        created: false,
      };
    }

    const createDto: CreateAgentEdgeDto = {
      id: uuidv5(
        computeTrackingLinkKey({
          sourceType: source.type,
          sourceNodeId: goalId,
          targetNodeId: dto.targetEntityId,
        }),
        uuidv5.URL,
      ),
      sourceNodeId: goalId,
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetNodeId: dto.targetEntityId,
      targetEntityType: this.toGraphEndpointEntityType(dto.targetEntityType),
      type: 'TRACKS',
      reasoning: 'Goal tracks this entity',
      createdBySessionId,
    } satisfies CreateAgentEdgeDto;

    const created = await this.agentEdgeClient.create(
      organizationId,
      projectId,
      createDto,
      token,
    );

    this.logger.log('attachToGoal created edge', {
      goalId,
      targetEntityId: dto.targetEntityId,
      edgeId: created.id,
    });

    return {
      edge: this.toEdgeResponse(created),
      target,
      created: true,
    };
  }

  async detachFromGoal(
    organizationId: OrganizationId,
    projectId: ProjectId,
    goalId: TaskId,
    dto: DetachFromGoalDto,
    userToken: string | null,
  ): Promise<DetachFromGoalResponseDto> {
    this.logger.log('detachFromGoal called', {
      organizationId,
      projectId,
      goalId,
      targetEntityId: dto.targetEntityId,
      targetEntityType: dto.targetEntityType,
    });

    const token = this.requireToken(userToken);

    const source = await this.loadTrackingSource(organizationId, goalId);

    const existing = await this.findExistingTracksEdge(
      organizationId,
      projectId,
      {
        sourceType: source.type,
        sourceNodeId: goalId,
        targetNodeId: dto.targetEntityId,
      },
      token,
    );

    if (!existing) {
      this.logger.log('detachFromGoal idempotent miss', {
        goalId,
        targetEntityId: dto.targetEntityId,
      });
      return {
        deleted: false,
        targetEntityId: dto.targetEntityId,
        targetEntityType: dto.targetEntityType,
      };
    }

    await this.agentEdgeClient.delete(
      organizationId,
      projectId,
      existing.id,
      token,
    );

    this.logger.log('detachFromGoal deleted edge', {
      goalId,
      targetEntityId: dto.targetEntityId,
      edgeId: existing.id,
    });

    return {
      deleted: true,
      targetEntityId: dto.targetEntityId,
      targetEntityType: dto.targetEntityType,
    };
  }

  async countRevokedTrackingSourceImpact(
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetType: string,
    revokedSourceTypeKeys: readonly string[],
    userToken: string | null,
  ): Promise<WorkItemTypeTrackingLinkRevocationImpactDto> {
    const uniqueSourceTypes = [...new Set(revokedSourceTypeKeys)].sort();
    if (uniqueSourceTypes.length === 0) {
      return { totalAffectedLinkCount: 0, sources: [] };
    }
    const token = this.requireToken(userToken);

    for (const sourceType of uniqueSourceTypes) {
      if (
        !this.workItemTypeRegistry.isTrackingSourceAllowed(
          targetType,
          EntityType.Task,
          sourceType,
          projectId,
        )
      ) {
        throw new BadRequestException(
          `Source task type ${sourceType} is not currently allowed to track ${targetType}.`,
        );
      }
    }

    const revokedEdges = await this.enumerateRevokedTrackingSourceEdges(
      organizationId,
      projectId,
      targetType,
      uniqueSourceTypes,
      token,
    );
    const counts = new Map(uniqueSourceTypes.map((type) => [type, 0]));
    for (const edge of revokedEdges) {
      counts.set(edge.sourceTypeKey, (counts.get(edge.sourceTypeKey) ?? 0) + 1);
    }

    return {
      totalAffectedLinkCount: [...counts.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
      sources: uniqueSourceTypes.map((sourceTypeKey) => ({
        sourceTypeKey,
        affectedLinkCount: counts.get(sourceTypeKey) ?? 0,
      })),
    };
  }

  async clearRevokedTrackingSourceEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetType: string,
    revokedSourceTypeKeys: readonly string[],
    userToken: string | null,
  ): Promise<ClearRevokedTrackingSourceEdgesResult> {
    const uniqueSourceTypes = [...new Set(revokedSourceTypeKeys)].sort();
    if (uniqueSourceTypes.length === 0) {
      return { clearedLinkCount: 0, clearedEdges: [] };
    }
    const token = this.requireToken(userToken);

    const revokedEdges = await this.enumerateRevokedTrackingSourceEdges(
      organizationId,
      projectId,
      targetType,
      uniqueSourceTypes,
      token,
    );

    for (const edge of revokedEdges) {
      await this.deleteRevokedTracksEdgeIfPresent(
        organizationId,
        projectId,
        edge.edgeId,
        token,
      );
    }

    return {
      clearedLinkCount: revokedEdges.length,
      clearedEdges: revokedEdges,
    };
  }

  private requireToken(userToken: string | null): string {
    if (!userToken) {
      throw new UnauthorizedException(
        'Authentication token required for goal track operations.',
      );
    }
    return userToken;
  }

  private async loadTrackingSource(
    organizationId: OrganizationId,
    goalId: TaskId,
  ): Promise<{ id: string; type: WorkItemTypeKey; projectId: string }> {
    const source = await this.prisma.db.task.findFirst({
      where: { id: goalId, organizationId, archivedAt: null },
      select: { id: true, type: true, projectId: true },
    });

    if (!source) {
      throw new NotFoundException(`Goal with ID ${goalId} not found.`);
    }
    const sourceType = source.type as WorkItemTypeKey;
    if (
      !this.workItemTypeRegistry.isTrackingSource(sourceType, source.projectId)
    ) {
      throw new BadRequestException(
        `Task type ${sourceType} is not an eligible tracking source. ` +
          'attach_to_goal/detach_from_goal require a source task whose type ' +
          `may own tracking links. Eligible source types: ${this.workItemTypeRegistry
            .getTrackingSourceTypes(source.projectId)
            .join(' / ')}.`,
      );
    }
    return { id: source.id, type: sourceType, projectId: source.projectId };
  }

  private async loadTargetSnapshot(
    organizationId: OrganizationId,
    sourceType: WorkItemTypeKey,
    targetEntityId: string,
    targetEntityType: EntityType,
    projectId: string,
  ): Promise<TrackedEntitySnapshot> {
    if (targetEntityType !== EntityType.Task) {
      throw new BadRequestException(
        `Target entity type ${targetEntityType} is not supported by the ` +
          'target-owned work-item tracking policy.',
      );
    }

    if (targetEntityType === EntityType.Task) {
      const task = await this.prisma.db.task.findFirst({
        where: {
          id: targetEntityId,
          organizationId,
          projectId,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          dueDate: true,
        },
      });
      if (!task) {
        throw new NotFoundException(
          `Target task with ID ${targetEntityId} not found.`,
        );
      }
      if (
        !this.workItemTypeRegistry.isTrackingSourceAllowed(
          task.type as WorkItemTypeKey,
          EntityType.Task,
          sourceType,
          projectId,
        )
      ) {
        const rules = this.workItemTypeRegistry.getTrackingRules(
          task.type,
          projectId,
        );
        throw new BadRequestException(
          `Target task type ${task.type} is not allowed for TRACKS edges ` +
            `from a ${sourceType} source. Permitted source task types: ` +
            `${rules.allowedSourceTaskTypes.join(' / ')}.`,
        );
      }
      return {
        targetEntityId: task.id,
        targetEntityType: 'TASK',
        title: task.name,
        status: task.status as WorkStatus,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      };
    }

    throw new BadRequestException(
      `Unsupported TRACKS target ${targetEntityId}.`,
    );
  }

  private async findExistingTracksEdge(
    organizationId: OrganizationId,
    projectId: ProjectId,
    key: TrackingLinkKey,
    userToken: string,
  ): Promise<AgentEdge | null> {
    const response = await this.agentEdgeClient.list(
      organizationId,
      projectId,
      { type: 'TRACKS', sourceNodeId: key.sourceNodeId },
      userToken,
    );
    // Every listed edge shares key.sourceNodeId, so each candidate's
    // source type is the type already loaded for that node.
    const wanted = computeTrackingLinkKey(key);
    return (
      response.content?.find(
        (edge) =>
          computeTrackingLinkKey({
            sourceType: key.sourceType,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
          }) === wanted,
      ) ?? null
    );
  }

  private async enumerateRevokedTrackingSourceEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetType: string,
    revokedSourceTypeKeys: readonly string[],
    userToken: string,
  ): Promise<RevokedTrackingSourceEdge[]> {
    const edges = await this.listAllTracksEdges(
      organizationId,
      projectId,
      userToken,
    );
    if (edges.length === 0) {
      return [];
    }

    const sourceIds = [
      ...new Set(edges.map((edge) => edge.sourceNodeId)),
    ].sort();
    const targetIds = [
      ...new Set(edges.map((edge) => edge.targetNodeId)),
    ].sort();
    const [sources, targets] = await Promise.all([
      this.prisma.db.task.findMany({
        where: {
          id: { in: sourceIds },
          organizationId,
          projectId,
          type: { in: [...revokedSourceTypeKeys] },
          archivedAt: null,
        },
        select: { id: true, type: true },
      }),
      this.prisma.db.task.findMany({
        where: {
          id: { in: targetIds },
          organizationId,
          projectId,
          type: targetType,
          archivedAt: null,
        },
        select: { id: true, type: true },
      }),
    ]);

    const sourceTypesById = new Map(
      sources.map((source) => [source.id, source.type]),
    );
    const targetSet = new Set(targets.map((target) => target.id));

    return edges
      .flatMap((edge): RevokedTrackingSourceEdge[] => {
        if (edge.type !== 'TRACKS') return [];
        const sourceType = sourceTypesById.get(edge.sourceNodeId as TaskId);
        if (!sourceType || !targetSet.has(edge.targetNodeId as TaskId))
          return [];
        return [
          {
            edgeId: edge.id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            sourceTypeKey: sourceType,
          },
        ];
      })
      .sort(compareRevokedTrackingSourceEdges);
  }

  private async deleteRevokedTracksEdgeIfPresent(
    organizationId: OrganizationId,
    projectId: ProjectId,
    edgeId: string,
    userToken: string,
  ): Promise<void> {
    try {
      await this.agentEdgeClient.delete(
        organizationId,
        projectId,
        edgeId,
        userToken,
        'Clearing invalid TRACKS edge after work-item type tracking source revocation.',
      );
    } catch (error) {
      if (isNotFoundLikeError(error)) {
        this.logger.log('Revoked TRACKS edge was already absent', { edgeId });
        return;
      }
      throw error;
    }
  }

  private async listAllTracksEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userToken: string,
  ): Promise<AgentEdge[]> {
    const pageSize = 100;
    const edges: AgentEdge[] = [];
    for (let page = 0; ; page += 1) {
      const response = await this.agentEdgeClient.list(
        organizationId,
        projectId,
        { type: 'TRACKS', page, size: pageSize },
        userToken,
      );
      const content = response.content ?? [];
      edges.push(...content);
      if (content.length < pageSize) {
        return edges;
      }
    }
  }

  private toEdgeResponse(edge: AgentEdge): AgentEdgeResponseDto {
    return {
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      sourceNodeName: edge.sourceNodeName ?? null,
      targetNodeId: edge.targetNodeId,
      targetNodeName: edge.targetNodeName ?? null,
      type: edge.type as AgentEdgeResponseDto['type'],
      reasoning: edge.reasoning,
      createdBySessionId: edge.createdBySessionId ?? null,
      lastModifiedBySessionId: edge.lastModifiedBySessionId ?? null,
      createdAt: edge.createdAt,
      updatedAt: edge.updatedAt,
    };
  }

  private toGraphEndpointEntityType(
    entityType: EntityType,
  ): AgentEdgeEndpointEntityType {
    switch (entityType) {
      case 'TASK':
        return AgentEdgeEndpointEntityType.Task;
      case 'DESIGN_DOC':
        return AgentEdgeEndpointEntityType.DesignDoc;
      default:
        throw new BadRequestException(
          `Entity type ${entityType} cannot be tracked by a goal.`,
        );
    }
  }
}

function compareRevokedTrackingSourceEdges(
  left: RevokedTrackingSourceEdge,
  right: RevokedTrackingSourceEdge,
): number {
  return (
    left.sourceNodeId.localeCompare(right.sourceNodeId) ||
    left.sourceTypeKey.localeCompare(right.sourceTypeKey) ||
    left.targetNodeId.localeCompare(right.targetNodeId) ||
    left.edgeId.localeCompare(right.edgeId)
  );
}

function isNotFoundLikeError(error: unknown): boolean {
  if (error instanceof NotFoundException) return true;
  const maybeResponse = error as {
    response?: { status?: unknown };
    status?: unknown;
  };
  return maybeResponse.response?.status === 404 || maybeResponse.status === 404;
}
