import axios, { AxiosHeaders, type AxiosResponse } from "axios";
import { vi } from "vitest";
import {
  createApiRuntime,
  registerApiRuntime,
} from "@hey-hey/ui-common/clients";
import type {
  OpenItem,
  OpenItemGroup,
  OpenItemsCollection,
  OpenItemsMutationResult,
  OpenItemsPresentCollection,
} from "@hey-hey/ui-common/api";
import {
  openItemsGroupRows,
  openItemsRows,
} from "../../../../packages/ui-common/src/data/openItemsMapping";
import { validOpenItemsCollection } from "../../../../packages/ui-common/src/data/openItemsValidation";

let userId = "";
export const openItemsTestUserId = () => userId;
const now = "2026-10-07T00:00:00.000Z";
const refKey = (item: Pick<OpenItem, "entityType" | "entityId">) =>
  `${item.entityType}:${item.entityId}`;
const position = (index: number) => String(index + 1).padStart(6, "0");
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
      data: structuredClone(data),
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
}

export function readOpenItemsTestCache(projectId: string) {
  const raw = localStorage.getItem(
    `open-items:cache:v2:${userId}:org-1:${projectId}`,
  );
  const value: unknown = raw ? JSON.parse(raw) : null;
  if (
    typeof value !== "object" ||
    value === null ||
    !("collection" in value) ||
    !validOpenItemsCollection(value.collection)
  )
    return { items: [], groups: [], disclosure: undefined };
  const collection = value.collection;
  const preferences = "preferences" in value ? value.preferences : {};
  return {
    ...(typeof preferences === "object" && preferences !== null
      ? preferences
      : {}),
    items:
      collection.state === "PRESENT" ? openItemsRows(collection.items) : [],
    groups:
      collection.state === "PRESENT"
        ? openItemsGroupRows(collection.groups)
        : [],
  };
}

