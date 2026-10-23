import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { CollectionHookOptions } from "../core/types";
import { dataLayerQueryPolicy, shouldRetryOnMount } from "./queryPolicy";
import {
  useCollectionQueryState,
  type CollectionQueryState,
} from "./useCollectionQueryState";

export type DataLayerQueryHookOptions = Pick<
  CollectionHookOptions<unknown>,
  "refetchOnMount" | "refetchOnWindowFocus" | "staleTimeMs" | "maxCacheAgeMs"
> & {
  enabled: boolean;
  /**
   * Each mount of this hook reads even when cached data is fresh, keeping
   * that data visible meanwhile. Consumers mounting while a read is in
   * flight join it, and a query enabled after mounting reads only when stale.
   */
  authoritativeMount?: boolean;
};

export interface DataLayerQuery<TData> {
  result: UseQueryResult<TData, Error>;
  state: CollectionQueryState<TData>;
}

/**
 * Runs one migrated Data Layer read with the shared policy and maps the
 * legacy hook options onto TanStack: `refetchOnMount` / `refetchOnWindowFocus`
 * force a read even when fresh (as does `authoritativeMount` on mount),
 * `staleTimeMs` overrides the policy stale time,
 * and `maxCacheAgeMs` is enforced by `useCollectionQueryState`.
 */
export function useDataLayerQuery<
  TQueryFnData,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: UseQueryOptions<TQueryFnData, Error, TData, TQueryKey> & {
    queryKey: TQueryKey;
  },
  hookOptions: DataLayerQueryHookOptions
): DataLayerQuery<TData> {
  const {
    enabled,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
    authoritativeMount,
  } = hookOptions;
  const queryClient = useQueryClient();
  const staleTime = staleTimeMs ?? options.staleTime ?? dataLayerQueryPolicy.staleTime;

  const result = useQuery({
    ...options,
    enabled,
    staleTime,
    retryOnMount: shouldRetryOnMount(
      enabled ? queryClient.getQueryState(options.queryKey) : undefined,
      typeof staleTime === "number" ? staleTime : dataLayerQueryPolicy.staleTime
    ),
    // TanStack consults refetchOnMount only when an observer subscribes, and
    // a Strict Mode replay joins the read that subscription started.
    ...(refetchOnMount || authoritativeMount
      ? { refetchOnMount: "always" as const }
      : {}),
    ...(refetchOnWindowFocus ? { refetchOnWindowFocus: "always" as const } : {}),
  });
  const state = useCollectionQueryState(result, options.queryKey, enabled, {
    maxCacheAgeMs,
  });

  return { result, state };
}
