import type { useOpenItems as useCanonicalOpenItems } from "@hey-hey/ui-common/data";
import { EntityType } from "@hey-hey/ui-common/api";
import type { OpenItemsContextValue } from "./openItemsContextValue";
import {
  matchesOpenItemIdentity,
  selectBulkRemovalTargets,
  type OpenItem,
  type OpenItemIdentity,
} from "./openItemsModel";

type Adapter = ReturnType<typeof useCanonicalOpenItems>["adapter"];
type StateKeys =
  | "items"
  | "groups"
  | "disclosure"
  | "sortDirection"
  | "isLoading"
  | "isFetching"
  | "stale"
  | "offline"
  | "pending"
  | "queued"
  | "error";
export type OpenItemsActions = Omit<OpenItemsContextValue, StateKeys>;

type OpenItemsRecord = ReturnType<Adapter["record"]>;

/** Rows as rendered: canonical collection, else the stale browser cache. */
function currentRecord(adapter: Adapter): OpenItemsRecord {
  return adapter.record(
    adapter.collection() ?? adapter.cachedCollection,
    adapter.getStatus().preferences,
  );
}

export function getOpenItemsDisclosure(record: OpenItemsRecord) {
  return {
    sectionExpanded: record.disclosure?.sectionExpanded ?? true,
    collapsedBranchKeys: new Set(record.disclosure?.collapsedBranchKeys ?? []),
  };
}

function createActionContext(adapter: Adapter, scoped: boolean) {
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (!scoped) return false;
    try {
      await action();
      return true;
    } catch (error) {
      adapter.reportError(error);
      return false;
    }
  };
  const mutate = (action: () => Promise<unknown>) =>
    run(async () => {
      if (!adapter.collection() && !adapter.getStatus().offline)
        await adapter.refresh();
      return action();
    });
  const itemRef = (identity: OpenItemIdentity) => adapter.ref(identity);
  const removeItems = async (
    identities: readonly OpenItemIdentity[],
    includeDescendants: boolean,
  ) => {
    if (identities.length === 0) return;
    await adapter.mutate({
      kind: "removeOpenItems",
      parameters: {
        removeOpenItemsRequest: {
          idempotencyKey: crypto.randomUUID(),
          includeDescendants,
          items: identities.map(itemRef),
        },
      },
    });
  };
  const removeItem = (
    identity: OpenItemIdentity,
    includeDescendants: boolean,
  ) => removeItems([identity], includeDescendants);
  const removeMatching = (select: (items: OpenItem[]) => OpenItem[]) =>
    mutate(async () => {
      const identities = select(currentRecord(adapter).items);
      await removeItems(identities, false);
    });
  const pinItem = (identity: OpenItemIdentity, pinned: boolean) =>
    mutate(() => {
      const ref = itemRef(identity);
      return adapter.mutate({
        kind: "setOpenItemPin",
        parameters: {
          ...ref,
          setOpenItemPinRequest: {
            idempotencyKey: crypto.randomUUID(),

            pinned,
          },
        },
      });
    });

  return {
    adapter,
    run,
    mutate,
    itemRef,
    removeItem,
    removeItems,
    removeMatching,
    pinItem,
  };
}
type ActionContext = ReturnType<typeof createActionContext>;

function createPreferenceActions(
  context: ActionContext,
): Pick<
  OpenItemsActions,
  "setSortDirection" | "setSectionExpanded" | "setBranchExpanded"
> {
  const { adapter } = context;
  return {
    setSortDirection: (sortDirection) =>
      adapter.updatePreferences({
        sortDirection,
        disclosure: currentRecord(adapter).disclosure,
      }),
    setSectionExpanded: (sectionExpanded) =>
      adapter.updatePreferences({
        sortDirection: currentRecord(adapter).sortDirection,
        disclosure: {
          version: 1,
          sectionExpanded,
          collapsedBranchKeys: [
            ...getOpenItemsDisclosure(currentRecord(adapter))
              .collapsedBranchKeys,
          ],
        },
      }),
    setBranchExpanded: (key, expanded) => {
      const keys = new Set(
        getOpenItemsDisclosure(currentRecord(adapter)).collapsedBranchKeys,
      );
      if (expanded) keys.delete(key);
      else keys.add(key);
      adapter.updatePreferences({
        sortDirection: currentRecord(adapter).sortDirection,
        disclosure: {
          version: 1,
          sectionExpanded: getOpenItemsDisclosure(currentRecord(adapter))
            .sectionExpanded,
          collapsedBranchKeys: [...keys],
        },
      });
    },
  };
}

