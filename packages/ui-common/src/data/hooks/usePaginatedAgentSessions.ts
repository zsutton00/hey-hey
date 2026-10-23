import {
  useInfiniteQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionListSort,
  AgentSessionStatus,
  AgentSessionType,
  PaginatedAgentSessionItemDto,
} from "../../api";
import {
  paginatedAgentSessionsQueryOptions,
  type PaginatedAgentSessionsData,
  type PaginatedAgentSessionsFilters,
  type PaginatedAgentSessionsPage,
} from "../collections/agentSessions";
import { dataLayerQueryPolicy, shouldRetryOnMount } from "../query/queryPolicy";
import { useCollectionQueryState } from "../query/useCollectionQueryState";
import {
  acceptAgentSessionPage,
  emptyAgentSessionSnapshot,
  reconcileAgentSessionPage,
} from "./paginatedAgentSessionSnapshot";
import { useAgentSessionCurrentStates } from "./useAgentSessionCurrentState";

export interface UsePaginatedAgentSessionsOptions {
  type?: AgentSessionType;
  excludeType?: AgentSessionType;
  hasUserMessage?: boolean;
  userId?: string;
  serviceId?: string;
  taskId?: string;
  statuses?: AgentSessionStatus[];
  sort?: AgentSessionListSort;
  limit?: number;
  enabled?: boolean;
  staleTimeMs?: number;
  maxCacheAgeMs?: number;
}

export interface UsePaginatedAgentSessionsReturn {
  items: PaginatedAgentSessionItemDto[];
  nextCursor: string | null;
  hasNextPage: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  error: Error | null;
  loadNextPage: () => void;
  hasPendingUpdates: boolean;
  isApplyingUpdates: boolean;
  refetch: () => Promise<"applied" | "superseded">;
}

const normalizeStatuses = (statuses: AgentSessionStatus[] | undefined) =>
  statuses?.length ? [...new Set(statuses)].sort() : undefined;

/** Snapshot page identity: the cursor that requested it ("" for page one). */
const pageKeyOf = (pageParam: unknown): string =>
  typeof pageParam === "string" ? pageParam : "";

/**
 * Cursor-paginated sessions as one infinite query, presented through a
 * reader-stable snapshot. Background re-reads (invalidation, resume) patch
 * fields of rows already shown but never add, remove or reorder them;
 * membership or order changes raise `hasPendingUpdates` instead. `refetch`
 * applies them: it re-reads page one alone and replaces every accumulated
 * page with it. `loadNextPage` appends the next page to both cache and
 * snapshot.
 */
