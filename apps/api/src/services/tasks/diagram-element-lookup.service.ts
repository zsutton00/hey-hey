import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { restrictTaskWhere } from 'src/read-restriction/read-policy';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import type { OrganizationId, ProjectId } from 'src/types';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import {
  diagramElementMetadataSchema,
  parseDiagramJson,
} from './diagram-metadata';
import { diagramElementsMentioningWhere } from './ux-flow-membership';

export const DIAGRAM_ELEMENT_LOOKUP_LIMITS = Object.freeze({
  identityCount: 20,
  hitCount: 200,
  /** Candidate rows read per page of the canonical-reference scan. */
  candidatePageSize: 200,
});

export type DiagramElementLookupIdentity = {
  entityType: 'TASK' | 'SERVICE';
  entityId: string;
};

export type DiagramElementLinkKind =
  | 'CANONICAL_REFERENCE'
  | 'FULFILLED_BY'
  | 'CONTRACT_PARTICIPATION';

export type DiagramElementLookupHit = {
  identity: DiagramElementLookupIdentity;
  element: { id: string; name: string; role: string | null };
  diagram: { id: string; name: string };
  linkKind: DiagramElementLinkKind;
  /** Set only for CONTRACT_PARTICIPATION: GUARANTEES, IMPLEMENTS or CONSUMES. */
  relationshipType?: string;
};

export type DiagramElementLookupResult = {
  hits: DiagramElementLookupHit[];
  truncated: boolean;
};

const PARTICIPATION_TYPES = new Set<string>([
  AgentEdgeType.Guarantees,
  AgentEdgeType.Implements,
  AgentEdgeType.Consumes,
]);

