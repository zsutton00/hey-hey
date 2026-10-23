import type { QueryKey as TanStackQueryKey } from "@tanstack/react-query";
import type { QueryKey } from "../core/types";

/** Legacy collections mark a `QueryKey` stale; TanStack-backed collections invalidate a key prefix. */
export type InvalidationKey = QueryKey | TanStackQueryKey;

export type MarkStaleAction<K extends InvalidationKey = QueryKey> = {
  type: "MARK_STALE";
  queryKey: K;
};

export type MarkStaleDispatch<K extends InvalidationKey = QueryKey> = (
  action: MarkStaleAction<K>
) => void;

/**
 * Routes a MARK_STALE through the cross-hook coordinator seam.
 *
 * Today this is a thin pass-through: it calls `dispatch(action)` immediately.
 * The cross-hook coordinator task replaces the body so duplicate MARK_STALE
 * calls for the same query key within a single event-loop tick collapse to
 * one. Every invalidator call site routes through this function so that
 * change is centralized.
 */
export function routeMarkStale<K extends InvalidationKey>(
  action: MarkStaleAction<K>,
  dispatch: MarkStaleDispatch<K>
): void {
  dispatch(action);
}
