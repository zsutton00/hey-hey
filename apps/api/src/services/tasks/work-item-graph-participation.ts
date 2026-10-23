import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WorkStatus } from '@prisma/client';
import type {
  WorkItemGraphParticipationCanonicalIdentity,
  WorkItemGraphParticipationEntry,
  WorkItemGraphParticipationProvenance,
  CanonicalEntityReference,
  WorkItemGraphParticipationResponseDto,
  WorkItemGraphParticipationType,
} from 'src/generated';
import { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import type { AgentEdge } from 'src/generated/graphs/model/agentEdge';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import { parseDiagramJson } from './diagram-metadata';

export const WORK_ITEM_GRAPH_PARTICIPATION_LIMITS = Object.freeze({
  referenceDepth: 4,
  candidateCount: 500,
  diagramCount: 100,
  graphRequestCount: 10,
  evidenceCount: 500,
});

const RESPONSIBILITIES = new Set<string>([
  AgentEdgeType.Guarantees,
  AgentEdgeType.Implements,
  AgentEdgeType.Consumes,
]);

/**
 * Incident-edge endpoint types are optional on the Graph read contract so
 * historical relationships can still be returned. The participant and
 * Contract records below are resolved from the project-scoped relational
 * store, making an omitted type compatible while still rejecting an explicit
 * non-task endpoint.
 */
export const hasTaskParticipationEndpoints = (edge: AgentEdge): boolean =>
  (edge.sourceEntityType === undefined ||
    edge.sourceEntityType === AgentEdgeEndpointEntityType.Task) &&
  (edge.targetEntityType === undefined ||
    edge.targetEntityType === AgentEdgeEndpointEntityType.Task);

type Reference = CanonicalEntityReference;
type Placement = {
  id: string;
  name: string;
  parentTaskId: string;
  reference?: Reference;
};
type ProvenanceSeed = {
  anchor: WorkItemGraphParticipationCanonicalIdentity;
  queryReference: Reference;
  diagramId: string;
  pathDiagramIds: string[];
  pathElementIds: string[];
  visitedReferenceKeys: string[];
  depth: number;
  /** Restricts canonical-entity discovery to its evidenced placement. */
  elementId?: string;
};

const referenceKey = (value: Reference): string =>
  `${value.entityType}:${value.entityId}`;

const provenanceKey = (value: WorkItemGraphParticipationProvenance): string =>
  JSON.stringify(value);

/** Pure stable merge used when cycles and repeated reference paths meet. */
export function mergeParticipationEvidence(
  entries: WorkItemGraphParticipationEntry[],
): WorkItemGraphParticipationEntry[] {
  const byEvidence = new Map<string, WorkItemGraphParticipationEntry>();
  for (const entry of entries) {
    const key = `${entry.relationship.evidenceId}:${entry.displayedAnchor.entityType}:${entry.displayedAnchor.entityId}`;
    const existing = byEvidence.get(key);
    if (!existing) {
      byEvidence.set(key, {
        ...entry,
        provenance: [...entry.provenance],
      });
      continue;
    }
    const seen = new Set(existing.provenance.map(provenanceKey));
    for (const provenance of entry.provenance) {
      if (!seen.has(provenanceKey(provenance)))
        existing.provenance.push(provenance);
    }
    existing.provenance.sort((a, b) =>
      provenanceKey(a).localeCompare(provenanceKey(b)),
    );
  }
  return [...byEvidence.values()].sort((a, b) =>
    a.relationship.evidenceId.localeCompare(b.relationship.evidenceId),
  );
}

@Injectable()
export class WorkItemGraphParticipationComposer {
  private readonly logger = new Logger(WorkItemGraphParticipationComposer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly edges: AgentEdgeClientService,
  ) {}

  async compose(
    organizationId: OrganizationId,
    projectId: ProjectId,
    rootDiagramId: string,
    relationshipTypes: WorkItemGraphParticipationType[],
    userToken: string | null,
  ): Promise<WorkItemGraphParticipationResponseDto> {
    if (!userToken)
      throw new UnauthorizedException('Authentication token is required');
    const references: Reference[] = [
      { entityType: 'TASK', entityId: rootDiagramId },
    ];
    const uniqueReferences = new Map(
      references.map((value) => [referenceKey(value), value]),
    );
    if (
      relationshipTypes.length < 1 ||
      relationshipTypes.length > 3 ||
      new Set(relationshipTypes).size !== relationshipTypes.length ||
      relationshipTypes.some((value) => !RESPONSIBILITIES.has(value))
    ) {
      throw new BadRequestException(
        'incidentRelationshipTypes must contain 1 to 3 unique supported relationship types',
      );
    }
    const requestedRelationshipTypes = new Set<string>(relationshipTypes);

    const requestedTaskIds = references
      .filter((value) => value.entityType === 'TASK')
      .map((value) => value.entityId);
    const requestedServiceIds = references
      .filter((value) => value.entityType === 'SERVICE')
      .map((value) => value.entityId);
    const [tasks, services, placements, requestedTasks, requestedServices] =
      await Promise.all([
        this.prisma.db.task.findMany({
          where: {
            organizationId,
            projectId,
            archivedAt: null,
            status: { not: WorkStatus.ARCHIVED },
          },
          select: { id: true, name: true, type: true, parentTaskId: true },
          orderBy: { id: 'asc' },
          take: WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount + 1,
        }),
        this.prisma.db.service.findMany({
          where: { organizationId, projectId, archivedAt: null },
          select: { id: true, name: true },
          orderBy: { id: 'asc' },
          take: WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount + 1,
        }),
        this.prisma.db.task.findMany({
          where: {
            organizationId,
            projectId,
            type: 'DIAGRAM_ELEMENT',
            archivedAt: null,
            status: { not: WorkStatus.ARCHIVED },
          },
          select: {
            id: true,
            name: true,
            parentTaskId: true,
            sections: {
              where: { key: 'diagramElementMetadata' },
              select: { materializedMarkdown: true },
            },
          },
          orderBy: { id: 'asc' },
          take: WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount + 1,
        }),
        this.prisma.db.task.findMany({
          where: {
            id: { in: requestedTaskIds },
            organizationId,
            projectId,
            archivedAt: null,
            status: { not: WorkStatus.ARCHIVED },
          },
          select: { id: true, name: true, type: true, parentTaskId: true },
        }),
        this.prisma.db.service.findMany({
          where: {
            id: { in: requestedServiceIds },
            organizationId,
            projectId,
            archivedAt: null,
          },
          select: { id: true, name: true },
        }),
      ]);

    const truncationReasons: string[] = [];
    if (
      tasks.length > WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount ||
      services.length > WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount ||
      placements.length > WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount
    ) {
      truncationReasons.push('candidate-count');
    }
    const taskById = new Map<string, (typeof tasks)[number]>(
      tasks
        .slice(0, WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount)
        .map((v) => [v.id, v]),
    );
    for (const task of requestedTasks) taskById.set(task.id, task);
    const serviceById = new Map<string, (typeof services)[number]>(
      services
        .slice(0, WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount)
        .map((v) => [v.id, v]),
    );
    for (const service of requestedServices)
      serviceById.set(service.id, service);
    const diagramById = new Map<string, (typeof tasks)[number]>(
      [...taskById.values()]
        .filter((v) => v.type === 'DIAGRAM')
        .map((v) => [v.id, v]),
    );
    const placementRows: Placement[] = placements
      .slice(0, WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount)
      .flatMap((row) => {
        if (!row.parentTaskId || !diagramById.has(row.parentTaskId)) return [];
        const raw = row.sections[0]?.materializedMarkdown;
        if (!raw)
          return [
            { id: row.id, name: row.name, parentTaskId: row.parentTaskId },
          ];
        const parsed = parseDiagramJson(raw) as {
          canonicalReference?: Reference | null;
        };
        return [
          {
            id: row.id,
            name: row.name,
            parentTaskId: row.parentTaskId,
            ...(parsed.canonicalReference
              ? { reference: parsed.canonicalReference }
              : {}),
          },
        ];
      });
    const placementsByReference = new Map<string, Placement[]>();
    const placementsByDiagram = new Map<string, Placement[]>();
    for (const placement of placementRows) {
      const inDiagram = placementsByDiagram.get(placement.parentTaskId) ?? [];
      inDiagram.push(placement);
      placementsByDiagram.set(placement.parentTaskId, inDiagram);
      if (placement.reference) {
        const list =
          placementsByReference.get(referenceKey(placement.reference)) ?? [];
        list.push(placement);
        placementsByReference.set(referenceKey(placement.reference), list);
      }
    }

    const identity = (
      ref: Reference,
    ): WorkItemGraphParticipationCanonicalIdentity | null => {
      const row =
        ref.entityType === 'TASK'
          ? taskById.get(ref.entityId)
          : serviceById.get(ref.entityId);
      return row
        ? { entityType: ref.entityType, entityId: row.id, title: row.name }
        : null;
    };
    const queue: ProvenanceSeed[] = [];
    for (const ref of uniqueReferences.values()) {
      const anchor = identity(ref);
      if (!anchor)
        throw new NotFoundException(
          'Canonical reference is unavailable in this project',
        );
      const task =
        ref.entityType === 'TASK' ? taskById.get(ref.entityId) : undefined;
      if (task?.type === 'DIAGRAM') {
        queue.push({
          anchor,
          queryReference: ref,
          diagramId: task.id,
          pathDiagramIds: [task.id],
          pathElementIds: [],
          visitedReferenceKeys: [referenceKey(ref)],
          depth: 0,
        });
      } else {
        for (const placement of placementsByReference.get(referenceKey(ref)) ??
          []) {
          queue.push({
            anchor,
            queryReference: ref,
            diagramId: placement.parentTaskId,
            pathDiagramIds: [placement.parentTaskId],
            pathElementIds: [],
            visitedReferenceKeys: [referenceKey(ref)],
            depth: 0,
            elementId: placement.id,
          });
        }
      }
    }

    const seedsByParticipant = new Map<string, ProvenanceSeed[]>();
    const visitedPaths = new Set<string>();
    const visitedDiagramIds = new Set<string>();
    while (queue.length > 0) {
      const seed = queue.shift()!;
      const pathKey = JSON.stringify([
        referenceKey(seed.queryReference),
        seed.pathDiagramIds,
        seed.pathElementIds,
        seed.elementId ?? '*',
      ]);
      if (visitedPaths.has(pathKey)) continue;
      visitedPaths.add(pathKey);
      visitedDiagramIds.add(seed.diagramId);
      if (
        visitedDiagramIds.size >
        WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.diagramCount
      ) {
        truncationReasons.push('diagram-count');
        break;
      }
      const diagramPlacements = placementsByDiagram.get(seed.diagramId) ?? [];
      const eligiblePlacements = seed.elementId
        ? diagramPlacements.filter((element) => element.id === seed.elementId)
        : diagramPlacements;
      for (const element of eligiblePlacements) {
        const nextSeed = {
          ...seed,
          pathElementIds: [...seed.pathElementIds, element.id],
        };
        const existing = seedsByParticipant.get(element.id) ?? [];
        existing.push(nextSeed);
        seedsByParticipant.set(element.id, existing);
        const nextReferenceKey = element.reference
          ? referenceKey(element.reference)
          : undefined;
        if (
          !element.reference ||
          (nextReferenceKey !== undefined &&
            seed.visitedReferenceKeys.includes(nextReferenceKey)) ||
          seed.depth >= WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.referenceDepth
        ) {
          if (
            element.reference &&
            seed.depth >= WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.referenceDepth
          )
            truncationReasons.push('reference-depth');
          continue;
        }
        const referencedTask =
          element.reference.entityType === 'TASK'
            ? taskById.get(element.reference.entityId)
            : undefined;
        const nextPlacements =
          referencedTask?.type === 'DIAGRAM'
            ? [{ parentTaskId: referencedTask.id, elementId: undefined }]
            : (
                placementsByReference.get(referenceKey(element.reference)) ?? []
              ).map((placement) => ({
                parentTaskId: placement.parentTaskId,
                elementId: placement.id,
              }));
        for (const next of nextPlacements) {
          queue.push({
            ...seed,
            diagramId: next.parentTaskId,
            pathDiagramIds: [...seed.pathDiagramIds, next.parentTaskId],
            pathElementIds: [...seed.pathElementIds, element.id],
            visitedReferenceKeys: [
              ...seed.visitedReferenceKeys,
              nextReferenceKey!,
            ],
            depth: seed.depth + 1,
            ...(next.elementId ? { elementId: next.elementId } : {}),
          });
        }
      }
    }

    const graphEdges: AgentEdge[] = [];
    const errors: string[] = [];
    const participantIds = [...seedsByParticipant.keys()].sort();
    const graphBatchSize = Math.ceil(
      WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.candidateCount /
        WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.graphRequestCount,
    );
    for (
      let offset = 0;
      offset < participantIds.length;
      offset += graphBatchSize
    ) {
      try {
        graphEdges.push(
          ...(await this.edges.findIncident(
            organizationId,
            projectId,
            {
              nodeIds: new Set(
                participantIds.slice(offset, offset + graphBatchSize),
              ),
              types: new Set(relationshipTypes as AgentEdgeType[]),
            },
            userToken,
          )),
        );
      } catch (error) {
        this.logger.error('Diagram participation graph read failed', {
          organizationId,
          projectId,
          batchNumber: Math.floor(offset / graphBatchSize),
          batchSize: Math.min(graphBatchSize, participantIds.length - offset),
        });
        errors.push('graph-read-failed');
      }
    }

    const rawEntries: WorkItemGraphParticipationEntry[] = [];
    for (const edge of graphEdges) {
      if (
        !requestedRelationshipTypes.has(edge.type) ||
        !hasTaskParticipationEndpoints(edge)
      )
        continue;
      const participant = placementRows.find(
        (value) => value.id === edge.sourceNodeId,
      );
      const contract = taskById.get(edge.targetNodeId);
      const provenanceSeeds = seedsByParticipant.get(edge.sourceNodeId);
      if (!participant || !provenanceSeeds || contract?.type !== 'CONTRACT')
        continue;
      const diagram = diagramById.get(participant.parentTaskId);
      if (!diagram) continue;
      const metadata = edge.metadata as
        | Record<string, unknown>
        | null
        | undefined;
      for (const seed of provenanceSeeds) {
        rawEntries.push({
          contract: {
            entityType: 'TASK',
            entityId: contract.id,
            title: contract.name,
          },
          sourceDiagram: {
            entityType: 'TASK',
            entityId: diagram.id,
            title: diagram.name,
          },
          displayedAnchor: seed.anchor,
          participant: {
            entityType: 'TASK',
            entityId: participant.id,
            title: participant.name,
          },
          responsibility: edge.type as WorkItemGraphParticipationType,
          relationship: {
            evidenceId: edge.id,
            semanticType: edge.type as WorkItemGraphParticipationType,
            sourceEntityId: edge.sourceNodeId,
            sourceEntityType: 'TASK',
            targetEntityId: edge.targetNodeId,
            targetEntityType: 'TASK',
            direction: 'source-to-target',
            label: edge.type,
            description:
              typeof metadata?.description === 'string'
                ? metadata.description
                : null,
            reason: edge.reasoning,
          },
          provenance: [
            {
              queryReference: seed.queryReference,
              pathDiagramIds: seed.pathDiagramIds,
              pathElementIds: seed.pathElementIds,
              derived: !(rootDiagramId === diagram.id && seed.depth === 0),
            },
          ],
        });
      }
    }
    let entries = mergeParticipationEvidence(rawEntries);
    if (entries.length > WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.evidenceCount) {
      entries = entries.slice(
        0,
        WORK_ITEM_GRAPH_PARTICIPATION_LIMITS.evidenceCount,
      );
      truncationReasons.push('evidence-count');
    }
    const truncated = truncationReasons.length > 0;
    const failed = errors.length > 0;
    const completeness = failed
      ? 'FAILED'
      : truncated
        ? 'TRUNCATED'
        : 'COMPLETE';
    this.logger.log('Relationship evidence read completed', {
      organizationId,
      projectId,
      referenceCount: references.length,
      evidenceCount: entries.length,
      completeness,
    });
    return {
      entries,
      summary: {
        completeness,
        uniqueContractCount:
          completeness === 'COMPLETE'
            ? new Set(entries.map((v) => v.contract.entityId)).size
            : null,
        participantCount: new Set(entries.map((v) => v.participant.entityId))
          .size,
        responsibilityCount: new Set(
          entries.map((value) => value.relationship.evidenceId),
        ).size,
        limits: WORK_ITEM_GRAPH_PARTICIPATION_LIMITS,
        truncationReasons: [...new Set(truncationReasons)].sort(),
        errors,
      },
    } satisfies WorkItemGraphParticipationResponseDto;
  }
}
