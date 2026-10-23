import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionType,
  EntityType,
  OpenItemsApi,
  type OpenItem,
  type OpenItemGroup,
  type OpenItemsCollection,
  type OpenItemsMutationResult,
} from "../../api";
import { createEntityActivation } from "../../contexts/EntityActivationContext";
import { createNavigationLineageEntry } from "../../types/userTracking";
import {
  OpenItemsAdapter,
  openItemsRecord,
  type OpenItemsOperation,
  type OpenItemsScope,
} from "../openItemsAdapter";
import { openItemsRows } from "../openItemsMapping";

const id = "550e8400-e29b-41d4-a716-446655440000";
const otherId = "550e8400-e29b-41d4-a716-446655440001";
const groupId = "550e8400-e29b-41d4-a716-446655440002";
const now = "2026-10-07T00:00:00.000Z";
const scope = { organizationId: "org", projectId: "project", userId: "user" };
const item = (entityId = id): OpenItem => ({
  entityType: EntityType.Task,
  entityId,
  note: "server note",
  pinned: false,
  position: "A",
  groupId: null,
  memberPosition: null,
  goalTrackedWorkFilter: "ACTIVE_AND_BACKLOG",
  goalCollapsed: true,
  revision: 1,
  lineage: [],
  presentation: { label: "Server task", workItemTypeKey: "STANDARD" },
  removedAt: null,
  updatedAt: now,
});
const group: OpenItemGroup = {
  groupId,
  name: "Server group",
  collapsed: false,
  revision: 1,
  position: "A",
  updatedAt: now,
};
const present = (
  items: OpenItem[] = [item()],
  groups: OpenItemGroup[] = [],
  revision = 1,
): OpenItemsCollection => ({ state: "PRESENT", revision, items, groups });
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
const result = (
  items: OpenItem[] = [],
  groups: OpenItemGroup[] = [],
  revision = 2,
): OpenItemsMutationResult => ({
  collectionRevision: revision,
  items,
  groups,
  deletedGroupIds: [],
  replayed: false,
});
const noteOperation = (): OpenItemsOperation => ({
  kind: "setOpenItemNote",
  parameters: {
    entityType: EntityType.Task,
    entityId: id,
    setOpenItemNoteRequest: {
      idempotencyKey: "stable-note-key",

      note: "Requested note",
    },
  },
});

const clients = new WeakMap<OpenItemsAdapter, QueryClient>();
/** A fresh adapter over a fresh query cache, as after a page reload. */
function load(api: OpenItemsApi, adapterScope: OpenItemsScope = scope) {
  const queryClient = new QueryClient();
  const adapter = new OpenItemsAdapter(adapterScope, queryClient, api);
  clients.set(adapter, queryClient);
  return adapter;
}
/** What the hook renders: query cache collection over the browser-cache placeholder. */
function view(adapter: OpenItemsAdapter) {
  const status = adapter.getStatus();
  const collection = adapter.collection() ?? adapter.cachedCollection;
  const state = clients.get(adapter)!.getQueryState(adapter.queryKey);
  return {
    ...status,
    collection,
    record: adapter.record(collection, status.preferences),
    stale:
      !state?.data ||
      state.isInvalidated ||
      status.offline ||
      status.error !== null,
  };
}