// A transport fixture for Sidebar presentation/interaction tests. The owner
// wiring and server-wins semantics are covered separately in Context tests.
export function installOpenItemsTestRuntime() {
  userId = crypto.randomUUID();
  const runtime = createApiRuntime({
    baseUrl: "/api/v1",
    transport: {
      axios: axios.create(),
      request: vi.fn(),
      setAuthToken: vi.fn(),
    },
  });
  registerApiRuntime(runtime);
  const api = runtime.clients.openItems;
  const collections = new Map<string, OpenItemsPresentCollection>();
  const collection = (projectId: string) => {
    let value = collections.get(projectId);
    if (!value) {
      value = { state: "PRESENT", revision: 1, items: [], groups: [] };
      collections.set(projectId, value);
    }
    return value;
  };
  const result = (
    projectId: string,
    items: OpenItem[] = [],
    groups: OpenItemGroup[] = [],
    deletedGroupIds: string[] = [],
  ): OpenItemsMutationResult => ({
    collectionRevision: ++collection(projectId).revision,
    items,
    groups,
    deletedGroupIds,
    replayed: false,
  });
  vi.spyOn(api, "getOpenItems").mockImplementation(async ({ projectId }) =>
    response<OpenItemsCollection>(
      collections.get(projectId) ?? { state: "ABSENT" },
    ),
  );
  vi.spyOn(api, "migrateOpenItems").mockImplementation(
    async ({ projectId, migrateOpenItemsRequest: request }) => {
      const value = collection(projectId);
      value.groups = request.groups.map((group, index) => ({
        groupId: group.localGroupId,
        name: group.name,
        collapsed: group.collapsed,
        position: position(index),
        revision: 1,
        updatedAt: now,
      }));
      value.items = request.items.map((item, index) => ({
        entityType: item.entityType,
        entityId: item.entityId,
        note: item.note,
        pinned: item.pinned,
        goalTrackedWorkFilter: "ACTIVE_AND_BACKLOG",
        goalCollapsed: true,
        position: position(index),
        groupId: item.localGroupId,
        memberPosition: item.localGroupId ? position(index) : null,
        revision: 1,
        lineage: item.lineage,
        presentation: item.presentation,
        removedAt: null,
        updatedAt: now,
      }));
      return response<OpenItemsCollection>(value);
    },
  );
  vi.spyOn(api, "activateOpenItem").mockImplementation(
    async ({ projectId, activateOpenItemRequest: request }) => {
      const value = collection(projectId);
      let item = value.items.find(
        (item) => refKey(item) === refKey(request.item),
      );
      if (!item) {
        item = {
          entityType: request.item.entityType,
          entityId: request.item.entityId,
          note: null,
          pinned: false,
          goalTrackedWorkFilter: "ACTIVE_AND_BACKLOG",
          goalCollapsed: true,
          position: position(value.items.length),
          groupId: null,
          memberPosition: null,
          revision: 1,
          lineage: request.lineage,
          presentation: request.presentation,
          removedAt: null,
          updatedAt: now,
        };
        value.items.push(item);
      } else {
        item.lineage = request.lineage;
        item.presentation = request.presentation;
        item.revision++;
      }
      return response(result(projectId, [{ ...item }]));
    },
  );
  vi.spyOn(api, "setOpenItemNote").mockImplementation(
    async ({
      projectId,
      entityType,
      entityId,
      setOpenItemNoteRequest: request,
    }) => {
      const item = collection(projectId).items.find(
        (item) => refKey(item) === refKey({ entityType, entityId }),
      );
      if (!item) throw new Error("Item is not open");
      item.note = request.note;
      item.revision++;
      return response(result(projectId, [{ ...item }]));
    },
  );
  vi.spyOn(api, "setOpenItemPin").mockImplementation(
    async ({
      projectId,
      entityType,
      entityId,
      setOpenItemPinRequest: request,
    }) => {
      const item = collection(projectId).items.find(
        (item) => refKey(item) === refKey({ entityType, entityId }),
      );
      if (!item) throw new Error("Item is not open");
      item.pinned = request.pinned;
      item.revision++;
      return response(result(projectId, [{ ...item }]));
    },
  );
  vi.spyOn(api, "removeOpenItem").mockImplementation(
    async ({
      projectId,
      entityType,
      entityId,
      removeOpenItemRequest: request,
    }) => {
      const value = collection(projectId);
      const root = refKey({ entityType, entityId });
      const affected = value.items.filter(
        (item) =>
          refKey(item) === root ||
          (request.includeDescendants &&
            !item.pinned &&
            !item.groupId &&
            item.lineage.some((entry) => refKey(entry) === root)),
      );
      value.items = value.items.filter((item) => !affected.includes(item));
      return response(
        result(
          projectId,
          affected.map((item) => ({
            ...item,
            removedAt: now,
            revision: item.revision + 1,
          })),
        ),
      );
    },
  );
  vi.spyOn(api, "removeOpenItems").mockImplementation(
    async ({ projectId, removeOpenItemsRequest: request }) => {
      const value = collection(projectId);
      const roots = new Set(request.items.map(refKey));
      const affected = value.items.filter(
        (item) =>
          roots.has(refKey(item)) ||
          (request.includeDescendants &&
            !item.pinned &&
            !item.groupId &&
            item.lineage.some((entry) => roots.has(refKey(entry)))),
      );
      value.items = value.items.filter((item) => !affected.includes(item));
      return response(
        result(
          projectId,
          affected.map((item) => ({
            ...item,
            removedAt: now,
            revision: item.revision + 1,
          })),
        ),
      );
    },
  );
  const assign = (
    projectId: string,
    ids: readonly Pick<OpenItem, "entityType" | "entityId">[],
    groupId: string | null,
  ) => {
    const keys = new Set(ids.map(refKey));
    return collection(projectId)
      .items.filter(
        (item) =>
          keys.has(refKey(item)) ||
          (groupId !== null &&
            item.lineage.some((entry) => keys.has(refKey(entry)))),
      )
      .map((item) => {
        item.groupId = groupId;
        item.memberPosition = groupId ? item.position : null;
        item.revision++;
        return { ...item };
      });
  };
  vi.spyOn(api, "createOpenItemGroup").mockImplementation(
    async ({ projectId, createOpenItemGroupRequest: request }) => {
      const value = collection(projectId);
      const group = {
        groupId: crypto.randomUUID(),
        name: request.name,
        collapsed: false,
        revision: 1,
        position: position(value.groups.length),
        updatedAt: now,
      };
      value.groups.push(group);
      return response(
        result(
          projectId,
          assign(projectId, request.assign ?? [], group.groupId),
          [group],
        ),
      );
    },
  );
  vi.spyOn(api, "assignOpenItemsToGroup").mockImplementation(
    async ({ projectId, groupId, assignOpenItemsToGroupRequest: request }) =>
      response(result(projectId, assign(projectId, request.items, groupId))),
  );
  vi.spyOn(api, "ungroupOpenItems").mockImplementation(
    async ({ projectId, ungroupOpenItemsRequest: request }) =>
      response(result(projectId, assign(projectId, request.items, null))),
  );
  vi.spyOn(api, "renameOpenItemGroup").mockImplementation(
    async ({ projectId, groupId, renameOpenItemGroupRequest: request }) => {
      const group = collection(projectId).groups.find(
        (group) => group.groupId === groupId,
      );
      if (!group) throw new Error("Missing group");
      group.name = request.name;
      group.revision++;
      return response(result(projectId, [], [{ ...group }]));
    },
  );
  vi.spyOn(api, "setOpenItemGroupDisclosure").mockImplementation(
    async ({
      projectId,
      groupId,
      setOpenItemGroupDisclosureRequest: request,
    }) => {
      const group = collection(projectId).groups.find(
        (group) => group.groupId === groupId,
      );
      if (!group) throw new Error("Missing group");
      group.collapsed = request.collapsed;
      group.revision++;
      return response(result(projectId, [], [{ ...group }]));
    },
  );
  vi.spyOn(api, "deleteOpenItemGroup").mockImplementation(
    async ({ projectId, groupId }) => {
      const value = collection(projectId);
      const members = value.items.filter((item) => item.groupId === groupId);
      value.groups = value.groups.filter((group) => group.groupId !== groupId);
      return response(
        result(projectId, assign(projectId, members, null), [], [groupId]),
      );
    },
  );
  vi.spyOn(api, "resetOpenItems").mockImplementation(async ({ projectId }) => {
    const value = collection(projectId);
    value.items = [];
    value.groups = [];
    value.revision++;
    return response<OpenItemsCollection>(value);
  });
  vi.spyOn(api, "setOpenItemGoalFilter").mockImplementation(
    async ({ projectId, entityId, setOpenItemGoalFilterRequest }) => {
      const item = collection(projectId).items.find(
        (item) => item.entityId === entityId,
      );
      if (!item) throw new Error("Goal is unavailable");
      item.goalTrackedWorkFilter = setOpenItemGoalFilterRequest.filter;
      item.revision++;
      return response(result(projectId, [{ ...item }]));
    },
  );
  vi.spyOn(api, "setOpenItemGoalDisclosure").mockImplementation(
    async ({ projectId, entityId, setOpenItemGoalDisclosureRequest }) => {
      const item = collection(projectId).items.find(
        (item) => item.entityId === entityId,
      );
      if (!item) throw new Error("Goal is unavailable");
      item.goalCollapsed = setOpenItemGoalDisclosureRequest.collapsed;
      item.revision++;
      return response(result(projectId, [{ ...item }]));
    },
  );
  vi.spyOn(api, "promoteGroupToGoal").mockImplementation(
    async ({ projectId, promoteGroupToGoalRequest: request }) => {
      const value = collection(projectId);
      const members = value.items.filter(
        (item) => item.groupId === request.groupId,
      );
      const untrackedMembers = members
        .filter((item) => item.entityType !== "TASK")
        .map((item) => ({
          entityType: item.entityType,
          entityId: item.entityId,
        }));
      value.items = value.items.filter(
        (item) =>
          item.groupId !== request.groupId || item.entityType !== "TASK",
      );
      value.items.forEach((item) => {
        if (item.groupId === request.groupId) {
          item.groupId = null;
          item.memberPosition = null;
        }
      });
      value.groups = value.groups.filter(
        (group) => group.groupId !== request.groupId,
      );
      const goal: OpenItem = {
        entityType: "TASK",
        entityId: crypto.randomUUID(),
        note: null,
        pinned: true,
        groupId: null,
        memberPosition: null,
        position: position(value.items.length),
        revision: 1,
        lineage: [],
        presentation: { label: request.goalName, workItemTypeKey: "GOAL" },
        removedAt: null,
        updatedAt: now,
        goalTrackedWorkFilter: "ACTIVE_AND_BACKLOG",
        goalCollapsed: true,
      };
      value.items.push(goal);
      value.revision++;
      return response({
        collection: value,
        goal: { entityType: goal.entityType, entityId: goal.entityId },
        untrackedMembers,
        replayed: false,
      });
    },
  );
  return api;
}
