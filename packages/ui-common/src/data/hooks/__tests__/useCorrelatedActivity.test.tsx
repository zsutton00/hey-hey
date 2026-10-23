import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  ProjectMetricIdentity,
  type ActivityCorrelationRecordDto,
} from "../../../api";
import { activityCorrelationClient } from "../../../clients/serviceClients";
import {
  activityKeys,
  crossProjectActivityQueryOptions,
} from "../../collections/activityCorrelations";
import { invalidateAllDataLayerQueries } from "../../query/dataLayerInvalidation";
import {
  useCorrelatedActivity,
  useCrossProjectActivity,
} from "../useCorrelatedActivity";

vi.mock("../../../clients/serviceClients", () => ({
  activityCorrelationClient: {
    getCorrelatedActivity: vi.fn(),
    getCorrelatedActivityByEntity: vi.fn(),
    queryActivity: vi.fn(),
  },
}));
const entityRead = vi.mocked(
  activityCorrelationClient.getCorrelatedActivityByEntity
);
const crossRead = vi.mocked(activityCorrelationClient.queryActivity);
const clients: QueryClient[] = [];
const record: ActivityCorrelationRecordDto = {
  entityId: "task-1",
  projectId: "project-1",
  entityType: EntityType.Task,
  title: "Task one",
  type: ActivityCorrelationActivityType.Viewed,
  timestamp: "2026-03-02T00:00:00Z",
  source: ActivityCorrelationSource.AttentionEvent,
  linkedEntities: [],
  reports: [],
};
const response = (records = [record], nextOffset: number | null = null) => ({
  data: { data: records },
  headers: { "x-next-offset": nextOffset, "x-total-count": records.length },
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
const scope = { entityType: EntityType.Task, entityId: "task-1" };

beforeEach(() => {
  vi.clearAllMocks();
  entityRead.mockResolvedValue(response() as never);
  crossRead.mockResolvedValue(response() as never);
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe("activity query cache", () => {
  it("shares one entity read across views and fresh remounts", async () => {
    const { client, wrapper } = setup();
    const first = renderHook(
      () => [
        useCorrelatedActivity("org", { ...scope, view: "dropdown" }),
        useCorrelatedActivity("org", { ...scope, view: "full" }),
      ],
      { wrapper }
    );
    await waitFor(() =>
      expect(first.result.current.every((feed) => feed.isReady)).toBe(true)
    );
    expect(entityRead).toHaveBeenCalledTimes(1);
    expect(first.result.current[0].rawRecords).toBe(
      first.result.current[1].rawRecords
    );
    expect(
      client.getQueryCache().findAll({ queryKey: activityKeys.root() })
    ).toHaveLength(1);
    first.unmount();
    const second = renderHook(() => useCorrelatedActivity("org", scope), {
      wrapper,
    });
    expect(second.result.current.isReady).toBe(true);
    expect(entityRead).toHaveBeenCalledTimes(1);
  });

  it("shares recent project reads and keeps server filters and offsets in separate keys", async () => {
    const { wrapper } = setup();
    const recentRead = vi.mocked(
      activityCorrelationClient.getCorrelatedActivity
    );
    recentRead.mockResolvedValue({
      data: {
        data: [
          {
            entityId: "task-1",
            entityType: EntityType.Task,
            title: "Task one",
            timestamp: "2026-03-02T00:00:00Z",
            linkedEntities: [],
            reports: [],
          },
        ],
      },
      headers: {},
    } as never);
    const recent = renderHook(
      () => [
        useCorrelatedActivity("org", { projectId: "project-1" }),
        useCorrelatedActivity("org", { projectId: "project-1" }),
      ],
      { wrapper }
    );
    await waitFor(() =>
      expect(recent.result.current[0].records).toHaveLength(1)
    );
    expect(recentRead).toHaveBeenCalledTimes(1);
    const scoped = renderHook(
      ({ userId, offset }) =>
        useCrossProjectActivity("org", { userId, offset, limit: 25 }),
      { wrapper, initialProps: { userId: "person-1", offset: 0 } }
    );
    await waitFor(() => expect(scoped.result.current.isReady).toBe(true));
    scoped.rerender({ userId: "person-2", offset: 25 });
    await waitFor(() => expect(crossRead).toHaveBeenCalledTimes(2));
    expect(
      crossRead.mock.calls.map(([params]) => ({
        userId: params.userId,
        offset: params.offset,
      }))
    ).toEqual([
      { userId: "person-1", offset: 0 },
      { userId: "person-2", offset: 25 },
    ]);
  });

  it("marks only the selected activity key stale", async () => {
    const { wrapper } = setup();
    const feeds = renderHook(
      () => [
        useCorrelatedActivity("org", scope),
        useCorrelatedActivity("org", { ...scope, entityId: "task-2" }),
      ],
      { wrapper }
    );
    await waitFor(() =>
      expect(feeds.result.current.every((feed) => feed.isReady)).toBe(true)
    );
    await act(async () => feeds.result.current[0].markStale());
    await waitFor(() => expect(entityRead).toHaveBeenCalledTimes(3));
    expect(entityRead.mock.calls[2][0].entityId).toBe("task-1");
  });

  it("shares cross-project reads and reconnect refetches only mounted keys once", async () => {
    const { client, wrapper } = setup();
    const mounted = renderHook(
      () => [useCrossProjectActivity("org"), useCrossProjectActivity("org")],
      { wrapper }
    );
    const inactive = renderHook(
      () => useCrossProjectActivity("org", { userId: "other" }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        inactive.result.current.isReady && mounted.result.current[0].isReady
      ).toBe(true)
    );
    inactive.unmount();
    expect(crossRead).toHaveBeenCalledTimes(2);
    await act(() => invalidateAllDataLayerQueries(client));
    expect(crossRead).toHaveBeenCalledTimes(3);
    expect(crossRead.mock.calls[2][0].userId).toBeUndefined();
  });

  it("restarts an initial read after invalidation and ignores its old response", async () => {
    const { client, wrapper } = setup();
    let finishOld!: (value: ReturnType<typeof response>) => void;
    entityRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }) as never
    );
    const { result } = renderHook(() => useCorrelatedActivity("org", scope), {
      wrapper,
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(() => invalidateAllDataLayerQueries(client));
    expect(entityRead).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.records).toHaveLength(1));
    await act(async () => finishOld(response([])));
    expect(result.current.records).toHaveLength(1);
    expect(entityRead.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("distinguishes disabled, pending, empty and explicit failure states, and caches 4xx", async () => {
    const { wrapper } = setup();
    const disabled = renderHook(() => useCorrelatedActivity(undefined, scope), {
      wrapper,
    });
    expect(disabled.result.current).toMatchObject({
      data: null,
      isFetched: false,
      isReady: false,
      error: null,
    });
    expect(entityRead).not.toHaveBeenCalled();
    entityRead.mockResolvedValueOnce(response([]) as never);
    const empty = renderHook(() => useCorrelatedActivity("empty", scope), {
      wrapper,
    });
    await waitFor(() => expect(empty.result.current.isReady).toBe(true));
    expect(empty.result.current.records).toEqual([]);
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    entityRead.mockRejectedValueOnce(error);
    const failed = renderHook(() => useCorrelatedActivity("failed", scope), {
      wrapper,
    });
    await waitFor(() => expect(failed.result.current.error).toBe(error));
    expect(failed.result.current.isReady).toBe(false);
    failed.unmount();
    renderHook(() => useCorrelatedActivity("failed", scope), { wrapper });
    expect(entityRead).toHaveBeenCalledTimes(2);
  });

  it("keeps expired cached records visible with refreshing state", async () => {
    const { client, wrapper } = setup();
    const first = renderHook(() => useCorrelatedActivity("org", scope), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();
    const key = activityKeys.correlated({ organizationId: "org", ...scope });
    client.setQueryData(key, client.getQueryData(key), {
      updatedAt: Date.now() - 10000,
    });
    entityRead.mockImplementationOnce(() => new Promise(() => {}) as never);
    const next = renderHook(
      () => useCorrelatedActivity("org", { ...scope, maxCacheAgeMs: 1000 }),
      { wrapper }
    );
    expect(next.result.current.records).toHaveLength(1);
    expect(next.result.current.isFetching).toBe(true);
    await waitFor(() => expect(entityRead).toHaveBeenCalledTimes(2));
  });

  it("preserves exact metric continuation across infinite pages", async () => {
    const { client } = setup();
    const metricContinuation = {
      metric: ProjectMetricIdentity.TaskCompleted,
      projectIds: ["project-2", "project-1"],
      windowStart: "2026-03-01T00:00:00Z",
      windowEnd: "2026-03-02T00:00:00Z",
      actorScope: { mode: "PERSONAL" as const, userId: "person" },
    };
    crossRead
      .mockResolvedValueOnce(response([record], 25) as never)
      .mockResolvedValueOnce(response([]) as never);
    const observer = new InfiniteQueryObserver(
      client,
      crossProjectActivityQueryOptions({
        organizationId: "org",
        metricContinuation,
        limit: 25,
      })
    );
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await observer.fetchNextPage();
    expect(crossRead.mock.calls.map(([params]) => params.offset)).toEqual([
      0, 25,
    ]);
    expect(
      crossRead.mock.calls.map(([params]) => params.metricContinuation)
    ).toEqual([
      expect.objectContaining({
        projectIds: ["project-2", "project-1"],
        actorUserId: "person",
      }),
      expect.objectContaining({
        projectIds: ["project-2", "project-1"],
        actorUserId: "person",
      }),
    ]);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
    unsubscribe();
  });

  it("scopes subscription invalidation and explicit refetch preserves the return shape", async () => {
    const { wrapper } = setup();
    let update!: () => void;
    const unsubscribe = vi.fn();
    const subscribeToUpdates = (callback: () => void) => {
      update = callback;
      return unsubscribe;
    };
    const hook = renderHook(
      () => useCorrelatedActivity("org", { ...scope, subscribeToUpdates }),
      { wrapper }
    );
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    await act(async () => update());
    await waitFor(() => expect(entityRead).toHaveBeenCalledTimes(2));
    await act(async () => {
      const data = await hook.result.current.refetch();
      expect(data?.items).toHaveLength(1);
    });
    expect(entityRead).toHaveBeenCalledTimes(3);
    hook.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
