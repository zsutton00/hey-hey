import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import axios from "axios";
import { Provider, createStore } from "jotai";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiRuntime,
  registerApiRuntime,
} from "@hey-hey/ui-common/clients";
import {
  AgentSessionType,
  EntityType,
  type OpenItem,
  type OpenItemGroup,
  type OpenItemsCollection,
  type OpenItemsMutationResult,
} from "@hey-hey/ui-common/api";
import { createEntityActivation } from "@hey-hey/ui-common/context";
import { createNavigationLineageEntry } from "@hey-hey/ui-common";
import { projectOpenItems } from "../components/Explorer/openItemsProjection";
import {
  OpenItemsProvider,
  useOpenItems,
  useOpenItemsActivationSink,
} from "./OpenItemsContext";
import { OpenItemsSyncStatus } from "../components/Explorer/OpenItemsSyncStatus";

const id = "550e8400-e29b-41d4-a716-446655440000";
const otherId = "550e8400-e29b-41d4-a716-446655440001";
const groupId = "550e8400-e29b-41d4-a716-446655440002";
const secondGroupId = "550e8400-e29b-41d4-a716-446655440003";
const now = "2026-10-07T00:00:00.000Z";
const item: OpenItem = {
  entityType: EntityType.Task,
  entityId: id,
  note: "Saved note",
  pinned: false,
  goalTrackedWorkFilter: "ACTIVE_AND_BACKLOG",
  goalCollapsed: true,
  position: "A",
  groupId: null,
  memberPosition: null,
  revision: 1,
  lineage: [],
  presentation: { label: "Canonical task", workItemTypeKey: "STANDARD" },
  removedAt: null,
  updatedAt: now,
};
const group: OpenItemGroup = {
  groupId,
  name: "Saved group",
  position: "A",
  collapsed: false,
  revision: 1,
  updatedAt: now,
};
const present = (
  items = [item],
  groups: OpenItemGroup[] = [],
): OpenItemsCollection => ({ state: "PRESENT", revision: 1, items, groups });
const result = (
  items: OpenItem[] = [item],
  groups: OpenItemGroup[] = [],
): OpenItemsMutationResult => ({
  collectionRevision: 2,
  items,
  groups,
  deletedGroupIds: [],
  replayed: false,
});
function response<T>(data: T): AxiosResponse<{
  success: boolean;
  message: string;
  timestamp: string;
  statusCode: number;
  data: T;
}> {
  return {
    data: {
      success: true,
      message: "ok",
      timestamp: now,
      statusCode: 200,
      data,
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
}
function setup(collection = present()) {
  const runtime = createApiRuntime({
    baseUrl: "/api/v1",
    transport: {
      axios: axios.create(),
      request: vi.fn(),
      setAuthToken: vi.fn(),
    },
  });
  registerApiRuntime(runtime);
  const client = runtime.clients.openItems;
  const read = vi
    .spyOn(client, "getOpenItems")
    .mockResolvedValue(response(collection));
  const scope = {
    organizationId: "organization",
    userId: "user",
    projectId: crypto.randomUUID(),
  };
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <OpenItemsProvider {...scope}>
          {children}
          <OpenItemsSyncStatus />
        </OpenItemsProvider>
      </Provider>
    </QueryClientProvider>
  );
  return { client, read, scope, wrapper };
}

describe("Open Items canonical UI owner", () => {
  it("persists Goal filter/disclosure through the owner and reads them on another device", async () => {
    const goal = {
      ...item,
      presentation: { label: "Outcome", workItemTypeKey: "GOAL" },
    };
    const { client, wrapper } = setup(present([goal]));
    const filter = vi
      .spyOn(client, "setOpenItemGoalFilter")
      .mockResolvedValue(
        response(
          result([{ ...goal, goalTrackedWorkFilter: "ACTIVE", revision: 2 }]),
        ),
      );
    const expandedGoal: OpenItem = {
      ...goal,
      goalTrackedWorkFilter: "ACTIVE",
      goalCollapsed: false,
      revision: 3,
    };
    const disclosure = vi
      .spyOn(client, "setOpenItemGoalDisclosure")
      .mockResolvedValue(
        response({
          ...result([expandedGoal]),
          collectionRevision: 3,
        }),
      );
    const { result: hook, unmount } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.items).toHaveLength(1));
    await act(async () => {
      expect(await hook.current.setGoalFilter(id, "ACTIVE")).toBe(true);
    });
    await act(async () => {
      expect(await hook.current.setGoalExpanded(id, true)).toBe(true);
    });
    expect(filter).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: EntityType.Task,
        entityId: id,
        setOpenItemGoalFilterRequest: {
          idempotencyKey: expect.any(String),
          filter: "ACTIVE",
        },
      }),
    );
    expect(disclosure).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: EntityType.Task,
        entityId: id,
        setOpenItemGoalDisclosureRequest: {
          idempotencyKey: expect.any(String),
          collapsed: false,
        },
      }),
    );
    unmount();
    localStorage.clear();
    const secondDevice = setup({
      state: "PRESENT",
      revision: 3,
      items: [expandedGoal],
      groups: [],
    });
    const { result: remote } = renderHook(useOpenItems, {
      wrapper: secondDevice.wrapper,
    });
    await waitFor(() =>
      expect(remote.current.items[0]).toMatchObject({
        entityType: "goal",
        goalTrackedWorkFilter: "ACTIVE",
        goalCollapsed: false,
      }),
    );
  });
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("nests a later-opened session from canonical membership and retains protected rows after branch removal", async () => {
    const parent: OpenItem = { ...item, groupId, memberPosition: "A" };
    const session: OpenItem = {
      ...item,
      entityId: otherId,
      entityType: EntityType.AgentSession,
      groupId,
      memberPosition: "B",
      position: "B",
      revision: 2,
      lineage: [{ entityType: EntityType.Task, entityId: id }],
      presentation: {
        label: "Coding session",
        agentSessionType: AgentSessionType.Coding,
        routeParams: { lineageKinds: "t" },
      },
    };
    const pinned: OpenItem = {
      ...session,
      entityId: "550e8400-e29b-41d4-a716-446655440004",
      pinned: true,
      position: "C",
      memberPosition: "C",
    };
    const otherGroup: OpenItemGroup = {
      ...group,
      groupId: secondGroupId,
      name: "Other",
      position: "B",
    };
    const protectedSession: OpenItem = {
      ...session,
      entityId: "550e8400-e29b-41d4-a716-446655440005",
      groupId: secondGroupId,
      position: "D",
    };
    const { wrapper, client, read } = setup(
      present([parent, pinned, protectedSession], [group, otherGroup]),
    );
    const activate = vi
      .spyOn(client, "activateOpenItem")
      .mockResolvedValue(response(result([session])));
    const remove = vi.spyOn(client, "removeOpenItems").mockResolvedValue(
      response({
        ...result(
          [parent, session].map((row) => ({
            ...row,
            groupId: null,
            memberPosition: null,
            removedAt: now,
            revision: 3,
          })),
        ),
        collectionRevision: 3,
      }),
    );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.items).toHaveLength(3));
    await act(async () => {
      await hook.current.activate(
        createEntityActivation(
          "agent_session",
          otherId,
          [createNavigationLineageEntry("task", id)],
          {
            kind: "agent_session",
            label: "Coding session",
            sessionType: AgentSessionType.Coding,
          },
        ),
      );
    });
    expect(activate.mock.calls[0]![0].activateOpenItemRequest).toMatchObject({
      item: { entityType: EntityType.AgentSession, entityId: otherId },
      lineage: [{ entityType: EntityType.Task, entityId: id }],
    });
    const projected = projectOpenItems(
      hook.current.items,
      "oldest",
      undefined,
      hook.current.groups,
    );
    expect(projected.find((row) => row.item.entityId === id)).toMatchObject({
      depth: 0,
      groupId,
    });
    expect(
      projected.find((row) => row.item.entityId === otherId),
    ).toMatchObject({ depth: 1, groupId });
    await act(async () => {
      await hook.current.remove(id, "task");
    });
    expect(remove.mock.calls[0]![0].removeOpenItemsRequest).toMatchObject({
      items: [{ entityType: EntityType.Task, entityId: id }],
      includeDescendants: true,
    });
    expect(hook.current.items.map((row) => row.entityId)).toEqual([
      pinned.entityId,
      protectedSession.entityId,
    ]);
    read.mockResolvedValue(
      response({
        state: "PRESENT",
        revision: 3,
        items: [pinned, protectedSession],
        groups: [group, otherGroup],
      }),
    );
    await act(async () => {
      await hook.current.refresh();
    });
    expect(hook.current.items.map((row) => row.entityId)).toEqual([
      pinned.entityId,
      protectedSession.entityId,
    ]);
  });

  it("shows offline cached state and replays a queued note after reconnecting", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { wrapper, scope, client, read } = setup();
    localStorage.setItem(
      `open-items:cache:v2:${scope.userId}:${scope.organizationId}:${scope.projectId}`,
      JSON.stringify({
        version: 2,
        collection: present(),
        preferences: { version: 1, items: [], groups: [] },
      }),
    );
    const note = vi
      .spyOn(client, "setOpenItemNote")
      .mockResolvedValue(
        response(result([{ ...item, note: "Reconnected note", revision: 2 }])),
      );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    expect(screen.queryByTestId("open-items-saving")).not.toBeInTheDocument();
    expect(hook.current.items[0]?.whyOpen).toBe("Saved note");
    await act(async () => {
      await hook.current.setWhyOpen(id, "task", "Offline note");
    });
    expect(note).not.toHaveBeenCalled();
    expect(hook.current.queued).toBe(1);
    expect(screen.queryByTestId("open-items-saving")).not.toBeInTheDocument();
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() =>
      expect(hook.current.items[0]?.whyOpen).toBe("Reconnected note"),
    );
    expect(read.mock.invocationCallOrder[0]!).toBeLessThan(
      note.mock.invocationCallOrder[0]!,
    );
    await waitFor(() => expect(hook.current.pending).toBe(0));
  });

  it("waits for the canonical mutation response while displaying pending state", async () => {
    const { wrapper, client } = setup();
    let resolve!: (
      value: ReturnType<typeof response<OpenItemsMutationResult>>,
    ) => void;
    vi.spyOn(client, "setOpenItemNote").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.isFetching).toBe(false));
    let operation!: Promise<boolean>;
    await act(async () => {
      operation = hook.current.setWhyOpen(id, "task", "Requested note");
    });
    expect(screen.getByTestId("open-items-saving")).toBeInTheDocument();
    expect(hook.current.items[0]?.whyOpen).toBe("Saved note");
    await act(async () => {
      resolve(
        response(result([{ ...item, note: "Canonical note", revision: 2 }])),
      );
      expect(await operation).toBe(true);
    });
    expect(hook.current.items[0]?.whyOpen).toBe("Canonical note");
    expect(screen.queryByTestId("open-items-saving")).not.toBeInTheDocument();
  });

  it("does not send another removal for descendants already removed canonically", async () => {
    const child = {
      ...item,
      entityId: otherId,
      lineage: [{ entityType: EntityType.Task, entityId: id }],
    };
    const { wrapper, client, read } = setup(present([item, child]));
    const remove = vi.spyOn(client, "removeOpenItems").mockResolvedValue(
      response(
        result([
          { ...item, removedAt: now, revision: 2 },
          { ...child, removedAt: now, revision: 2 },
        ]),
      ),
    );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.items).toHaveLength(2));
    await act(async () => {
      await hook.current.remove(id, "task");
      read.mockResolvedValue(
        response({ state: "PRESENT", revision: 2, items: [], groups: [] }),
      );
      remove.mockResolvedValue(response(result([])));
      expect(await hook.current.remove(otherId, "task")).toBe(true);
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(
      remove.mock.calls[0]![0].removeOpenItemsRequest.includeDescendants,
    ).toBe(true);
    expect(hook.current.items).toEqual([]);
  });

  it("settles the queued initial read when route activation arrives immediately", async () => {
    const { wrapper, client } = setup();
    const activate = vi
      .spyOn(client, "activateOpenItem")
      .mockResolvedValue(response(result()));
    const { result: hook } = renderHook(
      () => {
        const state = useOpenItems();
        useEffect(() => {
          void state.activate(
            createEntityActivation("task", id, null, {
              kind: "task",
              label: "Task",
              taskType: "STANDARD",
            }),
          );
        }, [state.activate]);
        return state;
      },
      { wrapper },
    );
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.current.isFetching).toBe(false));
    expect(hook.current.stale).toBe(false);
    expect(hook.current.pending).toBe(0);
  });

  it("passes authenticated scope and replaces cached rows with canonical data", async () => {
    const { wrapper, scope, read } = setup();
    localStorage.setItem(
      `open-items:v1:${scope.projectId}`,
      JSON.stringify({
        version: 1,
        items: [
          {
            entityType: "task",
            entityId: otherId,
            presentation: {
              kind: "task",
              label: "Cached task",
              taskType: "STANDARD",
            },
          },
        ],
      }),
    );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    expect(hook.current.items[0]?.presentation?.label).toBe("Cached task");
    await waitFor(() =>
      expect(hook.current.items[0]?.presentation?.label).toBe("Canonical task"),
    );
    expect(read).toHaveBeenCalledWith(expect.objectContaining(scope));
  });

  it("sends note and pin operations and renders only their canonical responses", async () => {
    const { wrapper, client } = setup();
    const note = vi
      .spyOn(client, "setOpenItemNote")
      .mockResolvedValue(
        response(result([{ ...item, note: "Canonical note", revision: 2 }])),
      );
    const pin = vi
      .spyOn(client, "setOpenItemPin")
      .mockResolvedValue(
        response(
          result([
            { ...item, note: "Canonical note", pinned: true, revision: 3 },
          ]),
        ),
      );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.items).toHaveLength(1));
    await act(async () => {
      expect(await hook.current.setWhyOpen(id, "task", "Requested note")).toBe(
        true,
      );
    });
    expect(note.mock.calls[0]?.[0].setOpenItemNoteRequest).toMatchObject({
      note: "Requested note",
    });
    expect(hook.current.items[0]?.whyOpen).toBe("Canonical note");
    await act(async () => {
      await hook.current.pin(id, "task");
    });
    expect(pin.mock.calls[0]?.[0].setOpenItemPinRequest).toEqual({
      idempotencyKey: expect.any(String),
      pinned: true,
    });
    expect(hook.current.items[0]?.pinned).toBe(true);
  });

  it("wires every group action with its current-state intent and no computed descendants", async () => {
    const { wrapper, client } = setup(present([item], [group]));
    const create = vi
      .spyOn(client, "createOpenItemGroup")
      .mockResolvedValue(response(result([], [group])));
    const assign = vi
      .spyOn(client, "assignOpenItemsToGroup")
      .mockResolvedValue(response(result()));
    const ungroup = vi
      .spyOn(client, "ungroupOpenItems")
      .mockResolvedValue(response(result()));
    const rename = vi
      .spyOn(client, "renameOpenItemGroup")
      .mockResolvedValue(
        response(result([], [{ ...group, name: "Renamed", revision: 2 }])),
      );
    const disclosure = vi
      .spyOn(client, "setOpenItemGroupDisclosure")
      .mockResolvedValue(
        response(
          result(
            [],
            [{ ...group, name: "Renamed", collapsed: true, revision: 3 }],
          ),
        ),
      );
    const remove = vi
      .spyOn(client, "deleteOpenItemGroup")
      .mockResolvedValue(response({ ...result(), deletedGroupIds: [groupId] }));
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.groups).toHaveLength(1));
    const identities = [{ entityType: "task" as const, entityId: id }];
    await act(async () => {
      await hook.current.createGroup("Created", identities);
      await hook.current.assignToGroup(groupId, identities);
      await hook.current.ungroup(identities);
    });
    expect(create.mock.calls[0]?.[0].createOpenItemGroupRequest.assign).toEqual(
      [{ entityType: "TASK", entityId: id }],
    );
    expect(
      assign.mock.calls[0]?.[0].assignOpenItemsToGroupRequest.items,
    ).toHaveLength(1);
    expect(ungroup).toHaveBeenCalled();
    await act(async () => {
      await hook.current.renameGroup(groupId, "Renamed");
      await hook.current.setGroupExpanded(groupId, false);
      await hook.current.deleteGroup(groupId);
    });
    expect(
      rename.mock.calls[0]?.[0].renameOpenItemGroupRequest,
    ).not.toHaveProperty("observedGroupRevision");
    expect(
      disclosure.mock.calls[0]?.[0].setOpenItemGroupDisclosureRequest,
    ).toMatchObject({ collapsed: true });
    expect(
      remove.mock.calls[0]?.[0].deleteOpenItemGroupRequest,
    ).not.toHaveProperty("observedGroupRevision");
    expect(hook.current.groups).toEqual([]);
  });

  it("wires item, member and group ordering relative to neighbors", async () => {
    const other = { ...item, entityId: otherId, position: "B" };
    const { wrapper, client } = setup(
      present(
        [item, other],
        [group, { ...group, groupId: secondGroupId, position: "B" }],
      ),
    );
    const move = vi
      .spyOn(client, "moveOpenItem")
      .mockResolvedValue(
        response(result([{ ...item, position: "C", revision: 2 }])),
      );
    const groupMove = vi
      .spyOn(client, "moveOpenItemGroup")
      .mockResolvedValue(
        response(result([], [{ ...group, position: "C", revision: 2 }])),
      );
    const assign = vi.spyOn(client, "assignOpenItemsToGroup").mockResolvedValue(
      response(
        result(
          [
            { ...item, groupId, memberPosition: "A" },
            { ...other, groupId, memberPosition: "B" },
          ],
          [group],
        ),
      ),
    );
    const memberMove = vi
      .spyOn(client, "moveOpenItemGroupMember")
      .mockResolvedValue(
        response(
          result([{ ...item, groupId, memberPosition: "C", revision: 2 }]),
        ),
      );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.items).toHaveLength(2));
    await act(async () => {
      await hook.current.moveItem({ entityId: id, entityType: "task" }, "down");
      await hook.current.moveGroup(groupId, "down");
      await hook.current.assignToGroup(groupId, [
        { entityId: id, entityType: "task" },
      ]);
      await hook.current.moveItem({ entityId: id, entityType: "task" }, "down");
    });
    expect(move.mock.calls[0]?.[0].moveOpenItemRequest).toMatchObject({
      after: { entityId: otherId },
    });
    expect(
      groupMove.mock.calls[0]?.[0].moveOpenItemGroupRequest.afterGroupId,
    ).toBe(secondGroupId);
    expect(assign).toHaveBeenCalled();
    expect(memberMove.mock.calls[0]?.[0].groupId).toBe(groupId);
  });

  it("retains canonical rows and reports failures until a retry", async () => {
    const { wrapper, client, read } = setup();
    let rejectSave!: (error: Error) => void;
    vi.spyOn(client, "setOpenItemNote").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.items).toHaveLength(1));
    let operation!: Promise<boolean>;
    await act(async () => {
      operation = hook.current.setWhyOpen(id, "task", "Changed");
    });
    expect(screen.getByTestId("open-items-saving")).toBeInTheDocument();
    await act(async () => {
      rejectSave(
        new AxiosError("conflict", "409", undefined, undefined, {
          ...response({}),
          status: 409,
        }),
      );
      expect(await operation).toBe(false);
    });
    expect(hook.current.error).toBeTruthy();
    expect(screen.queryByTestId("open-items-saving")).not.toBeInTheDocument();
    expect(hook.current.items[0]?.whyOpen).toBe("Saved note");
    read.mockResolvedValue(
      response(present([{ ...item, note: "Other device" }])),
    );
    await act(async () => {
      await hook.current.refresh();
    });
    expect(hook.current.error).toBeNull();
    expect(hook.current.items[0]?.whyOpen).toBe("Other device");
  });

  it("ignores browser-storage notifications and reads canonical state when shown", async () => {
    const { wrapper, read, scope } = setup();
    const { result: hook } = renderHook(useOpenItems, { wrapper });
    await waitFor(() => expect(hook.current.items).toHaveLength(1));
    const calls = read.mock.calls.length;
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: `open-items:v1:${scope.projectId}`,
        }),
      ),
    );
    expect(read.mock.calls.length).toBe(calls);
    read.mockResolvedValue(response(present([], [])));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(hook.current.items).toEqual([]));
  });

  it("bridges only explicit canonical activation and preserves Recently Viewed during reset", async () => {
    const { wrapper, client } = setup();
    const activate = vi
      .spyOn(client, "activateOpenItem")
      .mockResolvedValue(response(result()));
    const remove = vi
      .spyOn(client, "removeOpenItems")
      .mockResolvedValue(
        response(result([{ ...item, removedAt: now, revision: 2 }], [], 2)),
      );
    localStorage.setItem("recently-viewed", "history");
    const { result: hook } = renderHook(
      () => ({ state: useOpenItems(), sink: useOpenItemsActivationSink() }),
      { wrapper },
    );
    await waitFor(() => expect(hook.current.state.items).toHaveLength(1));
    expect(activate).not.toHaveBeenCalled();
    act(() =>
      hook.current.sink.onEntityActivated(
        createEntityActivation("task", id, null, {
          kind: "task",
          label: "Task",
          taskType: "STANDARD",
        }),
      ),
    );
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    await act(async () => {
      await hook.current.state.removeAll();
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![0].removeOpenItemsRequest.items).toEqual([
      { entityType: EntityType.Task, entityId: id },
    ]);
    expect(hook.current.state.items).toEqual([]);
    expect(localStorage.getItem("recently-viewed")).toBe("history");
  });
});
