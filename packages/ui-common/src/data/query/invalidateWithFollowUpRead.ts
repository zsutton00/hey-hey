import type {
  InvalidateQueryFilters,
  QueryClient,
  Query,
  QueryKey,
} from "@tanstack/react-query";

// Requests accepted before a cancelled first read restarts share that restart.
const pendingRestarts = new WeakMap<Query, Promise<void>>();

/** Cancel older work before asking the observer for its selected result. */
export async function refetchWithFollowUpRead<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  read: () => Promise<T>
): Promise<T> {
  await queryClient.cancelQueries({ queryKey, exact: true });
  return read();
}

/**
 * Invalidates queries so that no read already in flight satisfies the
 * invalidation: every affected mounted query reads again after it.
 *
 * `invalidateQueries`' default `cancelRefetch` restarts an in-flight read only
 * when the query already has data. A first read still in flight would be
 * joined instead, and its response — possibly from before the change — would
 * stand. Those reads are cancelled and, once settled, read again.
 */
export function invalidateWithFollowUpRead(
  queryClient: QueryClient,
  filters: InvalidateQueryFilters
): Promise<void> {
  const matched = queryClient.getQueryCache().findAll(filters);
  const firstReads = matched.filter((query) =>
    pendingRestarts.has(query) ||
    (query.state.fetchStatus === "fetching" && query.state.data === undefined)
  );
  // With no first-read cancellation to await, invalidate synchronously. A
  // consumer mounting in this turn then joins the refresh already started,
  // rather than starting a read that a deferred invalidation would restart.
  if (firstReads.length === 0) return queryClient.invalidateQueries(filters);
  const restarts = firstReads.map((query) => {
    const pending = pendingRestarts.get(query);
    if (pending) return pending;
    const restart = query.cancel({ revert: true }).then(() => {
      pendingRestarts.delete(query);
      return queryClient.invalidateQueries({
        queryKey: query.queryKey, exact: true, refetchType: filters.refetchType,
      });
    });
    pendingRestarts.set(query, restart);
    return restart;
  });
  const remaining = queryClient.invalidateQueries({
    ...filters,
    predicate: (query) => !firstReads.includes(query) && (!filters.predicate || filters.predicate(query)),
  });
  return Promise.all([...restarts, remaining]).then(() => undefined);
}
