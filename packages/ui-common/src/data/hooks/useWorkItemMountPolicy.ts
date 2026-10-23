import { useQueryMountPolicy } from "../core/queryMountPolicyContext";

/**
 * Whether work-item reads mounting here must read even when cached data is
 * fresh. Detail pages request this so opening a tab re-reads its work items.
 * Only work-item queries honour it; shared TanStack datasets (work-item
 * types, sidebar datasets, conversations) keep reading only when stale.
 */
export function useWorkItemAuthoritativeMount(): boolean {
  return useQueryMountPolicy() === "always-refetch";
}
