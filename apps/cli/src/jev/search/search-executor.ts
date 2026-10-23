import { z } from 'zod';
import { Configuration, EntityType, SearchApi } from '../../shared/api/generated';
import type { LiveReaderDeps, TitledRef } from '../traversal';

/** One search Project Assistant asked for: a query and, optionally, the entity types to search. */
export const plannedSearchSchema = z.object({
  query: z.string().trim().min(1),
  types: z.array(z.nativeEnum(EntityType)).min(1).optional(),
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
            entityType: z.nativeEnum(EntityType),
            title: z.string().optional(),
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
  responseSchema.parse(response).data.results.map(({ entityId, entityType, title }) => ({
    id: entityId,
    kind: entityType.toLowerCase(),
    // The platform returns a title "when available"; the trace shows an absent one as empty.
    title: title ?? '',
  }));

/** Runs searches through the platform's unified search, with the same credentials as the live reader. */
export const createLiveSearchExecutor = (deps: LiveReaderDeps): SearchExecutor => ({
  search: async ({ query, types }, signal) => {
    const accessToken = await deps.auth.getAccessToken();
    const api = new SearchApi(new Configuration({ accessToken, basePath: deps.apiBaseUrl }));
    const response = await api.unifiedSearch(
      {
        organizationId: deps.organizationId,
        projectId: deps.projectId,
        unifiedSearchRequest: { intent: 'hybrid', query, ...(types ? { common: { types } } : {}) },
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
