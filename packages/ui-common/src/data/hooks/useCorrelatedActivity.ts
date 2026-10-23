import {
  useInfiniteQuery,
  useQueryClient,
  hashKey,
  type InfiniteData,
} from "@tanstack/react-query";
import { useCollectionQueryState } from "../query/useCollectionQueryState";
import { dataLayerQueryPolicy, shouldRetryOnMount } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
} from "../../api";
import {
  createRecentCorrelatedActivityFetchParams,
  DEFAULT_RECENT_ACTIVITY_CORRELATION_MODE,
  type CorrelatedActivityEntityScope,
  type CorrelatedActivityData,
  type CorrelatedActivityListItem,
  type CrossProjectActivityFetchParams,
  type CrossProjectActivityFilterParams,
  type CrossProjectActivityMetricParams,
  type CrossProjectActivityHistoryParams,
  correlatedActivityQueryOptions,
  crossProjectActivityQueryOptions,
  getDefaultRecentActivityCorrelationSort,
} from "../collections/activityCorrelations";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;
const EMPTY_RECORDS: CorrelatedActivityListItem[] = [];

type UseCorrelatedActivityBaseOptions = Omit<
  CollectionHookOptions<CorrelatedActivityData>,
  "sort"
> & {
  limit?: number;
  offset?: number;
  view?: "dropdown" | "full";
  subscribeToUpdates?: (onUpdate: () => void) => (() => void) | void;
};

type CrossProjectActivityHookParams =
  | Omit<CrossProjectActivityFilterParams, "organizationId">
  | Omit<CrossProjectActivityMetricParams, "organizationId">
  | Omit<CrossProjectActivityHistoryParams, "organizationId">;

export type UseCrossProjectActivityOptions = UseCorrelatedActivityBaseOptions &
  CrossProjectActivityHookParams & {
    activityScope: "organization";
  };

type UseEntityCorrelatedActivityOptions = UseCorrelatedActivityBaseOptions &
  CorrelatedActivityEntityScope & {
    activityType?: ActivityCorrelationActivityType[];
    source?: ActivityCorrelationSource[];
    projectId?: never;
    mode?: never;
    sort?: never;
  };

type UseRecentCorrelatedActivityOptions = UseCorrelatedActivityBaseOptions & {
  projectId: string;
  mode?: RecentActivityCorrelationMode;
  sort?: RecentActivityCorrelationSort;
  entityType?: never;
  entityId?: never;
  activityType?: never;
  source?: never;
};

type UseDisabledCorrelatedActivityOptions = UseCorrelatedActivityBaseOptions & {
  projectId?: undefined;
  entityType?: undefined;
  entityId?: undefined;
  activityType?: never;
  source?: never;
  mode?: never;
  sort?: never;
};

export type UseCorrelatedActivityOptions =
  | UseDisabledCorrelatedActivityOptions
  | UseEntityCorrelatedActivityOptions
  | UseRecentCorrelatedActivityOptions
  | UseCrossProjectActivityOptions;

export type CorrelatedActivityDisplayRecord = CorrelatedActivityListItem;

export interface UseCorrelatedActivityReturn extends Omit<
  DataHookReturn<CorrelatedActivityData>,
  "data"
> {
  data: CorrelatedActivityData | null;
  records: CorrelatedActivityDisplayRecord[];
  rawRecords: CorrelatedActivityListItem[];
  pagination: CorrelatedActivityData["pagination"];
}

const isCrossProjectActivityOptions = (
  options: UseCorrelatedActivityOptions,
): options is UseCrossProjectActivityOptions =>
  "activityScope" in options && options.activityScope === "organization";

const buildCrossProjectActivityFetchParams = (
  organizationId: string,
  options: UseCrossProjectActivityOptions,
): CrossProjectActivityFetchParams => {
  if (options.historyFilter !== undefined) {
    return {
      organizationId,
      historyFilter: options.historyFilter,
      limit: options.limit,
      offset: options.offset,
    };
  }
  if (options.metricContinuation !== undefined) {
    return {
      organizationId,
      metricContinuation: options.metricContinuation,
      limit: options.limit,
      offset: options.offset,
    };
  }

  return {
    organizationId,
    projectId: options.projectId,
    userId: options.userId,
    entityType: options.entityType,
    activityMode: options.activityMode,
    activityType: options.activityType,
    source: options.source,
    serviceId: options.serviceId,
    since: options.since,
    until: options.until,
    affectsMe: options.affectsMe,
    sinceLastVisit: options.sinceLastVisit,
    limit: options.limit,
    offset: options.offset,
  };
};

function resolveEntityOrRecentScope(
  options: Exclude<
    UseCorrelatedActivityOptions,
    UseCrossProjectActivityOptions
  >,
) {
  const entityId = options.entityId?.trim();
  const projectId = options.projectId?.trim();
  const hasEntityScope =
    options.entityType !== undefined || options.entityId !== undefined;
  const validEntity = options.entityType !== undefined && !!entityId;
  return {
    entityId,
    projectId,
    validEntity,
    valid: hasEntityScope ? validEntity : !!projectId,
  };
}

