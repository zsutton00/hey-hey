import { BadRequestException, Injectable } from '@nestjs/common';
import { OrganizationId, ProjectId } from 'src/types';
import {
  UnifiedSearchPlanLineageBoost,
  UnifiedSearchPlanLineageMode,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';

const DEPENDENCY_BOOST_DELTA = 0.3;

@Injectable()
export class PlanLineageBoostService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveBoostDeltas(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    planLineage: UnifiedSearchPlanLineageBoost;
  }): Promise<Map<string, number>> {
    const { organizationId, projectId, planLineage } = params;
    if (planLineage.mode !== UnifiedSearchPlanLineageMode.WorkItemDependencies)
      throw new BadRequestException('Unsupported Plan lineage search mode');
    if (Boolean(planLineage.taskId) === Boolean(planLineage.designDocId)) {
      throw new BadRequestException(
        'Exactly one taskId or designDocId is required',
      );
    }
    const plan = await this.prisma.db.task.findFirst({
      where: {
        id: planLineage.planId,
        organizationId,
        projectId,
        type: 'PLAN',
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!plan)
      throw new BadRequestException('Plan work item not found in project');
    const stages = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        projectId,
        parentTaskId: plan.id,
        type: 'PLAN_STAGE',
        archivedAt: null,
      },
      select: { id: true },
    });
    const tasks = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        projectId,
        parentTaskId: { in: stages.map((stage) => stage.id) },
        archivedAt: null,
      },
      select: { id: true },
    });
    const ids: string[] = tasks.map((task) => task.id);
    let anchorId = planLineage.taskId;
    if (planLineage.designDocId) {
      const doc = await this.prisma.db.designDoc.findFirst({
        where: {
          id: planLineage.designDocId,
          organizationId,
          projectId,
          parentEntityType: 'TASK',
        },
        select: { parentEntityId: true },
      });
      anchorId = doc?.parentEntityId ?? undefined;
    }
    if (!anchorId || !ids.includes(anchorId)) {
      throw new BadRequestException(
        'Search anchor is not a work item in this Plan',
      );
    }
    const dependencies = await this.prisma.db.taskDependency.findMany({
      where: { dependentTaskId: { in: ids }, dependencyTaskId: { in: ids } },
      select: { dependentTaskId: true, dependencyTaskId: true },
    });
    const blockers = new Map<string, string[]>();
    for (const edge of dependencies) {
      const parents = blockers.get(edge.dependentTaskId) ?? [];
      parents.push(edge.dependencyTaskId);
      blockers.set(edge.dependentTaskId, parents);
    }
    const deltas = new Map<string, number>();
    for (const id of blockers.get(anchorId) ?? [])
      deltas.set(id, DEPENDENCY_BOOST_DELTA);
    const upstream = new Set<string>();
    const pending = [...(blockers.get(anchorId) ?? [])];
    while (pending.length) {
      const id = pending.pop()!;
      if (id === anchorId)
        throw new BadRequestException('Plan dependency graph contains a cycle');
      if (upstream.has(id)) continue;
      upstream.add(id);
      pending.push(...(blockers.get(id) ?? []));
    }
    const roots = [...upstream].filter((id) => !blockers.get(id)?.length);
    const docs = await this.prisma.db.designDoc.findMany({
      where: {
        organizationId,
        projectId,
        parentEntityType: 'TASK',
        parentEntityId: { in: roots },
      },
      select: { id: true },
    });
    for (const doc of docs) deltas.set(doc.id, DEPENDENCY_BOOST_DELTA);
    return deltas;
  }
}
