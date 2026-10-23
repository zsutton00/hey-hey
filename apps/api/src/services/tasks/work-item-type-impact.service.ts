import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import type { WorkItemTypeCascadeImpactDto } from '../../generated/model/workItemTypeCascadeImpactDto';
import type { WorkItemTypeSummaryDto } from '../../generated/model/workItemTypeSummaryDto';
import type { WorkItemTypeSectionContentImpactDto } from '../../generated/model/workItemTypeSectionContentImpactDto';
import type { WorkItemTypeTrackingLinkRevocationImpactDto } from '../../generated/model/workItemTypeTrackingLinkRevocationImpactDto';
import { AgentEdgeType } from '../../generated/graphs/model/agentEdgeType';
import { AgentEdgesService } from '../../generated/graphs/api/agentEdges.service';
import type { DeleteIncidentAgentEdgesResponse } from '../../generated/graphs/model/deleteIncidentAgentEdgesResponse';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId, ProjectId } from '../../types';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import { GoalTracksService } from './goal-tracks.service';

const CASCADE_IMPACT_EDGE_TYPES = Object.values(AgentEdgeType).filter(
  (type) => type !== AgentEdgeType.ProposedTogether,
);

export type CascadeIncidentEdgeDeletion = {
  deletedEdgeCount: number;
};

@Injectable()
export class WorkItemTypeImpactService {
  private readonly logger = new Logger(WorkItemTypeImpactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly goalTracksService: GoalTracksService,
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly agentEdgesService: AgentEdgesService,
  ) {}

  async enumerateCascadeWorkItemIdsInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    typeKey: string,
  ): Promise<string[]> {
    const items = await tx.task.findMany({
      where: { organizationId, projectId, type: typeKey },
      select: { id: true },
    });
    return [...new Set(items.map(({ id }) => id))].sort();
  }

  async deleteCascadeIncidentEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    workItemIds: readonly string[],
    userToken: string | null,
  ): Promise<CascadeIncidentEdgeDeletion> {
    const nodeIds = new Set(workItemIds);
    if (nodeIds.size === 0) {
      this.logger.log('Skipping cascade graph cleanup with no work items', {
        organizationId,
        projectId,
      });
      return { deletedEdgeCount: 0 };
    }
    if (!userToken) {
      throw new BadRequestException(
        'Authenticated user or service authorization is required to delete cascade incident edges.',
      );
    }

    this.logger.log('Starting cascade graph cleanup', {
      organizationId,
      projectId,
      workItemCount: nodeIds.size,
    });
    let response: { data: DeleteIncidentAgentEdgesResponse };
    try {
      response = await firstValueFrom<
        { data: DeleteIncidentAgentEdgesResponse }
      >(
        this.agentEdgesService.deleteIncidentAgentEdges(
          organizationId,
          projectId,
          { nodeIds },
          {
            config: {
              headers: {
                Authorization: `Bearer ${userToken}`,
                'X-API-Auth': `Bearer ${userToken}`,
                'Content-Type': 'application/json',
              },
              transformRequest: [stringifyJsonWithSets],
            },
          },
        ),
      );
    } catch (deleteError) {
      if (isNotFoundGraphError(deleteError)) {
        this.logger.warn('Cascade graph cleanup found no remaining edges', {
          organizationId,
          projectId,
          workItemCount: nodeIds.size,
        });
        return { deletedEdgeCount: 0 };
      }
      throw deleteError;
    }
    this.logger.log('Completed cascade graph cleanup', {
      organizationId,
      projectId,
      workItemCount: nodeIds.size,
      deletedEdgeCount: response.data.deletedEdgeCount,
    });
    return {
      deletedEdgeCount: response.data.deletedEdgeCount,
    }
  }

  async countCascadeImpact(
    organizationId: OrganizationId,
    projectId: ProjectId,
    typeKey: string,
    userToken: string | null,
  ): Promise<WorkItemTypeCascadeImpactDto> {
    if (!userToken) {
      throw new BadRequestException(
        'An authenticated user token is required to count cascade impact.',
      );
    }

    const items = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        projectId,
        type: typeKey,
      },
      select: { id: true },
    });
    const itemIds = new Set(items.map(({ id }) => id));
    if (itemIds.size === 0) {
      return {
        itemCount: 0,
        edgeCount: 0,
      } satisfies WorkItemTypeCascadeImpactDto;
    }

    const edges = await this.agentEdgeClient.findIncident(
      organizationId,
      projectId,
      {
        nodeIds: itemIds,
        types: new Set(CASCADE_IMPACT_EDGE_TYPES),
      },
      userToken,
    );

    return {
      itemCount: itemIds.size,
      edgeCount: new Set(edges.map(({ id }) => id)).size,
    } satisfies WorkItemTypeCascadeImpactDto;
  }

  async countSectionContentImpact(
    organizationId: OrganizationId,
    projectId: ProjectId,
    typeKey: string,
    removedSectionKeys: readonly string[],
  ): Promise<WorkItemTypeSectionContentImpactDto> {
    const uniqueKeys = [...new Set(removedSectionKeys)].sort();
    const details = await Promise.all(
      uniqueKeys.map(async (sectionKey) => ({
        sectionKey,
        affectedItemCount: await this.prisma.db.taskSection.count({
          where: {
            key: sectionKey,
            ...sectionHasContentWhere(),
            task: {
              organizationId,
              projectId,
              type: typeKey,
              archivedAt: null,
            },
          },
        }),
      })),
    );

    const totalAffectedItemCount =
      uniqueKeys.length === 0
        ? 0
        : await this.prisma.db.task.count({
            where: {
              organizationId,
              projectId,
              type: typeKey,
              archivedAt: null,
              sections: {
                some: {
                  key: { in: uniqueKeys },
                  ...sectionHasContentWhere(),
                },
              },
            },
          });

    return {
      totalAffectedItemCount,
      sections: details,
    };
  }

  async countTrackingLinkRevocationImpact(
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetTypeKey: string,
    revokedSourceTypeKeys: readonly string[],
    userToken: string | null,
  ): Promise<WorkItemTypeTrackingLinkRevocationImpactDto> {
    return this.goalTracksService.countRevokedTrackingSourceImpact(
      organizationId,
      projectId,
      targetTypeKey,
      revokedSourceTypeKeys,
      userToken,
    );
  }

  deriveRevokedTrackingSourceTypeKeys(
    existing: WorkItemTypeSummaryDto,
    proposed: WorkItemTypeDefinitionDto,
  ): readonly string[] {
    return removedKeys(
      existing.definition.tracking?.allowedSourceTaskTypes ?? [],
      proposed.tracking?.allowedSourceTaskTypes ?? [],
    );
  }

  async countTrackingLinkRevocationImpactForDefinitionEdit(
    organizationId: OrganizationId,
    projectId: ProjectId,
    existing: WorkItemTypeSummaryDto,
    proposed: WorkItemTypeDefinitionDto,
    userToken: string | null,
  ): Promise<WorkItemTypeTrackingLinkRevocationImpactDto> {
    return this.countTrackingLinkRevocationImpact(
      organizationId,
      projectId,
      existing.definition.key,
      this.deriveRevokedTrackingSourceTypeKeys(existing, proposed),
      userToken,
    );
  }

  async clearRevokedTrackingLinksForAcceptedEdit(
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetTypeKey: string,
    revokedSourceTypeKeys: readonly string[],
    userToken: string | null,
  ): Promise<{ clearedLinkCount: number }> {
    const result = await this.goalTracksService.clearRevokedTrackingSourceEdges(
      organizationId,
      projectId,
      targetTypeKey,
      revokedSourceTypeKeys,
      userToken,
    );
    return { clearedLinkCount: result.clearedLinkCount };
  }
}

const stringifyJsonWithSets = (data: unknown): string =>
  JSON.stringify(data, (_key, value) =>
    value instanceof Set ? Array.from(value) : value,
  );

function isNotFoundGraphError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  return candidate.status === 404 || candidate.response?.status === 404;
}

function sectionHasContentWhere() {
  return {
    AND: [
      { materializedMarkdown: { not: null } },
      { materializedMarkdown: { not: '' } },
    ],
  };
}

function removedKeys(
  current: readonly string[],
  proposed: readonly string[],
): string[] {
  return [...new Set(current.filter((key) => !proposed.includes(key)))].sort();
}