function createItemActions(
  context: ActionContext,
): Pick<OpenItemsActions, "activate" | "setWhyOpen" | "pin" | "unpin"> {
  const { adapter, run, mutate, itemRef, pinItem } = context;
  return {
    activate: (activation) => run(() => adapter.activate(activation)),
    setWhyOpen: (entityId, entityType, note) =>
      mutate(() => {
        const ref = itemRef({
          entityId,
          entityType,
        });
        return adapter.mutate({
          kind: "setOpenItemNote",
          parameters: {
            ...ref,
            setOpenItemNoteRequest: {
              idempotencyKey: crypto.randomUUID(),

              note: note || null,
            },
          },
        });
      }),
    pin: (entityId, entityType) => pinItem({ entityId, entityType }, true),
    unpin: (entityId, entityType) => pinItem({ entityId, entityType }, false),
  };
}

function createRemovalActions(
  context: ActionContext,
): Pick<
  OpenItemsActions,
  | "remove"
  | "removeItems"
  | "removeOthers"
  | "removeAllAbove"
  | "removeAllBelow"
  | "removeAll"
> {
  const { adapter, mutate, removeMatching, removeItem, removeItems } = context;
  return {
    remove: (entityId, entityType) =>
      mutate(async () => {
        const identity = { entityId, entityType };
        if (
          currentRecord(adapter).items.some((item) =>
            matchesOpenItemIdentity(item, identity),
          )
        ) {
          await removeItem(identity, true);
        }
      }),
    removeItems: (identities, includeDescendants) =>
      mutate(() => removeItems(identities, includeDescendants)),
    removeOthers: (identity) =>
      removeMatching((items) =>
        selectBulkRemovalTargets(items, "others", identity),
      ),
    removeAllAbove: (identity) =>
      removeMatching((items) =>
        selectBulkRemovalTargets(items, "above", identity),
      ),
    removeAllBelow: (identity) =>
      removeMatching((items) =>
        selectBulkRemovalTargets(items, "below", identity),
      ),
    removeAll: () =>
      removeMatching((items) => selectBulkRemovalTargets(items, "all")),
  };
}

function createGroupActions(
  context: ActionContext,
): Pick<
  OpenItemsActions,
  | "createGroup"
  | "assignToGroup"
  | "ungroup"
  | "renameGroup"
  | "deleteGroup"
  | "setGroupExpanded"
> {
  const { adapter, mutate } = context;
  return {
    createGroup: (name, identities) =>
      mutate(() =>
        adapter.mutate({
          kind: "createOpenItemGroup",
          parameters: {
            createOpenItemGroupRequest: {
              idempotencyKey: crypto.randomUUID(),
              name: name.trim(),
              assign: identities.map((identity) => adapter.ref(identity)),
            },
          },
        }),
      ),
    assignToGroup: (groupId, identities) =>
      mutate(() =>
        adapter.mutate({
          kind: "assignOpenItemsToGroup",
          parameters: {
            groupId,
            assignOpenItemsToGroupRequest: {
              idempotencyKey: crypto.randomUUID(),
              items: identities.map((identity) => adapter.ref(identity)),
            },
          },
        }),
      ),
    ungroup: (identities) =>
      mutate(() =>
        adapter.mutate({
          kind: "ungroupOpenItems",
          parameters: {
            ungroupOpenItemsRequest: {
              idempotencyKey: crypto.randomUUID(),
              items: identities.map((identity) => adapter.ref(identity)),
            },
          },
        }),
      ),
    renameGroup: (groupId, name) =>
      mutate(() =>
        adapter.mutate({
          kind: "renameOpenItemGroup",
          parameters: {
            groupId,
            renameOpenItemGroupRequest: {
              idempotencyKey: crypto.randomUUID(),

              name: name.trim(),
            },
          },
        }),
      ),
    deleteGroup: (groupId) =>
      mutate(() =>
        adapter.mutate({
          kind: "deleteOpenItemGroup",
          parameters: {
            groupId,
            deleteOpenItemGroupRequest: {
              idempotencyKey: crypto.randomUUID(),
            },
          },
        }),
      ),
    setGroupExpanded: (groupId, expanded) =>
      mutate(() =>
        adapter.mutate({
          kind: "setOpenItemGroupDisclosure",
          parameters: {
            groupId,
            setOpenItemGroupDisclosureRequest: {
              idempotencyKey: crypto.randomUUID(),

              collapsed: !expanded,
            },
          },
        }),
      ),
  };
}

