import { FutureOfferContext } from "../../futureOffers/FutureOfferContext";
import React, { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskSource,
  UpdateTaskResultStatus,
  WorkStatus,
  type TaskHierarchyResponseDto,
  type TaskResponseDto,
} from "../../../api";
import {
  invalidateWorkItemHolders,
  workItemKeys,
} from "../../collections/workItemLists";
import { workItemReferenceKeys } from "../../collections/workItemReferences";
import { DataEventType } from "../../relationships/dataEvents";
import { emitDataEvent } from "../../relationships/relationshipRules";
import { useConversation } from "../../hooks/useConversation";
import { useTaskHierarchy } from "../../hooks/useTaskHierarchy";
import { useWorkItem } from "../../hooks/useWorkItem";
import { useWorkItems } from "../../hooks/useWorkItems";
import { useWorkItemTypes } from "../../hooks/useWorkItemTypes";
import { WebSocketHandler } from "../../websockets/handler";

const mocks = vi.hoisted(() => ({
  checkTask: vi.fn(),
  getTask: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  removeTask: vi.fn(),
  getHierarchy: vi.fn(),
  getConversation: vi.fn(),
  dataRequest: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unifiedApiClient: {
    getTask: mocks.getTask,
    getTasks: mocks.getTasks,
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    removeTask: mocks.removeTask,
  },
  tasksClient: {
    organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet:
      mocks.getHierarchy,
  },
  platformClient: { getConversation: mocks.getConversation },
}));
vi.mock("../../../clients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dataClient: { request: mocks.dataRequest },
}));
vi.mock("../../hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const ORG = "org";
const PROJECT = "project";

const task = (
  id: string,
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto =>
  ({
    id,
    name: id,
    type: "STANDARD",
    organizationId: ORG,
    projectId: PROJECT,
    status: WorkStatus.Backlog,
    source: TaskSource.User,
    ...overrides,
  }) as TaskResponseDto;

const ok = <T,>(data: T) => ({ data: { data } });

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });

type WrapperOptions = { strict?: boolean };
const clientWrapper =
  (client: QueryClient, { strict = false }: WrapperOptions = {}) =>
  ({ children }: { children: React.ReactNode }) => {
    const tree = (
      <QueryClientProvider client={client}>
        <Provider store={createStore()}>
          <FutureOfferContext.Provider
            value={{
              checkTask: mocks.checkTask,
            }}
          >
            {children}
          </FutureOfferContext.Provider>
        </Provider>
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };

/** The mention badge and inline renderer read the same item this way. */
const useMention = (id: string, enabled = true) =>
  useWorkItem(ORG, "task", id, { projectId: PROJECT, enabled });
// A detail page's own entity read, which re-reads each time it mounts.
const usePageItem = (id: string) =>
  useWorkItem(ORG, "task", id, { projectId: PROJECT, refetchOnMount: true });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("shared work-item reads", () => {
  it("reads a mentioned item once for its badge and inline renderer", async () => {
    mocks.getTask.mockResolvedValue(ok(task("t1")));
    const client = createClient();
    const { result, rerender } = renderHook(
      ({ inlineReady }: { inlineReady: boolean }) => ({
        badge: useMention("t1"),
        // The inline renderer reads only once its type resolves.
        inline: useMention("t1", inlineReady),
      }),
      {
        initialProps: { inlineReady: false },
        wrapper: clientWrapper(client),
      },
    );
    await waitFor(() => expect(result.current.badge.isReady).toBe(true));
    rerender({ inlineReady: true });

    await waitFor(() => expect(result.current.inline.workItem?.id).toBe("t1"));
    expect(mocks.getTask).toHaveBeenCalledTimes(1);
  });

  it("reads each distinct list once and serves status filters from one read", async () => {
    mocks.getTasks.mockResolvedValue(
      ok([
        task("a", { status: WorkStatus.Active, parentTaskId: "p" }),
        task("b", { status: WorkStatus.Completed, parentTaskId: "p" }),
      ]),
    );
    const client = createClient();
    const { result } = renderHook(
      () => ({
        children: useWorkItems(ORG, "task", PROJECT, undefined, {
          parentTaskId: "p",
        }),
        childrenAgain: useWorkItems(ORG, "task", PROJECT, undefined, {
          parentTaskId: "p",
        }),
        active: useWorkItems(ORG, "task", PROJECT, undefined, {
          parentTaskId: "p",
          status: WorkStatus.Active,
        }),
        byIds: useWorkItems(ORG, "task", PROJECT, undefined, {
          taskIds: ["b", "a"],
        }),
      }),
      { wrapper: clientWrapper(client) },
    );

    await waitFor(() => expect(result.current.byIds.isReady).toBe(true));
    await waitFor(() => expect(result.current.active.isReady).toBe(true));
    expect(mocks.getTasks).toHaveBeenCalledTimes(2);
    expect(result.current.children.workItems.map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(result.current.active.workItems.map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(result.current.childrenAgain.workItems).toBe(
      result.current.children.workItems,
    );
  });
});

describe("per-query mount reads", () => {
  it("re-reads a fresh work item when a page mounts its own read, keeping cached data visible", async () => {
    const client = createClient();
    client.setQueryData(workItemKeys.detail(ORG, PROJECT, "t1"), task("t1"));
    const read = deferred<unknown>();
    mocks.getTask.mockReturnValue(read.promise);

    const { result } = renderHook(() => usePageItem("t1"), {
      wrapper: clientWrapper(client),
    });

    expect(mocks.getTask).toHaveBeenCalledTimes(1);
    expect(result.current.workItem?.name).toBe("t1");
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      read.resolve(ok(task("t1", { name: "Renamed" })));
    });
    await waitFor(() => expect(result.current.workItem?.name).toBe("Renamed"));
  });

  it("reads fresh work items only when stale without a per-query mount read", () => {
    const client = createClient();
    client.setQueryData(workItemKeys.detail(ORG, PROJECT, "t1"), task("t1"));

    renderHook(() => useMention("t1"), { wrapper: clientWrapper(client) });

    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it("reads once per page mount, including under Strict Mode", async () => {
    const client = createClient();
    client.setQueryData(workItemKeys.detail(ORG, PROJECT, "t1"), task("t1"));
    mocks.getTask.mockResolvedValue(ok(task("t1")));
    const wrapper = clientWrapper(client, { strict: true });

    const first = renderHook(() => usePageItem("t1"), { wrapper });
    await waitFor(() => expect(first.result.current.isFetching).toBe(false));
    expect(mocks.getTask).toHaveBeenCalledTimes(1);
    first.unmount();

    // Reopening the page reads again even though the data is fresh.
    const second = renderHook(() => usePageItem("t1"), { wrapper });
    await waitFor(() => expect(second.result.current.isFetching).toBe(false));
    expect(mocks.getTask).toHaveBeenCalledTimes(2);
  });

  it("re-reads lists and hierarchies that request a mount read", async () => {
    const client = createClient();
    client.setQueryData(
      workItemKeys.list(ORG, PROJECT, { parentTaskId: "p" }),
      [],
    );
    client.setQueryData(workItemKeys.hierarchy(ORG, PROJECT, "p"), {
      task: task("p"),
      children: [],
    });
    mocks.getTasks.mockResolvedValue(ok([]));
    mocks.getHierarchy.mockResolvedValue(ok({ task: task("p"), children: [] }));

    renderHook(
      () => ({
        list: useWorkItems(ORG, "task", PROJECT, undefined, {
          parentTaskId: "p",
          refetchOnMount: true,
        }),
        hierarchy: useTaskHierarchy(ORG, PROJECT, "p", {
          refetchOnMount: true,
        }),
      }),
      { wrapper: clientWrapper(client) },
    );

    await waitFor(() => expect(mocks.getHierarchy).toHaveBeenCalledTimes(1));
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
  });

  it("does not re-read fresh shared datasets alongside a page mount read", async () => {
    const client = createClient();
    mocks.dataRequest.mockResolvedValue({ data: { data: [] } });
    mocks.getConversation.mockResolvedValue(
      ok({ id: "c1", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    mocks.getTask.mockResolvedValue(ok(task("t1")));
    const wrapper = clientWrapper(client);
    const useShared = () => ({
      page: usePageItem("t1"),
      types: useWorkItemTypes(ORG, { projectId: PROJECT }),
      conversation: useConversation(ORG, PROJECT, { conversationId: "c1" }),
    });

    const first = renderHook(useShared, { wrapper });
    await waitFor(() => expect(first.result.current.types.isReady).toBe(true));
    await waitFor(() =>
      expect(first.result.current.conversation.isReady).toBe(true),
    );
    const typeReads = mocks.dataRequest.mock.calls.length;
    const conversationReads = mocks.getConversation.mock.calls.length;
    first.unmount();

    const second = renderHook(useShared, { wrapper });
    await waitFor(() => expect(second.result.current.types.isReady).toBe(true));
    expect(mocks.dataRequest).toHaveBeenCalledTimes(typeReads);
    expect(mocks.getConversation).toHaveBeenCalledTimes(conversationReads);
  });
});

describe("realtime work-item events", () => {
  const handlerFor = (client: QueryClient) =>
    new WebSocketHandler(createStore(), undefined, client);
  const updated = (taskId: string) =>
    ({
      type: "task.updated",
      taskId,
      organizationId: ORG,
      projectId: PROJECT,
      timestamp: new Date().toISOString(),
      changedBy: { userId: "someone-else" },
    }) as never;

  it("follows an in-flight read with a later read when an event arrives", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.getTask
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const client = createClient();
    const { result } = renderHook(() => useMention("t1"), {
      wrapper: clientWrapper(client),
    });
    expect(mocks.getTask).toHaveBeenCalledTimes(1);

    await act(async () => handlerFor(client).handleEvent(updated("t1")));
    expect(mocks.getTask).toHaveBeenCalledTimes(2);

    // The earlier response does not stand in for the event's read.
    await act(async () => {
      first.resolve(ok(task("t1", { name: "Before" })));
    });
    expect(result.current.workItem?.name).not.toBe("Before");
    await act(async () => {
      second.resolve(ok(task("t1", { name: "After" })));
    });
    await waitFor(() => expect(result.current.workItem?.name).toBe("After"));
  });

  it("re-reads each affected mounted key once, leaving other items alone", async () => {
    mocks.getTask.mockImplementation(async ({ taskId }: { taskId: string }) =>
      ok(task(taskId)),
    );
    mocks.getTasks.mockResolvedValue(ok([task("t1")]));
    const client = createClient();
    const { result } = renderHook(
      () => ({
        changed: useMention("t1"),
        other: useMention("t2"),
        list: useWorkItems(ORG, "task", PROJECT, undefined, {
          parentTaskId: "p",
        }),
      }),
      { wrapper: clientWrapper(client) },
    );
    await waitFor(() => expect(result.current.list.isReady).toBe(true));
    await waitFor(() => expect(result.current.other.isReady).toBe(true));
    mocks.getTask.mockClear();
    mocks.getTasks.mockClear();

    await act(async () => {
      handlerFor(client).handleEvent(updated("t1"));
    });

    await waitFor(() => expect(mocks.getTasks).toHaveBeenCalledTimes(1));
    expect(mocks.getTask).toHaveBeenCalledTimes(1);
    expect(mocks.getTask.mock.calls[0][0]).toMatchObject({ taskId: "t1" });
  });

  it("re-reads every mounted work-item key once on reconnect", async () => {
    mocks.getTask.mockImplementation(async ({ taskId }: { taskId: string }) =>
      ok(task(taskId)),
    );
    mocks.getTasks.mockResolvedValue(ok([]));
    mocks.getHierarchy.mockResolvedValue(ok({ task: task("p"), children: [] }));
    const client = createClient();
    const { result } = renderHook(
      () => ({
        a: useMention("t1"),
        aAgain: useMention("t1"),
        b: useMention("t2"),
        list: useWorkItems(ORG, "task", PROJECT, undefined, {
          taskType: "GOAL",
        }),
        hierarchy: useTaskHierarchy(ORG, PROJECT, "p"),
      }),
      { wrapper: clientWrapper(client) },
    );
    await waitFor(() => expect(result.current.hierarchy.isReady).toBe(true));
    await waitFor(() => expect(result.current.b.isReady).toBe(true));
    await waitFor(() => expect(result.current.list.isReady).toBe(true));
    vi.clearAllMocks();

    await act(async () => {
      handlerFor(client).markAllStale();
    });

    await waitFor(() => expect(mocks.getHierarchy).toHaveBeenCalledTimes(1));
    expect(mocks.getTask).toHaveBeenCalledTimes(2);
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
  });
});

describe("agent-session changes to a work item", () => {
  it("invalidates only the entries holding the item", async () => {
    const client = createClient();
    const keys = {
      detail: workItemKeys.detail(ORG, PROJECT, "t1"),
      projectlessDetail: workItemKeys.detail(ORG, "", "t1"),
      holdingList: workItemKeys.list(ORG, PROJECT, { parentTaskId: "p" }),
      holdingHierarchy: workItemKeys.hierarchy(ORG, PROJECT, "p"),
      ownHierarchy: workItemKeys.hierarchy(ORG, PROJECT, "t1"),
      otherDetail: workItemKeys.detail(ORG, PROJECT, "t2"),
      otherList: workItemKeys.list(ORG, PROJECT, { taskType: "GOAL" }),
      otherHierarchy: workItemKeys.hierarchy(ORG, PROJECT, "q"),
      references: workItemReferenceKeys.project(ORG, PROJECT),
    };
    client.setQueryData(keys.detail, task("t1"));
    client.setQueryData(keys.projectlessDetail, task("t1"));
    client.setQueryData(keys.holdingList, [task("t1"), task("t2")]);
    client.setQueryData(keys.holdingHierarchy, {
      task: task("p"),
      children: [task("t1")],
    });
    client.setQueryData(keys.ownHierarchy, { task: task("t1"), children: [] });
    client.setQueryData(keys.otherDetail, task("t2"));
    client.setQueryData(keys.otherList, [task("g1")]);
    client.setQueryData(keys.otherHierarchy, { task: task("q"), children: [] });
    client.setQueryData(keys.references, []);
    const invalidated = (queryKey: readonly unknown[]) =>
      client.getQueryState(queryKey)?.isInvalidated ?? false;

    emitDataEvent(
      {
        type: DataEventType.AgentSessionCreated,
        organizationId: ORG,
        taskId: "t1",
        agentSessionId: "s1",
      },
      {
        invalidateWorkItem: (organizationId, taskId) =>
          void invalidateWorkItemHolders(client, organizationId, taskId),
        invalidateConversation: vi.fn(),
      },
    );
    await act(async () => {});

    for (const key of [
      keys.detail,
      keys.projectlessDetail,
      keys.holdingList,
      keys.holdingHierarchy,
      keys.ownHierarchy,
    ]) {
      expect(invalidated(key)).toBe(true);
    }
    for (const key of [
      keys.otherDetail,
      keys.otherList,
      keys.otherHierarchy,
      keys.references,
    ]) {
      expect(invalidated(key)).toBe(false);
    }
  });
});

describe("optimistic work-item writes", () => {
  const seed = (client: QueryClient) => {
    client.setQueryData(
      workItemKeys.list(ORG, PROJECT, { parentTaskId: "p" }),
      [task("t1", { parentTaskId: "p" })],
    );
    client.setQueryData(workItemKeys.detail(ORG, PROJECT, "t1"), task("t1"));
    client.setQueryData<TaskHierarchyResponseDto>(
      workItemKeys.hierarchy(ORG, PROJECT, "p"),
      { task: task("p"), children: [task("t1", { parentTaskId: "p" })] },
    );
  };
  const renderWrites = (client: QueryClient) =>
    renderHook(
      () => ({
        list: useWorkItems(ORG, "task", PROJECT, undefined, {
          parentTaskId: "p",
        }),
        item: useMention("t1"),
        hierarchy: useTaskHierarchy(ORG, PROJECT, "p"),
      }),
      { wrapper: clientWrapper(client) },
    );

  it("shows an update in every cached list, item and hierarchy, then rolls back on failure", async () => {
    const client = createClient();
    seed(client);
    const failure = deferred<never>();
    mocks.updateTask.mockReturnValueOnce(failure.promise);
    const { result } = renderWrites(client);

    let update: Promise<unknown> = Promise.resolve();
    act(() => {
      update = result.current.list.updateTask("t1", { name: "Renamed" });
      update.catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.item.workItem?.name).toBe("Renamed"),
    );
    expect(result.current.list.workItems[0].name).toBe("Renamed");
    expect(result.current.hierarchy.children[0].name).toBe("Renamed");

    await act(async () => {
      failure.reject(new Error("PATCH failed"));
      await update.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.item.workItem?.name).toBe("t1"));
    expect(result.current.list.workItems[0].name).toBe("t1");
    expect(result.current.hierarchy.children[0].name).toBe("t1");
  });

  it("restores the unchanged task when the update is staged behind a proposal", async () => {
    const client = createClient();
    seed(client);
    const unchanged = task("t1", { parentTaskId: "p", priority: undefined });
    const proposal = { id: "proposal-1" };
    mocks.updateTask.mockResolvedValueOnce(
      ok({ status: UpdateTaskResultStatus.Pending, task: unchanged, proposal }),
    );
    const onPendingProposal = vi.fn();
    const { result } = renderWrites(client);

    await act(async () => {
      await result.current.list.updateTask(
        "t1",
        { name: "Renamed", reason: "" },
        { onPendingProposal },
      );
    });

    await waitFor(() => expect(result.current.item.workItem?.name).toBe("t1"));
    expect(result.current.list.workItems[0].name).toBe("t1");
    expect(onPendingProposal).toHaveBeenCalledWith(proposal, unchanged);
    expect(mocks.updateTask.mock.calls[0][0].updateTaskDto).toEqual({
      name: "Renamed",
      reason: "",
    });
  });

  it("re-reads the old and new parents' lists and hierarchies on reparent", async () => {
    const client = createClient();
    seed(client);
    mocks.getTasks.mockResolvedValue(ok([]));
    mocks.getTask.mockResolvedValue(ok(task("t1", { parentTaskId: "q" })));
    mocks.getHierarchy.mockResolvedValue(ok({ task: task("p"), children: [] }));
    mocks.updateTask.mockResolvedValueOnce(
      ok({
        status: UpdateTaskResultStatus.Applied,
        task: task("t1", { parentTaskId: "q" }),
      }),
    );
    const { result } = renderWrites(client);

    await act(async () => {
      await result.current.list.updateTask("t1", { parentTaskId: "q" });
    });

    await waitFor(() => expect(result.current.hierarchy.children).toEqual([]));
    expect(mocks.getHierarchy).toHaveBeenCalled();
    expect(mocks.getTasks).toHaveBeenCalled();
    expect(result.current.item.workItem?.parentTaskId).toBe("q");
  });

  it("swaps a created item into the current list and rolls back a failed create", async () => {
    const client = createClient();
    seed(client);
    mocks.getTasks.mockResolvedValue(
      ok([
        task("t1", { parentTaskId: "p" }),
        task("t2", { parentTaskId: "p" }),
      ]),
    );
    mocks.createTask
      .mockResolvedValueOnce(ok(task("t2", { parentTaskId: "p" })))
      .mockRejectedValueOnce(new Error("POST failed"));
    const config = {
      kind: "INITIAL_WORKTREE" as const,
      version: "v1" as const,
      initialWorktreeBranch: "feature/launch",
    };
    const { result } = renderWrites(client);

    await act(async () => {
      await result.current.list.createTask({
        name: "t2",
        parentTaskId: "p",
        config,
      });
    });
    expect(mocks.createTask.mock.calls[0][0].createTaskDto.config).toEqual(
      config,
    );
    await waitFor(() =>
      expect(result.current.list.workItems.map((item) => item.id)).toEqual([
        "t1",
        "t2",
      ]),
    );

    const before = result.current.list.workItems;
    await act(async () => {
      await result.current.list
        .createTask({ name: "t3", parentTaskId: "p" })
        .catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.list.workItems.map((item) => item.id)).toEqual(
        before.map((item) => item.id),
      ),
    );
  });

  it("removes a deleted item everywhere and restores it on failure", async () => {
    const client = createClient();
    seed(client);
    const failure = deferred<never>();
    mocks.removeTask.mockReturnValueOnce(failure.promise);
    const { result } = renderWrites(client);

    let removal: Promise<unknown> = Promise.resolve();
    act(() => {
      removal = result.current.list.remove("t1");
      removal.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.list.workItems).toEqual([]));
    expect(result.current.hierarchy.children).toEqual([]);

    await act(async () => {
      failure.reject(new Error("DELETE failed"));
      await removal.catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.list.workItems.map((item) => item.id)).toEqual([
        "t1",
      ]),
    );
    expect(result.current.hierarchy.children.map((item) => item.id)).toEqual([
      "t1",
    ]);
    expect(
      client.getQueryData(workItemKeys.detail(ORG, PROJECT, "t1")),
    ).toEqual(task("t1"));
  });

  it("updates an item cached only as a single read, from a hook that never reads", async () => {
    const client = createClient();
    client.setQueryData(workItemKeys.detail(ORG, "", "t9"), task("t9"));
    mocks.updateTask.mockResolvedValueOnce(
      ok({
        status: UpdateTaskResultStatus.Applied,
        task: task("t9", { name: "Renamed" }),
      }),
    );
    const { result } = renderHook(
      () => useWorkItems(ORG, "task", PROJECT, undefined, { enabled: false }),
      { wrapper: clientWrapper(client) },
    );

    await act(async () => {
      await result.current.updateTask("t9", { name: "Renamed" });
    });

    expect(
      client.getQueryData<TaskResponseDto>(workItemKeys.detail(ORG, "", "t9"))
        ?.name,
    ).toBe("Renamed");
    expect(mocks.getTasks).not.toHaveBeenCalled();
  });
});

describe("read lifecycle states", () => {
  it("reports loading without error, then populated", async () => {
    const read = deferred<unknown>();
    mocks.getTask.mockReturnValue(read.promise);
    const { result } = renderHook(() => useMention("t1"), {
      wrapper: clientWrapper(createClient()),
    });

    expect(result.current).toMatchObject({
      isLoading: true,
      isReady: false,
      error: null,
      workItem: null,
    });
    await act(async () => {
      read.resolve(ok(task("t1")));
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.workItem?.id).toBe("t1");
  });

  it("is neither loading nor failed when disabled", () => {
    const { result } = renderHook(() => useMention("t1", false), {
      wrapper: clientWrapper(createClient()),
    });
    expect(result.current).toMatchObject({
      isLoading: false,
      isFetched: false,
      isReady: false,
      error: null,
    });
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it("reports a failed read explicitly and presents no hierarchy", async () => {
    mocks.getHierarchy.mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        isAxiosError: true,
        response: { status: 404 },
      }),
    );
    const { result } = renderHook(
      () => useTaskHierarchy(ORG, PROJECT, "gone"),
      {
        wrapper: clientWrapper(createClient()),
      },
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current).toMatchObject({
      isReady: false,
      hierarchy: null,
      task: null,
      children: [],
    });
  });

  it("reports an empty list only after a successful read", async () => {
    mocks.getTasks.mockResolvedValue(ok([]));
    const { result } = renderHook(
      () => useWorkItems(ORG, "task", PROJECT, undefined, { taskType: "GOAL" }),
      { wrapper: clientWrapper(createClient()) },
    );
    expect(result.current.isReady).toBe(false);
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.workItems).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("returns the cached hierarchy as the server sent it", async () => {
    const hierarchy = {
      parent: task("root"),
      task: task("p", { parentTaskId: "root" }),
      children: [task("c1", { parentTaskId: "p" })],
    };
    mocks.getHierarchy.mockResolvedValue(ok(hierarchy));
    const { result } = renderHook(
      () =>
        useTaskHierarchy(ORG, PROJECT, "p", {
          includeDesignDocCounts: true,
          includeAgentSessionCounts: true,
        }),
      { wrapper: clientWrapper(createClient()) },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.hierarchy).toEqual(hierarchy);
    expect(result.current.parent?.id).toBe("root");
    expect(mocks.getHierarchy.mock.calls[0][0]).toMatchObject({
      includeDesignDocCounts: true,
      includeAgentSessionCounts: true,
    });
    await expect(result.current.refetch()).resolves.toEqual(hierarchy);
  });
});

describe("shared completion offer checks", () => {
  it.each([WorkStatus.Verifying, WorkStatus.Completed])(
    "checks linked futures after saving %s, even if the task already has that status",
    async (status) => {
      const current = task("canonical-task", { status });
      mocks.updateTask.mockResolvedValue(
        ok({ status: UpdateTaskResultStatus.Applied, task: current }),
      );
      const { result } = renderHook(
        () => useWorkItems(ORG, "task", PROJECT, undefined, { enabled: false }),
        { wrapper: clientWrapper(createClient()) },
      );
      await act(async () => {
        await result.current.updateTask(
          current.id,
          { status },
          { authoritativeTask: current },
        );
      });
      expect(mocks.checkTask).toHaveBeenCalledExactlyOnceWith(current.id);
      expect(mocks.getTask).not.toHaveBeenCalled();
    },
  );
  it("does not check before a pending approval actually changes the status", async () => {
    const current = task("canonical-task", { status: WorkStatus.Active });
    mocks.updateTask.mockResolvedValue(
      ok({
        status: UpdateTaskResultStatus.Pending,
        task: current,
        proposal: { id: "proposal" },
      }),
    );
    const { result } = renderHook(
      () => useWorkItems(ORG, "task", PROJECT, undefined, { enabled: false }),
      { wrapper: clientWrapper(createClient()) },
    );
    await act(async () => {
      await result.current.updateTask(
        current.id,
        { status: WorkStatus.Completed },
        { authoritativeTask: current },
      );
    });
    expect(mocks.checkTask).not.toHaveBeenCalled();
  });
  it("does not check if an approved change has not yet changed the returned status", async () => {
    const current = task("canonical-task", { status: WorkStatus.Active });
    mocks.updateTask.mockResolvedValue(
      ok({ status: UpdateTaskResultStatus.Applied, task: current }),
    );
    const { result } = renderHook(
      () => useWorkItems(ORG, "task", PROJECT, undefined, { enabled: false }),
      { wrapper: clientWrapper(createClient()) },
    );
    await act(async () => {
      await result.current.updateTask(
        current.id,
        { status: WorkStatus.Completed },
        { authoritativeTask: current },
      );
    });
    expect(mocks.checkTask).not.toHaveBeenCalled();
  });
  it("does not check on unrelated edits or failed completion", async () => {
    const current = task("canonical-task", { status: WorkStatus.Completed });
    mocks.updateTask
      .mockResolvedValueOnce(
        ok({ status: UpdateTaskResultStatus.Applied, task: current }),
      )
      .mockRejectedValueOnce(new Error("Update denied"));
    const { result } = renderHook(
      () => useWorkItems(ORG, "task", PROJECT, undefined, { enabled: false }),
      { wrapper: clientWrapper(createClient()) },
    );
    await act(async () => {
      await result.current.updateTask(
        current.id,
        { name: "Renamed" },
        { authoritativeTask: current },
      );
    });
    await act(async () => {
      await expect(
        result.current.updateTask(
          current.id,
          { status: WorkStatus.Completed },
          { authoritativeTask: current },
        ),
      ).rejects.toThrow("Update denied");
    });
    expect(mocks.checkTask).not.toHaveBeenCalled();
  });
});
