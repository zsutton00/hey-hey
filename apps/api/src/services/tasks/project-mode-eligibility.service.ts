import { BadRequestException, Injectable } from '@nestjs/common';
import { RelationshipType } from 'src/generated/graphs/model/relationshipType';
import { WorkItemTypeLifecycleStatus } from 'src/generated';
import type { ProjectModeSettings } from 'src/generated';
import { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import { PROJECT_MODE_TYPE_KEY } from './project-mode-files.validator';
import {
  resolveProjectModeEligibleWorkItemTypeKeys,
  type ProjectModeEligibleTypeSource,
} from './project-mode-eligible-types';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';

export interface ProjectModeEligibilityResult {
  applicableWorkItemTypeKeys: string[];
  applicableWorkItemTypeSource: ProjectModeEligibleTypeSource;
  focalFeatureIds: string[];
}

type TaskHierarchyRow = {
  id: string;
  type: string;
  parentTaskId: string | null;
};

/**
 * Owns the launch policy shared by the picker and the authoritative capture
 * boundary. Work-item type eligibility comes from the selected MODE's own
 * settings list (legacy type-level guidance when absent). Structural ownership
 * is intentionally read from the task tree, while only outbound
 * MODE -> FEATURE DEPENDS_ON edges restrict applicability.
 */
@Injectable()
export class ProjectModeEligibilityService {
  constructor(
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  async assertEligible(params: {
    dbClient: Pick<AnyTransactionClient, 'task'>;
    organizationId: OrganizationId;
    projectId: ProjectId;
    modeId: string;
    /** The selected MODE's validated settings section, or null when absent. */
    modeSettings: ProjectModeSettings | null;
    focalTaskId: string;
    userToken: string | null;
  }): Promise<ProjectModeEligibilityResult> {
    const modeDefinition = this.workItemTypeRegistry.getDefinition(
      params.projectId,
      PROJECT_MODE_TYPE_KEY,
    );
    if (
      !modeDefinition ||
      modeDefinition.status !== WorkItemTypeLifecycleStatus.Active
    ) {
      throw new BadRequestException(
        'The MODE work-item type is not active in the Agent Session project',
      );
    }

    const { keys: applicableWorkItemTypeKeys, source } =
      resolveProjectModeEligibleWorkItemTypeKeys({
        modeTypeDefinition: modeDefinition.definition,
        settings: params.modeSettings,
      });

    const focalWorkItem = await params.dbClient.task.findFirst({
      where: {
        id: params.focalTaskId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        archivedAt: null,
      },
      select: { id: true, type: true, parentTaskId: true },
    });
    if (!focalWorkItem) {
      throw new BadRequestException(
        'The selected project MODE is not eligible for this work item',
      );
    }

    const focalTypeDefinition = this.workItemTypeRegistry.getDefinition(
      params.projectId,
      focalWorkItem.type,
    );
    if (
      !applicableWorkItemTypeKeys.includes(focalWorkItem.type) ||
      !focalTypeDefinition ||
      focalTypeDefinition.status !== WorkItemTypeLifecycleStatus.Active
    ) {
      throw new BadRequestException(
        'The selected project MODE is not eligible for this work-item type',
      );
    }

    const hierarchyRows = await params.dbClient.task.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        archivedAt: null,
      },
      select: { id: true, type: true, parentTaskId: true },
    });
    const rowsById = new Map<string, TaskHierarchyRow>(
      hierarchyRows.map((row: TaskHierarchyRow) => [row.id, row]),
    );
    const focalFeatureIds = this.resolveFocalFeatureIds(
      focalWorkItem,
      rowsById,
    );

    if (!params.userToken) {
      throw new BadRequestException(
        'The selected project MODE cannot be validated because Feature applicability data is unavailable',
      );
    }

    const edgeResponse = await this.agentEdgeClient.list(
      params.organizationId,
      params.projectId,
      {
        type: RelationshipType.DependsOn,
        sourceNodeId: params.modeId,
        page: 0,
        size: 100,
      },
      params.userToken,
    );
    if (
      edgeResponse.page?.totalElements !== undefined &&
      edgeResponse.page.totalElements > (edgeResponse.content?.length ?? 0)
    ) {
      throw new BadRequestException(
        'The selected project MODE cannot be validated because Feature applicability data is incomplete',
      );
    }

    const featureDependencyIds = new Set(
      (edgeResponse.content ?? [])
        .filter(
          (edge) =>
            edge.type === RelationshipType.DependsOn &&
            edge.sourceNodeId === params.modeId &&
            (edge.targetNodeType === 'FEATURE' ||
              rowsById.get(edge.targetNodeId)?.type === 'FEATURE'),
        )
        .map((edge) => edge.targetNodeId),
    );

    if (
      featureDependencyIds.size > 0 &&
      !Array.from(featureDependencyIds).some((id) =>
        focalFeatureIds.includes(id),
      )
    ) {
      throw new BadRequestException(
        'The selected project MODE is not eligible for this Feature',
      );
    }

    return {
      applicableWorkItemTypeKeys,
      applicableWorkItemTypeSource: source,
      focalFeatureIds,
    };
  }

  private resolveFocalFeatureIds(
    focalWorkItem: TaskHierarchyRow,
    rowsById: ReadonlyMap<string, TaskHierarchyRow>,
  ): string[] {
    const featureIds: string[] = [];
    const visited = new Set<string>();
    let current: TaskHierarchyRow | undefined = focalWorkItem;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.type === 'FEATURE') featureIds.push(current.id);
      current = current.parentTaskId
        ? rowsById.get(current.parentTaskId)
        : undefined;
    }
    return featureIds;
  }
}
