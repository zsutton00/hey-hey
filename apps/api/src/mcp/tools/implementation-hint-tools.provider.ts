import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { AgentSessionService } from '../../services/agent-session.service';
import { UnifiedSearchService } from '../../services/unified-search/unified-search.service';
import { ImplementationHintService } from '../../services/service/implementation-hint.service';
import {
  CreateImplementationHintDto,
  EntityType,
  ImplementationHintExtractedFrom,
  UnifiedSearchRequest,
} from '../../generated';
import { ProjectId } from '../../types';
import {
  extractAuthContext,
  isAgentSessionId,
  isAuthContext,
  mcpError,
  paginationFields,
  resolveAgentSessionId,
  resolveProjectId,
  isProjectId,
  resolveServiceId,
  isServiceId,
  truncate,
} from './mcp-tool.utils';
import { SearchCacheService } from './search-cache.service';

const MAX_SNIPPET_LENGTH = 300;
export const IMPLEMENTATION_HINT_SEARCH_TIMEOUT_MS = 15_000;

const normalizeAuthorizedServiceIds = (
  serviceIds: readonly string[] | undefined,
): string[] => Array.from(new Set(serviceIds ?? [])).sort();

class ImplementationHintSearchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Implementation hint search timed out after ${timeoutMs}ms`);
    this.name = 'ImplementationHintSearchTimeoutError';
  }
}

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new ImplementationHintSearchTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

const searchImplementationHintsParameters = z.object({
  query: z
    .string()
    .min(1)
    .describe('Natural language search query for implementation hints'),
  ...paginationFields,
});

const implementationHintSearchOutput = z.object({
  results: z.array(
    z.object({
      id: z.string().describe('Implementation hint ID'),
      type: z.string().describe('Entity type'),
      title: z.string().describe('Feature name'),
      snippet: z.string().describe('Hint content excerpt'),
      score: z.number().describe('Relevance score'),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  total: z.number().int().describe('Number of results returned in this page'),
  hasMore: z
    .boolean()
    .describe('Whether more results may exist beyond this page'),
});

type ImplementationHintSearchOutput = z.infer<
  typeof implementationHintSearchOutput
>;

const createImplementationHintParameters = z.object({
  featureName: z
    .string()
    .min(1)
    .describe('Feature or module area this hint applies to'),
  description: z
    .string()
    .min(1)
    .describe('Human-readable description of the implementation guidance'),
  hint: z
    .string()
    .optional()
    .describe('Canonical hint content (the concrete guidance text)'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence score for this hint (0–1)'),
});

const createImplementationHintOutput = z.object({
  id: z.string().describe('Created hint ID'),
  featureName: z.string(),
  description: z.string(),
  hint: z.string().optional(),
  confidence: z.number().optional(),
});

type CreateImplementationHintOutput = z.infer<
  typeof createImplementationHintOutput
>;

const editImplementationHintParameters = z.object({
  hintId: z.string().uuid().describe('ID of the hint to update'),
  featureName: z.string().min(1).optional().describe('Updated feature name'),
  description: z.string().min(1).optional().describe('Updated description'),
  hint: z.string().optional().describe('Updated hint content'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Updated confidence score (0–1)'),
});

const editImplementationHintOutput = z.object({
  id: z.string().describe('Updated hint ID'),
  featureName: z.string(),
  description: z.string(),
  hint: z.string().optional(),
  confidence: z.number().optional(),
});

type EditImplementationHintOutput = z.infer<
  typeof editImplementationHintOutput
>;

const deleteImplementationHintParameters = z.object({
  hintId: z
    .string()
    .uuid()
    .describe(
      'ID of the hint to delete (use when the underlying code no longer exists)',
    ),
});

const deleteImplementationHintOutput = z.object({
  deleted: z.boolean(),
  hintId: z.string(),
});

type DeleteImplementationHintOutput = z.infer<
  typeof deleteImplementationHintOutput
>;

@Injectable()
export class ImplementationHintToolsProvider {
  private readonly logger = new Logger(ImplementationHintToolsProvider.name);

  constructor(
    private readonly unifiedSearchService: UnifiedSearchService,
    private readonly searchCache: SearchCacheService,
    private readonly implementationHintService: ImplementationHintService,
    private readonly agentSessionService: AgentSessionService,
  ) {}

  @Tool({
    name: 'search_implementation_hints',
    description:
      "Search implementation hints for the active coding session's " +
      'authorized Services. Returns hints ranked by semantic relevance, scoped ' +
      "to the session's project and authorized Service context (the request " +
      'identifies the authenticated Agent Session, not the scope).',
    parameters: searchImplementationHintsParameters,
    outputSchema: implementationHintSearchOutput,
  })
  async searchImplementationHints(
    params: z.infer<typeof searchImplementationHintsParameters>,
    _context: Context,
    request: Request,
  ): Promise<ImplementationHintSearchOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const agentSessionId = resolveAgentSessionId(request);
    if (!isAgentSessionId(agentSessionId)) return agentSessionId;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    let agentSession: Awaited<ReturnType<AgentSessionService['findOne']>>;
    try {
      this.logger.debug('search_implementation_hints.scope_resolving', {
        organizationId: auth.organizationId,
        projectId,
        agentSessionId,
      });
      agentSession = await this.agentSessionService.findOne(
        auth.organizationId,
        agentSessionId,
        { projectId },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('search_implementation_hints.scope_resolution_failed', {
        organizationId: auth.organizationId,
        projectId,
        agentSessionId,
        message,
      });
      return mcpError(`Implementation hint search context failed: ${message}`);
    }

    const serviceIds = normalizeAuthorizedServiceIds(agentSession.serviceIds);
    if (serviceIds.length === 0) {
      this.logger.warn('search_implementation_hints.scope_missing', {
        organizationId: auth.organizationId,
        projectId,
        agentSessionId,
      });
      return mcpError(
        'Missing authorized Service context: the Agent Session has no authorized Services.',
      );
    }

    this.logger.debug('search_implementation_hints.scope_resolved', {
      organizationId: auth.organizationId,
      projectId,
      agentSessionId,
      serviceIds,
    });

    const { query, limit, offset } = params;

    const scopeKey = this.searchCache.buildScopeKey(
      auth.organizationId,
      projectId,
    );
    const cacheParams = {
      tool: 'search_implementation_hints',
      query,
      projectId,
      organizationId: auth.organizationId,
      serviceIds,
      limit,
      offset,
    };
    const cacheKey = this.searchCache.generateKey(cacheParams);
    const filterFp = this.searchCache.buildFilterFingerprint(cacheParams);

    const cached =
      this.searchCache.get<ImplementationHintSearchOutput>(cacheKey) ??
      this.searchCache.findSimilar<ImplementationHintSearchOutput>(
        query,
        scopeKey,
        filterFp,
      );
    if (cached) return cached;

    try {
      const searchRequest: UnifiedSearchRequest = {
        intent: 'semantic',
        query,
        common: {
          types: [EntityType.ImplementationHint],
        },
        embeddings: {
          queryMode: 'default',
          maxResults: limit,
          offset,
          filters: {
            serviceIds,
          },
        },
      };

      const response = await withTimeout(
        this.unifiedSearchService.search(
          auth.organizationId,
          projectId as ProjectId,
          searchRequest,
          auth.token,
        ),
        IMPLEMENTATION_HINT_SEARCH_TIMEOUT_MS,
      );

      const items = response.results ?? [];
      const paged = items.slice(0, limit);

      const mapped = paged.map((item) => ({
        id: item.entityId ?? '',
        type: item.entityType ?? EntityType.ImplementationHint,
        title: item.title ?? '',
        snippet:
          truncate(item.content, MAX_SNIPPET_LENGTH) ||
          truncate(item.topologySummary, MAX_SNIPPET_LENGTH),
        score: item.score ?? 0,
        metadata: {
          sources: item.sources ?? [],
          semanticScore: item.semanticScore ?? null,
          ...(serviceIds.length === 1
            ? { serviceId: serviceIds[0] }
            : { serviceIds }),
        },
      }));

      const hasMore = items.length > limit;

      const result: ImplementationHintSearchOutput = {
        results: mapped,
        total: mapped.length,
        hasMore,
      };

      // Cache TTL is 60s — writes via create/edit/delete will not invalidate
      // search results immediately, so newly created hints may not appear
      // in search until the cache entry expires.
      this.searchCache.set(cacheKey, query, scopeKey, filterFp, result);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(
        `search_implementation_hints failed: ${message}\n${stack}`,
      );
      return mcpError(`Implementation hint search failed: ${message}`);
    }
  }

  @Tool({
    name: 'create_implementation_hint',
    description:
      'Create a new implementation hint for the active service. Use at the end ' +
      'of an implementation session to record patterns, conventions, or guidance ' +
      'discovered while working on a feature. Service is resolved from the ' +
      'X-Service-ID request header; agent session from X-Agent-Session-ID.',
    parameters: createImplementationHintParameters,
    outputSchema: createImplementationHintOutput,
  })
  async createImplementationHint(
    params: z.infer<typeof createImplementationHintParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreateImplementationHintOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const serviceId = resolveServiceId({}, request);
    if (!isServiceId(serviceId)) return serviceId;

    const agentSessionId = resolveAgentSessionId(request);
    if (!isAgentSessionId(agentSessionId)) return agentSessionId;

    const { featureName, description, hint, confidence } = params;

    this.logger.log('create_implementation_hint called', {
      organizationId: auth.organizationId,
      serviceId,
      featureName,
    });

    try {
      const created = await this.implementationHintService.create(
        auth.organizationId,
        {
          serviceId,
          agentSessionId,
          featureName,
          description,
          sourceType: CreateImplementationHintDto.SourceTypeEnum.System,
          extractedFrom: ImplementationHintExtractedFrom.Agent,
          ...(hint !== undefined && { hint }),
          ...(confidence !== undefined && { confidence }),
        },
      );

      return {
        id: created.id,
        featureName: created.featureName,
        description: created.description,
        hint: created.hint ?? undefined,
        confidence: created.confidence ?? undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(
        `create_implementation_hint failed: ${message}\n${stack}`,
      );
      return mcpError(`Implementation hint creation failed: ${message}`);
    }
  }

  @Tool({
    name: 'edit_implementation_hint',
    description:
      'Update an existing implementation hint. Use to refine guidance discovered ' +
      'in a prior session, correct outdated details, or update the confidence score. ' +
      'Service is resolved from the X-Service-ID request header.',
    parameters: editImplementationHintParameters,
    outputSchema: editImplementationHintOutput,
  })
  async editImplementationHint(
    params: z.infer<typeof editImplementationHintParameters>,
    _context: Context,
    request: Request,
  ): Promise<EditImplementationHintOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const serviceId = resolveServiceId({}, request);
    if (!isServiceId(serviceId)) return serviceId;

    const { hintId, featureName, description, hint, confidence } = params;

    if (
      featureName === undefined &&
      description === undefined &&
      hint === undefined &&
      confidence === undefined
    ) {
      return mcpError('No fields provided to update.');
    }

    this.logger.log('edit_implementation_hint called', {
      organizationId: auth.organizationId,
      hintId,
      serviceId,
    });

    try {
      const updated = await this.implementationHintService.update(
        auth.organizationId,
        hintId,
        {
          serviceId,
          ...(featureName !== undefined && { featureName }),
          ...(description !== undefined && { description }),
          ...(hint !== undefined && { hint }),
          ...(confidence !== undefined && { confidence }),
        },
      );

      return {
        id: updated.id,
        featureName: updated.featureName,
        description: updated.description,
        hint: updated.hint ?? undefined,
        confidence: updated.confidence ?? undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(`edit_implementation_hint failed: ${message}\n${stack}`);
      return mcpError(`Implementation hint update failed: ${message}`);
    }
  }

  @Tool({
    name: 'delete_implementation_hint',
    description:
      'Delete an implementation hint. Use when the code or feature the hint ' +
      'describes no longer exists, to keep the hint index clean and accurate.',
    parameters: deleteImplementationHintParameters,
    outputSchema: deleteImplementationHintOutput,
  })
  async deleteImplementationHint(
    params: z.infer<typeof deleteImplementationHintParameters>,
    _context: Context,
    request: Request,
  ): Promise<DeleteImplementationHintOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const { hintId } = params;

    this.logger.log('delete_implementation_hint called', {
      organizationId: auth.organizationId,
      hintId,
    });

    try {
      await this.implementationHintService.remove(auth.organizationId, hintId);
      return { deleted: true, hintId };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(
        `delete_implementation_hint failed: ${message}\n${stack}`,
      );
      return mcpError(`Implementation hint deletion failed: ${message}`);
    }
  }
}
