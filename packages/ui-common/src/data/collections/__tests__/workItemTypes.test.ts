import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { createElement, type ReactNode } from "react";
import { dataClient } from "../../../clients";
import type { WorkItemTypeSummaryDto } from "../../../api";
import { WebSocketHandler } from "../../websockets/handler";
import { useMarkWorkItemTypeDataStale } from "../../hooks/useWorkItemTypeLifecycle";
import {
  useMentionWorkItemTypeKey,
  useWorkItemTypeByKey,
  useWorkItemTypeRelationshipIndex,
  useWorkItemTypes,
} from "../../hooks/useWorkItemTypes";
import { retryUnlessClientError } from "../../query/queryPolicy";
import { workItemTypeKeys } from "../workItemTypes";

const { byKeyRead } = vi.hoisted(() => ({ byKeyRead: vi.fn() }));
vi.mock("../../../clients", () => ({ dataClient: { request: vi.fn() } }));
vi.mock("../../../clients/runtime", () => ({
  getApiRuntime: () => ({ transport: { axios: {} } }),
}));
vi.mock("../../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api")>()),
  WorkItemTypesApi: class {
    organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyGet =
      byKeyRead;
  },
}));

const catalogRead = vi.mocked(dataClient.request);

const standard: WorkItemTypeSummaryDto = {
  id: "registry-row",
  projectId: "project-1",
  status: "ACTIVE",
  effectiveSource: "PROJECT_CUSTOM",
  definition: {
    key: "STANDARD",
    name: "Task",
    role: "work-item",
    sections: [],
    allowedStatuses: ["ACTIVE"],
  },
} as WorkItemTypeSummaryDto;
const archived: WorkItemTypeSummaryDto = {
  ...standard,
  id: "archived-row",
  status: "ARCHIVED",
  definition: { ...standard.definition, key: "LEGACY", name: "Legacy" },
};
const mockups: WorkItemTypeSummaryDto = {
  ...standard,
  id: "mockups-row",
  definition: { ...standard.definition, key: "mockups_v3", name: "Mockups" },
};

const clientError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });

function createHarness() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

const catalogKey = workItemTypeKeys.catalog("org-1", "project-1");
const byKeyKey = (typeKey: string) =>
  workItemTypeKeys.byKey("org-1", "project-1", typeKey);

beforeEach(() => {
  catalogRead.mockResolvedValue({ data: { data: [standard, archived] } });
  byKeyRead.mockResolvedValue({ data: { data: standard } });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("work-item type keys", () => {
  it("nests catalog and by-key reads under one project prefix", () => {
    expect(workItemTypeKeys.root()).toEqual(["workItemTypes"]);
    expect(workItemTypeKeys.all("org-1", "project-1")).toEqual([
      "workItemTypes",
      "org-1",
      "project-1",
    ]);
    expect(catalogKey).toEqual(["workItemTypes", "org-1", "project-1", "catalog"]);
    expect(byKeyKey("MARKETING")).toEqual([
      "workItemTypes",
      "org-1",
      "project-1",
      "byKey",
      "MARKETING",
    ]);
  });
});

describe("one shared catalog read", () => {
  it("serves every consumer in a project from a single request", async () => {
    const { wrapper } = createHarness();

    const first = renderHook(
      () => ({
        all: useWorkItemTypes("org-1", { projectId: "project-1" }),
        active: useWorkItemTypes("org-1", {
          projectId: "project-1",
          status: "ACTIVE",
        }),
        index: useWorkItemTypeRelationshipIndex("org-1", "project-1"),
      }),
      { wrapper }
    );
    const second = renderHook(
      () => useWorkItemTypes("org-1", { projectId: "project-1" }),
      { wrapper }
    );

    await waitFor(() => expect(first.result.current.all.isReady).toBe(true));
    expect(second.result.current.workItemTypes).toEqual([standard, archived]);
    expect(first.result.current.active.workItemTypes).toEqual([standard]);
    expect(first.result.current.index.relationshipIndex).toBeDefined();
    expect(catalogRead).toHaveBeenCalledTimes(1);
    expect(catalogRead.mock.calls[0][0]).not.toHaveProperty("params");
  });

  it("isolates catalogs by organization and project", async () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => [
        useWorkItemTypes("org-1", { projectId: "project-1" }),
        useWorkItemTypes("org-1", { projectId: "project-2" }),
        useWorkItemTypes("org-2", { projectId: "project-1" }),
      ],
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.every((query) => query.isReady)).toBe(true)
    );
    expect(catalogRead.mock.calls.map(([request]) => request.url)).toEqual([
      "/organizations/org-1/projects/project-1/work-item-types",
      "/organizations/org-1/projects/project-2/work-item-types",
      "/organizations/org-2/projects/project-1/work-item-types",
    ]);
  });
});

