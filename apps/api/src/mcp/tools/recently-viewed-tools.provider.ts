import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  AttentionEventService,
  type AttentionEventWithEntity,
} from '../../services/analytics/attention-event.service';
import {
  EntityContextService,
  type FullEntityContextDto,
} from '../../services/entity-context/entity-context.service';
import { EntityType as EntityTypeEnum } from '../../generated/model/entityType';
import type { OrganizationId, ProjectId } from '../../types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';

const GET_RECENTLY_VIEWED_TOOL_NAME = 'get_recently_viewed';

const DEFAULT_SINCE_HOURS = 24;
const MAX_SINCE_HOURS = 24 * 7;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const getRecentlyViewedParameters = z.object({
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Project to scope recently-viewed entities to. ' +
        'Inferred from X-Project-ID header when omitted.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe('Maximum number of recently-viewed entities to return'),
  sinceHours: z
    .number()
    .int()
    .min(1)
    .max(MAX_SINCE_HOURS)
    .default(DEFAULT_SINCE_HOURS)
    .describe(
      'Lookback window in hours. Only entities viewed within this window ' +
        'are returned; defaults to the last 24 hours.',
    ),
});

const recentlyViewedEntrySchema = z.object({
  entityType: z
    .string()
    .describe('Entity type (e.g. TASK, DESIGN_DOC, PLAN, INITIATIVE)'),
  entityId: z.string().describe('ID of the viewed entity'),
  title: z.string().describe('Human-readable title or name of the entity'),
  featurePath: z
    .array(z.string())
    .describe(
      'Ancestor feature-hierarchy names from root to parent (may be empty ' +
        'when the entity has no feature hierarchy)',
    ),
  lastViewedAt: z
    .string()
    .describe('ISO timestamp of the most recent attention event (focusEnd)'),
});

const getRecentlyViewedOutput = z.object({
  entities: z.array(recentlyViewedEntrySchema),
});

type GetRecentlyViewedOutput = z.infer<typeof getRecentlyViewedOutput>;
type RecentlyViewedEntry = z.infer<typeof recentlyViewedEntrySchema>;

function buildFeaturePath(context: FullEntityContextDto): string[] {
  const ancestors = (context.featureHierarchy ?? []).filter(
    (f) => f.relationship === 'ancestor',
  );
  ancestors.sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0));
  return ancestors.map((f) => f.name);
}

@Injectable()
export class RecentlyViewedToolsProvider {
  private readonly logger = new Logger(RecentlyViewedToolsProvider.name);

  constructor(
    private readonly attentionEventService: AttentionEventService,
    private readonly entityContextService: EntityContextService,
  ) {}

  @Tool({
    name: GET_RECENTLY_VIEWED_TOOL_NAME,
    description:
      'Returns entities the current user has recently viewed in the active ' +
      'project, ordered from most to least recent. Each entry includes the ' +
      "entity's type, ID, title, feature-hierarchy path, and the timestamp " +
      'of the most recent view. Use this during planning to spot ' +
      'cross-hierarchy relationships the user has been navigating between ' +
      '— especially when those navigation patterns suggest entities that ' +
      'should be connected via edges even though the graph does not yet ' +
      'reflect the relationship.',
    parameters: getRecentlyViewedParameters,
    outputSchema: getRecentlyViewedOutput,
  })
  async getRecentlyViewed(
    params: z.infer<typeof getRecentlyViewedParameters>,
    _context: Context,
    request: Request,
  ): Promise<GetRecentlyViewedOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const resolvedProjectId = resolveProjectId(params, request);
    if (!isProjectId(resolvedProjectId)) return resolvedProjectId;
    const projectId = resolvedProjectId;

    const { limit, sinceHours } = params;
    const sinceIso = new Date(
      Date.now() - sinceHours * 60 * 60 * 1000,
    ).toISOString();

    this.logger.log('get_recently_viewed called', {
      organizationId: auth.organizationId,
      projectId,
      userId: auth.user.userId,
      limit,
      sinceHours,
    });

    let events: AttentionEventWithEntity[];
    try {
      const result = await this.attentionEventService.getAttentionEvents(
        auth.user,
        {
          limit,
          offset: 0,
          since: sinceIso,
          sort: 'mostRecent',
          projectId,
        },
      );
      events = result.events;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return mcpError(`Failed to load recently-viewed entities: ${message}`);
    }

    const entries: RecentlyViewedEntry[] = [];
    for (const event of events) {
      let featurePath: string[] = [];
      try {
        const fullContext =
          await this.entityContextService.getFullEntityContext(
            auth.organizationId as OrganizationId,
            projectId as ProjectId,
            event.entityType as EntityTypeEnum,
            event.entityId,
            auth.token ?? null,
          );
        featurePath = buildFeaturePath(fullContext);
      } catch (error) {
        this.logger.warn(
          `Failed to resolve feature path for ${event.entityType}:${event.entityId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      entries.push({
        entityType: event.entityType,
        entityId: event.entityId,
        title: event.entityName || 'Unknown',
        featurePath,
        lastViewedAt: event.focusEnd,
      });
    }

    return { entities: entries };
  }
}
