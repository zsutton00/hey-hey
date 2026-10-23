import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useOptionalWebSocketContext } from "../../contexts/WebSocketContext";
import {
  getOpenItemsAdapter,
  openItemsQueryOptions,
} from "../collections/openItems";
import type { OpenItemsScope } from "../openItemsAdapter";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type OpenItemsSnapshot = ReturnType<typeof useOpenItems>;

export function useOpenItems(scope: OpenItemsScope) {
  const queryClient = useQueryClient();
  const adapter = getOpenItemsAdapter(queryClient, scope);
  const websocket = useOptionalWebSocketContext();
  const service = websocket?.service;
  const realtimeReady = websocket?.isAuthenticated === true;
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const status = useSyncExternalStore(
    adapter.subscribe,
    adapter.getStatus,
    adapter.getStatus,
  );
  const options = useMemo(() => openItemsQueryOptions(adapter), [adapter]);
  const complete = Boolean(
    scope.organizationId && scope.projectId && scope.userId,
  );
  // With realtime, joining the room triggers the read; without it, mounting does.
  const enabled = complete && !status.offline && visible && !realtimeReady;
  const { result: query } = useDataLayerQuery(options, {
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
  /** The one canonical read path; concurrent callers join the read in flight. */
  const refresh = useCallback(async () => {
    await queryClient.fetchQuery({ ...options, staleTime: 0 });
  }, [queryClient, options]);
  useEffect(() => {
    if (!complete) return;
    const revalidate = () => {
      void refresh().catch(() => {});
    };
    const onOnline = () => {
      adapter.setOffline(false);
      if (document.visibilityState === "visible") revalidate();
    };
    const onOffline = () => adapter.setOffline(true);
    const onVisibility = () => {
      const shown = document.visibilityState === "visible";
      setVisible(shown);
      if (shown) {
        if (realtimeReady) adapter.markStale();
        else revalidate();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [adapter, complete, refresh, realtimeReady]);
  useEffect(() => {
    if (!visible || !service || !complete) return;
    const subscription = service.subscribe({
      openItemsProjectIds: [scope.projectId],
      events: {
        onOpenItemsRoomJoined: (projectId) => {
          if (
            projectId === scope.projectId &&
            document.visibilityState === "visible"
          )
            void refresh().catch(() => {});
        },
        onOpenItemsChanged: (event) => {
          if (
            document.visibilityState !== "visible" ||
            event.projectId !== scope.projectId
          )
            return;
          const collection = adapter.collection();
          const revision =
            collection?.state === "PRESENT" ? collection.revision : 0;
          if (event.revision > revision)
            void adapter.refreshForSignal(event.revision).catch(() => {});
        },
      },
    });
    return () => {
      service.unsubscribe(subscription);
    };
  }, [adapter, service, visible, complete, refresh, scope.projectId]);
  // A disabled observer never reports isStale, and reads here are driven by
  // signals rather than the observer, so read invalidation from the cache.
  const invalidated = useSyncExternalStore(
    queryClient.getQueryCache().subscribe,
    () =>
      queryClient.getQueryState(adapter.queryKey)?.isInvalidated === true,
  );
  const collection = query.data ?? null;
  const record = useMemo(
    () => adapter.record(collection, status.preferences),
    [adapter, collection, status.preferences],
  );
  return {
    record,
    collection,
    pending: status.pending,
    queued: status.queued,
    offline: status.offline,
    adapter,
    refresh,
    retry: refresh,
    isLoading:
      collection === null &&
      (query.isLoading || (visible && realtimeReady)),
    isFetching: query.isFetching,
    stale:
      query.isPlaceholderData ||
      query.data === undefined ||
      invalidated ||
      status.offline ||
      status.error !== null,
    error: status.error ?? query.error,
  };
}
