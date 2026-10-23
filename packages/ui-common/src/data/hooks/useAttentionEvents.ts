import { useMemo } from "react";
import type {
  AttentionEventResponse,
  GetAttentionEventsSortEnum,
} from "../../api";
import {
  attentionEventsQueryOptions,
  type AttentionEventsData,
} from "../collections/attentionEvents";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseAttentionEventsOptions
  extends Omit<CollectionHookOptions<AttentionEventsData>, "sort"> {
  limit?: number;
  offset?: number;
  sort?: GetAttentionEventsSortEnum;
  includeEntity?: boolean;
  since?: string;
  projectId?: string;
}

export interface UseAttentionEventsReturn
  extends Omit<DataHookReturn<AttentionEventsData>, "data"> {
  events: AttentionEventResponse[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export function useAttentionEvents(
  organizationId: string | undefined,
  options: UseAttentionEventsOptions = {}
): UseAttentionEventsReturn {
  const {
    limit,
    offset,
    sort,
    includeEntity,
    since,
    projectId,
    enabled: enabledOption,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;

  const enabled = enabledOption !== false && !!organizationId;

  const queryOptions = useMemo(
    () =>
      attentionEventsQueryOptions(organizationId ?? "__noop__", {
        limit,
        offset,
        sort,
        includeEntity,
        since,
        projectId,
      }),
    [organizationId, limit, offset, sort, includeEntity, since, projectId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  });
  const data = enabled ? result.data : null;

  return {
    events: data?.events ?? [],
    pagination: data?.pagination ?? {
      limit: limit ?? 10,
      offset: offset ?? 0,
      total: 0,
    },
    ...state,
  };
}