describe("by-key reuse of the catalog", () => {
  it("seeds a by-key read from the catalog without extending its freshness", async () => {
    const { queryClient, wrapper } = createHarness();
    const catalog = renderHook(
      () => useWorkItemTypes("org-1", { projectId: "project-1" }),
      { wrapper }
    );
    await waitFor(() => expect(catalog.result.current.isReady).toBe(true));

    const { result } = renderHook(
      () => useWorkItemTypeByKey("org-1", "project-1", "STANDARD"),
      { wrapper }
    );

    expect(result.current.workItemTypeSummary).toEqual(standard);
    expect(result.current.isReady).toBe(true);
    expect(byKeyRead).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(byKeyKey("STANDARD"))?.dataUpdatedAt).toBe(
      queryClient.getQueryState(catalogKey)?.dataUpdatedAt
    );

    await act(() => result.current.refetch());
    expect(byKeyRead).toHaveBeenCalledTimes(1);
  });

  it.each([
    "organization",
    "project",
    "incomplete",
    "missing",
    "expired",
    "invalidated",
    "reconnect",
  ] as const)("does not reuse %s catalog data", async (reason) => {
    const { queryClient, wrapper } = createHarness();
    const row =
      reason === "incomplete"
        ? { ...standard, definition: { key: "STANDARD" } }
        : standard;
    queryClient.setQueryData(catalogKey, reason === "missing" ? [] : [row], {
      updatedAt: reason === "expired" ? Date.now() - 300_001 : Date.now(),
    });
    if (reason === "invalidated") {
      await queryClient.invalidateQueries({ queryKey: catalogKey });
    }
    if (reason === "reconnect") {
      new WebSocketHandler(createStore(), undefined, queryClient).markAllStale();
    }

    renderHook(
      () =>
        useWorkItemTypeByKey(
          reason === "organization" ? "other-org" : "org-1",
          reason === "project" ? "other-project" : "project-1",
          "STANDARD"
        ),
      { wrapper }
    );

    await waitFor(() => expect(byKeyRead).toHaveBeenCalledTimes(1));
  });
});

