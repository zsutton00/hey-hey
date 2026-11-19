import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskSource,
  UpdateTaskResultStatus,
  WorkStatus,
  type ProposalResponseDto,
  type TaskResponseDto,
} from "../../../api";
import {
  FakeWorkItemServer,
  type FakeWorkItem,
} from "../../../test/workItemGraphQL";
import { useTaskHierarchy } from "../../hooks/useTaskHierarchy";
import { useWorkItem } from "../../hooks/useWorkItem";
import { useWorkItems } from "../../hooks/useWorkItems";
import { WebSocketHandler } from "../../websockets/handler";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  removeTask: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unifiedApiClient: {
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    removeTask: mocks.removeTask,
  },
}));
vi.mock("../../hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const ORG = "org-1";
const PROJECT = "project-1";

const feature: FakeWorkItem = {
  id: "f1",
  name: "Feature",
  type: "FEATURE",
  status: "ACTIVE",
};
const task: FakeWorkItem = {
  id: "t1",
  name: "Task",
  type: "STANDARD",
  status: WorkStatus.Backlog,
  parentTaskId: "f1",
};
const competitor: FakeWorkItem = {
  id: "c1",
  name: "Competitor profile",
  type: "competitor",
  status: "RESEARCHING",
};

const taskDto = (id: string): TaskResponseDto => ({
  id,
  name: id,
  type: "STANDARD",
  organizationId: ORG,
  projectId: PROJECT,
  status: WorkStatus.Backlog,
  source: TaskSource.User,
});

describe("work-item hooks over GraphQL", () => {
  let server: FakeWorkItemServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new FakeWorkItemServer([feature, task, competitor]);
  });

  const mountList = (options = {}) =>
    renderHook(() => useWorkItems(ORG, "task", PROJECT, undefined, options), {
      wrapper: server.wrapper,
    });

  describe("read lifecycle", () => {
    it("reports loading, then the items the server holds", async () => {
      const { result } = mountList({ parentTaskId: "f1" });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.error).toBeNull();

      await waitFor(() => expect(result.current.isReady).toBe(true));

      expect(result.current.isLoading).toBe(false);
      expect(result.current.workItems.map((item) => item.id)).toEqual(["t1"]);
    });

    it("reports an empty list only after a successful read", async () => {
      const { result } = mountList({ taskType: "NOTHING" });

      expect(result.current.isReady).toBe(false);
      await waitFor(() => expect(result.current.isReady).toBe(true));

      expect(result.current.workItems).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("reports a failed read as an error, without data", async () => {
      const { result } = renderHook(
        () => useWorkItem(ORG, "task", "missing", { projectId: PROJECT }),
        { wrapper: server.wrapper },
      );

      await waitFor(() => expect(result.current.error).not.toBeNull());

      expect(result.current.workItem).toBeNull();
      expect(result.current.isReady).toBe(false);
    });

    it("does not read without a project, as the endpoint is project-scoped", async () => {
      const { result } = renderHook(() => useWorkItem(ORG, "task", "t1", {}), {
        wrapper: server.wrapper,
      });

      await Promise.resolve();

      expect(result.current.workItem).toBeNull();
      expect(server.requests).toEqual([]);
    });

    it("shares one request between consumers of the same read", async () => {
      renderHook(
        () => ({
          first: useWorkItems(ORG, "task", PROJECT, undefined, {
            parentTaskId: "f1",
          }),
          second: useWorkItems(ORG, "task", PROJECT, undefined, {
            parentTaskId: "f1",
          }),
        }),
        { wrapper: server.wrapper },
      );

      await waitFor(() =>
        expect(server.received("GetWorkItems").length).toBeGreaterThan(0),
      );

      expect(server.received("GetWorkItems")).toHaveLength(1);
    });

    it("re-reads fresh data on mount when asked to, keeping what it shows", async () => {
      const first = mountList({ parentTaskId: "f1" });
      await waitFor(() => expect(first.result.current.isReady).toBe(true));

      server.update("t1", { name: "Changed elsewhere" });
      const second = mountList({ parentTaskId: "f1", refetchOnMount: true });

      await waitFor(() =>
        expect(second.result.current.workItems[0]?.name).toBe(
          "Changed elsewhere",
        ),
      );
    });
  });

  describe("record sharing", () => {
    it("shows a list row and a detail view from the same cached record", async () => {
      const views = renderHook(
        () => ({
          list: useWorkItems(ORG, "task", PROJECT, undefined, {
            parentTaskId: "f1",
          }),
          detail: useWorkItem(ORG, "task", "t1", { projectId: PROJECT }),
        }),
        { wrapper: server.wrapper },
      );
      await waitFor(() => {
        expect(views.result.current.list.isReady).toBe(true);
        expect(views.result.current.detail.isReady).toBe(true);
      });

      const cache = server.graphql.forProject({
        organizationId: ORG,
        projectId: PROJECT,
      }).cache;
      const record =
        cache.extract()[
          cache.identify({ __typename: "WorkItem", id: "t1" }) ?? ""
        ];

      expect(record).toMatchObject({ id: "t1", name: "Task" });
      expect(views.result.current.detail.workItem?.name).toBe("Task");
      expect(views.result.current.list.workItems[0]?.name).toBe("Task");
    });

    it("shows a project-defined type with its open type key and status", async () => {
      const { result } = renderHook(
        () => useWorkItem(ORG, "task", "c1", { projectId: PROJECT }),
        { wrapper: server.wrapper },
      );

      await waitFor(() => expect(result.current.workItem).not.toBeNull());

      expect(result.current.workItem).toMatchObject({
        type: "competitor",
        status: "RESEARCHING",
      });
    });

    it("returns a hierarchy whose members are the shared records", async () => {
      const { result } = renderHook(
        () => useTaskHierarchy(ORG, PROJECT, "f1"),
        { wrapper: server.wrapper },
      );

      await waitFor(() => expect(result.current.isReady).toBe(true));

      expect(result.current.task?.id).toBe("f1");
      expect(result.current.parent).toBeUndefined();
      expect(result.current.children.map((child) => child.id)).toEqual(["t1"]);
    });
  });

  describe("writes", () => {
    const mountWithHandler = async () => {
      const views = renderHook(
        () =>
          useWorkItems(ORG, "task", PROJECT, undefined, {
            parentTaskId: "f1",
          }),
        { wrapper: server.wrapper },
      );
      await waitFor(() => expect(views.result.current.isReady).toBe(true));
      const handler = new WebSocketHandler(
        createStore(),
        undefined,
        server.queryClient,
        server.graphql.apollo,
      );

      return { views, handler };
    };

    it("sends an update to the server and shows it once the server reports it", async () => {
      const { views, handler } = await mountWithHandler();
      mocks.updateTask.mockResolvedValue({
        data: {
          data: {
            status: UpdateTaskResultStatus.Applied,
            task: { ...taskDto("t1"), name: "Renamed" },
          },
        },
      });

      await act(async () => {
        await views.result.current.updateTask("t1", { name: "Renamed" });
      });

      // The write does not edit the cache; the server's event refreshes it.
      expect(views.result.current.workItems[0]?.name).toBe("Task");
      expect(mocks.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "t1",
          updateTaskDto: { name: "Renamed" },
        }),
      );

      server.update("t1", { name: "Renamed" });
      act(() =>
        handler.handleEvent({
          type: "task.updated",
          timestamp: "2026-11-01T00:00:00.000Z",
          organizationId: ORG,
          projectId: PROJECT,
          taskId: "t1",
        }),
      );

      await waitFor(() =>
        expect(views.result.current.workItems[0]?.name).toBe("Renamed"),
      );
    });

    it("reports a staged update's proposal and leaves the item unchanged", async () => {
      const { views } = await mountWithHandler();
      const proposal = { id: "proposal-1" } as ProposalResponseDto;
      const onPendingProposal = vi.fn();
      mocks.updateTask.mockResolvedValue({
        data: {
          data: {
            status: UpdateTaskResultStatus.Pending,
            task: taskDto("t1"),
            proposal,
          },
        },
      });

      await act(async () => {
        await views.result.current.updateTask(
          "t1",
          { name: "Staged" },
          { onPendingProposal },
        );
      });

      expect(onPendingProposal).toHaveBeenCalledWith(
        proposal,
        expect.objectContaining({ id: "t1" }),
      );
      expect(views.result.current.workItems[0]?.name).toBe("Task");
    });

    it("surfaces a failed write and leaves what the views show", async () => {
      const { views } = await mountWithHandler();
      mocks.updateTask.mockRejectedValue(new Error("rejected"));
      const onError = vi.fn();

      await act(async () => {
        await expect(
          views.result.current.updateTask("t1", { name: "X" }, { onError }),
        ).rejects.toThrow("rejected");
      });

      expect(onError).toHaveBeenCalled();
      expect(views.result.current.workItems[0]?.name).toBe("Task");
    });

    it("creates through the server without placing a copy in the list", async () => {
      const { views } = await mountWithHandler();
      mocks.createTask.mockResolvedValue({
        data: { data: taskDto("t2") },
      });

      await act(async () => {
        await views.result.current.createTask({ name: "t2" } as never);
      });

      expect(views.result.current.workItems.map((i) => i.id)).toEqual(["t1"]);
    });

    it("deletes through the server and removes the item once it reports it", async () => {
      const { views, handler } = await mountWithHandler();
      mocks.removeTask.mockResolvedValue({});

      await act(async () => {
        await views.result.current.remove("t1");
      });
      expect(mocks.removeTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "t1" }),
      );

      server.remove("t1");
      act(() =>
        handler.handleEvent({
          type: "task.deleted",
          timestamp: "2026-11-01T00:00:00.000Z",
          organizationId: ORG,
          projectId: PROJECT,
          taskId: "t1",
        }),
      );

      await waitFor(() => expect(views.result.current.workItems).toEqual([]));
    });

    it("refuses to delete an item no view has read", async () => {
      const { views } = await mountWithHandler();

      await act(async () => {
        await expect(views.result.current.remove("unknown")).rejects.toThrow(
          "not found",
        );
      });
      expect(mocks.removeTask).not.toHaveBeenCalled();
    });
  });
});
