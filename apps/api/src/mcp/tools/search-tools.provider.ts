import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { UnifiedSearchService } from '../../services/unified-search/unified-search.service';
import {
  CanonicalTaskMetadata,
  EntityType,
  HelpDemoDsl,
  HelpDemoPreset,
  HelpNodeWithBody,
  HelpSearchResponse,
  UnifiedSearchRequest,
  UnifiedSearchResult,
  WorkStatus,
} from '../../generated';
import { SearchProjection } from '../../generated/graphs';
import { HelpService } from '../../services/help.service';
import { ProjectId } from '../../types';
import {
  AuthContext,
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  paginationFields,
  resolveProjectId,
  truncate,
} from './mcp-tool.utils';
import {
  ENVELOPE_ALLOWANCE,
  RESPONSE_CHARACTER_BUDGET,
} from './response-budget';
import { SearchCacheService } from './search-cache.service';

const MAX_SNIPPET_LENGTH = 300;
const MAX_HELP_SEARCH_RESULTS = 50;

/**
 * Over-fetch multiplier used when client-side filters are active.
 * We request more results from the backend to compensate for
 * post-filtering, which would otherwise break pagination.
 */
const FILTER_OVER_FETCH_MULTIPLIER = 3;

/**
 * Upper bound on the number of queries a single `unified_search` call may
 * batch. Bounds blast radius: each query fans out to the graph and embeddings
 * services, so the worst-case backend load scales with this cap.
 */
const MAX_UNIFIED_SEARCH_QUERIES = 5;

export const UNIFIED_SEARCH_ENTITY_TYPES = [
  'TASK',
  'DESIGN_DOC',
  'MESSAGE',
] as const;

// NOTE: do not wrap this schema in `.refine()`/`.superRefine()`. Those produce
// a ZodEffects, which breaks MCP tool schema generation. The exactly-one-of
// `query`/`queries` constraint is enforced at runtime in the handler instead.
export const unifiedSearchParameters = z.object({
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Natural language search query for a single search. Provide exactly ' +
        'one of `query` or `queries`.',
    ),
  queries: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_UNIFIED_SEARCH_QUERIES)
    .optional()
    .describe(
      'Batch of natural language search queries (max ' +
        `${MAX_UNIFIED_SEARCH_QUERIES}) run in a single call. Returns one ` +
        'result group per query, ordered to match this array, so callers can ' +
        'correlate results back to the originating query. Use to fan out ' +
        'related orientation searches without multiple round-trips. Provide ' +
        'exactly one of `query` or `queries`.',
    ),
  entityTypes: z
    .array(z.enum(UNIFIED_SEARCH_ENTITY_TYPES))
    .optional()
    .describe(
      'Optional list of entity types to scope the search to. When omitted, ' +
        'returns hits across tasks, design docs, plans, and messages. ' +
        'Provide a subset (e.g. ["MESSAGE"]) to scope results. Applies to ' +
        'every query in a batch.',
    ),
  downrankUnreviewed: z
    .boolean()
    .optional()
    .describe(
      'When true, deprioritizes system-generated entities that have not been ' +
        'reviewed by a human (e.g. tasks still in a refining state). Use this ' +
        'when searching for evidence or background context where human-reviewed ' +
        'content should be preferred. Do NOT set this when looking up a specific ' +
        'entity by name. Applies to every query in a batch.',
    ),
  createdAfter: z
    .string()
    .datetime()
    .optional()
    .describe(
      'Optional ISO-8601 date-time lower bound. When set, only entities ' +
        'created at or after this instant are returned. Use to scope results ' +
        'to recent work (e.g. "2026-05-01T00:00:00Z"). Applies to every query ' +
        'in a batch.',
    ),
  createdBefore: z
    .string()
    .datetime()
    .optional()
    .describe(
      'Optional ISO-8601 date-time upper bound. When set, only entities ' +
        'created at or before this instant are returned. Combine with ' +
        'createdAfter to scope results to a creation-time window. Applies to ' +
        'every query in a batch.',
    ),
  updatedAfter: z
    .string()
    .datetime()
    .optional()
    .describe(
      'Optional ISO-8601 date-time lower bound. When set, only entities ' +
        'updated at or after this instant are returned. Applies to every ' +
        'query in a batch.',
    ),
  updatedBefore: z
    .string()
    .datetime()
    .optional()
    .describe(
      'Optional ISO-8601 date-time upper bound. When set, only entities ' +
        'updated at or before this instant are returned. Combine with ' +
        'updatedAfter to scope results to an update-time window. Applies to ' +
        'every query in a batch.',
    ),
  ...paginationFields,
});

