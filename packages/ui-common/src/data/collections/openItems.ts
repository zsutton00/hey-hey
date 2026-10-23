import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  OpenItemsAdapter,
  openItemsKeys,
  type OpenItemsScope,
} from "../openItemsAdapter";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export { openItemsKeys };

const adapters = new WeakMap<QueryClient, Map<string, OpenItemsAdapter>>();
export function getOpenItemsAdapter(
  queryClient: QueryClient,
  scope: OpenItemsScope,
): OpenItemsAdapter {
  let scoped = adapters.get(queryClient);
  if (!scoped) {
    scoped = new Map();
    adapters.set(queryClient, scoped);
  }
  const key = JSON.stringify(openItemsKeys.collection(scope));
  let adapter = scoped.get(key);
  if (!adapter) {
    adapter = new OpenItemsAdapter(scope, queryClient);
    scoped.set(key, adapter);
  }
  return adapter;
}

/**
 * The canonical read: a canonical collection (migrating when absent), then
 * replay of queued offline operations. Concurrent callers share one read.
 * Reads are driven by visibility, reconnect and revision signals only, so
 * TanStack's own focus and reconnect refetches are off and data stays fresh
 * until a signal or failure marks it stale.
 */
export const openItemsQueryOptions = (adapter: OpenItemsAdapter) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: adapter.queryKey,
    queryFn: () => adapter.refresh(),
    staleTime: Infinity,
    // A retried read would replay the offline queue again; failures surface.
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: adapter.cachedCollection ?? undefined,
  });
