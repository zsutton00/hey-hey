import {
  AgentSessionType,
  type OpenItemGoalTrackedWorkFilter,
} from "@hey-hey/ui-common/api";
import type {
  EntityActivation,
  EntityActivationType,
} from "@hey-hey/ui-common/context";
import type {
  NavigationLineage,
  NavigationLineageEntry,
} from "@hey-hey/ui-common";

export interface OpenItem extends Omit<EntityActivation, "lineage"> {
  title?: string;
  lineage?: NavigationLineage;
  whyOpen?: string;
  pinned?: boolean;
  firstAddedOrder?: number;
  groupId?: string;
  goalTrackedWorkFilter?: OpenItemGoalTrackedWorkFilter;
  goalCollapsed?: boolean;
}

export interface OpenItemGroup {
  id: string;
  name: string;
  order: number;
  collapsed: boolean;
}

export type OpenItemActivation = EntityActivation;

export interface OpenItemIdentity {
  entityId: string;
  entityType: EntityActivationType;
}

export type OpenItemsSortDirection = "oldest" | "newest";

export const openItemKey = (item: OpenItemIdentity): string =>
  `${item.entityType}:${item.entityId}`;

const OPEN_ITEM_GENERIC_TITLES: Record<OpenItem["entityType"], string> = {
  initiative: "Initiative",
  task: "Task",
  goal: "Goal",
  conversation: "Conversation",
  design_doc: "Design doc",
  agent_session: "Agent session",
  plan: "Plan",
  proposal: "Proposal",
};

const genericOpenItemTitle = (entityType: OpenItem["entityType"]): string =>
  OPEN_ITEM_GENERIC_TITLES[entityType];

export const openItemTitle = (
  item: Pick<OpenItem, "entityType" | "title" | "presentation">,
): string =>
  item.presentation?.label?.trim() ||
  item.title?.trim() ||
  genericOpenItemTitle(item.entityType);

export const matchesOpenItemIdentity = (
  item: Pick<OpenItem, "entityId" | "entityType">,
  identity: OpenItemIdentity | null | undefined,
): boolean =>
  identity !== null &&
  identity !== undefined &&
  item.entityId === identity.entityId &&
  item.entityType === identity.entityType;

/** Bulk removals larger than this require confirmation. */
export const BULK_REMOVAL_CONFIRM_THRESHOLD = 5;

export type BulkRemovalScope = "others" | "above" | "below" | "all";

/** Items a bulk removal command removes, in the order shown. */
export const selectBulkRemovalTargets = (
  items: OpenItem[],
  scope: BulkRemovalScope,
  identity?: OpenItemIdentity,
): OpenItem[] => {
  if (scope === "all") return items;
  if (scope === "others")
    return items.filter((item) => !matchesOpenItemIdentity(item, identity));
  const index = items.findIndex((item) =>
    matchesOpenItemIdentity(item, identity),
  );
  if (index < 0) return [];
  return scope === "above" ? items.slice(0, index) : items.slice(index + 1);
};

const openItemBranchKeys = (
  items: OpenItem[],
  branchRoots: readonly OpenItemIdentity[],
): Set<string> => {
  const itemByKey = new Map(items.map((item) => [openItemKey(item), item]));
  const parentByKey = new Map<string, string>();

  // A lineage can reveal relationships between visible ancestors that do not
  // carry lineage themselves. For example, a session lineage can establish
  // both session -> task and task -> plan.
  for (const item of items) {
    const visibleLineageKeys = (item.lineage ?? [])
      .map((entry) => `${entry.entityType}:${entry.entityId}`)
      .filter((key) => itemByKey.has(key));
    const itemKey = openItemKey(item);
    const nearestVisibleAncestor = visibleLineageKeys.at(-1);
    if (nearestVisibleAncestor && nearestVisibleAncestor !== itemKey) {
      parentByKey.set(itemKey, nearestVisibleAncestor);
    }
    for (let index = 1; index < visibleLineageKeys.length; index += 1) {
      const childKey = visibleLineageKeys[index]!;
      const parentKey = visibleLineageKeys[index - 1]!;
      if (childKey !== parentKey && !parentByKey.has(childKey)) {
        parentByKey.set(childKey, parentKey);
      }
    }
  }

  const branchKeys = new Set(branchRoots.map(openItemKey));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [childKey, parentKey] of parentByKey) {
      if (branchKeys.has(parentKey) && !branchKeys.has(childKey)) {
        branchKeys.add(childKey);
        changed = true;
      }
    }
  }

  return branchKeys;
};