function createOrderingActions(
  context: ActionContext,
): Pick<OpenItemsActions, "moveItem" | "moveGroup"> {
  const { adapter, mutate } = context;
  return {
    moveItem: (identity, direction) =>
      mutate(async () => {
        const current = currentRecord(adapter).items;
        const selected = current.find((item) =>
          matchesOpenItemIdentity(item, identity),
        );
        if (!selected) throw new Error("Open Item is unavailable");
        const siblings = current
          .filter(
            (item) =>
              item.groupId === selected.groupId &&
              Boolean(item.pinned) === Boolean(selected.pinned),
          )
          .sort((a, b) => (a.firstAddedOrder ?? 0) - (b.firstAddedOrder ?? 0));
        const index = siblings.findIndex((item) =>
          matchesOpenItemIdentity(item, identity),
        );
        const offset =
          (direction === "up" ? -1 : 1) *
          (currentRecord(adapter).sortDirection === "newest" ? -1 : 1);
        if (index + offset < 0 || index + offset >= siblings.length) return;
        const afterItem = siblings[index + (offset < 0 ? -2 : 1)];
        const premise = adapter.ref(identity);
        const after = afterItem ? adapter.ref(afterItem) : null;
        const request = {
          idempotencyKey: crypto.randomUUID(),

          after: after
            ? { entityType: after.entityType, entityId: after.entityId }
            : null,
        };
        const ref = {
          entityType: premise.entityType,
          entityId: premise.entityId,
        };
        if (selected.groupId)
          await adapter.mutate({
            kind: "moveOpenItemGroupMember",
            parameters: {
              ...ref,
              groupId: selected.groupId,
              moveOpenItemGroupMemberRequest: request,
            },
          });
        else
          await adapter.mutate({
            kind: "moveOpenItem",
            parameters: { ...ref, moveOpenItemRequest: request },
          });
      }),
    moveGroup: (groupId, direction) =>
      mutate(async () => {
        const groups = currentRecord(adapter).groups;
        const index = groups.findIndex((group) => group.id === groupId);
        const offset = direction === "up" ? -1 : 1;
        if (index < 0 || index + offset < 0 || index + offset >= groups.length)
          return;
        await adapter.mutate({
          kind: "moveOpenItemGroup",
          parameters: {
            groupId,
            moveOpenItemGroupRequest: {
              idempotencyKey: crypto.randomUUID(),

              afterGroupId: groups[index + (offset < 0 ? -2 : 1)]?.id ?? null,
            },
          },
        });
      }),
  };
}

export function createOpenItemsActions(
  adapter: Adapter,
  refreshCanonical: () => Promise<void>,
  scoped: boolean,
): OpenItemsActions {
  const context = createActionContext(adapter, scoped);
  const refresh = () => context.run(refreshCanonical);
  return {
    refresh,
    retry: refresh,
    promoteGroupToGoal: (request) => {
      if (!scoped)
        return Promise.reject(new Error("Open Items scope is unavailable"));
      return adapter.promoteGroupToGoal(request);
    },
    setGoalFilter: (goalId, filter) =>
      context.mutate(() =>
        adapter.mutate({
          kind: "setOpenItemGoalFilter",
          parameters: {
            entityType: EntityType.Task,
            entityId: goalId,
            setOpenItemGoalFilterRequest: {
              idempotencyKey: crypto.randomUUID(),
              filter,
            },
          },
        }),
      ),
    setGoalExpanded: (goalId, expanded) =>
      context.mutate(() =>
        adapter.mutate({
          kind: "setOpenItemGoalDisclosure",
          parameters: {
            entityType: EntityType.Task,
            entityId: goalId,
            setOpenItemGoalDisclosureRequest: {
              idempotencyKey: crypto.randomUUID(),
              collapsed: !expanded,
            },
          },
        }),
      ),
    ...createPreferenceActions(context),
    ...createItemActions(context),
    ...createRemovalActions(context),
    ...createGroupActions(context),
    ...createOrderingActions(context),
  };
}
