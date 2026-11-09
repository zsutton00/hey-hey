import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { WORK_ITEM_TYPE_KEYS } from '../../services/tasks/work-item-type-keys';
import type {
  GetEntityIdentitiesRequest,
  GetEntityIdentity,
} from '@hey-hey/contracts/api/models';
import type { OrganizationId, ProjectId } from '../../types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';

/** Identities keyed by entityId; null for any id that is not returnable. */
type GetEntityIdentitiesResponse = Record<string, GetEntityIdentity | null>;

const MAX_PAIRS = 50;

type CanonicalType = GetEntityIdentity['entityType'];

const CANONICAL_TYPES: readonly CanonicalType[] = [
  'TASK',
  'DESIGN_DOC',
  'SERVICE',
];

export const getEntityIdentitiesParameters = z
  .object({
    entities: z
      .array(
        z
          .object({
            entityType: z
              .string()
              .describe(
                'TASK, DESIGN_DOC or SERVICE; any registered work-item type key (such as FEATURE, BUG or PLAN) aliases TASK',
              ),
            entityId: z.string().uuid().describe('The UUID of the entity'),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PAIRS)
      .describe(`1–${MAX_PAIRS} { entityType, entityId } pairs to resolve.`),
  })
  .strict() satisfies z.ZodType<GetEntityIdentitiesRequest>;

interface RegistryMatch {
  entityId: string;
  entityName: string | null;
}

@Injectable()
export class GetEntityIdentitiesToolsProvider {
  private readonly logger = new Logger(GetEntityIdentitiesToolsProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  @Tool({
    name: 'get_entity_identities',
    description:
      'The cheapest way to turn a known entity id into a mention: returns only ' +
      '{ entityType, entityId, title, status, itemType } per id, with no content, relations or snippets. ' +
      'Accepts 1–50 { entityType, entityId } pairs; any registered work-item type key (FEATURE, BUG, PLAN, ...) ' +
      'is accepted as an alias of TASK, and DESIGN_DOC and SERVICE are also resolvable. ' +
      'entityType in the result is the canonical TASK, DESIGN_DOC or SERVICE; itemType is the work-item type key ' +
      'for work items (FEATURE, BUG, STANDARD, a custom type), the template for design docs, and null for plans and services. ' +
      'Returns a JSON object keyed by entityId; unknown, archived, deleted or out-of-project ids produce null ' +
      'for that key without failing the call. A batch over 50 pairs is rejected.',
    parameters: getEntityIdentitiesParameters,
  })
  async getEntityIdentities(
    params: z.infer<typeof getEntityIdentitiesParameters>,
    _context: Context,
    request: Request,
  ): Promise<CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) {
      return auth;
    }
    const { organizationId } = auth;
    const resolvedProjectId = resolveProjectId({}, request);
    if (!isProjectId(resolvedProjectId)) {
      return resolvedProjectId;
    }
    const projectId = resolvedProjectId;

    const requested = params.entities.map(({ entityType, entityId }) => ({
      entityId,
      canonicalType: this.canonicalType(entityType, projectId),
    }));
    const invalid = requested.find(({ canonicalType }) => !canonicalType);
    if (invalid) {
      return mcpError(
        'Invalid entityType. Accepted types: ' +
          [...CANONICAL_TYPES, 'any registered work-item type key'].join(', '),
      );
    }

    const pairs = requested.map(({ entityId, canonicalType }) => ({
      entityId,
      entityType: canonicalType as CanonicalType,
    }));
    const identities = await this.resolve(pairs, organizationId, projectId);

    const result: GetEntityIdentitiesResponse = {};
    for (const { entityId, entityType } of pairs) {
      result[entityId] =
        identities.get(this.key(entityType, entityId)) ??
        result[entityId] ??
        null;
    }

    this.logger.debug('get_entity_identities completed', {
      requested: pairs.length,
      resolved: identities.size,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  private canonicalType(
    entityType: string,
    projectId: ProjectId,
  ): CanonicalType | undefined {
    const canonical = CANONICAL_TYPES.find((type) => type === entityType);
    if (canonical) {
      return canonical;
    }

    return this.workItemTypeRegistry.getRulesForProject(entityType, projectId)
      ? 'TASK'
      : undefined;
  }

  private key(entityType: CanonicalType, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private async resolve(
    pairs: { entityId: string; entityType: CanonicalType }[],
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<Map<string, GetEntityIdentity>> {
    const registry = await this.prisma.db.entityRegistry.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: pairs.map(({ entityId, entityType }) => ({ entityId, entityType })),
      },
      select: { entityId: true, entityType: true, entityName: true },
    });

    const idsByType = new Map<CanonicalType, RegistryMatch[]>();
    for (const row of registry) {
      const entityType = CANONICAL_TYPES.find(
        (type) => type === row.entityType,
      );
      if (!entityType) {
        continue;
      }
      const matches = idsByType.get(entityType) ?? [];
      matches.push({ entityId: row.entityId, entityName: row.entityName });
      idsByType.set(entityType, matches);
    }

    const scope = (matches: RegistryMatch[]) => ({
      id: { in: matches.map(({ entityId }) => entityId) },
      organizationId,
      projectId,
      archivedAt: null,
      // status is an independent archive signal: it can change without archivedAt.
      status: { not: 'ARCHIVED' as const },
    });
    const titles = (matches: RegistryMatch[]) =>
      new Map(matches.map((match) => [match.entityId, match.entityName]));

    const identities = new Map<string, GetEntityIdentity>();

    const taskMatches = idsByType.get('TASK');
    if (taskMatches) {
      const names = titles(taskMatches);
      const rows = await this.prisma.db.task.findMany({
        where: scope(taskMatches),
        select: { id: true, name: true, type: true, status: true },
      });
      for (const row of rows) {
        identities.set(this.key('TASK', row.id), {
          entityType: 'TASK',
          entityId: row.id,
          title: names.get(row.id) ?? row.name,
          status: row.status,
          itemType: row.type === WORK_ITEM_TYPE_KEYS.Plan ? null : row.type,
        });
      }
    }

    const docMatches = idsByType.get('DESIGN_DOC');
    if (docMatches) {
      const names = titles(docMatches);
      const rows = await this.prisma.db.designDoc.findMany({
        where: scope(docMatches),
        select: { id: true, name: true, template: true, status: true },
      });
      for (const row of rows) {
        identities.set(this.key('DESIGN_DOC', row.id), {
          entityType: 'DESIGN_DOC',
          entityId: row.id,
          title: names.get(row.id) ?? row.name,
          status: row.status,
          itemType: row.template,
        });
      }
    }

    const serviceMatches = idsByType.get('SERVICE');
    if (serviceMatches) {
      const names = titles(serviceMatches);
      const rows = await this.prisma.db.service.findMany({
        where: scope(serviceMatches),
        select: { id: true, name: true, status: true },
      });
      for (const row of rows) {
        identities.set(this.key('SERVICE', row.id), {
          entityType: 'SERVICE',
          entityId: row.id,
          title: names.get(row.id) ?? row.name,
          status: row.status,
          itemType: null,
        });
      }
    }

    return identities;
  }
}