export const removeOpenItemBranch = (
  items: OpenItem[],
  branchRoot: OpenItemIdentity,
): OpenItem[] => {
  const branchKeys = openItemBranchKeys(items, [branchRoot]);
  const rootKey = openItemKey(branchRoot);
  const rootGroupId = items.find((item) =>
    matchesOpenItemIdentity(item, branchRoot),
  )?.groupId;

  return items.filter((item) => {
    const itemKey = openItemKey(item);
    return (
      !branchKeys.has(itemKey) ||
      (itemKey !== rootKey &&
        (item.pinned === true ||
          (item.groupId !== undefined && item.groupId !== rootGroupId)))
    );
  });
};

const lineageEquals = (
  left: NavigationLineage | null | undefined,
  right: NavigationLineage | null | undefined,
): boolean => {
  if (left === right || (!left && !right)) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (entry, index) =>
      entry.entityType === right[index]?.entityType &&
      entry.entityId === right[index]?.entityId,
  );
};

const openItemEquals = (left: OpenItem, right: OpenItem): boolean =>
  left.entityId === right.entityId &&
  left.entityType === right.entityType &&
  left.title === right.title &&
  lineageEquals(left.lineage, right.lineage) &&
  JSON.stringify(left.presentation) === JSON.stringify(right.presentation) &&
  left.whyOpen === right.whyOpen &&
  (left.pinned ?? false) === (right.pinned ?? false) &&
  left.firstAddedOrder === right.firstAddedOrder &&
  left.groupId === right.groupId &&
  left.goalTrackedWorkFilter === right.goalTrackedWorkFilter &&
  left.goalCollapsed === right.goalCollapsed;

const openItemsEqual = (left: OpenItem[], right: OpenItem[]): boolean =>
  left.length === right.length &&
  left.every((item, index) => openItemEquals(item, right[index]));

export const lineageEntityId = (
  lineage: NavigationLineage | null | undefined,
  entityType: NavigationLineageEntry["entityType"],
): string | undefined =>
  lineage
    ?.slice()
    .reverse()
    .find((entry) => entry.entityType === entityType)?.entityId;

/**
 * Activations keep the working set flat. New coding sessions inherit the
 * nearest visible ancestor's group; nesting and ordering stay in projection.
 */
export const upsertOpenItem = (
  items: OpenItem[],
  activation: OpenItemActivation,
): OpenItem[] => {
  const existing = items.find((item) =>
    matchesOpenItemIdentity(item, activation),
  );
  if (existing) {
    const nextItem: OpenItem = {
      ...existing,
      ...(activation.lineage ? { lineage: activation.lineage } : {}),
      ...(activation.presentation
        ? { presentation: activation.presentation }
        : {}),
    };
    const next = items.map((item) =>
      matchesOpenItemIdentity(item, activation) ? nextItem : item,
    );
    return openItemsEqual(items, next) ? items : next;
  }

  const nextFirstAddedOrder =
    Math.max(items.length, ...items.map((item) => item.firstAddedOrder ?? 0)) +
    1;
  const itemByKey = new Map(items.map((item) => [openItemKey(item), item]));
  const nearestOpenAncestor =
    activation.entityType === "agent_session" &&
    activation.presentation?.kind === "agent_session" &&
    activation.presentation.sessionType === AgentSessionType.Coding
      ? activation.lineage
          ?.slice()
          .reverse()
          .find((entry) =>
            itemByKey.has(`${entry.entityType}:${entry.entityId}`),
          )
      : undefined;
  const inheritedGroupId = nearestOpenAncestor
    ? itemByKey.get(
        `${nearestOpenAncestor.entityType}:${nearestOpenAncestor.entityId}`,
      )?.groupId
    : undefined;

  return [
    ...items,
    {
      entityId: activation.entityId,
      entityType: activation.entityType,
      firstAddedOrder: nextFirstAddedOrder,
      ...(activation.lineage ? { lineage: activation.lineage } : {}),
      ...(activation.presentation
        ? { presentation: activation.presentation }
        : {}),
      ...(inheritedGroupId === undefined ? {} : { groupId: inheritedGroupId }),
    },
  ];
};