export const taskSearchParameters = z.object({
  query: z.string().min(1).describe('Search query for tasks'),
  status: z
    .enum(['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])
    .optional()
    .describe('Filter tasks by status'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional()
    .describe('Filter tasks by priority'),
  initiativeId: z
    .string()
    .uuid()
    .optional()
    .describe('Filter tasks belonging to a specific initiative'),
  taskType: z.string().optional().describe('Filter tasks by task type'),
  downrankUnreviewed: z
    .boolean()
    .optional()
    .describe(
      'When true, deprioritizes system-generated tasks that have not been ' +
        'reviewed by a human (e.g. tasks still in a refining state). Use this ' +
        'when searching for evidence or background context where human-reviewed ' +
        'content should be preferred. Do NOT set this when looking up a specific ' +
        'task by name.',
    ),
  ...paginationFields,
});

export const featureSearchParameters = taskSearchParameters.omit({
  taskType: true,
});

// Goals share the same wire shape as features for search — the dispatch
// pre-binds taskType so callers never see it.
export const goalSearchParameters = taskSearchParameters.omit({
  taskType: true,
});

export const planSearchParameters = taskSearchParameters.omit({
  taskType: true,
});

export const designDocSearchParameters = z.object({
  query: z
    .string()
    .min(1)
    .describe('Natural language search query for design documents'),
  template: z
    .enum(['ADR', 'DECISION', 'BRAINSTORM', 'PLAN_DOCUMENT'])
    .optional()
    .describe(
      'Filter by design doc template type. ' +
        'ADR = Architecture Decision Record, ' +
        'DECISION = standalone decision, ' +
        'BRAINSTORM = brainstorming session, ' +
        'PLAN_DOCUMENT = plan-linked document.',
    ),
  status: z
    .enum(['DRAFTING', 'IN_REVIEW', 'READY'])
    .optional()
    .describe('Filter by document lifecycle status'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Filter to documents matching ALL specified tags'),
  ...paginationFields,
});

export const helpSearchParameters = z.object({
  query: z.string().min(1).describe('Search query for the global Help corpus'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_HELP_SEARCH_RESULTS)
    .default(10)
    .describe('Maximum number of Help results to return'),
});

export const getHelpNodeParameters = z.object({
  idOrSlugPath: z
    .string()
    .min(1)
    .describe('Canonical Help node UUID or full slash-delimited slug path'),
});

const helpSearchResult = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  snippet: z.string(),
  rank: z.number(),
});

export const helpSearchOutput = z.object({
  results: z.array(helpSearchResult),
});

const helpDemoBase = {
  id: z.string(),
  ordering: z.number().int(),
  caption: z.string(),
};

const helpDemo = z.discriminatedUnion('kind', [
  z.object({
    ...helpDemoBase,
    kind: z.literal(HelpDemoPreset.KindEnum.Preset),
    presetKey: z.string(),
  }),
  z.object({
    ...helpDemoBase,
    kind: z.literal(HelpDemoDsl.KindEnum.Dsl),
    definition: z.object({}).passthrough(),
  }),
]);

export const getHelpNodeOutput = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  slug: z.string(),
  title: z.string(),
  ordering: z.number().int(),
  body: z.string(),
  demos: z.array(helpDemo),
});

const searchResultItem = z.object({
  id: z.string().describe('Entity ID'),
  type: z.string().describe('Entity type'),
  title: z.string().describe('Entity title or summary'),
  snippet: z.string().describe('Relevant text snippet'),
  matchSpans: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        strength: z.number(),
      }),
    )
    .optional()
    .describe(
      'Matched spans with end-exclusive UTF-16 code-unit offsets into matchText, never snippet. Present together with matchText.',
    ),
  matchText: z
    .string()
    .optional()
    .describe(
      'Exact source text indexed by matchSpans; present together with matchSpans.',
    ),
  score: z.number().describe('Relevance score'),
  taskType: z
    .string()
    .optional()
    .describe(
      'Task subtype for TASK-type hits (e.g. STANDARD, BUG, FEATURE, GOAL, or ' +
        'a project-defined custom type), sourced from the search response. ' +
        'Omitted when the search data does not provide a subtype.',
    ),
  metadata: z.record(z.unknown()).optional(),
});

export const searchResultOutput = z.object({
  results: z.array(searchResultItem),
  total: z.number().int().describe('Number of results returned in this page'),
  hasMore: z
    .boolean()
    .describe('Whether more results may exist beyond this page'),
});

type SearchResultOutput = z.infer<typeof searchResultOutput>;