const ELEMENT_SELECT = {
  id: true,
  name: true,
  sections: {
    where: { key: 'diagramElementMetadata' },
    select: { materializedMarkdown: true },
  },
  parentTask: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

type ElementRow = Prisma.TaskGetPayload<{ select: typeof ELEMENT_SELECT }>;

const identityKey = (identity: DiagramElementLookupIdentity): string =>
  `${identity.entityType}:${identity.entityId}`;

/**
 * Finds the live Diagram Elements that explicit, recorded links connect to a
 * task, Service or Contract. Never matches on names, roles, containment or
 * proximity: an element is returned only through its canonical reference, a
 * FULFILLED_BY edge, or (for a Contract) a GUARANTEES/IMPLEMENTS/CONSUMES edge.
 */
@Injectable()
export class DiagramElementLookupService {
  private readonly logger = new Logger(DiagramElementLookupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly edges: AgentEdgeClientService,
  ) {}

  /** A failed read throws; it is never reported as an empty result. */
  async find(
    organizationId: OrganizationId,
    projectId: ProjectId,
    identities: readonly DiagramElementLookupIdentity[],
    userToken: string,
  ): Promise<DiagramElementLookupResult> {
    const unique = [
      ...new Map(
        identities.map((value) => [identityKey(value), value]),
      ).values(),
    ];
    const byId = new Map(unique.map((value) => [value.entityId, value]));

    const canonical = await this.canonicalHits(organizationId, projectId, byId);
    const linked = await this.edgeHits(
      organizationId,
      projectId,
      unique,
      userToken,
    );

    const merged = new Map<string, DiagramElementLookupHit>();
    for (const hit of [...canonical, ...linked]) {
      const key = [
        identityKey(hit.identity),
        hit.element.id,
        hit.linkKind,
        hit.relationshipType ?? '',
      ].join('|');
      if (!merged.has(key)) {
        merged.set(key, hit);
      }
    }

    const all = [...merged.values()];
    const truncated = all.length > DIAGRAM_ELEMENT_LOOKUP_LIMITS.hitCount;
    const hits = all.slice(0, DIAGRAM_ELEMENT_LOOKUP_LIMITS.hitCount);

    this.logger.log('Diagram element lookup completed', {
      organizationId,
      projectId,
      identityCount: unique.length,
      canonicalCount: canonical.length,
      linkedCount: linked.length,
      hitCount: hits.length,
      truncated,
    });

    return { hits, truncated };
  }

  private async canonicalHits(
    organizationId: OrganizationId,
    projectId: ProjectId,
    byId: Map<string, DiagramElementLookupIdentity>,
  ): Promise<DiagramElementLookupHit[]> {
    const where = diagramElementsMentioningWhere({
      organizationId,
      projectId,
      entityIds: [...byId.keys()],
    });
    const pageSize = DIAGRAM_ELEMENT_LOOKUP_LIMITS.candidatePageSize;
    const hits: DiagramElementLookupHit[] = [];
    let cursor: string | undefined;

    // The text match only narrows candidates, so incidental mentions must not
    // crowd out a real reference: page until the candidates run out or the
    // verified hits exceed the limit.
    while (hits.length <= DIAGRAM_ELEMENT_LOOKUP_LIMITS.hitCount) {
      const rows = await this.prisma.db.task.findMany({
        where,
        select: ELEMENT_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      for (const row of rows) {
        const metadata = this.parseMetadata(row);
        const reference = metadata?.canonicalReference;
        const identity = reference ? byId.get(reference.entityId) : undefined;

        if (
          !row.parentTask ||
          !reference ||
          !identity ||
          identity.entityType !== reference.entityType
        ) {
          continue;
        }

        hits.push(
          this.hit(row, identity, 'CANONICAL_REFERENCE', metadata?.role),
        );
      }

      if (rows.length < pageSize) {
        break;
      }
      cursor = rows.at(-1)?.id;
    }

    return hits;
  }

  private async edgeHits(
    organizationId: OrganizationId,
    projectId: ProjectId,
    identities: readonly DiagramElementLookupIdentity[],
    userToken: string,
  ): Promise<DiagramElementLookupHit[]> {
    const byId = new Map(identities.map((value) => [value.entityId, value]));
    const edges = await this.edges.findIncident(
      organizationId,
      projectId,
      {
        nodeIds: new Set(byId.keys()),
        types: new Set<AgentEdgeType>([
          AgentEdgeType.FulfilledBy,
          AgentEdgeType.Guarantees,
          AgentEdgeType.Implements,
          AgentEdgeType.Consumes,
        ]),
      },
      userToken,
    );

    const relevant = edges.filter(
      (edge) =>
        byId.has(edge.targetNodeId) &&
        (edge.type === AgentEdgeType.FulfilledBy ||
          PARTICIPATION_TYPES.has(edge.type)),
    );
    if (relevant.length === 0) {
      return [];
    }

    const contractIds = await this.contractIds(
      organizationId,
      projectId,
      relevant
        .filter((edge) => PARTICIPATION_TYPES.has(edge.type))
        .map((edge) => edge.targetNodeId),
    );
    const elementRows = await this.prisma.db.task.findMany({
      where: restrictTaskWhere({
        organizationId,
        projectId,
        type: 'DIAGRAM_ELEMENT',
        archivedAt: null,
        status: { not: 'ARCHIVED' },
        parentTask: {
          is: {
            type: 'DIAGRAM',
            archivedAt: null,
            status: { not: 'ARCHIVED' },
          },
        },
        id: { in: [...new Set(relevant.map((edge) => edge.sourceNodeId))] },
      }),
      select: ELEMENT_SELECT,
    });
    const elementsById = new Map<string, ElementRow>(
      elementRows.map((row) => [row.id, row]),
    );

    const hits: DiagramElementLookupHit[] = [];
    for (const edge of relevant) {
      const row = elementsById.get(edge.sourceNodeId);
      const identity = byId.get(edge.targetNodeId);
      const participation = PARTICIPATION_TYPES.has(edge.type);

      if (!row?.parentTask || !identity) {
        continue;
      }
      if (participation && !contractIds.has(edge.targetNodeId)) {
        continue;
      }

      const role = this.parseMetadata(row)?.role;
      hits.push({
        ...this.hit(
          row,
          identity,
          participation ? 'CONTRACT_PARTICIPATION' : 'FULFILLED_BY',
          role,
        ),
        ...(participation ? { relationshipType: edge.type } : {}),
      });
    }

    return hits;
  }

  private async contractIds(
    organizationId: OrganizationId,
    projectId: ProjectId,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.db.task.findMany({
      where: restrictTaskWhere({
        organizationId,
        projectId,
        type: 'CONTRACT',
        archivedAt: null,
        status: { not: 'ARCHIVED' },
        id: { in: [...new Set(ids)] },
      }),
      select: { id: true },
    });

    return new Set(rows.map((row) => row.id));
  }

  private parseMetadata(row: ElementRow) {
    const raw = row.sections[0]?.materializedMarkdown;
    if (!raw) {
      return undefined;
    }

    try {
      const parsed = diagramElementMetadataSchema.safeParse(
        parseDiagramJson(raw),
      );
      if (!parsed.success) {
        this.logger.warn('Diagram element metadata failed its schema', {
          elementId: row.id,
          issues: parsed.error.issues.map((issue) => issue.message),
        });
        return undefined;
      }

      return parsed.data;
    } catch (error) {
      this.logger.warn('Diagram element metadata is not valid JSON', {
        elementId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private hit(
    row: ElementRow,
    identity: DiagramElementLookupIdentity,
    linkKind: DiagramElementLinkKind,
    role: string | null | undefined,
  ): DiagramElementLookupHit {
    return {
      identity,
      element: { id: row.id, name: row.name, role: role ?? null },
      diagram: { id: row.parentTask!.id, name: row.parentTask!.name },
      linkKind,
    };
  }
}
