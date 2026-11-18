import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  BatchReadWorkItemExecutionState200Response,
  WorkItemExecutionState,
  WorkItemExecutionStateBatchItemDto,
} from "../../api";
import { dataClient } from "../../clients";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import {
  BATCH_LIMIT,
  createPacedBatchReadCoordinator,
  type HydrationClock,
  type PacedBatchReadCoordinator,
} from "../query/pacedBatchRead";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

/**
 * Latest owner-reported execution state of participating work items: one
 * query per item, shared by every consumer. A read joins one paced batch per
 * project; realtime events write the record they carry. The platform revision
 * orders both, so an older delivery never replaces a newer record.
 */

export const workItemExecutionStateKeys = {
  project: (organizationId: string, projectId: string) =>
    ["workItemExecutionState", organizationId, projectId] as const,
  item: (organizationId: string, projectId: string, workItemId: string) =>
    [
      ...workItemExecutionStateKeys.project(organizationId, projectId),
      workItemId,
    ] as const,
};

/** What the platform holds for one work item. */
export type WorkItemExecutionStateEntry =
  | { result: "RETAINED"; executionState: WorkItemExecutionState }
  | { result: "MISSING" };

const toEntry = (
  item: WorkItemExecutionStateBatchItemDto,
): WorkItemExecutionStateEntry =>
  item.result === "RETAINED"
    ? { result: "RETAINED", executionState: item.executionState }
    : { result: "MISSING" };

const revisionOf = (entry: WorkItemExecutionStateEntry | undefined): number =>
  entry?.result === "RETAINED" ? entry.executionState.revision : 0;

/**
 * A read is the platform's answer at read time, so it stands unless the cache
 * already holds a strictly newer revision. Freshness can differ between two
 * answers at one revision, and the later answer is the true one.
 */
function writeReadResult(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  item: WorkItemExecutionStateBatchItemDto,
): void {
  const incoming = toEntry(item);
  queryClient.setQueryData<WorkItemExecutionStateEntry>(
    workItemExecutionStateKeys.item(organizationId, projectId, item.workItemId),
    (current) =>
      revisionOf(current) > revisionOf(incoming) ? current : incoming,
  );
}

/** A realtime record replaces the cached one only when strictly newer. */
export function writeWorkItemExecutionStateEvent(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  executionState: WorkItemExecutionState,
): void {
  queryClient.setQueryData<WorkItemExecutionStateEntry>(
    workItemExecutionStateKeys.item(
      organizationId,
      projectId,
      executionState.workItemId,
    ),
    (current) =>
      revisionOf(current) >= executionState.revision
        ? current
        : { result: "RETAINED", executionState },
  );
}

const fetchWorkItemExecutionStateBatch = async (
  organizationId: string,
  projectId: string,
  workItemIds: string[],
): Promise<WorkItemExecutionStateBatchItemDto[]> => {
  const response =
    await dataClient.request<BatchReadWorkItemExecutionState200Response>({
      method: "POST",
      url: `/organizations/${organizationId}/projects/${projectId}/work-items/execution-state:batch`,
      data: { workItemIds },
    });
  const items = response.data.data?.items;
  if (!items) {
    throw new Error("Work item execution-state read returned no items");
  }

  return items;
};

export const createWorkItemExecutionStateCoordinator = (
  queryClient: QueryClient,
  clock?: HydrationClock,
): PacedBatchReadCoordinator =>
  createPacedBatchReadCoordinator(
    fetchWorkItemExecutionStateBatch,
    (organizationId, projectId, items) =>
      items.forEach((item) =>
        writeReadResult(queryClient, organizationId, projectId, item),
      ),
    clock,
  );

const coordinators = new WeakMap<QueryClient, PacedBatchReadCoordinator>();

const coordinatorFor = (
  queryClient: QueryClient,
): PacedBatchReadCoordinator => {
  const existing = coordinators.get(queryClient);
  if (existing) {
    return existing;
  }

  const coordinator = createWorkItemExecutionStateCoordinator(queryClient);
  coordinators.set(queryClient, coordinator);
  return coordinator;
};

export function workItemExecutionStateQueryOptions(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  workItemId: string,
) {
  const queryKey = workItemExecutionStateKeys.item(
    organizationId,
    projectId,
    workItemId,
  );

  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async (): Promise<WorkItemExecutionStateEntry> => {
      await coordinatorFor(queryClient).request({
        organizationId,
        projectId,
        ids: [workItemId],
      });
      const entry =
        queryClient.getQueryData<WorkItemExecutionStateEntry>(queryKey);
      if (!entry) {
        throw new Error("Work item execution-state read omitted the item");
      }

      return entry;
    },
  });
}

