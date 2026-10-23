import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EntityType,
  type ProjectReportPlacementEntry,
  type ProjectReportSubject,
  type ProjectReportSubjectPlacement,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { projectReportSubjectKey } from './project-report-activity.service';

const MAX_ANCESTOR_DEPTH = 50;
const MAX_PLACEMENT_FEATURES = 50;

type ChainRow = {
  seed_id: string;
  id: string;
  name: string;
  type: string;
  distance: number | bigint;
};

/**
 * Resolves where each report subject sits in the project's work: its nearest
 * Plan and its Feature lineage, nearest first. One recursive walk covers every
 * subject in a batch, so placement cost does not grow with round trips.
 */
@Injectable()
export class ProjectReportPlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  async resolve(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    subjects: readonly ProjectReportSubject[];
  }): Promise<Map<string, ProjectReportSubjectPlacement>> {
    const anchors = await this.resolveTaskAnchors(input);
    const chains = await this.readChains(input, [...new Set(anchors.values())]);
    const placements = new Map<string, ProjectReportSubjectPlacement>();
    for (const subject of input.subjects) {
      const key = projectReportSubjectKey(subject);
      const anchor = anchors.get(key);
      const chain = anchor ? (chains.get(anchor) ?? []) : [];
      const plan = chain.find((row) => row.type === 'PLAN');
      placements.set(key, {
        ...(plan ? { plan: toEntry(plan) } : {}),
        features: chain
          .filter((row) =>
            this.workItemTypeRegistry.isHierarchyNode(
              row.type,
              input.projectId,
            ),
          )
          .slice(0, MAX_PLACEMENT_FEATURES)
          .map(toEntry),
      });
    }
    return placements;
  }

  /** Design docs anchor on their parent task; agent sessions on their task. */
  private async resolveTaskAnchors(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    subjects: readonly ProjectReportSubject[];
  }): Promise<Map<string, string>> {
    const anchors = new Map<string, string>();
    const idsOf = (type: EntityType) =>
      input.subjects
        .filter((subject) => subject.entityType === type)
        .map((subject) => subject.entityId);
    for (const id of idsOf(EntityType.Task)) {
      anchors.set(
        projectReportSubjectKey({ entityType: EntityType.Task, entityId: id }),
        id,
      );
    }
    const designDocIds = idsOf(EntityType.DesignDoc);
    if (designDocIds.length > 0) {
      const documents = await this.prisma.db.designDoc.findMany({
        where: {
          id: { in: designDocIds },
          organizationId: input.organizationId,
          projectId: input.projectId,
          parentEntityType: 'TASK',
          parentEntityId: { not: null },
        },
        select: { id: true, parentEntityId: true },
      });
      for (const document of documents) {
        anchors.set(
          projectReportSubjectKey({
            entityType: EntityType.DesignDoc,
            entityId: document.id,
          }),
          document.parentEntityId!,
        );
      }
    }
    const sessionIds = idsOf(EntityType.AgentSession);
    if (sessionIds.length > 0) {
      const sessions = await this.prisma.db.agentSession.findMany({
        where: {
          id: { in: sessionIds },
          organizationId: input.organizationId,
          projectId: input.projectId,
          entityType: EntityType.Task,
          entityId: { not: null },
        },
        select: { id: true, entityId: true },
      });
      for (const session of sessions) {
        anchors.set(
          projectReportSubjectKey({
            entityType: EntityType.AgentSession,
            entityId: session.id,
          }),
          session.entityId!,
        );
      }
    }
    return anchors;
  }

  /**
   * Walks every anchor's parent chain in one query. Org/project scoping on the
   * seed and each recursive step keeps titles inside the request's project;
   * the depth guard bounds cyclic or pathologically deep chains.
   */
  private async readChains(
    input: { organizationId: OrganizationId; projectId: ProjectId },
    seedIds: readonly string[],
  ): Promise<Map<string, ChainRow[]>> {
    const chains = new Map<string, ChainRow[]>();
    if (seedIds.length === 0) return chains;
    const rows = await this.prisma.db.$queryRaw<ChainRow[]>`
      WITH RECURSIVE chain AS (
        SELECT id AS seed_id, id, name, type, parent_task_id, 0 AS distance
        FROM   tasks
        WHERE  id IN (${Prisma.join([...seedIds])})
          AND  organization_id = ${input.organizationId}
          AND  project_id = ${input.projectId}
        UNION ALL
        SELECT c.seed_id, t.id, t.name, t.type, t.parent_task_id, c.distance + 1
        FROM   tasks t
        JOIN   chain c ON t.id = c.parent_task_id
        WHERE  t.organization_id = ${input.organizationId}
          AND  t.project_id = ${input.projectId}
          AND  c.distance < ${MAX_ANCESTOR_DEPTH}
      )
      SELECT seed_id, id, name, type, distance
      FROM   chain
      ORDER BY seed_id, distance ASC
    `;
    for (const row of rows) {
      const chain = chains.get(row.seed_id) ?? [];
      chain.push(row);
      chains.set(row.seed_id, chain);
    }
    return chains;
  }
}

const toEntry = (row: ChainRow): ProjectReportPlacementEntry => ({
  id: row.id,
  title: row.name,
});