// `unified_search` returns the flat shape above for a single-query call and
// the grouped shape below for a multi-query (`queries`) call. The output
// schema is the union of both so a single tool can serve either shape; the
// runtime value carries exactly one of `results`/`total`/`hasMore` (single)
// or `groups` (multi).
const unifiedSearchGroup = z.object({
  query: z.string().describe('The query this result group was produced from'),
  results: z.array(searchResultItem),
  total: z.number().int().describe('Number of results returned in this group'),
  hasMore: z
    .boolean()
    .describe('Whether more results may exist beyond this group'),
  omittedForSize: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Number of ranked results cut from the end of this page to stay within ' +
        'the response size budget. Present only when results were cut; ' +
        'hasMore is then true. Read the cut results by repeating the query ' +
        'with limit no larger than total and offset a multiple of that limit.',
    ),
});

export const unifiedSearchResultOutput = z.object({
  results: z
    .array(searchResultItem)
    .optional()
    .describe(
      'Flat result list. Present only for a single-query (`query`) call.',
    ),
  total: z
    .number()
    .int()
    .optional()
    .describe(
      'Number of results returned. Present only for a single-query call.',
    ),
  hasMore: z
    .boolean()
    .optional()
    .describe(
      'Whether more results may exist. Present only for a single-query call.',
    ),
  omittedForSize: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Number of ranked results cut from the end of this page to stay within ' +
        'the response size budget. Present only when results were cut; ' +
        'hasMore is then true. Read the cut results by repeating the query ' +
        'with limit no larger than total and offset a multiple of that limit.',
    ),
  groups: z
    .array(unifiedSearchGroup)
    .optional()
    .describe(
      'Per-query result groups, ordered to match the input `queries` array. ' +
        'Present only for a multi-query (`queries`) call.',
    ),
});

type UnifiedSearchResultOutput = z.infer<typeof unifiedSearchResultOutput>;

type SearchPage = {
  results: z.infer<typeof searchResultItem>[];
  total: number;
  hasMore: boolean;
  omittedForSize?: number;
};

/**
 * Cut ranked results from the end of the largest page, one at a time, until
 * the response fits the size budget. Every page keeps its first result. A cut
 * page reports how many results were cut and is marked as having more. Each
 * result is measured once; the cut results are the lowest-ranked of their
 * page, so they are read by paging with a smaller `limit`.
 */
function fitSearchPagesToBudget<T extends SearchPage>(pages: T[]): T[] {
  const sizes = pages.map((page) =>
    page.results.map((result) => JSON.stringify(result).length + 1),
  );
  const kept = sizes.map((pageSizes) => pageSizes.length);
  let total =
    ENVELOPE_ALLOWANCE +
    pages.reduce(
      (sum, page, index) =>
        sum +
        JSON.stringify({ ...page, results: [] }).length +
        sizes[index]!.reduce((pageSum, size) => pageSum + size, 0),
      0,
    );
  while (total > RESPONSE_CHARACTER_BUDGET) {
    const largest = Math.max(...kept);
    if (largest <= 1) break;
    const index = kept.lastIndexOf(largest);
    kept[index]!--;
    total -= sizes[index]![kept[index]!]!;
  }
  return pages.map((page, index): T => {
    const omitted = page.results.length - kept[index]!;
    return omitted === 0
      ? page
      : {
          ...page,
          results: page.results.slice(0, kept[index]),
          total: kept[index]!,
          hasMore: true,
          omittedForSize: omitted,
        };
  });
}

function mapResult(item: UnifiedSearchResult) {
  const snippet =
    truncate(item.content, MAX_SNIPPET_LENGTH) ||
    truncate(item.topologySummary, MAX_SNIPPET_LENGTH);

  const meta = item.embeddings?.metadata as CanonicalTaskMetadata | undefined;
  const isFeature = meta?.taskType === 'FEATURE';

  return {
    id: item.entityId ?? '',
    type: item.entityType ?? '',
    title: item.title ?? '',
    snippet,
    score: item.score ?? 0,
    ...(item.embeddings?.matchSpans !== undefined &&
    item.embeddings.text !== undefined
      ? {
          matchSpans: item.embeddings.matchSpans,
          matchText: item.embeddings.text,
        }
      : {}),
    // Surface the task subtype straight from the search metadata so callers
    // can tell a feature/bug/goal hit from a standard one without a follow-up
    // lookup; omit it entirely when the search data carries no subtype.
    ...(meta?.taskType ? { taskType: meta.taskType } : {}),
    metadata: {
      // Features have no meaningful work status; omit it so search results
      // mirror the get_context invariant (FEATURE entries never carry status).
      ...(isFeature ? {} : { status: item.status ?? null }),
      sources: item.sources ?? [],
      graphScore: item.graphScore ?? null,
      semanticScore: item.semanticScore ?? null,
    },
  };
}

const DEFAULT_TYPES: EntityType[] = [
  EntityType.Task,
  EntityType.DesignDoc,
  EntityType.Message,
];

