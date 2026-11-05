import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  AdminHint,
  AdminHintConnection,
  AdminProjectHintsResponse,
} from '@hey-hey/contracts/api/models';
import {
  ENTITY_RESOURCES,
  ProjectResourceAccessService,
} from '../../auth/services/project-resource-access.service';
import { EntityType } from '@prisma/client';
import type { Hint, HintConnection } from '../../generated/graphs';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphsClientService } from '../graphs-client.service';
import type { HintRequestor } from './hint.service';

export interface AdminHintFilters {
  search?: string;
  itemTypes?: string[];
  minStrength?: number;
}

interface ConnectionIdentity {
  title: string;
  itemType?: string;
}

const identityKey = (
  connection: Pick<HintConnection, 'targetNodeId' | 'targetEntityType'>,
) => `${connection.targetEntityType}:${connection.targetNodeId}`;

/**
 * Platform-admin project listing of live graph Hints. Connected item titles
 * are resolved here, never in the graph service, and only for items the
 * caller may see.
 */
@Injectable()
export class AdminHintListingService {
  constructor(
    private readonly graphsClient: GraphsClientService,
    private readonly resourceAccess: ProjectResourceAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    requestor: HintRequestor,
    filters: AdminHintFilters,
  ): Promise<AdminProjectHintsResponse> {
    await this.resourceAccess.assertResource(
      requestor.userId,
      requestor.organizationId,
      'project',
      requestor.projectId,
    );

    const { hints } = await this.graphsClient.listProjectHints(
      requestor.organizationId,
      requestor.projectId,
      requestor.token,
    );
    const identities = await this.resolveIdentities(requestor, hints);
    const enriched = hints.map((hint) => enrich(hint, identities));
    const matching = enriched.filter((hint) => matches(hint, filters));

    return {
      hints: matching,
      matchingCount: matching.length,
      totalCount: enriched.length,
    };
  }

  private async resolveIdentities(
    requestor: HintRequestor,
    hints: Hint[],
  ): Promise<Map<string, ConnectionIdentity>> {
    const targets = new Map<string, HintConnection>();
    for (const connection of hints.flatMap((hint) => hint.connections)) {
      targets.set(identityKey(connection), connection);
    }
    const idsOf = (type: string) =>
      [...targets.values()]
        .filter((target) => target.targetEntityType === type)
        .map((target) => target.targetNodeId);

    const scope = (ids: string[]) => ({
      id: { in: ids },
      organizationId: requestor.organizationId,
      projectId: requestor.projectId,
    });
    const live = { archivedAt: null, status: { not: 'ARCHIVED' } } as const;

    const [tasks, designDocs, services] = await Promise.all([
      this.prisma.db.task.findMany({
        where: { ...scope(idsOf('TASK')), ...live },
        select: { id: true, name: true, type: true },
      }),
      this.prisma.db.designDoc.findMany({
        where: { ...scope(idsOf('DESIGN_DOC')), ...live },
        select: { id: true, name: true, template: true },
      }),
      this.prisma.db.service.findMany({
        where: { ...scope(idsOf('SERVICE')), ...live },
        select: { id: true, name: true },
      }),
    ]);

    const identities = new Map<string, ConnectionIdentity>();
    for (const row of tasks) {
      identities.set(`TASK:${row.id}`, { title: row.name, itemType: row.type });
    }
    for (const row of designDocs) {
      identities.set(`DESIGN_DOC:${row.id}`, {
        title: row.name,
        itemType: row.template,
      });
    }
    for (const row of services) {
      identities.set(`SERVICE:${row.id}`, { title: row.name });
    }

    await this.addRegistryIdentities(
      requestor,
      [...targets.values()],
      identities,
    );
    addHintIdentities(hints, identities);

    return identities;
  }

