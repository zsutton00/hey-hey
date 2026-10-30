import { z } from 'zod/v4';
import { Configuration, EntityType, SearchApi } from '../../shared/api/generated';
import type { LiveReaderDeps, TitledRef } from '../traversal';

/**
 * One search Project Assistant asked for: a query and, optionally, the entity types to search and
 * the work-item types that narrow TASK hits. Work-item type keys are registry-backed and include
 * project-defined keys, so the search endpoint takes any string; so does this.
 */
export const plannedSearchSchema = z.object({
  query: z.string().trim().min(1),
  types: z
    .array(z.enum(EntityType))
    .min(1)
    .optional()
    .describe(
      'Entity types to search; omit to search every type. Features, Contracts, Decisions, bugs and every other work item are TASK.',
    ),
  taskTypes: z
    .array(z.string().trim().min(1))
    .min(1)
    .optional()
    .describe(
      'Work-item type keys that narrow TASK results, such as FEATURE, STANDARD, BUG, CONTRACT or decision; omit to keep every kind of work item.',
    ),
});

export type PlannedSearch = z.infer<typeof plannedSearchSchema>;

/** Runs one search against the project. Rejects when the search fails; nothing is hidden. */
export interface SearchExecutor {
  search(planned: PlannedSearch, signal?: AbortSignal): Promise<TitledRef[]>;
}

/** The part of a unified search answer the stage reads; hits without an id or type are not entities. */
const responseSchema = z.object({
  data: z.object({
    results: z
      .array(
        z
          .object({
            entityId: z.string().min(1),
            entityType: z.enum(EntityType),
            title: z.string().optional(),
            embeddings: z
              .object({
                text: z.string().optional(),
                matchSpans: z
                  .array(
                    z.object({
                      start: z.number().int().nonnegative(),
                      end: z.number().int().nonnegative(),
                      strength: z.number().finite(),
                    }),
                  )
                  .optional(),
              })
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
  }),
});

/**
 * Search hits as the walk names entities. A hit carries no work-item type, so a work item's kind
 * is `task` until it is read; the reader only needs the kind to know which platform type to load.
 */
export const refsFromSearchResponse = (response: unknown): TitledRef[] =>
  responseSchema
    .parse(response)
    .data.results.map(({ entityId, entityType, title, embeddings }) => ({
      id: entityId,
      kind: entityType.toLowerCase(),
      // The platform returns a title "when available"; the trace shows an absent one as empty.
      title: title ?? '',
      ...(embeddings?.matchSpans && embeddings.text !== undefined
        ? { matchSpans: embeddings.matchSpans, indexedText: embeddings.text }
        : {}),
    }));

/** Runs searches through the platform's unified search, with the same credentials as the live reader. */
export const createLiveSearchExecutor = (deps: LiveReaderDeps): SearchExecutor => ({
  search: async ({ query, types, taskTypes }, signal) => {
    const accessToken = await deps.auth.getAccessToken();
    const api = new SearchApi(new Configuration({ accessToken, basePath: deps.apiBaseUrl }));
    const common = { ...(types ? { types } : {}), ...(taskTypes ? { taskTypes } : {}) };
    const response = await api.unifiedSearch(
      {
        organizationId: deps.organizationId,
        projectId: deps.projectId,
        unifiedSearchRequest: { intent: 'hybrid', query, common },
      },
      signal ? { signal } : undefined,
    );
    return refsFromSearchResponse(response.data);
  },
});

/** Answers each query from a fixed table, for offline runs and tests. An unknown query is an error. */
export const createMemorySearchExecutor = (
  results: Readonly<Record<string, readonly TitledRef[]>>,
): SearchExecutor => ({
  search: ({ query }) => {
    const hits = results[query];
    return hits
      ? Promise.resolve([...hits])
      : Promise.reject(new Error(`No saved results for search "${query}".`));
  },
});
