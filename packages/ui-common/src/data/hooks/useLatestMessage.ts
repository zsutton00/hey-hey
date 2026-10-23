import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { MessageResponseDto } from "../../api";
import {
  conversationMessagesQueryOptions,
  latestMessageQueryOptions,
  selectLatestTimelineMessage,
} from "../collections/messages";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export type UseLatestMessageReturn = DataHookReturn<MessageResponseDto>;
export type UseLatestMessageOptions = Omit<
  CollectionHookOptions<MessageResponseDto>,
  "preferStale"
> & {
  /** Kept for compatibility; cached data is always reused while fresh. */
  skipInitialFetchIfCached?: boolean;
};

/**
 * The newest timeline message of a conversation. When the conversation's
 * message list is loaded, this is a `select` over it and issues no read of
 * its own; otherwise it reads the server's latest-message endpoint.
 */
export function useLatestMessage(
  organizationId: string | undefined,
  projectId: string | undefined,
  conversationId: string | undefined,
  options: UseLatestMessageOptions = {}
): UseLatestMessageReturn {
  const enabled =
    (options.enabled ?? true) &&
    !!organizationId &&
    !!projectId &&
    !!conversationId;
  const orgId = organizationId ?? "__noop__";
  const projId = projectId ?? "__noop__";
  const convId = conversationId ?? "__noop__";

  const queryClient = useQueryClient();
  const listOptions = useMemo(
    () => conversationMessagesQueryOptions(queryClient, orgId, projId, convId),
    [queryClient, orgId, projId, convId]
  );
  // Observes the list without reading it; the list owner decides when to read.
  const fromList = useQuery({
    ...listOptions,
    enabled: false,
    select: selectLatestTimelineMessage,
  });
  const hasList = enabled && fromList.status === "success";

  const latestOptions = useMemo(
    () => latestMessageQueryOptions(queryClient, orgId, projId, convId),
    [queryClient, orgId, projId, convId]
  );
  const { result, state } = useDataLayerQuery(latestOptions, {
    enabled: enabled && !hasList,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
  });

  // Realtime message events invalidate this conversation's message prefix
  // centrally; this only keeps the conversation subscribed.
  useWebsocketSubscriptions(
    { conversationIds: conversationId ? [conversationId] : [] },
    { enabled }
  );

  const { refetch: refetchList } = fromList;
  const refetchFromList = useCallback(async () => {
    const next = await refetchList({ throwOnError: true });
    return next.data ?? null;
  }, [refetchList]);

  if (hasList) {
    return {
      data: fromList.data ?? null,
      isLoading: false,
      isFetching: fromList.isFetching,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: fromList.isStale,
      refetch: refetchFromList,
      markStale: () =>
        void queryClient.invalidateQueries({
          queryKey: listOptions.queryKey,
          exact: true,
        }),
    };
  }

  return { ...state, data: result.data ?? null };
}
