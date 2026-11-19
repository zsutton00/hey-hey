import type { OperationVariables, TypedDocumentNode } from "@apollo/client";
import { useApolloClient, useQuery } from "@apollo/client/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { DEFAULT_STALE_TIME_MS } from "../core/staleTime";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { getProjectGraphQLClient, type GraphQLProjectScope } from "./client";

/** One read: the query, the project it runs in, and how its result is shaped. */
export interface GraphQLReadSpec<
  TQuery,
  TVariables extends OperationVariables,
  TData,
> {
  document: TypedDocumentNode<TQuery, TVariables>;
  variables: TVariables;
  scope: GraphQLProjectScope;
  /** `null` is a valid answer: the read succeeded and found nothing. */
  select: (data: TQuery) => TData | null;
}

export type GraphQLReadOptions = Pick<
  CollectionHookOptions<unknown>,
  "refetchOnMount" | "refetchOnWindowFocus" | "staleTimeMs"
> & { enabled: boolean };

/**
 * Runs one read through the GraphQL client and reports it on the Data Layer
 * hook surface. Data comes from the normalized cache, so every view of the
 * same entity shows the same record and updates when it is written.
 */
export function useGraphQLRead<
  TQuery,
  TVariables extends OperationVariables,
  TData,
>(
  spec: GraphQLReadSpec<TQuery, TVariables, TData>,
  options: GraphQLReadOptions,
): DataHookReturn<TData> {
  const { enabled, refetchOnMount, refetchOnWindowFocus, staleTimeMs } =
    options;
  const staleTime = staleTimeMs ?? DEFAULT_STALE_TIME_MS;

  const client = getProjectGraphQLClient(useApolloClient(), spec.scope);
  const {
    data: observed,
    error,
    loading,
    refetch,
  } = useQuery(spec.document, {
    client,
    variables: spec.variables,
    context: spec.scope,
    skip: !enabled,
  });

  // A failed read leaves the last result in place. If the cache no longer
  // holds what that result showed (the entity was deleted), it is not shown.
  const data =
    error &&
    client.readQuery({ query: spec.document, variables: spec.variables }) ===
      null
      ? undefined
      : observed;
  const { select } = spec;
  const selected = useMemo(
    () => (data === undefined ? null : select(data)),
    [data, select],
  );

  const settledAtRef = useRef<number | null>(null);
  const previousClient = useRef(client);
  if (previousClient.current !== client) {
    previousClient.current = client;
    settledAtRef.current = null;
  }
  if (!loading && (data !== undefined || error)) {
    settledAtRef.current ??= Date.now();
  }

  const read = useCallback(async (): Promise<TData | null> => {
    const result = await refetch();
    settledAtRef.current = Date.now();

    return result.data === undefined ? null : select(result.data);
  }, [refetch, select]);

  const mountedRead = useRef(read);
  mountedRead.current = read;
  useEffect(() => {
    if (enabled && refetchOnMount) {
      void mountedRead.current().catch(() => null);
    }
  }, [enabled, refetchOnMount]);

  useEffect(() => {
    if (!enabled || refetchOnWindowFocus === false) {
      return;
    }
    const onVisible = () => {
      const settledAt = settledAtRef.current;
      const isStale = settledAt === null || Date.now() - settledAt >= staleTime;
      if (
        document.visibilityState === "visible" &&
        (refetchOnWindowFocus === true || isStale)
      ) {
        void mountedRead.current().catch(() => null);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, refetchOnWindowFocus, staleTime]);

  const hasData = data !== undefined;
  const isFetched = hasData || !!error;
  const settledAt = settledAtRef.current;

  return {
    data: selected,
    isLoading: enabled && loading && !hasData,
    isFetching: enabled && loading,
    isFetched: enabled && isFetched,
    isReady: enabled && isFetched && !error,
    error: enabled ? (error ?? null) : null,
    isStale: settledAt !== null && Date.now() - settledAt >= staleTime,
    refetch: read,
    markStale: () => void read(),
  };
}
