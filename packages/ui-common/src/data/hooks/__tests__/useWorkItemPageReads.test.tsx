import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakeWorkItemServer } from "../../../test/workItemGraphQL";
import { GetTasksPageDocument } from "../../../graphql/generated/graphql";
import { workItemListRead } from "../../collections/workItemLists";
import { refreshWorkItem } from "../../graphql/workItemCache";
import {
  useActivityWorkItems,
  usePlanTaskMonitorPageItem,
  useTasksPageItems,
} from "../useWorkItemPageReads";

const scope = { organizationId: "org-1", projectId: "project-1" };

describe("page-shaped work-item reads", () => {
  it("keeps the task list and the monitor title current from the shared event refresh", async () => {
    const server = new FakeWorkItemServer([
      {
        id: "monitor",
        name: "Old title",
        status: "ACTIVE",
        type: "TASK_MONITOR",
      },
    ]);

    const { result } = renderHook(
      () => ({
        list: useTasksPageItems(scope, true),
        detail: usePlanTaskMonitorPageItem(scope, "monitor"),
      }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => {
      expect(result.current.list.data?.[0]?.name).toBe("Old title");
      expect(result.current.detail.data?.name).toBe("Old title");
    });
    expect(result.current.list.data?.[0]).not.toHaveProperty("organizationId");
    expect(result.current.detail.data).toEqual({
      __typename: "WorkItem",
      id: "monitor",
      name: "Old title",
      type: "TASK_MONITOR",
    });
    expect(server.received("GetTasksPage")).toEqual([{}]);
    expect(server.received("GetPlanTaskMonitorPage")).toEqual([
      { id: "monitor" },
    ]);

    server.update("monitor", { name: "New title" });
    await act(async () => {
      await refreshWorkItem(server.graphql.apollo, "monitor", scope);
    });

    await waitFor(() => {
      expect(result.current.list.data?.[0]?.name).toBe("New title");
      expect(result.current.detail.data?.name).toBe("New title");
    });
  });

  it("loads activity details even when the record links more items than the filter accepts", async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `item-${index}`);
    const server = new FakeWorkItemServer(
      ids.map((id) => ({
        id,
        name: id,
        type: "STANDARD",
        status: "ACTIVE",
      })),
    );

    const { result } = renderHook(
      () => useActivityWorkItems(scope, ids, true),
      {
        wrapper: server.wrapper,
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(201));
    expect(server.received("GetActivityWorkItems")).toEqual([
      { ids: ids.slice(0, 200) },
      { ids: ids.slice(200) },
    ]);
  });

  it.each(["list", "activity"])(
    "preserves the task list's child-count breakdown when %s loads first",
    async (first) => {
      const counts = { total: 6, done: 1, inProgress: 2, backlog: 3 };
      const server = new FakeWorkItemServer([
        {
          id: "task-1",
          name: "Task",
          type: "STANDARD",
          status: "ACTIVE",
          childCounts: counts,
        },
      ]);
      const { result, rerender } = renderHook(
        ({ both }) => ({
          list: useTasksPageItems(scope, both || first === "list"),
          activity: useActivityWorkItems(
            scope,
            ["task-1"],
            both || first === "activity",
          ),
        }),
        { initialProps: { both: false }, wrapper: server.wrapper },
      );
      await waitFor(() =>
        expect(result.current[first].data?.[0]?.childCounts?.total).toBe(6),
      );

      server.update("task-1", { childCounts: { ...counts, total: 7 } });
      rerender({ both: true });

      await waitFor(() => {
        expect(result.current.activity.data?.[0]?.childCounts?.total).toBe(7);
        expect(result.current.list.data?.[0]?.childCounts).toMatchObject({
          ...counts,
          total: 7,
        });
      });
      const cachedList = server.graphql.forProject(scope).readQuery({
        query: GetTasksPageDocument,
      });
      expect(cachedList?.workItems[0]?.childCounts).toMatchObject({
        ...counts,
        total: 7,
      });
      expect(server.received("GetTasksPage")).toEqual([{}]);
      expect(server.received("GetActivityWorkItems")).toEqual([
        { ids: ["task-1"] },
      ]);
    },
  );

  it.each(["goals", "tasks"] as const)(
    "preserves the Goals summary when %s loads first and clears it on a server null",
    async (first) => {
      const summary = {
        __typename: "TrackedWorkSummary",
        totalCount: 6,
        completedCount: 1,
        pastDueCount: 2,
        openUndatedCount: 3,
        cancelledCount: 0,
      };
      const server = new FakeWorkItemServer([
        {
          id: "goal-1",
          type: "GOAL",
          status: "ACTIVE",
          name: "Goal",
          trackedWorkSummary: summary,
        },
      ]);
      const client = server.graphql.forProject(scope);
      const goals = workItemListRead(scope, {
        taskType: "GOAL",
        taskIds: ["goal-1"],
        includeTrackedEntities: false,
        includeTrackedWorkSummary: true,
        page: 1,
        limit: 1,
      });
      const reads = {
        goals: { query: goals.document, variables: goals.variables },
        tasks: { query: GetTasksPageDocument },
      };
      const network = { context: scope, fetchPolicy: "network-only" } as const;
      const load = {
        goals: () => client.query({ ...reads.goals, ...network }),
        tasks: () => client.query({ ...reads.tasks, ...network }),
      };
      await load[first]();
      server.update("goal-1", {
        trackedWorkSummary: { ...summary, totalCount: 7 },
      });
      const second = first === "goals" ? "tasks" : "goals";
      await load[second]();

      expect(
        client.readQuery(reads.goals)?.workItems[0]?.trackedWorkSummary,
      ).toEqual({ ...summary, totalCount: 7 });
      expect(
        client.readQuery(reads.tasks)?.workItems[0]?.trackedWorkSummary
          ?.totalCount,
      ).toBe(7);

      server.update("goal-1", { trackedWorkSummary: null });
      await load.tasks();
      expect(
        client.readQuery(reads.goals)?.workItems[0]?.trackedWorkSummary,
      ).toBeNull();
    },
  );
});