/**
 * Whether this client is still receiving a project's updates. Cached records
 * keep the owner's reported condition and freshness; delivery says whether the
 * client can know of a newer one. It starts `INTERRUPTED` and becomes `LIVE`
 * only once an authorized refresh after joining the project room succeeds.
 * Leaving the room interrupts that project; losing the platform connection
 * interrupts every project again.
 */
export type WorkItemExecutionStateDelivery = "LIVE" | "INTERRUPTED";

interface DeliveryStore {
  /** Advances when the connection or its authorization is lost. */
  epoch: number;
  /** Advances per project when this client leaves that project's room. */
  projectEpochs: Map<string, number>;
  live: Set<string>;
  listeners: Set<() => void>;
}

const deliveryStores = new WeakMap<QueryClient, DeliveryStore>();

const deliveryStoreFor = (queryClient: QueryClient): DeliveryStore => {
  const existing = deliveryStores.get(queryClient);
  if (existing) {
    return existing;
  }

  const store: DeliveryStore = {
    epoch: 0,
    projectEpochs: new Map(),
    live: new Set(),
    listeners: new Set(),
  };
  deliveryStores.set(queryClient, store);
  return store;
};

const deliveryKey = (organizationId: string, projectId: string) =>
  `${organizationId}/${projectId}`;

const notifyDelivery = (store: DeliveryStore) =>
  store.listeners.forEach((listener) => listener());

export function readWorkItemExecutionStateDelivery(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
): WorkItemExecutionStateDelivery {
  const { live } = deliveryStoreFor(queryClient);
  return live.has(deliveryKey(organizationId, projectId))
    ? "LIVE"
    : "INTERRUPTED";
}

export function subscribeWorkItemExecutionStateDelivery(
  queryClient: QueryClient,
  listener: () => void,
): () => void {
  const store = deliveryStoreFor(queryClient);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

/** The platform connection or its authorization was lost. */
export function interruptWorkItemExecutionStateDelivery(
  queryClient: QueryClient,
): void {
  const store = deliveryStoreFor(queryClient);
  store.epoch += 1;
  if (store.live.size === 0) {
    return;
  }

  store.live.clear();
  notifyDelivery(store);
}

/**
 * This client left a project's room: its updates stop arriving, and a refresh
 * begun under the departed membership must not mark the project live.
 */
export function interruptWorkItemExecutionStateProjectDelivery(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
): void {
  const store = deliveryStoreFor(queryClient);
  const key = deliveryKey(organizationId, projectId);
  store.projectEpochs.set(key, (store.projectEpochs.get(key) ?? 0) + 1);
  if (!store.live.delete(key)) {
    return;
  }

  notifyDelivery(store);
}

/**
 * After joining a project room, events may have been missed: every held
 * execution state in the project reads again through the paced batch, whether
 * or not a component is currently mounted on it. Invalidation alone refetches
 * only mounted queries, so unmounted cached entries are requested directly in
 * batches of at most `BATCH_LIMIT`. The project's delivery becomes live only if
 * every read succeeded and neither the connection nor this project's room
 * membership changed meanwhile.
 */
export async function refreshLoadedWorkItemExecutionStates(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const store = deliveryStoreFor(queryClient);
  const key = deliveryKey(organizationId, projectId);
  const epoch = store.epoch;
  const projectEpoch = store.projectEpochs.get(key);
  const queryKey = workItemExecutionStateKeys.project(
    organizationId,
    projectId,
  );

  await invalidateWithFollowUpRead(queryClient, { queryKey });
  await readUnmountedWorkItemExecutionStates(
    queryClient,
    organizationId,
    projectId,
  );

  const failed = queryClient
    .getQueryCache()
    .findAll({ queryKey })
    .filter((query) => query.state.status === "error");
  if (failed.length > 0) {
    throw Object.assign(
      new Error(
        `Work item execution-state refresh failed for ${failed.length} item(s); delivery stays interrupted`,
      ),
      { cause: failed[0].state.error },
    );
  }
  const membershipEnded =
    store.epoch !== epoch || store.projectEpochs.get(key) !== projectEpoch;
  if (membershipEnded) {
    return;
  }

  store.live.add(key);
  notifyDelivery(store);
}

async function readUnmountedWorkItemExecutionStates(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const unmountedIds = queryClient
    .getQueryCache()
    .findAll({
      queryKey: workItemExecutionStateKeys.project(organizationId, projectId),
    })
    .filter((query) => query.getObserversCount() === 0)
    .map((query) => String(query.queryKey[3]));
  const coordinator = coordinatorFor(queryClient);
  const reads: Array<Promise<void>> = [];

  for (let start = 0; start < unmountedIds.length; start += BATCH_LIMIT) {
    reads.push(
      coordinator.request({
        organizationId,
        projectId,
        ids: unmountedIds.slice(start, start + BATCH_LIMIT),
      }),
    );
  }

  await Promise.all(reads);
}