function buildActivityQueryOptions(
  organizationId: string | undefined,
  options: UseCorrelatedActivityOptions,
) {
  if (isCrossProjectActivityOptions(options)) {
    return {
      enabled: !!organizationId && (options.enabled ?? true),
      queryOptions: crossProjectActivityQueryOptions(
        buildCrossProjectActivityFetchParams(
          organizationId ?? "__noop__",
          options,
        ),
      ),
    };
  }
  const scope = resolveEntityOrRecentScope(options);
  const mode = options.mode ?? DEFAULT_RECENT_ACTIVITY_CORRELATION_MODE;
  const params =
    scope.validEntity && options.entityType !== undefined && scope.entityId
      ? {
          organizationId: organizationId ?? "__noop__",
          entityType: options.entityType,
          entityId: scope.entityId,
          activityType: options.activityType,
          source: options.source,
          limit: options.limit,
          offset: options.offset,
        }
      : createRecentCorrelatedActivityFetchParams({
          organizationId: organizationId ?? "__noop__",
          projectId: scope.projectId || "__noop__",
          mode,
          sort: options.sort ?? getDefaultRecentActivityCorrelationSort(mode),
          limit: options.limit,
          offset: options.offset,
        });
  return {
    enabled: !!organizationId && (options.enabled ?? true) && scope.valid,
    queryOptions: correlatedActivityQueryOptions(params),
  };
}

export function useCorrelatedActivity(
  organizationId: string | undefined,
  options: UseCorrelatedActivityOptions = {},
): UseCorrelatedActivityReturn {
  const {
    limit,
    offset,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    subscribeToUpdates,
    view = "full",
  } = options;
  const { enabled: isEnabled, queryOptions } = buildActivityQueryOptions(
    organizationId,
    options,
  );
  const queryClient = useQueryClient();
  const keyRef = useRef(queryOptions.queryKey);
  if (hashKey(keyRef.current) !== hashKey(queryOptions.queryKey)) {
    keyRef.current = queryOptions.queryKey;
  }
  const queryKey = keyRef.current;
  const staleTime = staleTimeMs ?? dataLayerQueryPolicy.staleTime;
  const result = useInfiniteQuery({
    ...queryOptions,
    queryKey,
    enabled: isEnabled,
    staleTime,
    retryOnMount: shouldRetryOnMount(
      queryClient.getQueryState(queryKey),
      staleTime,
    ),
    ...(refetchOnMount ? { refetchOnMount: "always" as const } : {}),
    ...(refetchOnWindowFocus
      ? { refetchOnWindowFocus: "always" as const }
      : {}),
    select: (feed: InfiniteData<CorrelatedActivityData, number>) =>
      feed.pages[0] ?? null,
  });
  const query = useCollectionQueryState(result, queryKey, isEnabled, {
    maxCacheAgeMs: options.maxCacheAgeMs,
  });
  const data = isEnabled ? (result.data ?? null) : null;
  const rawRecords = data?.items ?? EMPTY_RECORDS;

  const { refetch: refetchResult } = result;
  const refetch = useCallback(async () => {
    if (!isEnabled) return null;
    await queryClient.cancelQueries({ queryKey, exact: true });
    const next = await refetchResult({ throwOnError: true });
    return next.data ?? null;
  }, [isEnabled, queryClient, queryKey, refetchResult]);
  const records = useMemo<CorrelatedActivityDisplayRecord[]>(
    () =>
      rawRecords.map((record) => ({
        ...record,
        previewText:
          view === "dropdown" ? record.preview.dropdown : record.preview.full,
      })),
    [rawRecords, view],
  );

  const pagination = data?.pagination ?? {
    limit: limit ?? DEFAULT_LIMIT,
    offset: offset ?? DEFAULT_OFFSET,
    totalCount: null,
    nextOffset: null,
  };

  const refreshFromUpdate = useCallback(() => {
    if (!isEnabled) return;
    void invalidateWithFollowUpRead(queryClient, { queryKey, exact: true });
  }, [isEnabled, queryClient, queryKey]);

  useEffect(() => {
    if (!isEnabled || !subscribeToUpdates) {
      return;
    }

    const unsubscribe = subscribeToUpdates(() => {
      void refreshFromUpdate();
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [isEnabled, subscribeToUpdates, refreshFromUpdate]);

  return {
    data,
    records,
    rawRecords,
    pagination,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isReady: query.isFetched && !query.error,
    error: query.error,
    isStale: query.isStale,
    refetch,
    markStale: refreshFromUpdate,
  };
}

export type UseCrossProjectActivityInput = UseCorrelatedActivityBaseOptions &
  (
    | Omit<CrossProjectActivityFilterParams, "organizationId">
    | Omit<CrossProjectActivityMetricParams, "organizationId">
    | Omit<CrossProjectActivityHistoryParams, "organizationId">
  );

export function useCrossProjectActivity(
  organizationId: string | undefined,
  options: UseCrossProjectActivityInput = {},
): UseCorrelatedActivityReturn {
  return useCorrelatedActivity(organizationId, {
    ...options,
    activityScope: "organization",
  });
}
