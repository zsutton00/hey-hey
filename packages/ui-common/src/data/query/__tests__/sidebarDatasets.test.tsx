import { FakeWorkItemServer } from "../../../test/workItemGraphQL";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus } from "../../../api";
import { featureContentKeys } from "../../collections/featureDocumentContent";
import { useWorkItems } from "../../hooks/useWorkItems";
import { usePrivateBetaDisclosure } from "../../hooks/usePrivateBetaDisclosure";
import { useServices } from "../../hooks/useServices";
import { WebSocketHandler } from "../../websockets/handler";
import {
  dataLayerQueryRoots,
  invalidateProjectWorkItemQueries,
} from "../dataLayerInvalidation";

const mocks = vi.hoisted(() => ({
  updateTask: vi.fn(),
  getPrivateBetaDisclosureStatus: vi.fn(),
  dataRequest: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unifiedApiClient: {
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
  it("share one read per list, filtered by the server", async () => {
    const server = new FakeWorkItemServer([goal("g1"), feature("f1")]);
    const { result } = renderHook(
      () => ({ sidebar: useGoals(), picker: useGoals() }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(result.current.sidebar.isReady).toBe(true));

    expect(result.current.picker.workItems).toEqual(
      result.current.sidebar.workItems,
    );
    expect(result.current.sidebar.workItems.map((item) => item.id)).toEqual([
      "g1",
    ]);
    expect(server.received("GetWorkItems")).toHaveLength(1);
    expect(server.received("GetWorkItems")[0]).toMatchObject({
      type: "GOAL",
      statuses: ["ACTIVE"],
    });
  });

  it("serves parent-scoped lists of a type", async () => {
    const server = new FakeWorkItemServer([
      { ...feature("f1"), parentTaskId: "parent" },
      feature("f2"),
    ]);
    const { result } = renderHook(
      () =>
        useWorkItems("org", "task", "project", undefined, {
          taskType: "FEATURE",
          parentTaskId: "parent",
        }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.workItems.map((item) => item.id)).toEqual(["f1"]);
    expect(server.received("GetWorkItems")[0]).toMatchObject({
      parentTaskId: "parent",
    });
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
      "root",
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
    const server = new FakeWorkItemServer([goal("g1")]);
    const client = server.queryClient;
    mocks.dataRequest.mockResolvedValue({ data: { data: [] } });
    mocks.getPrivateBetaDisclosureStatus.mockResolvedValue({
      data: { data: { recordedAcceptances: [] } },
    });
    const { result } = renderHook(
      () => ({
        goals: useGoals(),
        services: useServices("org", { projectId: "project" }),
        disclosure: usePrivateBetaDisclosure(),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => {
      expect(result.current.goals.isReady).toBe(true);
      expect(result.current.services.isReady).toBe(true);
      expect(result.current.disclosure.isReady).toBe(true);
    });
    const handler = new WebSocketHandler(
      createStore(),
      undefined,
      client,
      server.graphql.apollo,
    );

    await act(async () => {
      handler.markAllStale();
    });
    await waitFor(() => {
      expect(server.received("GetWorkItems")).toHaveLength(2);
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
      { wrapper: clientWrapper(client) },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isStale).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(60_001);
    });
    await waitFor(() =>
      expect(mocks.getPrivateBetaDisclosureStatus).toHaveBeenCalledTimes(2),
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
      expect(result.current.data).toMatchObject({ version: "new" }),
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
      { updatedAt: Date.now() - 120_000 },
    );
    const { result } = renderHook(
      () =>
        usePrivateBetaDisclosure({
          maxCacheAgeMs: 60_000,
          staleTimeMs: 10 * 60_000,
        }),
      { wrapper: clientWrapper(client) },
    );
    expect(result.current.data).toMatchObject({ version: "cached" });
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isStale).toBe(true);
    await waitFor(() =>
      expect(mocks.getPrivateBetaDisclosureStatus).toHaveBeenCalledTimes(1),
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
