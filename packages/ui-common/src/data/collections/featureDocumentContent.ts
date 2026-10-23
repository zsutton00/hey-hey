import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type { WorkItemResponseDto } from "./workItems";

const FEATURE_CONTENT_BATCH_SIZE = 100;
const FEATURE_CONTENT_PAGE_SIZE = 500;
export type FeatureContentEntry =
  | { status: "loading"; data?: WorkItemResponseDto }
  | { status: "ready"; data: WorkItemResponseDto }
  | { status: "error"; data?: WorkItemResponseDto; error: Error };
type Selection =
  { taskIds: string[] } | { parentTaskId: string; includeDescendants: true };

/** Task lists return arrays; a short page ends traversal. */
export async function fetchFeaturePages(
  organizationId: string,
  projectId: string,
  selection: Selection,
  includeSectionKeys: string[] | undefined,
): Promise<WorkItemResponseDto[]> {
  const items = new Map<string, WorkItemResponseDto>();
  for (let page = 1; ; page += 1) {
    const response = await unifiedApiClient.getTasks({
      organizationId,
      projectId,
      ...selection,
      type: "FEATURE",
      includeSectionKeys,
      page,
      limit: FEATURE_CONTENT_PAGE_SIZE,
    });
    const values = response.data.data;
    if (!values)
      throw new Error("Feature content response is missing its item list.");
    for (const item of values) items.set(item.id, item);
    if (values.length < FEATURE_CONTENT_PAGE_SIZE) return [...items.values()];
  }
}

export type FeatureContentProjection = "document" | "metadata";

const featureContentSectionKeys = (
  projection: FeatureContentProjection,
): string[] | undefined =>
  projection === "document" ? ["description", "requirements"] : undefined;

/**
 * Prefix tree for feature content. Content is keyed by feature identity, not
 * by when the reference list was last read, so re-reading unchanged
 * references never re-reads content. Work-item changes in a project
 * invalidate `project(organizationId, projectId)`.
 */
export const featureContentKeys = {
  root: () => ["featureContent"] as const,
  all: (organizationId: string) => ["featureContent", organizationId] as const,
  project: (organizationId: string, projectId: string) =>
    [...featureContentKeys.all(organizationId), projectId] as const,
  byId: (
    organizationId: string,
    projectId: string,
    projection: FeatureContentProjection,
    featureId: string,
  ) =>
    [
      ...featureContentKeys.project(organizationId, projectId),
      projection,
      "byId",
      featureId,
    ] as const,
  subtree: (
    organizationId: string,
    projectId: string,
    projection: FeatureContentProjection,
    rootId: string,
  ) =>
    [
      ...featureContentKeys.project(organizationId, projectId),
      projection,
      "subtree",
      rootId,
    ] as const,
};

/** A requested feature the server no longer returns; cached as a 404. */
export class FeatureUnavailableError extends Error {
  readonly status = 404;
  constructor() {
    super("Feature is no longer available.");
  }
}

type PendingRead = {
  resolve: (item: WorkItemResponseDto) => void;
  reject: (error: Error) => void;
};

const pendingBatches = new Map<string, Map<string, PendingRead[]>>();

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error("Unable to load feature content.");

function flushBatch(
  batchKey: string,
  organizationId: string,
  projectId: string,
  sectionKeys: string[] | undefined,
) {
  const pending = pendingBatches.get(batchKey);
  pendingBatches.delete(batchKey);
  if (!pending) return;
  const ids = [...pending.keys()];
  for (
    let offset = 0;
    offset < ids.length;
    offset += FEATURE_CONTENT_BATCH_SIZE
  ) {
    const batch = ids.slice(offset, offset + FEATURE_CONTENT_BATCH_SIZE);
    fetchFeaturePages(
      organizationId,
      projectId,
      { taskIds: batch },
      sectionKeys,
    ).then(
      (items) => {
        const found = new Map(items.map((item) => [item.id, item]));
        for (const id of batch) {
          const item = found.get(id);
          for (const read of pending.get(id) ?? []) {
            if (item) read.resolve(item);
            else read.reject(new FeatureUnavailableError());
          }
        }
      },
      (error: unknown) => {
        for (const id of batch) {
          for (const read of pending.get(id) ?? []) read.reject(toError(error));
        }
      },
    );
  }
}

/**
 * Reads one feature's content. Reads requested in the same task are
 * coalesced into `taskIds` batches of at most FEATURE_CONTENT_BATCH_SIZE, so
 * per-feature queries cost one request per batch, not one per feature.
 */
function fetchFeatureContent(
  organizationId: string,
  projectId: string,
  projection: FeatureContentProjection,
  featureId: string,
): Promise<WorkItemResponseDto> {
  const batchKey = JSON.stringify([organizationId, projectId, projection]);
  let pending = pendingBatches.get(batchKey);
  if (!pending) {
    pending = new Map();
    pendingBatches.set(batchKey, pending);
    setTimeout(() =>
      flushBatch(
        batchKey,
        organizationId,
        projectId,
        featureContentSectionKeys(projection),
      ),
    );
  }
  const reads = pending.get(featureId) ?? [];
  pending.set(featureId, reads);
  return new Promise((resolve, reject) => reads.push({ resolve, reject }));
}

const featureContentQueryPolicy = {
  ...dataLayerQueryPolicy,
  // A failed feature stays failed until the caller retries it.
  retry: false,
  retryOnMount: false,
} as const;

export function featureContentQueryOptions(
  organizationId: string,
  projectId: string,
  projection: FeatureContentProjection,
  featureId: string,
) {
  return queryOptions({
    ...featureContentQueryPolicy,
    queryKey: featureContentKeys.byId(
      organizationId,
      projectId,
      projection,
      featureId,
    ),
    queryFn: () =>
      fetchFeatureContent(organizationId, projectId, projection, featureId),
  });
}

/**
 * Reads every descendant of a root in one paged traversal and seeds each
 * descendant's by-id entry, so a later by-id read of a loaded descendant is
 * served from cache.
 */
export function featureSubtreeQueryOptions(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  projection: FeatureContentProjection,
  rootId: string,
) {
  return queryOptions({
    ...featureContentQueryPolicy,
    queryKey: featureContentKeys.subtree(
      organizationId,
      projectId,
      projection,
      rootId,
    ),
    queryFn: async () => {
      const items = await fetchFeaturePages(
        organizationId,
        projectId,
        { parentTaskId: rootId, includeDescendants: true },
        featureContentSectionKeys(projection),
      );
      for (const item of items) {
        queryClient.setQueryData(
          featureContentKeys.byId(
            organizationId,
            projectId,
            projection,
            item.id,
          ),
          item,
        );
      }
      return items;
    },
  });
}