  // Other entity kinds have no batched backing read; each is authorized
  // individually before its registry name is trusted.
  private async addRegistryIdentities(
    requestor: HintRequestor,
    targets: HintConnection[],
    identities: Map<string, ConnectionIdentity>,
  ): Promise<void> {
    const others = targets.filter(
      (target) =>
        !['TASK', 'DESIGN_DOC', 'SERVICE', 'HINT'].includes(
          target.targetEntityType,
        ) && ENTITY_RESOURCES[target.targetEntityType],
    );
    if (others.length === 0) {
      return;
    }

    const registry = await this.prisma.db.entityRegistry.findMany({
      where: {
        organizationId: requestor.organizationId,
        deletedAt: null,
        OR: others.flatMap((target) =>
          isRegistryType(target.targetEntityType)
            ? [
                {
                  entityId: target.targetNodeId,
                  entityType: target.targetEntityType,
                },
              ]
            : [],
        ),
      },
      select: { entityId: true, entityType: true, entityName: true },
    });
    const names = new Map(
      registry.map((row) => [
        `${row.entityType}:${row.entityId}`,
        row.entityName,
      ]),
    );

    for (const target of others) {
      const key = identityKey(target);
      const name = names.get(key);
      if (!name) {
        continue;
      }
      try {
        await this.resourceAccess.assertResource(
          requestor.userId,
          requestor.organizationId,
          ENTITY_RESOURCES[target.targetEntityType]!,
          target.targetNodeId,
          requestor.projectId,
        );
        identities.set(key, { title: name });
      } catch (error) {
        if (!(error instanceof ForbiddenException)) {
          throw error;
        }
      }
    }
  }
}

// A connected hint is titled by its text only when every item it connects to
// is itself available, so its text never leaks through this shortcut.
function addHintIdentities(
  hints: Hint[],
  identities: Map<string, ConnectionIdentity>,
): void {
  for (const hint of hints) {
    const available = hint.connections.every(
      (connection) =>
        connection.targetEntityType === 'HINT' ||
        identities.has(identityKey(connection)),
    );
    if (available) {
      identities.set(`HINT:${hint.id}`, { title: hint.text });
    }
  }
}

function isRegistryType(type: string): type is EntityType {
  return type in EntityType;
}

function enrich(
  hint: Hint,
  identities: Map<string, ConnectionIdentity>,
): AdminHint {
  return {
    id: hint.id,
    projectId: hint.projectId,
    text: hint.text,
    origin: hint.origin,
    createdAt: hint.createdAt,
    updatedAt: hint.updatedAt,
    connections: hint.connections.map((connection) => {
      const identity = identities.get(identityKey(connection));
      return {
        id: connection.id,
        targetNodeId: connection.targetNodeId,
        targetEntityType: connection.targetEntityType,
        strength: connection.strength,
        ...(identity ? { title: identity.title } : {}),
        ...(identity?.itemType ? { itemType: identity.itemType } : {}),
      };
    }),
  };
}

function matches(hint: AdminHint, filters: AdminHintFilters): boolean {
  const { search, itemTypes, minStrength } = filters;

  if (search) {
    const needle = search.toLowerCase();
    const textMatches =
      hint.text.toLowerCase().includes(needle) ||
      hint.connections.some((c) => c.title?.toLowerCase().includes(needle));
    if (!textMatches) {
      return false;
    }
  }

  const connectionFiltered =
    Boolean(itemTypes?.length) || minStrength !== undefined;
  if (!connectionFiltered) {
    return true;
  }

  return hint.connections.some((connection) =>
    connectionMatches(connection, itemTypes, minStrength),
  );
}

// An unavailable connection has no known type, so it can never satisfy a type filter.
function connectionMatches(
  connection: AdminHintConnection,
  itemTypes: string[] | undefined,
  minStrength: number | undefined,
): boolean {
  if (minStrength !== undefined && connection.strength < minStrength) {
    return false;
  }
  if (!itemTypes?.length) {
    return true;
  }
  if (connection.title === undefined) {
    return false;
  }
  return itemTypes.includes(connection.itemType ?? connection.targetEntityType);
}
