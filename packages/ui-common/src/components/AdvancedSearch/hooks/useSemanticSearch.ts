import { useEffect, useRef, useState } from "react";
import {
  EntityType,
  UnifiedEmbeddingsSearchOptionsQueryModeEnum,
  UnifiedSearchIntent,
  type UnifiedSearchRequest,
  type UnifiedSearchResult,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { normalizeEntityType } from "../../entityTypeUtils";
import type {
  AdvancedSearchEntityScope,
  SearchEntity,
  SearchFilterState,
} from "../types";

/**
 * Hook for performing semantic search with debouncing
 *
 * @param organizationId - Organization ID for scoping the search
 * @param titleQuery - Title search query (quick name/title matching)
 * @param semanticQuery - Semantic search query (deep semantic matching)
 * @param filters - Search filter state
 * @param projectId - Optional project ID to scope the search
 * @param options - Additional options
 * @param scopedEntity - Optional entity to scope the graph search
 * @returns Search results, loading state, and error
 */
export function useSemanticSearch(
  organizationId: string,
  titleQuery: string,
  semanticQuery: string,
  filters: SearchFilterState,
  projectId?: string,
  options: {
    maxResults?: number;
  } = {},
  scopedEntity?: AdvancedSearchEntityScope
) {
  const [results, setResults] = useState<SearchEntity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const {
    entityTypes,
    statuses,
    taskTypes,
    initiativeId,
    parentTaskId,
    threshold,
    boostRecent,
  } = filters;
  const scopedEntityId = scopedEntity?.entityId;
  const scopedEntityType = scopedEntity?.entityType;

  // Store abort controller for cancelling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Don't search if both queries are empty
    if (!titleQuery.trim() && !semanticQuery.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    // Cancel previous request if still in flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Debounce: wait 500ms before executing search
    const timeoutId = setTimeout(async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Create new abort controller for this request
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Use semantic query if provided, otherwise fall back to title query
        const query = semanticQuery.trim() || titleQuery.trim();
        const maxResults = options.maxResults ?? 50;

        const scopeArg =
          scopedEntityId && scopedEntityType
            ? { entityId: scopedEntityId, entityType: scopedEntityType }
            : undefined;

        const request = buildUnifiedSearchRequest(
          query,
          semanticQuery,
          {
            entityTypes,
            statuses,
            taskTypes,
            ...(initiativeId ? { initiativeId } : {}),
            ...(parentTaskId ? { parentTaskId } : {}),
            ...(threshold !== undefined ? { threshold } : {}),
            ...(boostRecent !== undefined ? { boostRecent } : {}),
          },
          scopeArg,
          maxResults
        );

        const response = await unifiedApiClient.unifiedSearch({
          organizationId: organizationId,
          projectId: projectId!,
          unifiedSearchRequest: request,
        });

        if (abortController.signal.aborted) return;

        const unifiedResults = response.data?.data?.results ?? [];
        setResults(transformUnifiedResults(unifiedResults));
        setIsLoading(false);
      } catch (err: unknown) {
        // Ignore abort errors
        if (err instanceof Error && err.name === "CanceledError") {
          return;
        }

        const error = err as Error;
        console.error("Search error:", error);
        setError(error);
        setResults([]);
        setIsLoading(false);
      }
    }, 500);

    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [
    organizationId,
    titleQuery,
    semanticQuery,
    entityTypes,
    statuses,
    taskTypes,
    initiativeId,
    parentTaskId,
    threshold,
    boostRecent,
    projectId,
    scopedEntityId,
    scopedEntityType,
    options.maxResults,
  ]);

  return { results, isLoading, error };
}

function transformUnifiedResults(
  results: UnifiedSearchResult[]
): SearchEntity[] {
  return results
    .filter((result) => typeof result.entityId === "string")
    .map((result) => ({
      id: result.entityId || "",
      type: toSearchEntityType(result.entityType),
      name: result.title || result.entityId || "Untitled",
      description: result.topologySummary || result.content,
      status: result.status,
      similarity: result.score,
    }));
}

function toSearchEntityType(entityType: EntityType | undefined): string {
  switch (entityType) {
    case EntityType.DesignDoc:
      return "design_doc";
    case EntityType.AgentSession:
      return "agent_session";
    default:
      return entityType ? entityType.toLowerCase() : "unknown";
  }
}

function buildUnifiedSearchRequest(
  query: string,
  semanticQuery: string,
  filters: SearchFilterState,
  scopedEntity: AdvancedSearchEntityScope | undefined,
  maxResults: number
): UnifiedSearchRequest {
  const normalizedTypes = (filters.entityTypes ?? [])
    .map((type) => normalizeEntityType(type))
    .filter((type): type is EntityType => type !== null);

  const hasCommonFilters =
    normalizedTypes.length > 0 ||
    filters.statuses.length > 0 ||
    (filters.taskTypes && filters.taskTypes.length > 0);

  return {
    intent: UnifiedSearchIntent.Hybrid,
    query,
    common: hasCommonFilters
      ? {
          types: normalizedTypes.length > 0 ? normalizedTypes : undefined,
          statuses: filters.statuses.length > 0 ? filters.statuses : undefined,
          taskTypes: filters.taskTypes,
        }
      : undefined,
    graph: scopedEntity
      ? {
          seedEntityIds: [scopedEntity.entityId],
          seedEntityIdsStrategy: "explicit",
          size: maxResults,
        }
      : {
          size: maxResults,
        },
    embeddings: {
      maxResults,
      similarityThreshold: filters.threshold || 0.15,
      queryMode: semanticQuery.trim()
        ? UnifiedEmbeddingsSearchOptionsQueryModeEnum.Default
        : UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
    },
  };
}
