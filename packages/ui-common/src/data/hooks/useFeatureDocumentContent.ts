import {
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  featureContentKeys,
  featureContentQueryOptions,
  featureSubtreeQueryOptions,
  FeatureUnavailableError,
  type FeatureContentEntry,
  type FeatureContentProjection,
} from "../collections/featureDocumentContent";
import type { WorkItemResponseDto } from "../collections/workItems";

const NO_ROOT = "__no_root__";

const toEntry = (
  result: UseQueryResult<WorkItemResponseDto, Error>
): FeatureContentEntry => {
  if (result.isError) {
    return { status: "error", data: result.data, error: result.error };
  }
  if (result.isSuccess && !result.isFetching) {
    return { status: "ready", data: result.data };
  }
  // Keep the current document visible while it is re-read.
  return { status: "loading", data: result.data };
};

/**
 * The result fields `toEntry` reads. Declaring them turns off TanStack's
 * per-property tracking, whose cost in `useQueries` grows with the size of
 * the set on every access: with hundreds of features each settling read
 * froze the page for seconds.
 */
const ENTRY_RESULT_PROPS = [
  "data",
  "error",
  "isError",
  "isSuccess",
  "isFetching",
] as const;

// Module-level, so useQueries keeps the same entries while no result changes.
const toEntries = (
  results: Array<UseQueryResult<WorkItemResponseDto, Error>>
): FeatureContentEntry[] => results.map(toEntry);

const subtreeEntry = (
  result: UseQueryResult<WorkItemResponseDto[], Error>,
  items: ReadonlyMap<string, WorkItemResponseDto>,
  id: string
): FeatureContentEntry => {
  const data = items.get(id);
  if (result.isError) {
    return { status: "error", data, error: result.error };
  }
  if (result.isSuccess && !result.isFetching) {
    return data
      ? { status: "ready", data }
      : { status: "error", error: new FeatureUnavailableError() };
  }
  return { status: "loading", data };
};

/**
 * Feature content keyed by feature identity. Each requested feature is its
 * own query (coalesced into batched requests), so a reference list that is
 * re-read with unchanged ids requests nothing, and structural sharing keeps
 * entry data identity stable when a re-read returns unchanged content.
 *
 * With `selectedRoot`, the root is read by id and its descendants by one
 * subtree traversal.
 */
export function useFeatureDocumentContent(
  organizationId: string,
  projectId: string,
  featureIds: readonly string[],
  selectedRoot?: { id: string; descendantIds: readonly string[] },
  projection: FeatureContentProjection = "document"
) {
  const queryClient = useQueryClient();
  const enabled = !!organizationId && !!projectId;
  const rootId = selectedRoot?.id;
  const idsKey = featureIds.join("|");
  const descendantsKey = selectedRoot?.descendantIds.join("|") ?? "";
  const byIdIds = useMemo(
    () => [...new Set(rootId ? [rootId] : idsKey ? idsKey.split("|") : [])],
    [idsKey, rootId]
  );
  const descendantIds = useMemo(
    () => (descendantsKey ? descendantsKey.split("|") : []),
    [descendantsKey]
  );

  const byIdEntries = useQueries({
    queries: byIdIds.map((id) => ({
      ...featureContentQueryOptions(organizationId, projectId, projection, id),
      enabled,
      notifyOnChangeProps: [...ENTRY_RESULT_PROPS],
    })),
    combine: toEntries,
  });
  const subtreeResult = useQuery({
    ...featureSubtreeQueryOptions(
      queryClient,
      organizationId,
      projectId,
      projection,
      rootId ?? NO_ROOT
    ),
    enabled: enabled && !!rootId,
  });
  const subtree = rootId ? subtreeResult : undefined;

  const entries = useMemo(() => {
    const next = new Map<string, FeatureContentEntry>();
    byIdIds.forEach((id, index) => {
      const entry = byIdEntries[index];
      if (entry) next.set(id, entry);
    });
    if (subtree) {
      const items = new Map((subtree.data ?? []).map((item) => [item.id, item]));
      for (const id of descendantIds) {
        if (id !== rootId) next.set(id, subtreeEntry(subtree, items, id));
      }
    }
    return next;
  }, [byIdEntries, byIdIds, descendantIds, rootId, subtree]);

  const retry = useCallback(
    (id: string) =>
      queryClient.refetchQueries({
        queryKey:
          rootId && id !== rootId
            ? featureContentKeys.subtree(
                organizationId,
                projectId,
                projection,
                rootId
              )
            : featureContentKeys.byId(organizationId, projectId, projection, id),
        exact: true,
      }),
    [organizationId, projectId, projection, queryClient, rootId]
  );

  return { entries, retry };
}
