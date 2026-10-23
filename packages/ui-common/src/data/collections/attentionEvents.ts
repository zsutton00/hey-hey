import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  AttentionEventResponse,
  GetAttentionEventsSortEnum,
} from "../../api";
import { analyticsClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export interface AttentionEventsData {
  events: AttentionEventResponse[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export type AttentionEventsParams = {
  limit?: number;
  offset?: number;
  sort?: GetAttentionEventsSortEnum;
  includeEntity?: boolean;
  since?: string;
  projectId?: string;
};

/** Keys: [root, org, params]. */
export const attentionEventKeys = {
  root: () => ["attentionEvents"] as const,
  all: (organizationId: string) =>
    [...attentionEventKeys.root(), organizationId] as const,
  list: (organizationId: string, params: AttentionEventsParams) =>
    [...attentionEventKeys.all(organizationId), params] as const,
};

export function attentionEventsQueryOptions(
  organizationId: string,
  params: AttentionEventsParams,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: attentionEventKeys.list(organizationId, params),
    queryFn: async ({ signal }): Promise<AttentionEventsData | null> => {
      const response = await analyticsClient.getAttentionEvents(params, {
        ...captureRequestOptions(),
        signal,
      });
      const responseData = response.data?.data;
      if (!responseData) return null;
      return {
        events: responseData.events ?? [],
        pagination: responseData.pagination ?? {
          limit: params.limit ?? 10,
          offset: params.offset ?? 0,
          total: 0,
        },
      };
    },
  });
}

const dedupeKeyFor = (entityType: string, entityId: string): string =>
  `${entityType}:${entityId}`;

/**
 * Puts an attention event this client just recorded at the head of every
 * cached attention-event list. An entry for the same entity moves to the head
 * instead of duplicating; `pagination.total` grows only for a new entity; the
 * list is trimmed back to its page limit.
 */
export function prependAttentionEvent(
  queryClient: QueryClient,
  event: AttentionEventResponse,
): void {
  const dedupeKey = dedupeKeyFor(event.entityType, event.entityId);
  queryClient.setQueriesData<AttentionEventsData | null>(
    { queryKey: attentionEventKeys.root() },
    (data) => {
      if (!data) return data;
      const existingIndex = data.events.findIndex(
        (existing) =>
          dedupeKeyFor(existing.entityType, existing.entityId) === dedupeKey,
      );
      const remainingEvents =
        existingIndex >= 0
          ? data.events.filter((_, index) => index !== existingIndex)
          : data.events;
      const prepended = [event, ...remainingEvents];
      const limit = data.pagination.limit;
      return {
        events:
          typeof limit === "number" && limit > 0
            ? prepended.slice(0, limit)
            : prepended,
        pagination: {
          ...data.pagination,
          total:
            existingIndex === -1
              ? data.pagination.total + 1
              : data.pagination.total,
        },
      };
    },
  );
}
