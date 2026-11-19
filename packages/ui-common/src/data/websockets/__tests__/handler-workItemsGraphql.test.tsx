import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../../api";
import {
  FakeWorkItemServer,
  type FakeWorkItem,
} from "../../../test/workItemGraphQL";
import { featureContentKeys } from "../../collections/featureDocumentContent";
import { useTaskHierarchy } from "../../hooks/useTaskHierarchy";
import { useWorkItem } from "../../hooks/useWorkItem";
import { useWorkItemGraph } from "../../hooks/useWorkItemGraph";
import { useWorkItemReferences } from "../../hooks/useWorkItemReferences";
import { useWorkItems } from "../../hooks/useWorkItems";
import { WebSocketHandler } from "../handler";

vi.mock("../../../utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ORG = "org-1";
const PROJECT = "project-1";
const scope = {
  timestamp: "2026-11-01T00:00:00.000Z",
  organizationId: ORG,
  projectId: PROJECT,
};

const parent: FakeWorkItem = {
  id: "p1",
  name: "Parent",
  type: "FEATURE",
  status: "ACTIVE",
};
const task: FakeWorkItem = {
  id: "t1",
  name: "First task",
  type: "STANDARD",
  status: WorkStatus.Backlog,
  parentTaskId: "p1",
};
const competitor: FakeWorkItem = {
  id: "c1",
  name: "Competitor profile",
  type: "competitor",
  status: "RESEARCHING",
  parentTaskId: "p1",
};

describe("work-item events over GraphQL", () => {
  let server: FakeWorkItemServer;
  let handler: WebSocketHandler;

  /** A list, a detail, a hierarchy, a graph and a reference list of the same data. */
  const mountViews = async (options: { statuses?: WorkStatus[] } = {}) => {
    const views = renderHook(
      () => ({
        list: useWorkItems(ORG, "task", PROJECT, undefined, {
          parentTaskId: "p1",
          ...(options.statuses ? { status: options.statuses } : {}),
        }),
        detail: useWorkItem(ORG, "task", "t1", { projectId: PROJECT }),
        hierarchy: useTaskHierarchy(ORG, PROJECT, "p1"),
        graph: useWorkItemGraph(ORG, PROJECT, "p1"),
        references: useWorkItemReferences({
          organizationId: ORG,
          projectId: PROJECT,
          workItemType: "STANDARD",
        }),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => {
      expect(views.result.current.list.isReady).toBe(true);
      expect(views.result.current.detail.isReady).toBe(true);
      expect(views.result.current.hierarchy.isReady).toBe(true);
      expect(views.result.current.graph.isReady).toBe(true);
      expect(views.result.current.references.status).not.toBe("loading");
    });

    return views;
  };

  const projectCache = () =>
    server.graphql.forProject({ organizationId: ORG, projectId: PROJECT })
      .cache;
  const cacheId = (id: string) =>
    projectCache().identify({ __typename: "WorkItem", id });
  /** Cache entries that are work items. */
  const cachedWorkItems = () =>
    Object.keys(projectCache().extract()).filter((key) =>
      key.startsWith("WorkItem:"),
    );

  beforeEach(() => {
    server = new FakeWorkItemServer([parent, task, competitor]);
    handler = new WebSocketHandler(
      createStore(),
      undefined,
      server.queryClient,
      server.graphql.apollo,
    );
  });

  it("holds one cached record that list, detail, hierarchy and graph views share", async () => {
    const views = await mountViews();

    expect(cachedWorkItems().sort()).toEqual(
      ["c1", "p1", "t1"].map(cacheId).sort(),
    );
    expect(views.result.current.list.workItems.map((item) => item.id)).toEqual([
      "t1",
      "c1",
    ]);
    expect(views.result.current.detail.workItem?.id).toBe("t1");
  });

  it("shows a changed work item in every view that holds it", async () => {
    const views = await mountViews();

    server.update("t1", { name: "Renamed task", status: WorkStatus.Active });
    act(() =>
      handler.handleEvent({ type: "task.updated", ...scope, taskId: "t1" }),
    );

    await waitFor(() => {
      const { list, detail, hierarchy, graph } = views.result.current;
      expect(list.workItems.find((item) => item.id === "t1")?.name).toBe(
        "Renamed task",
      );
      expect(detail.workItem?.name).toBe("Renamed task");
      expect(hierarchy.children.find((c) => c.id === "t1")?.name).toBe(
        "Renamed task",
      );
      expect(graph.data?.children.find((c) => c.id === "t1")?.name).toBe(
        "Renamed task",
      );
    });
  });

  it("removes a deleted work item from every view and from the cache", async () => {
    const views = await mountViews();

    server.remove("t1");
    act(() =>
      handler.handleEvent({ type: "task.deleted", ...scope, taskId: "t1" }),
    );

    await waitFor(() => {
      const { list, detail, hierarchy, graph } = views.result.current;
      expect(list.workItems.map((item) => item.id)).toEqual(["c1"]);
      expect(hierarchy.children.map((child) => child.id)).toEqual(["c1"]);
      expect(graph.data?.children.map((child) => child.id)).toEqual(["c1"]);
      expect(detail.workItem).toBeNull();
    });
    expect(cachedWorkItems()).not.toContain(cacheId("t1"));
  });

  it("adds an item to a list it now qualifies for when its status changes", async () => {
    const views = await mountViews({ statuses: [WorkStatus.Verifying] });
    expect(views.result.current.list.workItems).toEqual([]);

    server.update("t1", { status: WorkStatus.Verifying });
    act(() =>
      handler.handleEvent({
        type: "task.status_changed",
        ...scope,
        taskId: "t1",
        previousStatus: WorkStatus.Backlog,
        newStatus: WorkStatus.Verifying,
      }),
    );

    await waitFor(() =>
      expect(views.result.current.list.workItems.map((i) => i.id)).toEqual([
        "t1",
      ]),
    );
  });

  it("shows a created work item in lists, hierarchies and reference lists", async () => {
    const views = await mountViews();

    server.add({
      id: "t2",
      name: "Second task",
      type: "STANDARD",
      status: WorkStatus.Backlog,
      parentTaskId: "p1",
    });
    act(() =>
      handler.handleEvent({ type: "task.created", ...scope, taskId: "t2" }),
    );

    await waitFor(() => {
      const { list, hierarchy, references } = views.result.current;
      expect(list.workItems.map((item) => item.id)).toContain("t2");
      expect(hierarchy.children.map((child) => child.id)).toContain("t2");
      expect(references.references.map((ref) => ref.id)).toContain("t2");
    });
  });

  it("never writes a record the server did not return", async () => {
    await mountViews();

    act(() =>
      handler.handleEvent({ type: "task.created", ...scope, taskId: "ghost" }),
    );
    await waitFor(() =>
      expect(server.received("GetWorkItems").length).toBeGreaterThan(1),
    );

    expect(cachedWorkItems()).not.toContain(cacheId("ghost"));
  });

  it("reads again every shown work-item read after a reconnect", async () => {
    await mountViews();
    const before = server.requests.length;

    act(() => handler.markAllStale());

    await waitFor(() => {
      for (const operation of [
        "GetWorkItems",
        "GetWorkItem",
        "GetWorkItemHierarchy",
        "GetWorkItemGraph",
        "GetAllWorkItemReferences",
      ]) {
        expect(
          server.received(operation).length,
          operation,
        ).toBeGreaterThanOrEqual(2);
      }
    });
    expect(server.requests.length).toBeGreaterThan(before);
  });

  it("still invalidates the TanStack data that depends on a work item", async () => {
    const contentKey = featureContentKeys.byId(ORG, PROJECT, "document", "t1");
    server.queryClient.setQueryData(contentKey, task);

    act(() =>
      handler.handleEvent({ type: "task.updated", ...scope, taskId: "t1" }),
    );

    expect(server.queryClient.getQueryState(contentKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("serves a project-defined type the schema has never seen", async () => {
    const views = renderHook(
      () => useWorkItem(ORG, "task", "c1", { projectId: PROJECT }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(views.result.current.workItem).not.toBeNull());

    expect(views.result.current.workItem).toMatchObject({
      id: "c1",
      type: "competitor",
      status: "RESEARCHING",
    });
  });
});