// BACKLOG: all "not ready to work on" states (generated, refining, on hold)
// IN_PROGRESS: actively being worked on
// IN_REVIEW: verification phase
// DONE / CANCELLED: terminal states
const MCP_TO_TASK_STATUSES: Record<string, WorkStatus[]> = {
  BACKLOG: [
    WorkStatus.Generated,
    WorkStatus.Backlog,
    WorkStatus.RefiningDescription,
    WorkStatus.RefiningDetails,
    WorkStatus.RefiningAcceptanceCriteria,
    WorkStatus.GeneratingDescription,
    WorkStatus.GeneratingDetails,
    WorkStatus.GeneratingDescriptionAndDetails,
    WorkStatus.GeneratingAcceptanceCriteria,
    WorkStatus.GeneratingAll,
    WorkStatus.OnHold,
  ],
  IN_PROGRESS: [WorkStatus.Active],
  IN_REVIEW: [WorkStatus.Verifying],
  DONE: [WorkStatus.Completed],
  CANCELLED: [WorkStatus.Cancelled],
};

// Simplified MCP-facing status → internal design doc workflow statuses.
// ADR statuses come from src/types/design-doc.types.ts (runtime domain);
// non-ADR statuses from src/generated/model/brainstormStatus.ts and
// decisionStatus.ts. Note: archiving uses archivedAt, not a status value.
const MCP_TO_DESIGN_DOC_STATUSES: Record<string, string[]> = {
  DRAFTING: [
    'ADR_CONTEXT',
    'ADR_REFINING_CONTEXT',
    'ADR_GENERATING_DECISION',
    'ADR_REFINING_DECISION',
    'ADR_DECISION',
    'ADR_GENERATING_CONSEQUENCES',
    'ADR_REFINING_CONSEQUENCES',
    'ADR_CONSEQUENCES',
    'REFINING_CONTENT',
  ],
  IN_REVIEW: ['ADR_REVIEW', 'IN_REVIEW'],
  READY: ['READY'],
};

@Injectable()
export class SearchToolsProvider {
  private readonly logger = new Logger(SearchToolsProvider.name);

  constructor(
    private readonly unifiedSearchService: UnifiedSearchService,
    private readonly searchCache: SearchCacheService,
    private readonly helpService: HelpService,
  ) {}