describe("invalidation", () => {
  async function mountConsumers() {
    const harness = createHarness();
    const view = renderHook(
      () => ({
        catalog: useWorkItemTypes("org-1", { projectId: "project-1" }),
        active: useWorkItemTypes("org-1", {
          projectId: "project-1",
          status: "ACTIVE",
        }),
        type: useWorkItemTypeByKey("org-1", "project-1", "MARKETING"),
        invalidate: useMarkWorkItemTypeDataStale(),
      }),
      { wrapper: harness.wrapper }
    );
    await waitFor(() => {
      expect(view.result.current.catalog.isReady).toBe(true);
      expect(view.result.current.type.isReady).toBe(true);
    });
    catalogRead.mockClear();
    byKeyRead.mockClear();
    return { ...harness, view };
  }

  it("re-reads the catalog exactly once after a lifecycle change", async () => {
    const { queryClient, view } = await mountConsumers();

    act(() =>
      view.result.current.invalidate("org-1", "project-1", "MARKETING")
    );

    await waitFor(() => expect(byKeyRead).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(queryClient.isFetching({ queryKey: catalogKey })).toBe(0)
    );
    expect(catalogRead).toHaveBeenCalledTimes(1);
  });

  it("re-reads the catalog exactly once after a WebSocket reconnect", async () => {
    const { queryClient } = await mountConsumers();

    new WebSocketHandler(createStore(), undefined, queryClient).markAllStale();

    await waitFor(() => expect(catalogRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(catalogRead).toHaveBeenCalledTimes(1);
    expect(byKeyRead).toHaveBeenCalledTimes(1);
  });

  it("leaves unmounted reads for their next mount on reconnect", async () => {
    const { queryClient } = createHarness();
    queryClient.setQueryData(catalogKey, [standard]);

    new WebSocketHandler(createStore(), undefined, queryClient).markAllStale();

    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true);
    expect(catalogRead).not.toHaveBeenCalled();
  });
});

describe("client errors", () => {
  it("caches a 404 for the stale time instead of retrying or re-reading on mount", async () => {
    byKeyRead.mockRejectedValue(clientError(404));
    const { queryClient, wrapper } = createHarness();

    const first = renderHook(
      () => useWorkItemTypeByKey("org-1", "project-1", "GHOST"),
      { wrapper }
    );
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    expect(first.result.current.isFetched).toBe(true);
    expect(first.result.current.isReady).toBe(false);
    expect(first.result.current.isLoading).toBe(false);

    const second = renderHook(
      () => useWorkItemTypeByKey("org-1", "project-1", "GHOST"),
      { wrapper }
    );
    expect(second.result.current.error).not.toBeNull();
    expect(byKeyRead).toHaveBeenCalledTimes(1);

    await act(() =>
      queryClient.invalidateQueries({ queryKey: byKeyKey("GHOST") })
    );
    expect(byKeyRead).toHaveBeenCalledTimes(2);
  });

  it("retries only transient failures", () => {
    expect(retryUnlessClientError(0, clientError(404))).toBe(false);
    expect(retryUnlessClientError(0, clientError(403))).toBe(false);
    expect(retryUnlessClientError(0, clientError(503))).toBe(true);
    expect(retryUnlessClientError(0, new Error("Network Error"))).toBe(true);
    expect(retryUnlessClientError(3, new Error("Network Error"))).toBe(false);
  });
});

describe("registered mention type lookups", () => {
  function renderMentionLookup(kind: string) {
    const { wrapper } = createHarness();
    return renderHook(
      () => {
        const mention = useMentionWorkItemTypeKey("org-1", "project-1", kind);
        const type = useWorkItemTypeByKey("org-1", "project-1", mention.typeKey);
        return { mention, type };
      },
      { wrapper }
    );
  }

  it("never requests a type for the generic task kind", async () => {
    catalogRead.mockResolvedValue({ data: { data: [standard, mockups] } });

    const { result } = renderMentionLookup("task");

    await waitFor(() => expect(result.current.mention.isResolved).toBe(true));
    expect(result.current.mention.typeKey).toBeUndefined();
    expect(byKeyRead).not.toHaveBeenCalled();
  });

  it("resolves a custom kind that names a registered key", async () => {
    catalogRead.mockResolvedValue({ data: { data: [standard, mockups] } });

    const { result } = renderMentionLookup("mockups_v3");

    expect(result.current.mention.isResolved).toBe(false);
    await waitFor(() =>
      expect(result.current.mention.typeKey).toBe("mockups_v3")
    );
  });

  it("resolves platform aliases without reading the catalog", () => {
    const { result } = renderMentionLookup("standard");

    expect(result.current.mention).toEqual({
      typeKey: "STANDARD",
      isResolved: true,
    });
    expect(catalogRead).not.toHaveBeenCalled();
  });
});