describe("canonical Open Items adapter", () => {
  it("returns scoped online results to triage without enqueueing a failed explicit application", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    const result: OpenItemsMutationResult = {collectionRevision: 2, items: [], groups: [group], deletedGroupIds: [], replayed: false};
    vi.spyOn(api, "createOpenItemGroup").mockResolvedValue(response(result));
    const adapter = load(api);
    expect(await adapter.mutateWithResult({kind: "createOpenItemGroup", parameters: {createOpenItemGroupRequest: {name: group.name, idempotencyKey: "create-key"}}})).toBe(result);
    vi.spyOn(api, "setOpenItemNote").mockRejectedValue(new AxiosError("Connection lost"));
    await expect(adapter.mutateWithResult(noteOperation())).rejects.toThrow("Connection lost");
    expect(adapter.getStatus().queued).toBe(0);
  });
  it("preserves base row identity across disclosure-only preference changes", () => {
    const collection = present();
    const first = openItemsRecord(collection, {
      version: 1,
      items: [],
      groups: [],
    });
    const next = openItemsRecord(collection, {
      ...first,
      disclosure: {
        version: 1,
        sectionExpanded: false,
        collapsedBranchKeys: [],
      },
    });
    expect(next.items).toBe(first.items);
    expect(next.groups).toBe(first.groups);
    expect(next.disclosure?.sectionExpanded).toBe(false);
    const changed = openItemsRecord(
      present([
        { ...item(), goalCollapsed: false, goalTrackedWorkFilter: "ALL" },
      ]),
      first,
    );
    expect(changed.items).not.toBe(first.items);
    expect(changed.items[0]).toMatchObject({
      goalCollapsed: false,
      goalTrackedWorkFilter: "ALL",
    });
  });
  it("never queues or replays failed promotion when canonical state is refreshed", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(
      response(present([item()], [group])),
    );
    const promote = vi.spyOn(api, "promoteGroupToGoal").mockRejectedValue(
      new AxiosError("Stale group", "ERR_BAD_REQUEST", undefined, undefined, {
        ...response(null),
        status: 409,
      }),
    );
    const adapter = load(api);
    await expect(
      adapter.promoteGroupToGoal({
        groupId,
        goalName: "Outcome",
        idempotencyKey: "promotion-key",
      }),
    ).rejects.toThrow("Stale group");
    expect(adapter.getStatus().queued).toBe(0);
    expect(adapter.getStatus().pending).toBe(0);
    await adapter.refresh();
    await adapter.refresh();
    expect(promote).toHaveBeenCalledOnce();
    expect(view(adapter).record.groups[0].name).toBe("Server group");
  });

  it("publishes a promotion collection and exposes persisted Goal row preferences", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(
      response(present([item()], [group])),
    );
    const goal = {
      ...item(otherId),
      pinned: true,
      goalTrackedWorkFilter: "ACTIVE" as const,
      goalCollapsed: false,
      presentation: { label: "Outcome", workItemTypeKey: "GOAL" },
    };
    const promoted = {
      collection: {
        state: "PRESENT" as const,
        revision: 2,
        items: [goal],
        groups: [],
      },
      goal: { entityType: EntityType.Task, entityId: otherId },
      untrackedMembers: [],
      replayed: false,
    };
    const promote = vi
      .spyOn(api, "promoteGroupToGoal")
      .mockResolvedValue(response(promoted));
    const adapter = load(api);
    const request = {
      groupId,
      goalName: "Outcome",
      idempotencyKey: "promotion-key",
    };
    await expect(adapter.promoteGroupToGoal(request)).resolves.toEqual(
      promoted,
    );
    expect(promote).toHaveBeenCalledWith({
      ...scope,
      promoteGroupToGoalRequest: request,
    });
    expect(view(adapter).record.items[0]).toMatchObject({
      entityType: "goal",
      pinned: true,
      goalTrackedWorkFilter: "ACTIVE",
      goalCollapsed: false,
    });
    expect(view(load(api)).collection).toEqual(promoted.collection);
    expect(adapter.getStatus().pending).toBe(0);
  });

  it("dispatches Goal filter and disclosure mutations and persists their result", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    const filter = vi
      .spyOn(api, "setOpenItemGoalFilter")
      .mockResolvedValue(
        response(
          result([{ ...item(), goalTrackedWorkFilter: "NONE", revision: 2 }]),
        ),
      );
    const disclosure = vi
      .spyOn(api, "setOpenItemGoalDisclosure")
      .mockResolvedValue(
        response(
          result(
            [
              {
                ...item(),
                goalTrackedWorkFilter: "NONE",
                goalCollapsed: false,
                revision: 3,
              },
            ],
            [],
            3,
          ),
        ),
      );
    const adapter = load(api);
    await adapter.mutate({
      kind: "setOpenItemGoalFilter",
      parameters: {
        entityType: EntityType.Task,
        entityId: id,
        setOpenItemGoalFilterRequest: {
          idempotencyKey: "filter-key",
          filter: "NONE",
        },
      },
    });
    await adapter.mutate({
      kind: "setOpenItemGoalDisclosure",
      parameters: {
        entityType: EntityType.Task,
        entityId: id,
        setOpenItemGoalDisclosureRequest: {
          idempotencyKey: "disclosure-key",
          collapsed: false,
        },
      },
    });
    expect(filter).toHaveBeenCalledOnce();
    expect(disclosure).toHaveBeenCalledOnce();
    expect(view(load(api)).record.items[0]).toMatchObject({
      goalTrackedWorkFilter: "NONE",
      goalCollapsed: false,
    });
  });
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each(["BUG", "STANDARD"])(
    "repairs a detached %s session on canonical revisits and retains server membership after reload",
    async (workItemTypeKey) => {
      const api = new OpenItemsApi();
      const parent: OpenItem = {
        ...item(),
        groupId,
        memberPosition: "A",
        presentation: { label: "Parent work item", workItemTypeKey },
      };
      let session: OpenItem = {
        ...item(otherId),
        entityType: EntityType.AgentSession,
        position: "B",
        groupId,
        memberPosition: "B",
        presentation: {
          label: "Old session",
          agentSessionType: AgentSessionType.Coding,
        },
      };
      let revision = 1;
      vi.spyOn(api, "getOpenItems").mockImplementation(async () =>
        response(present([parent, session], [group], revision))
      );
      // Provider replacement is modeled here; this is not evidence of live server behavior.
      const activate = vi
        .spyOn(api, "activateOpenItem")
        .mockImplementation(async ({ activateOpenItemRequest: request }) => {
          session = {
            ...session,
            lineage: request.lineage,
            presentation: request.presentation,
            revision: ++revision,
          };
          return response(result([session], [], revision));
        });
      const adapter = load(api);
      await adapter.refresh();
      const activation = createEntityActivation(
        "agent_session",
        otherId,
        [createNavigationLineageEntry("task", id)],
        {
          kind: "agent_session",
          label: "Coding session",
          sessionType: "CODING",
        }
      );
      expect(
        view(adapter).record.items.find((row) => row.entityId === otherId)
          ?.lineage
      ).toEqual([]);
      // Task-route opening, followed by the equivalent general-route activation.
      await adapter.activate(activation);
      await adapter.activate(activation);
      expect(activate).toHaveBeenCalledTimes(2);
      expect(activate.mock.calls[1]?.[0].activateOpenItemRequest).toMatchObject(
        {
          item: { entityType: EntityType.AgentSession, entityId: otherId },
          lineage: [{ entityType: EntityType.Task, entityId: id }],
          presentation: {
            label: "Coding session",
            agentSessionType: AgentSessionType.Coding,
            routeParams: { lineageKinds: "t" },
          },
        }
      );
      const assertRepaired = (candidate: OpenItemsAdapter) => {
        expect(
          view(candidate).record.items.find((row) => row.entityId === otherId)
        ).toMatchObject({
          lineage: [{ entityType: "task", entityId: id }],
          groupId,
          presentation: {
            kind: "agent_session",
            label: "Coding session",
            sessionType: "CODING",
          },
        });
      };
      assertRepaired(adapter);
      await adapter.refresh();
      assertRepaired(adapter);
      const reloaded = load(api);
      assertRepaired(reloaded);
      await reloaded.refresh();
      assertRepaired(reloaded);
    }
  );

  it("reconciles inherited lineage and only server-selected removal tombstones across refresh and cache reload", async () => {
    const api = new OpenItemsApi();
    const parent: OpenItem = { ...item(), groupId, memberPosition: "A" };
    const session: OpenItem = {
      ...item(otherId),
      entityType: EntityType.AgentSession,
      position: "B",
      groupId,
      memberPosition: "B",
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
      entityId: "550e8400-e29b-41d4-a716-446655440003",
      pinned: true,
      position: "C",
      memberPosition: "C",
    };
    const differentGroup = {
      ...group,
      groupId: "550e8400-e29b-41d4-a716-446655440004",
      position: "B",
    };
    const protectedSession: OpenItem = {
      ...session,
      entityId: "550e8400-e29b-41d4-a716-446655440005",
      groupId: differentGroup.groupId,
      position: "D",
    };
    const ungrouped: OpenItem = {
      ...session,
      entityId: "550e8400-e29b-41d4-a716-446655440006",
      groupId: null,
      memberPosition: null,
      position: "E",
    };
    const unrelated: OpenItem = {
      ...item("550e8400-e29b-41d4-a716-446655440007"),
      position: "F",
    };
    const initial = [parent, pinned, protectedSession, ungrouped, unrelated];
    const read = vi
      .spyOn(api, "getOpenItems")
      .mockResolvedValue(response(present(initial, [group, differentGroup])));
    const activate = vi
      .spyOn(api, "activateOpenItem")
      .mockResolvedValue(response(result([session], [], 2)));
    const adapter = load(api);
    await adapter.refresh();
    await adapter.activate(
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
    expect(activate.mock.calls[0]![0].activateOpenItemRequest).toMatchObject({
      item: { entityType: EntityType.AgentSession, entityId: otherId },
      lineage: [{ entityType: EntityType.Task, entityId: id }],
    });
    expect(
      view(adapter).record.items.find((row) => row.entityId === otherId),
    ).toMatchObject({
      groupId,
      lineage: [createNavigationLineageEntry("task", id)],
    });
    expect(
      view(load(api)).record.items.find((row) => row.entityId === otherId)
        ?.groupId,
    ).toBe(groupId);
    const remove = vi.spyOn(api, "removeOpenItem").mockResolvedValue(
      response(
        result(
          [parent, session, ungrouped].map((row) => ({
            ...row,
            groupId: null,
            memberPosition: null,
            removedAt: now,
            revision: 3,
          })),
          [],
          3,
        ),
      ),
    );
    await adapter.mutate({
      kind: "removeOpenItem",
      parameters: {
        entityType: EntityType.Task,
        entityId: id,
        removeOpenItemRequest: {
          idempotencyKey: "remove-grouped-branch",
          includeDescendants: true,
        },
      },
    });
    expect(remove).toHaveBeenCalledTimes(1);
    const retained = [pinned, protectedSession, unrelated];
    expect(view(adapter).record.items.map((row) => row.entityId)).toEqual(
      retained.map((row) => row.entityId),
    );
    read.mockResolvedValue(
      response(present(retained, [group, differentGroup], 3)),
    );
    await adapter.refresh();
    const reloaded = load(api);
    expect(view(reloaded).record.items).toEqual(view(adapter).record.items);
    await reloaded.refresh();
    expect(view(reloaded).record.items).toEqual(view(adapter).record.items);
  });

  it("persists cache reads without using storage as a notification channel", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    const first = load(api);
    await first.refresh();
    const second = load(api);
    second.updatePreferences({
      sortDirection: "newest",
      disclosure: undefined,
    });
    const write = vi.spyOn(Storage.prototype, "setItem");
    await first.refresh();
    await second.refresh();
    expect(write).toHaveBeenCalledTimes(2);
    vi.mocked(api.getOpenItems).mockResolvedValue(response(present([], [], 2)));
    await first.refresh();
    expect(write).toHaveBeenCalledTimes(3);
    await second.refresh();
    expect(write).toHaveBeenCalledTimes(4);
    expect(view(second).record.items).toEqual([]);
  });

  it("shows validated cache, then replaces items and groups with the complete server collection", async () => {
    localStorage.setItem(
      "open-items:v1:project",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityType: "task",
            entityId: id,
            presentation: {
              kind: "task",
              label: "Cached task",
              taskType: "STANDARD",
            },
            groupId: "local",
          },
        ],
        groups: [{ id: "local", name: "Local", order: 0, collapsed: true }],
      }),
    );
    const api = new OpenItemsApi();
    const read = vi
      .spyOn(api, "getOpenItems")
      .mockResolvedValue(response(present([item(otherId)], [group])));
    const migrate = vi.spyOn(api, "migrateOpenItems");
    const adapter = load(api);
    expect(view(adapter).record.items[0]?.presentation?.label).toBe(
      "Cached task",
    );
    await adapter.refresh();
    expect(read).toHaveBeenCalledWith(expect.objectContaining(scope));
    expect(migrate).not.toHaveBeenCalled();
    expect(view(adapter).record.items.map((row) => row.entityId)).toEqual([
      otherId,
    ]);
    expect(view(adapter).record.groups.map((row) => row.id)).toEqual([groupId]);
  });

  it("migrates valid items and group state together only when absent, skipping invalid identities", async () => {
    localStorage.setItem(
      "open-items:v1:project",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityType: "task",
            entityId: id,
            presentation: { kind: "task", label: "Task", taskType: "STANDARD" },
            groupId: "local",
            whyOpen: "Keep",
            pinned: true,
          },
          {
            entityType: "task",
            entityId: "invalid",
            presentation: { kind: "task", label: "Bad", taskType: "STANDARD" },
          },
        ],
        groups: [{ id: "local", name: "Local", order: 0, collapsed: true }],
      }),
    );
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems")
      .mockResolvedValueOnce(response<OpenItemsCollection>({ state: "ABSENT" }))
      .mockResolvedValue(response(present()));
    const migrate = vi
      .spyOn(api, "migrateOpenItems")
      .mockResolvedValue(response(present([item()], [group])));
    const adapter = load(api);
    await adapter.refresh();
    await adapter.refresh();
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(migrate.mock.calls[0]?.[0].migrateOpenItemsRequest).toMatchObject({
      sourceSchemaVersion: 1,
      items: [
        {
          entityType: "TASK",
          entityId: id,
          note: "Keep",
          pinned: true,
          localGroupId: "local",
        },
      ],
      groups: [{ localGroupId: "local", name: "Local", collapsed: true }],
    });
  });

  it("retains the exact migration body and key after an uncertain network failure", async () => {
    localStorage.setItem(
      "open-items:v1:project",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityType: "task",
            entityId: id,
            presentation: { kind: "task", label: "Task", taskType: "STANDARD" },
          },
        ],
      }),
    );
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(
      response<OpenItemsCollection>({ state: "ABSENT" }),
    );
    const migrate = vi
      .spyOn(api, "migrateOpenItems")
      .mockRejectedValueOnce(new AxiosError("offline"))
      .mockResolvedValue(response(present()));
    await expect(load(api).refresh()).rejects.toThrow("offline");
    localStorage.removeItem("open-items:v1:project");
    await load(api).refresh();
    expect(migrate.mock.calls[1]?.[0]).toEqual(migrate.mock.calls[0]?.[0]);
  });

  it("keeps unchanged items while applying only canonical affected items, removals, and groups", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(
      response(present([item(), { ...item(otherId), position: "B" }], [group])),
    );
    vi.spyOn(api, "setOpenItemNote").mockResolvedValue(
      response(result([{ ...item(), note: "Canonical note", revision: 2 }])),
    );
    vi.spyOn(api, "deleteOpenItemGroup").mockResolvedValue(
      response({
        ...result([{ ...item(), removedAt: now }], [], 3),
        deletedGroupIds: [groupId],
      }),
    );
    const adapter = load(api);
    await adapter.refresh();
    await adapter.mutate(noteOperation());
    expect(view(adapter).record.items.map((row) => row.whyOpen)).toEqual([
      "Canonical note",
      "server note",
    ]);
    await adapter.mutate({
      kind: "deleteOpenItemGroup",
      parameters: {
        groupId,
        deleteOpenItemGroupRequest: {
          idempotencyKey: "delete-group-key",
        },
      },
    });
    expect(view(adapter).record.items.map((row) => row.entityId)).toEqual([
      otherId,
    ]);
    expect(view(adapter).record.groups).toEqual([]);
  });

  it("waits for canonical mutation success and exposes pending state without optimistic notes", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    let resolve!: (
      value: ReturnType<typeof response<OpenItemsMutationResult>>,
    ) => void;
    vi.spyOn(api, "setOpenItemNote").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const adapter = load(api);
    await adapter.refresh();
    const mutation = adapter.mutate(noteOperation());
    await Promise.resolve();
    expect(view(adapter).pending).toBe(1);
    expect(view(adapter).record.items[0]?.whyOpen).toBe("server note");
    resolve(response(result([{ ...item(), note: "Saved", revision: 2 }])));
    await mutation;
    expect(view(adapter).pending).toBe(0);
    expect(view(adapter).record.items[0]?.whyOpen).toBe("Saved");
  });

  it("preserves typed offline operations and idempotency keys across reload, reading canonically before replay", async () => {
    const api = new OpenItemsApi();
    const read = vi
      .spyOn(api, "getOpenItems")
      .mockResolvedValue(response(present()));
    const note = vi
      .spyOn(api, "setOpenItemNote")
      .mockResolvedValue(
        response(result([{ ...item(), note: "Replayed", revision: 2 }])),
      );
    const adapter = load(api);
    await adapter.refresh();
    adapter.setOffline(true);
    await adapter.mutate(noteOperation());
    expect(note).not.toHaveBeenCalled();
    expect(view(adapter).record.items[0]?.whyOpen).toBe("server note");
    const reloaded = load(api);
    expect(view(reloaded).pending).toBe(1);
    expect(reloaded.ref({ entityType: "task", entityId: id })).toEqual({
      entityType: "TASK",
      entityId: id,
    });
    await reloaded.refresh();
    expect(read.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      note.mock.invocationCallOrder[0]!,
    );
    expect(note.mock.calls[0]?.[0].setOpenItemNoteRequest.idempotencyKey).toBe(
      "stable-note-key",
    );
    expect(view(reloaded).pending).toBe(0);
  });

  it("keeps a new mutation pending while an offline replay finishes", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    let finishReplay!: (
      value: ReturnType<typeof response<OpenItemsMutationResult>>,
    ) => void;
    let finishPin!: (
      value: ReturnType<typeof response<OpenItemsMutationResult>>,
    ) => void;
    const note = vi.spyOn(api, "setOpenItemNote").mockImplementation(
      () =>
        new Promise((done) => {
          finishReplay = done;
        }),
    );
    const pin = vi.spyOn(api, "setOpenItemPin").mockImplementation(
      () =>
        new Promise((done) => {
          finishPin = done;
        }),
    );
    const adapter = load(api);
    await adapter.refresh();
    adapter.setOffline(true);
    await adapter.mutate(noteOperation());
    adapter.setOffline(false);
    const replay = adapter.refresh();
    await vi.waitFor(() => expect(note).toHaveBeenCalled());
    const mutation = adapter.mutate({
      kind: "setOpenItemPin",
      parameters: {
        entityType: EntityType.Task,
        entityId: id,
        setOpenItemPinRequest: {
          idempotencyKey: "pin-key",

          pinned: true,
        },
      },
    });
    expect(view(adapter).pending).toBe(2);
    finishReplay(response(result([{ ...item(), revision: 2 }])));
    await replay;
    await vi.waitFor(() => expect(pin).toHaveBeenCalled());
    expect(view(adapter)).toMatchObject({ pending: 1, queued: 0 });
    finishPin(
      response(result([{ ...item(), revision: 3, pinned: true }], [], 3)),
    );
    await mutation;
    expect(view(adapter).pending).toBe(0);
  });

  it("rejects offline ordering operations and surfaces failures for retry", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    vi.spyOn(api, "setOpenItemNote").mockRejectedValue(
      new AxiosError("stale", "409", undefined, undefined, {
        ...response({}),
        status: 409,
      }),
    );
    const adapter = load(api);
    await adapter.refresh();
    adapter.setOffline(true);
    await expect(
      adapter.mutate({
        kind: "moveOpenItem",
        parameters: {
          entityType: EntityType.Task,
          entityId: id,
          moveOpenItemRequest: {
            idempotencyKey: "move-key",

            after: null,
          },
        },
      }),
    ).rejects.toThrow("connection");
    adapter.setOffline(false);
    await expect(adapter.mutate(noteOperation())).rejects.toThrow("stale");
    expect(view(adapter)).toMatchObject({
      stale: true,
      pending: 0,
    });
    expect(view(adapter).record.items[0]?.whyOpen).toBe("server note");
    await adapter.refresh();
    expect(view(adapter).error).toBeNull();
  });

  it("ignores an originating signal queued before the mutation response arrives", async () => {
    const api = new OpenItemsApi();
    const read = vi
      .spyOn(api, "getOpenItems")
      .mockResolvedValue(response(present()));
    let finish!: (
      value: ReturnType<typeof response<OpenItemsMutationResult>>,
    ) => void;
    vi.spyOn(api, "setOpenItemNote").mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const adapter = load(api);
    await adapter.refresh();
    const mutation = adapter.mutate(noteOperation());
    await vi.waitFor(() => expect(finish).toBeDefined());
    const signal = adapter.refreshForSignal(2);
    finish(
      response(result([{ ...item(), note: "Saved", revision: 2 }], [], 2)),
    );
    await Promise.all([mutation, signal]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(view(adapter).record.items[0]?.whyOpen).toBe("Saved");
  });

  it("skips a queued signal read when the tab becomes hidden before its mutation settles", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const api = new OpenItemsApi();
    const read = vi
      .spyOn(api, "getOpenItems")
      .mockResolvedValue(response(present()));
    let finish!: (
      value: ReturnType<typeof response<OpenItemsMutationResult>>,
    ) => void;
    vi.spyOn(api, "setOpenItemNote").mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const adapter = load(api);
    await adapter.refresh();
    const mutation = adapter.mutate(noteOperation());
    await vi.waitFor(() => expect(finish).toBeDefined());
    const signal = adapter.refreshForSignal(3);
    visibility.mockReturnValue("hidden");
    finish(
      response(result([{ ...item(), note: "Saved", revision: 2 }], [], 2)),
    );
    await Promise.all([mutation, signal]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads missed canonical changes when a partial mutation response skips revisions", async () => {
    const api = new OpenItemsApi();
    const read = vi
      .spyOn(api, "getOpenItems")
      .mockResolvedValueOnce(response(present()))
      .mockResolvedValue(
        response(
          present(
            [{ ...item(), note: "Saved", revision: 3 }, item(otherId)],
            [],
            3,
          ),
        ),
      );
    vi.spyOn(api, "setOpenItemNote").mockResolvedValue(
      response(result([{ ...item(), note: "Saved", revision: 3 }], [], 3)),
    );
    const adapter = load(api);
    await adapter.refresh();
    await adapter.mutate(noteOperation());
    expect(read).toHaveBeenCalledTimes(2);
    expect(view(adapter).record.items).toHaveLength(2);
  });

  it("retains queued intent after a failed replay and applies it after a newer canonical read", async () => {
    const api = new OpenItemsApi();
    const read = vi
      .spyOn(api, "getOpenItems")
      .mockResolvedValue(response(present()));
    const note = vi
      .spyOn(api, "setOpenItemNote")
      .mockRejectedValueOnce(new Error("retry me"))
      .mockResolvedValue(
        response(
          result(
            [{ ...item(), pinned: true, note: "Replayed", revision: 3 }],
            [],
            3,
          ),
        ),
      );
    const adapter = load(api);
    await adapter.refresh();
    adapter.setOffline(true);
    await adapter.mutate(noteOperation());
    adapter.setOffline(false);
    await expect(adapter.refresh()).rejects.toThrow("retry me");
    expect(view(adapter).queued).toBe(1);
    read.mockResolvedValue(
      response(present([{ ...item(), pinned: true, revision: 2 }], [], 2)),
    );
    await adapter.refresh();
    expect(view(adapter).record.items[0]).toMatchObject({
      pinned: true,
      whyOpen: "Replayed",
    });
    expect(view(adapter).queued).toBe(0);
    expect(note.mock.calls[0]?.[0]).toEqual(note.mock.calls[1]?.[0]);
  });

  it("reset replaces the entire collection and groups with intentionally empty state without touching Recently Viewed", async () => {
    localStorage.setItem("recently-viewed", "history");
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(
      response(present([item()], [group])),
    );
    const reset = vi
      .spyOn(api, "resetOpenItems")
      .mockResolvedValue(response(present([], [], 2)));
    const adapter = load(api);
    await adapter.refresh();
    await adapter.reset();
    expect(reset.mock.calls[0]?.[0].resetOpenItemsRequest).toEqual({
      idempotencyKey: expect.any(String),
    });
    expect(view(adapter).record).toMatchObject({
      items: [],
      groups: [],
    });
    expect(view(load(api)).record.items).toEqual([]);
    expect(localStorage.getItem("recently-viewed")).toBe("history");
  });

  it("activation preserves bounded typed lineage and specialized routes without transient fields", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    const activate = vi
      .spyOn(api, "activateOpenItem")
      .mockResolvedValue(response(result()));
    const adapter = load(api);
    await adapter.activate(
      createEntityActivation(
        "task",
        id,
        [createNavigationLineageEntry("plan", otherId)],
        { kind: "task", label: "Task", taskType: "STANDARD" },
      ),
    );
    const request = activate.mock.calls[0]?.[0].activateOpenItemRequest;
    expect(request).toMatchObject({
      item: { entityType: "TASK", entityId: id },
      lineage: [{ entityType: "TASK", entityId: otherId }],
      presentation: { routeParams: { lineageKinds: "p" } },
    });
    const mapped = openItemsRows([
      {
        ...item(),
        lineage: request!.lineage,
        presentation: request!.presentation,
      },
    ]);
    expect(mapped[0]?.lineage?.[0]?.entityType).toBe("plan");
    await adapter.activate(
      createEntityActivation("task", id, null, {
        kind: "task",
        label: "Plan work item",
        taskType: "PLAN",
      }),
    );
    const planWorkItem =
      activate.mock.calls[1]![0].activateOpenItemRequest.presentation;
    expect(
      openItemsRows([{ ...item(), presentation: planWorkItem }])[0]?.entityType,
    ).toBe("task");
    await adapter.activate(
      createEntityActivation("plan", id, null, {
        kind: "plan",
        label: "Plan route",
      }),
    );
    const planRoute =
      activate.mock.calls[2]![0].activateOpenItemRequest.presentation;
    expect(
      openItemsRows([{ ...item(), presentation: planRoute }])[0]?.entityType,
    ).toBe("plan");
  });

  it("isolates persisted collections by authenticated user and organization", async () => {
    const api = new OpenItemsApi();
    vi.spyOn(api, "getOpenItems").mockResolvedValue(response(present()));
    const adapter = load(api);
    await adapter.refresh();
    expect(
      view(load(api, { ...scope, userId: "another-user" })).record.items,
    ).toEqual([]);
    expect(
      view(load(api, { ...scope, organizationId: "another-org" })).record.items,
    ).toEqual([]);
  });
});
