import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createStore } from "jotai/vanilla";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  workItemReferenceKeys,
  type WorkItemReferenceScope,
} from "../../collections/workItemReferences";
import { WebSocketHandler } from "../handler";

const timestamp = "2026-08-29T00:00:00.000Z";
const base = {
  timestamp,
  organizationId: "org-1",
  projectId: "project-1",
  taskId: "task-1",
};

const taskEvents = [
  ["task.created", { type: "task.created", ...base }],
  ["task.updated", { type: "task.updated", ...base, changedFields: ["name"] }],
  [
    "task.status_changed",
    {
      type: "task.status_changed",
      ...base,
      previousStatus: "BACKLOG",
      newStatus: "ACTIVE",
    },
  ],
  ["task.deleted", { type: "task.deleted", ...base }],
] as const;

describe("WebSocketHandler work-item reference invalidation", () => {
  let queryClient: QueryClient;
  let handler: WebSocketHandler;
  let unsubscribers: Array<() => void>;

  const mount = async (scope: WorkItemReferenceScope) => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const observer = new QueryObserver(queryClient, {
      queryKey: workItemReferenceKeys.list(scope),
      queryFn,
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isFetching).toBe(false),
    );
    return queryFn;
  };

  const settle = () =>
    vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

  beforeEach(() => {
    queryClient = new QueryClient();
    unsubscribers = [];
    handler = new WebSocketHandler(createStore(), undefined, queryClient);
  });

  afterEach(() => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it.each(taskEvents)(
    "%s re-reads each mounted list in that project once and none elsewhere",
    async (_name, event) => {
      const feature = await mount({ ...base, workItemType: "FEATURE" });
      const goal = await mount({ ...base, workItemType: "GOAL" });
      const otherProject = await mount({
        ...base,
        projectId: "project-2",
        workItemType: "FEATURE",
      });

      handler.handleEvent(event);
      await vi.waitFor(() => expect(feature).toHaveBeenCalledTimes(2));
      await settle();

      expect(feature).toHaveBeenCalledTimes(2);
      expect(goal).toHaveBeenCalledTimes(2);
      expect(otherProject).toHaveBeenCalledTimes(1);
    },
  );

  it("re-reads every mounted reference list once on markAllStale", async () => {
    const feature = await mount({ ...base, workItemType: "FEATURE" });
    const otherProject = await mount({
      ...base,
      projectId: "project-2",
      workItemType: "FEATURE",
    });

    handler.markAllStale();
    await vi.waitFor(() => expect(feature).toHaveBeenCalledTimes(2));
    await settle();

    expect(feature).toHaveBeenCalledTimes(2);
    expect(otherProject).toHaveBeenCalledTimes(2);
  });

});
