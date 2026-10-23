import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus } from "../../../api";
import { featureContentKeys } from "../../collections/featureDocumentContent";
import { workItemKeys } from "../../collections/workItemLists";
import { useWorkItems } from "../../hooks/useWorkItems";
import { usePrivateBetaDisclosure } from "../../hooks/usePrivateBetaDisclosure";
import { useServices } from "../../hooks/useServices";
import { WebSocketHandler } from "../../websockets/handler";
import {
  dataLayerQueryRoots,
  invalidateProjectWorkItemQueries,
} from "../dataLayerInvalidation";

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  updateTask: vi.fn(),
  getPrivateBetaDisclosureStatus: vi.fn(),
  dataRequest: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unifiedApiClient: {
    getTasks: mocks.getTasks,
    updateTask: mocks.updateTask,
    getPrivateBetaDisclosureStatus: mocks.getPrivateBetaDisclosureStatus,
  },
}));
vi.mock("../../../clients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dataClient: { request: mocks.dataRequest },
}));
vi.mock("../../hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const goal = (id: string) => ({
  id,
  name: id,
  type: "GOAL",
  organizationId: "org",
  projectId: "project",
  status: WorkStatus.Active,
  source: TaskSource.User,
});

const feature = (id: string) => ({ ...goal(id), type: "FEATURE" });

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const clientWrapper =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider store={createStore()}>{children}</Provider>
    </QueryClientProvider>
  );