  @Tool({
    name: 'search_help',
    description:
      'Search the global published Help corpus. Returns canonical Help node ' +
      'identifiers and slugs with titles, snippets, and lexical ranking metadata.',
    parameters: helpSearchParameters,
    outputSchema: helpSearchOutput,
  })
  async searchHelp(
    params: z.infer<typeof helpSearchParameters>,
  ): Promise<HelpSearchResponse | CallToolResult> {
    const query = params.query.trim();
    if (!query) {
      return mcpError('Help search query must not be blank.');
    }

    const limit = Math.min(params.limit, MAX_HELP_SEARCH_RESULTS);

    try {
      const response = await this.helpService.searchHelpNodes(query, limit);
      return {
        results: response.results.map((result) => ({
          id: result.id,
          slug: result.slug,
          title: result.title,
          snippet: result.snippet,
          rank: result.rank,
        })),
      } satisfies HelpSearchResponse;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`search_help failed: ${message}`);
      return mcpError(`Help search failed: ${message}`);
    }
  }

  @Tool({
    name: 'get_help_node',
    description:
      'Open one canonical published Help node by UUID or full slug path. ' +
      'Returns its Markdown body and ordered preset or DSL demo attachments.',
    parameters: getHelpNodeParameters,
    outputSchema: getHelpNodeOutput,
  })
  async getHelpNode(
    params: z.infer<typeof getHelpNodeParameters>,
  ): Promise<HelpNodeWithBody | CallToolResult> {
    const idOrSlugPath = params.idOrSlugPath.trim();
    if (!idOrSlugPath) {
      return mcpError('Help node identifier must not be blank.');
    }

    try {
      const node = await this.helpService.findByIdOrSlugPath(idOrSlugPath);
      if (!node) {
        return mcpError('Help node not found.');
      }
      return node;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`get_help_node failed: ${message}`);
      return mcpError(`Help node retrieval failed: ${message}`);
    }
  }

  @Tool({
    name: 'unified_search',
    description:
      'Search across content types (tasks, design docs, plans, and messages) ' +
      'in a project. Returns ranked results with relevance scores and text ' +
      'snippets for context. Provide EITHER `query` (a single search, ' +
      'returning a flat { results, total, hasMore }) OR `queries` (a batch of ' +
      'up to 5 searches run in one call, returning { groups } — one ordered ' +
      'group per input query so you can correlate results back to the query ' +
      'that produced them). Exactly one of `query`/`queries` is required. Use ' +
      '`queries` to fan out related orientation searches (e.g. after ' +
      'get_context) without multiple round-trips. Shared filters ' +
      '(`entityTypes`, `downrankUnreviewed`, `createdAfter`, `createdBefore`, ' +
      '`updatedAfter`, `updatedBefore`) ' +
      'and `limit` apply to every query. Pass `entityTypes` to scope to a ' +
      'subset (e.g. ["MESSAGE"] to search conversation history only). Pass ' +
      '`createdAfter` and/or `createdBefore` (ISO-8601 date-times) to scope ' +
      'results to an entity creation-time window. Pass `updatedAfter` and/or ' +
      "`updatedBefore` to scope results to each entity's own update-time " +
      'window. Both time ranges can be combined. The response stays within ' +
      'an 8,000-token estimated budget: when it would not fit, ranked ' +
      'results are cut from the end, hasMore is true, and omittedForSize ' +
      'says how many were cut — repeat the query with limit no larger than ' +
      'total and page through it with offset in steps of that limit.',
    parameters: unifiedSearchParameters,
    outputSchema: unifiedSearchResultOutput,
  })
  async unifiedSearch(
    params: z.infer<typeof unifiedSearchParameters>,
    _context: Context,
    request: Request,
  ): Promise<UnifiedSearchResultOutput | CallToolResult> {
    this.logger.debug('unified_search called', { params });

    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const resolved = resolveProjectId({}, request);
    if (!isProjectId(resolved)) return resolved;
    const projectId = resolved;

    const {
      query,
      queries,
      entityTypes,
      downrankUnreviewed,
      createdAfter,
      createdBefore,
      updatedAfter,
      updatedBefore,
      limit,
      offset,
    } = params;

    const hasSingle = typeof query === 'string' && query.length > 0;
    const hasMulti = Array.isArray(queries) && queries.length > 0;
    if (hasSingle === hasMulti) {
      return mcpError(
        'Provide exactly one of `query` (single search) or `queries` ' +
          '(batch of searches).',
      );
    }
    if (hasMulti && queries.length > MAX_UNIFIED_SEARCH_QUERIES) {
      return mcpError(
        `Too many queries: ${queries.length} provided, but at most ` +
          `${MAX_UNIFIED_SEARCH_QUERIES} are allowed per call.`,
      );
    }

    const shared = {
      entityTypes,
      downrankUnreviewed,
      createdAfter,
      createdBefore,
      updatedAfter,
      updatedBefore,
      limit,
      offset,
    };

    try {
      if (hasMulti) {
        // Run each query through the same single-query pipeline (cache
        // included) and return one ordered group per query. Promise.all
        // preserves input order so callers can correlate groups back to the
        // query that produced them.
        const groups = await Promise.all(
          queries.map(async (singleQuery) => ({
            query: singleQuery,
            ...(await this.runUnifiedQuery(
              singleQuery,
              shared,
              auth,
              projectId,
            )),
          })),
        );
        this.logger.debug('unified_search (multi-query) completed', {
          queryCount: groups.length,
          totalsByQuery: groups.map((group) => group.total),
        });
        return { groups: fitSearchPagesToBudget(groups) };
      }

      // `hasSingle` (mutually exclusive with `hasMulti`, checked above)
      // guarantees `query` is a non-empty string here.
      const [page] = fitSearchPagesToBudget([
        await this.runUnifiedQuery(query as string, shared, auth, projectId),
      ]);
      return page!;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`unified_search failed: ${message}`, stack);
      return mcpError(`Search failed: ${message}`);
    }
  }

  /**
   * Execute one unified-search query through the hybrid pipeline (graph +
   * embeddings) with caching. Shared filters and pagination apply identically
   * whether the query arrived via `query` or as one entry of a `queries`
   * batch. Throws on service failure so the caller's single try/catch can map
   * it to an MCP error.
   */
  private async runUnifiedQuery(
    query: string,
    shared: {
      entityTypes?: (typeof UNIFIED_SEARCH_ENTITY_TYPES)[number][];
      downrankUnreviewed?: boolean;
      createdAfter?: string;
      createdBefore?: string;
      updatedAfter?: string;
      updatedBefore?: string;
      limit: number;
      offset: number;
    },
    auth: AuthContext,
    projectId: ProjectId,
  ): Promise<SearchResultOutput> {
    const {
      entityTypes,
      downrankUnreviewed,
      createdAfter,
      createdBefore,
      updatedAfter,
      updatedBefore,
      limit,
      offset,
    } = shared;

    const resolvedTypes: EntityType[] = entityTypes?.length
      ? (entityTypes as EntityType[])
      : DEFAULT_TYPES;

    const scopeKey = this.searchCache.buildScopeKey(
      auth.organizationId,
      projectId,
    );
    const cacheParams = {
      tool: 'unified_search',
      query,
      projectId,
      organizationId: auth.organizationId,
      entityTypes: resolvedTypes,
      downrankUnreviewed,
      createdAfter,
      createdBefore,
      updatedAfter,
      updatedBefore,
      limit,
      offset,
    };
    const cacheKey = this.searchCache.generateKey(cacheParams);
    const filterFp = this.searchCache.buildFilterFingerprint(cacheParams);

    const cached =
      this.searchCache.get<SearchResultOutput>(cacheKey) ??
      this.searchCache.findSimilar<SearchResultOutput>(
        query,
        scopeKey,
        filterFp,
      );
    if (cached) {
      this.logger.debug('unified_search cache hit', {
        query,
        total: cached.total,
      });
      return cached;
    }

    const graphPage = Math.floor(offset / limit);

    // Only attach a range when at least one bound is supplied so an
    // unfiltered call produces exactly the same request as before. Routing
    // through common filters reaches both retrieval services.
    const dateRange =
      createdAfter || createdBefore
        ? { from: createdAfter, to: createdBefore }
        : undefined;
    const updatedAtRange =
      updatedAfter || updatedBefore
        ? { from: updatedAfter, to: updatedBefore }
        : undefined;

    const searchRequest: UnifiedSearchRequest = {
      intent: 'hybrid',
      query,
      excludeContentless: true,
      downrankUnreviewed: downrankUnreviewed ?? false,
      common: {
        types: resolvedTypes,
        ...(dateRange ? { dateRange } : {}),
        ...(updatedAtRange ? { updatedAtRange } : {}),
      },
      embeddings: {
        queryMode: 'default',
        maxResults: limit,
        offset,
      },
      graph: {
        page: graphPage,
        size: limit,
      },
    };

    const response = await this.unifiedSearchService.search(
      auth.organizationId,
      projectId as ProjectId,
      searchRequest,
      auth.token,
      SearchProjection.CompactRanked,
    );

    const items = response.results ?? [];
    const paged = items.slice(0, limit);
    const mapped = paged.map(mapResult);
    const hasMore = items.length > limit;

    const result: SearchResultOutput = {
      results: mapped,
      total: mapped.length,
      hasMore,
    };

    this.logger.debug('unified_search completed', {
      query,
      entityTypes: resolvedTypes,
      entityTypesExplicit: !!entityTypes?.length,
      limit,
      offset,
      rawCount: items.length,
      returnedCount: mapped.length,
      hasMore,
    });

    this.searchCache.set(cacheKey, query, scopeKey, filterFp, result);
    return result;
  }

  @Tool({
    name: 'task_search',
    description:
      'Search for tasks within a project with optional filtering ' +
      'by status, priority, and initiative. Returns tasks ranked ' +
      'by relevance with content snippets.',
    parameters: taskSearchParameters,
    outputSchema: searchResultOutput,
  })
  async taskSearch(
    params: z.infer<typeof taskSearchParameters>,
    _context: Context,
    request: Request,
    toolNameOverride?: string,
  ): Promise<SearchResultOutput | CallToolResult> {
    const toolName = toolNameOverride ?? 'task_search';
    this.logger.debug(`${toolName} called`, { params });

    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const resolved = resolveProjectId({}, request);
    if (!isProjectId(resolved)) return resolved;
    const projectId = resolved;

    const {
      query,
      status,
      priority,
      initiativeId,
      taskType,
      downrankUnreviewed,
      limit,
      offset,
    } = params;

    const scopeKey = this.searchCache.buildScopeKey(
      auth.organizationId,
      projectId,
    );
    const cacheParams = {
      tool: toolName,
      query,
      projectId,
      organizationId: auth.organizationId,
      status,
      priority,
      initiativeId,
      taskType,
      downrankUnreviewed,
      limit,
      offset,
    };
    const cacheKey = this.searchCache.generateKey(cacheParams);
    const filterFp = this.searchCache.buildFilterFingerprint(cacheParams);

    const cached =
      this.searchCache.get<SearchResultOutput>(cacheKey) ??
      this.searchCache.findSimilar<SearchResultOutput>(
        query,
        scopeKey,
        filterFp,
      );
    if (cached) {
      this.logger.debug(`${toolName} cache hit`, {
        query,
        total: cached.total,
      });
      return cached;
    }

    const hasPostFetchFilters = !!(status || priority || initiativeId);
    const hasFilters = hasPostFetchFilters || !!taskType;
    const fetchLimit = hasPostFetchFilters
      ? Math.min(limit * FILTER_OVER_FETCH_MULTIPLIER, 50)
      : taskType
        ? limit + 1
        : limit;

    const mappedStatuses = status ? MCP_TO_TASK_STATUSES[status] : undefined;

    try {
      const searchRequest: UnifiedSearchRequest = {
        intent: 'semantic',
        query,
        downrankUnreviewed: downrankUnreviewed ?? false,
        common: {
          types: [EntityType.Task],
          ...(taskType ? { taskTypes: [taskType] } : {}),
        },
        embeddings: {
          queryMode: 'default',
          maxResults: fetchLimit,
          offset: hasPostFetchFilters ? 0 : offset,
        },
      };

      const response = await this.unifiedSearchService.search(
        auth.organizationId,
        projectId as ProjectId,
        searchRequest,
        auth.token,
        SearchProjection.CompactRanked,
      );

      let items = response.results ?? [];
      const rawCount = items.length;

      this.logger.debug(`${toolName} raw results`, {
        query,
        rawCount,
        hasFilters,
        fetchLimit,
        results: items.map((item) => {
          const meta = item.embeddings?.metadata as
            | CanonicalTaskMetadata
            | undefined;
          return {
            entityId: item.entityId,
            entityType: item.entityType,
            title: item.title,
            status: item.status,
            score: item.score,
            sources: item.sources,
            taskType: meta?.taskType,
            priority: meta?.priority,
            initiativeId: meta?.initiativeId,
            name: meta?.name,
            metadataType: meta?.type,
          };
        }),
      });

      if (mappedStatuses) {
        const before = items.length;
        const statusSet = new Set(mappedStatuses);
        items = items.filter(
          (item) => item.status && statusSet.has(item.status as WorkStatus),
        );
        this.logger.debug(`${toolName} status filter`, {
          filter: status,
          mappedStatuses,
          before,
          after: items.length,
        });
      }

      if (priority) {
        const before = items.length;
        items = items.filter((item) => {
          const meta = item.embeddings?.metadata as
            | CanonicalTaskMetadata
            | undefined;
          return meta?.priority === priority;
        });
        this.logger.debug(`${toolName} priority filter`, {
          filter: priority,
          before,
          after: items.length,
        });
      }

      if (initiativeId) {
        const before = items.length;
        items = items.filter((item) => {
          const meta = item.embeddings?.metadata as
            | CanonicalTaskMetadata
            | undefined;
          return meta?.initiativeId === initiativeId;
        });
        this.logger.debug(`${toolName} initiativeId filter`, {
          filter: initiativeId,
          before,
          after: items.length,
        });
      }

      // Filters applied after retrieval need a candidate window from offset 0;
      // subtype-only searches are already filtered by the API and paginate there.
      const paged = hasPostFetchFilters
        ? items.slice(offset, offset + limit)
        : items.slice(0, limit);

      const mapped = paged.map((item) => {
        const base = mapResult(item);
        const meta = item.embeddings?.metadata as
          | CanonicalTaskMetadata
          | undefined;
        return {
          ...base,
          metadata: {
            ...base.metadata,
            priority: meta?.priority ?? null,
            initiativeId: meta?.initiativeId ?? null,
          },
        };
      });

      const hasMore =
        (hasPostFetchFilters
          ? items.length > offset + limit
          : items.length > limit) ||
        (hasPostFetchFilters && !taskType && rawCount >= fetchLimit);

      this.logger.debug(`${toolName} completed`, {
        query,
        rawCount,
        postFilterCount: items.length,
        returnedCount: mapped.length,
        hasMore,
      });

      const result: SearchResultOutput = {
        results: mapped,
        total: mapped.length,
        hasMore,
      };

      this.searchCache.set(cacheKey, query, scopeKey, filterFp, result);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`${toolName} failed: ${message}`, stack);
      return mcpError(`${toolName} failed: ${message}`);
    }
  }

  @Tool({
    name: 'search_features',
    description:
      'Search for FEATURE-type tasks within a project. Pre-filters to ' +
      'features only — callers never need to specify task type. Supports ' +
      'optional filtering by status, priority, and initiative. Returns ' +
      'features ranked by relevance with content snippets.',
    parameters: featureSearchParameters,
    outputSchema: searchResultOutput,
  })
  async searchFeatures(
    params: z.infer<typeof featureSearchParameters>,
    _context: Context,
    request: Request,
  ): Promise<SearchResultOutput | CallToolResult> {
    this.logger.debug('search_features called', { params });
    return this.taskSearch(
      { ...params, taskType: 'FEATURE' },
      _context,
      request,
      'search_features',
    );
  }

  @Tool({
    name: 'search_goals',
    description:
      'Search for GOAL-type tasks within a project. Pre-filters to goals ' +
      'only — callers never need to specify task type. Supports optional ' +
      'filtering by status, priority, and initiative. Returns goals ranked ' +
      'by relevance with content snippets.',
    parameters: goalSearchParameters,
    outputSchema: searchResultOutput,
  })
  async searchGoals(
    params: z.infer<typeof goalSearchParameters>,
    _context: Context,
    request: Request,
  ): Promise<SearchResultOutput | CallToolResult> {
    this.logger.debug('search_goals called', { params });
    return this.taskSearch(
      { ...params, taskType: 'GOAL' },
      _context,
      request,
      'search_goals',
    );
  }

  @Tool({
    name: 'plan_search',
    description:
      'Search for plans within a project with optional filtering ' +
      'by status and owner. Returns plans ranked by relevance ' +
      'with content snippets and plan metadata.',
    parameters: planSearchParameters,
    outputSchema: searchResultOutput,
  })
  async planSearch(
    params: z.infer<typeof planSearchParameters>,
    context: Context,
    request: Request,
  ): Promise<SearchResultOutput | CallToolResult> {
    return this.taskSearch(
      { ...params, taskType: 'PLAN' },
      context,
      request,
      'plan_search',
    );
  }

  @Tool({
    name: 'search_design_docs',
    description:
      'Search for design documents (ADRs, decisions, brainstorms, plan documents) ' +
      'within a project. Supports filtering by template type, lifecycle status, ' +
      'and tags. Returns documents ranked by relevance with content excerpts.',
    parameters: designDocSearchParameters,
    outputSchema: searchResultOutput,
  })
  async designDocSearch(
    params: z.infer<typeof designDocSearchParameters>,
    _context: Context,
    request: Request,
  ): Promise<SearchResultOutput | CallToolResult> {
    this.logger.debug('search_design_docs called', { params });

    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const resolved = resolveProjectId({}, request);
    if (!isProjectId(resolved)) return resolved;
    const projectId = resolved;

    const { query, template, status, tags, limit, offset } = params;

    const scopeKey = this.searchCache.buildScopeKey(
      auth.organizationId,
      projectId,
    );
    const cacheParams = {
      tool: 'search_design_docs',
      query,
      projectId,
      organizationId: auth.organizationId,
      template,
      status,
      tags,
      limit,
      offset,
    };
    const cacheKey = this.searchCache.generateKey(cacheParams);
    const filterFp = this.searchCache.buildFilterFingerprint(cacheParams);

    const cached =
      this.searchCache.get<SearchResultOutput>(cacheKey) ??
      this.searchCache.findSimilar<SearchResultOutput>(
        query,
        scopeKey,
        filterFp,
      );
    if (cached) {
      this.logger.debug('search_design_docs cache hit', {
        query,
        total: cached.total,
      });
      return cached;
    }

    const mappedStatuses = status
      ? MCP_TO_DESIGN_DOC_STATUSES[status]
      : undefined;
    const hasClientFilters = !!mappedStatuses;
    const fetchLimit = hasClientFilters
      ? Math.min(limit * FILTER_OVER_FETCH_MULTIPLIER, 50)
      : limit;

    try {
      const graphPage = Math.floor(offset / limit);
      const searchRequest: UnifiedSearchRequest = {
        intent: 'hybrid',
        query,
        excludeContentless: true,
        common: {
          types: [EntityType.DesignDoc],
        },
        embeddings: {
          queryMode: 'default',
          maxResults: fetchLimit,
          offset: hasClientFilters ? 0 : offset,
          filters: {
            ...(template ? { docTypes: [template] } : {}),
            ...(tags?.length ? { tags } : {}),
          },
        },
        graph: {
          page: graphPage,
          size: fetchLimit,
        },
      };

      const response = await this.unifiedSearchService.search(
        auth.organizationId,
        projectId as ProjectId,
        searchRequest,
        auth.token,
        SearchProjection.CompactRanked,
      );

      let items = response.results ?? [];
      const rawCount = items.length;

      if (mappedStatuses) {
        const statusSet = new Set(mappedStatuses);
        items = items.filter(
          (item) => item.status && statusSet.has(item.status),
        );
      }

      const paged = hasClientFilters
        ? items.slice(offset, offset + limit)
        : items.slice(0, limit);

      const mapped = paged.map((item) => {
        const base = mapResult(item);
        return {
          ...base,
          metadata: {
            ...base.metadata,
            template: item.graph?.node?.['template'] ?? null,
            tags: item.graph?.node?.['tags'] ?? null,
          },
        };
      });

      const hasMore =
        (hasClientFilters
          ? items.length > offset + limit
          : items.length > limit) || rawCount >= fetchLimit;

      const result: SearchResultOutput = {
        results: mapped,
        total: mapped.length,
        hasMore,
      };

      this.logger.debug('search_design_docs completed', {
        query,
        rawCount,
        postFilterCount: items.length,
        returnedCount: mapped.length,
        hasMore,
      });

      this.searchCache.set(cacheKey, query, scopeKey, filterFp, result);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`search_design_docs failed: ${message}`, stack);
      return mcpError(`Design doc search failed: ${message}`);
    }
  }
}