export function usePaginatedAgentSessions(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UsePaginatedAgentSessionsOptions = {}
): UsePaginatedAgentSessionsReturn {
  const {
    type,
    excludeType,
    hasUserMessage,
    userId,
    serviceId,
    taskId,
    sort,
    limit,
    enabled: enabledOption = true,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;
  const enabled = enabledOption && !!organizationId && !!projectId;
  const queryClient = useQueryClient();
  const statusesKey = normalizeStatuses(options.statuses)?.join(",") ?? "";
  const filters = useMemo<PaginatedAgentSessionsFilters>(
    () => ({
      type,
      excludeType,
      hasUserMessage,
      userId,
      serviceId,
      taskId,
      statuses: statusesKey
        ? (statusesKey.split(",") as AgentSessionStatus[])
        : undefined,
      sort,
      limit,
    }),
    [
      excludeType,
      hasUserMessage,
      limit,
      serviceId,
      sort,
      statusesKey,
      taskId,
      type,
      userId,
    ]
  );
  const queryOptions = useMemo(
    () =>
      paginatedAgentSessionsQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        filters
      ),
    [filters, organizationId, projectId]
  );
  const { queryKey } = queryOptions;
  const filterKey = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const staleTime = staleTimeMs ?? dataLayerQueryPolicy.staleTime;

  const query = useInfiniteQuery({
    ...queryOptions,
    enabled,
    staleTime,
    retryOnMount: shouldRetryOnMount(
      enabled ? queryClient.getQueryState(queryKey) : undefined,
      staleTime
    ),
  });
  const queryState = useCollectionQueryState(
    query as unknown as UseQueryResult<PaginatedAgentSessionsData, Error>,
    queryKey,
    enabled,
    { maxCacheAgeMs }
  );

  const [accumulated, setAccumulated] = useState(() => ({
    filterKey,
    snapshot: emptyAgentSessionSnapshot(),
  }));
  const [isApplyingUpdates, setIsApplyingUpdates] = useState(false);
  const [isAppending, setIsAppending] = useState(false);
  const [requestError, setRequestError] = useState<Error | null>(null);
  const createScope = () => ({
    filterKey,
    generation: 0,
    applying: false,
    appending: false,
    observed: new Map<string, PaginatedAgentSessionsPage>(),
  });
  const scopeRef = useRef(createScope());
  if (scopeRef.current.filterKey !== filterKey) {
    scopeRef.current = createScope();
  }
  useEffect(() => {
    setAccumulated({ filterKey, snapshot: emptyAgentSessionSnapshot() });
    setIsApplyingUpdates(false);
    setIsAppending(false);
    setRequestError(null);
  }, [filterKey]);

  // Fold every new cached page into the snapshot: the first pages seen are
  // accepted as-is, later re-reads of accepted pages only patch rows.
  const data = enabled ? query.data : undefined;
  useEffect(() => {
    const scope = scopeRef.current;
    if (!data || scope.applying || scope.filterKey !== filterKey) return;
    const fresh: Array<[string, PaginatedAgentSessionsPage]> = [];
    data.pages.forEach((page, index) => {
      const key = pageKeyOf(data.pageParams[index]);
      if (scope.observed.get(key) === page) return;
      scope.observed.set(key, page);
      fresh.push([key, page]);
    });
    if (fresh.length === 0) return;
    setAccumulated((current) => {
      if (current.filterKey !== filterKey) return current;
      let snapshot = current.snapshot;
      if (snapshot.acceptedPages.size === 0) {
        data.pages.forEach((page, index) => {
          snapshot = acceptAgentSessionPage(
            snapshot,
            pageKeyOf(data.pageParams[index]),
            page
          );
        });
      } else {
        for (const [key, page] of fresh) {
          snapshot = reconcileAgentSessionPage(snapshot, key, page);
        }
      }
      return snapshot === current.snapshot ? current : { filterKey, snapshot };
    });
  }, [data, filterKey, isApplyingUpdates]);

  const visible =
    accumulated.filterKey === filterKey
      ? accumulated.snapshot
      : emptyAgentSessionSnapshot();
  const visibleAgentSessionIds = useMemo(
    () => visible.items.map((item) => item.agentSession.id),
    [visible.items]
  );
  const currentStateOverlay = useAgentSessionCurrentStates(
    organizationId,
    projectId,
    visibleAgentSessionIds,
    { enabled }
  );
  const overlaidItems = useMemo(
    () =>
      visible.items.map((item) => {
        const liveState =
          currentStateOverlay.currentStateById[item.agentSession.id];
        return liveState
          ? {
              ...item,
              agentSession: {
                ...item.agentSession,
                currentState: liveState.currentState,
              },
            }
          : item;
      }),
    [currentStateOverlay.currentStateById, visible.items]
  );

  const { fetchNextPage, refetch: refetchQuery } = query;
  const loadNextPage = useCallback(() => {
    const scope = scopeRef.current;
    if (
      scope.filterKey !== filterKey ||
      scope.applying ||
      scope.appending ||
      !visible.nextCursor ||
      !enabled
    )
      return;
    const generation = scope.generation;
    scope.appending = true;
    setIsAppending(true);
    setRequestError(null);
    void fetchNextPage({ cancelRefetch: false, throwOnError: true })
      .then((result) => {
        if (scope !== scopeRef.current || generation !== scope.generation)
          return;
        const pages = result.data?.pages;
        const nextPage = pages?.at(-1);
        if (!pages || pages.length < 2 || !nextPage)
          throw new Error("Unable to load more sessions. Try again.");
        const key = pageKeyOf(result.data?.pageParams.at(-1));
        scope.observed.set(key, nextPage);
        setAccumulated((current) => ({
          filterKey,
          snapshot: acceptAgentSessionPage(current.snapshot, key, nextPage),
        }));
      })
      .catch((error: unknown) => {
        if (scope === scopeRef.current && generation === scope.generation) {
          setRequestError(
            error instanceof Error
              ? error
              : new Error("Unable to load more sessions.")
          );
        }
      })
      .finally(() => {
        if (scope === scopeRef.current && generation === scope.generation) {
          scope.appending = false;
          setIsAppending(false);
        }
      });
  }, [enabled, fetchNextPage, filterKey, visible.nextCursor]);

  const refetch = useCallback(async (): Promise<"applied" | "superseded"> => {
    const scope = scopeRef.current;
    if (scope.filterKey !== filterKey || scope.applying || !enabled)
      return "superseded";
    const generation = ++scope.generation;
    scope.applying = true;
    scope.appending = false;
    setIsAppending(false);
    setIsApplyingUpdates(true);
    setRequestError(null);
    // Page one is re-read alone: later pages are dropped from the cache so the
    // next `loadNextPage` continues from the fresh page's cursor.
    await queryClient.cancelQueries({ queryKey, exact: true });
    const previous =
      queryClient.getQueryData<PaginatedAgentSessionsData>(queryKey);
    if (previous && previous.pages.length > 1) {
      queryClient.setQueryData<PaginatedAgentSessionsData>(queryKey, {
        pages: previous.pages.slice(0, 1),
        pageParams: previous.pageParams.slice(0, 1),
      });
    }
    try {
      const result = await refetchQuery({ throwOnError: true });
      if (scope !== scopeRef.current || generation !== scope.generation)
        return "superseded";
      const freshPage = result.data?.pages[0];
      if (!freshPage)
        throw new Error("Unable to refresh sessions. Try again.");
      scope.observed.clear();
      scope.observed.set(pageKeyOf(null), freshPage);
      setAccumulated({
        filterKey,
        snapshot: acceptAgentSessionPage(
          emptyAgentSessionSnapshot(),
          pageKeyOf(null),
          freshPage
        ),
      });
      return "applied";
    } catch (error) {
      if (scope !== scopeRef.current || generation !== scope.generation)
        return "superseded";
      // Keep cache and snapshot describing the same pages.
      if (previous) queryClient.setQueryData(queryKey, previous);
      const failure =
        error instanceof Error
          ? error
          : new Error("Unable to refresh sessions. Try again.");
      setRequestError(failure);
      throw failure;
    } finally {
      if (scope === scopeRef.current && generation === scope.generation) {
        scope.applying = false;
        setIsApplyingUpdates(false);
      }
    }
  }, [enabled, filterKey, queryClient, queryKey, refetchQuery]);

  return {
    items: overlaidItems,
    nextCursor: visible.nextCursor,
    hasNextPage: visible.nextCursor !== null,
    hasPendingUpdates: visible.hasPendingUpdates,
    isApplyingUpdates,
    isLoading: visible.acceptedPages.size === 0 && queryState.isLoading,
    isFetching: queryState.isFetching || isApplyingUpdates || isAppending,
    isFetchingNextPage: isAppending,
    error: requestError ?? queryState.error,
    loadNextPage,
    refetch,
  };
}