const useGoals = () =>
  useWorkItems("org", "task", "project", undefined, {
    taskType: "GOAL",
    status: WorkStatus.Active,
  });

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("goal and plan lists", () => {
  it("share one read per list and refresh once per project invalidation", async () => {
    mocks.getTasks.mockResolvedValue({ data: { data: [goal("g1")] } });
    const client = createClient();
    const { result } = renderHook(
      () => ({ sidebar: useGoals(), picker: useGoals() }),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.sidebar.isReady).toBe(true));
    expect(result.current.picker.workItems).toEqual(
      result.current.sidebar.workItems
    );
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
    // The status filter is a select over the complete list.
    expect(mocks.getTasks.mock.calls[0][0]).toMatchObject({
      organizationId: "org",
      projectId: "project",
      type: "GOAL",
      status: undefined,
    });
    expect(
      client.getQueryCache().findAll({ queryKey: workItemKeys.root() })
    ).toHaveLength(1);

    await act(async () => {
      await invalidateProjectWorkItemQueries(client, "org", "other");
    });
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
    await act(async () => {
      await invalidateProjectWorkItemQueries(client, "org", "project");
    });
    expect(mocks.getTasks).toHaveBeenCalledTimes(2);
  });

  it("serves project-wide lists of any type from TanStack Query", async () => {
    mocks.getTasks.mockResolvedValue({ data: { data: [feature("f1")] } });
    const client = createClient();
    const { result } = renderHook(
      () =>
        useWorkItems("org", "task", "project", undefined, {
          taskType: "FEATURE",
        }),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.workItems.map((item) => item.id)).toEqual(["f1"]);
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
    const [query] = client
      .getQueryCache()
      .findAll({ queryKey: workItemKeys.root() });
    expect(query.state.data).toEqual([feature("f1")]);
  });

  it("serves parent-scoped lists from TanStack Query", async () => {
    mocks.getTasks.mockResolvedValue({ data: { data: [] } });
    const client = createClient();
    const { result } = renderHook(
      () =>
        useWorkItems("org", "task", "project", undefined, {
          taskType: "FEATURE",
          parentTaskId: "parent",
        }),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
    expect(mocks.getTasks.mock.calls[0][0]).toMatchObject({
      parentTaskId: "parent",
    });
    const [query] = client
      .getQueryCache()
      .findAll({ queryKey: workItemKeys.lists("org", "project") });
    expect(query.state.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("applies updates optimistically to cached lists and rolls back on failure", async () => {
    mocks.getTasks.mockResolvedValue({ data: { data: [feature("f1")] } });
    const failure = deferred();
    mocks.updateTask.mockReturnValueOnce(failure.promise);
    const client = createClient();
    const { result } = renderHook(
      () =>
        useWorkItems("org", "task", "project", undefined, {
          taskType: "FEATURE",
        }),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    let update: Promise<unknown> = Promise.resolve();
    act(() => {
      update = result.current.updateTask("f1", { name: "Renamed" });
      update.catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.workItems[0]?.name).toBe("Renamed")
    );

    await act(async () => {
      failure.reject(new Error("PATCH failed"));
      await update.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.workItems[0]?.name).toBe("f1"));
  });
});

describe("work-item change invalidation", () => {
  it("scopes feature content to the changed item and subtree reads", async () => {
    const client = createClient();
    const changed = featureContentKeys.byId("org", "project", "document", "f1");
    const other = featureContentKeys.byId("org", "project", "document", "f2");
    const subtree = featureContentKeys.subtree(
      "org",
      "project",
      "metadata",
      "root"
    );
    for (const queryKey of [changed, other, subtree]) {
      client.setQueryData(queryKey, feature("x"));
    }
    await invalidateProjectWorkItemQueries(client, "org", "project", "f1");
    const invalidated = (queryKey: readonly unknown[]) =>
      client.getQueryState(queryKey)?.isInvalidated;
    expect(invalidated(changed)).toBe(true);
    expect(invalidated(subtree)).toBe(true);
    expect(invalidated(other)).toBe(false);

    await invalidateProjectWorkItemQueries(client, "org", "project");
    expect(invalidated(other)).toBe(true);
  });
});

describe("reconnect", () => {
  it("re-reads every mounted migrated dataset exactly once", async () => {
    mocks.getTasks.mockResolvedValue({ data: { data: [goal("g1")] } });
    mocks.dataRequest.mockResolvedValue({ data: { data: [] } });
    mocks.getPrivateBetaDisclosureStatus.mockResolvedValue({
      data: { data: { recordedAcceptances: [] } },
    });
    const client = createClient();
    const { result } = renderHook(
      () => ({
        goals: useGoals(),
        services: useServices("org", { projectId: "project" }),
        disclosure: usePrivateBetaDisclosure(),
      }),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => {
      expect(result.current.goals.isReady).toBe(true);
      expect(result.current.services.isReady).toBe(true);
      expect(result.current.disclosure.isReady).toBe(true);
    });
    const handler = new WebSocketHandler(createStore(), undefined, client);

    await act(async () => {
      handler.markAllStale();
    });
    await waitFor(() => {
      expect(mocks.getTasks).toHaveBeenCalledTimes(2);
      expect(mocks.dataRequest).toHaveBeenCalledTimes(2);
      expect(mocks.getPrivateBetaDisclosureStatus).toHaveBeenCalledTimes(2);
    });
    for (const queryKey of dataLayerQueryRoots()) {
      for (const query of client.getQueryCache().findAll({ queryKey })) {
        expect(query.state.fetchStatus).toBe("idle");
      }
    }
  });
});

describe("max cache age", () => {
  it("keeps expired data visible, reports it refreshing, and re-reads once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fresh = deferred();
    mocks.getPrivateBetaDisclosureStatus
      .mockResolvedValueOnce({
        data: { data: { recordedAcceptances: [], version: "old" } },
      })
      .mockReturnValueOnce(fresh.promise);
    const client = createClient();
    const { result } = renderHook(
      () => usePrivateBetaDisclosure({ maxCacheAgeMs: 60_000 }),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isStale).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(60_001);
    });
    await waitFor(() =>
      expect(mocks.getPrivateBetaDisclosureStatus).toHaveBeenCalledTimes(2)
    );
    expect(result.current.data).toMatchObject({ version: "old" });
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isStale).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      fresh.resolve({
        data: { data: { recordedAcceptances: [], version: "new" } },
      });
      await fresh.promise;
    });
    await waitFor(() =>
      expect(result.current.data).toMatchObject({ version: "new" })
    );
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isStale).toBe(false);
    expect(mocks.getPrivateBetaDisclosureStatus).toHaveBeenCalledTimes(2);
  });

  it("reports cached data already past the max age as refreshing on mount", async () => {
    const fresh = deferred();
    mocks.getPrivateBetaDisclosureStatus.mockReturnValueOnce(fresh.promise);
    const client = createClient();
    client.setQueryData(
      ["privateBetaDisclosure", "current"],
      { recordedAcceptances: [], version: "cached" },
      { updatedAt: Date.now() - 120_000 }
    );
    const { result } = renderHook(
      () =>
        usePrivateBetaDisclosure({
          maxCacheAgeMs: 60_000,
          staleTimeMs: 10 * 60_000,
        }),
      { wrapper: clientWrapper(client) }
    );
    expect(result.current.data).toMatchObject({ version: "cached" });
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isStale).toBe(true);
    await waitFor(() =>
      expect(mocks.getPrivateBetaDisclosureStatus).toHaveBeenCalledTimes(1)
    );
  });
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
