import {
  openItemKey,
  openItemTitle,
  type OpenItem,
  type OpenItemGroup,
  type OpenItemsSortDirection,
} from "../../contexts/openItemsModel";

export interface ProjectedOpenItem {
  depth: number;
  group: "pinned" | "unpinned";
  groupId?: string;
  item: OpenItem;
  sourceIndex: number;
}

type IndexedOpenItem = {
  item: OpenItem;
  sourceIndex: number;
};

export interface ProjectOpenItemsInstrumentation {
  onSubtreeRankComputed?: (key: string) => void;
}

const visibleLineageParentKeys = (
  item: OpenItem,
  itemByKey: ReadonlyMap<string, OpenItem>,
): string[] => {
  const key = openItemKey(item);
  const candidates = (item.lineage ?? [])
    .slice()
    .reverse()
    .map((entry) => `${entry.entityType}:${entry.entityId}`)
    .filter((candidate) => candidate !== key && itemByKey.has(candidate));
  return candidates;
};

const wouldCreateCycle = (
  childKey: string,
  parentKey: string,
  parentByKey: ReadonlyMap<string, string>,
): boolean => {
  let current: string | undefined = parentKey;
  const visited = new Set<string>();
  while (current) {
    if (current === childKey) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = parentByKey.get(current);
  }
  return false;
};

const projectOpenItemGroup = (
  entries: IndexedOpenItem[],
  group: ProjectedOpenItem["group"],
  sortDirection: OpenItemsSortDirection,
  groupId?: string,
  instrumentation?: ProjectOpenItemsInstrumentation,
): ProjectedOpenItem[] => {
  const items = entries.map(({ item }) => item);
  const itemByKey = new Map(items.map((item) => [openItemKey(item), item]));
  const sourceIndexByKey = new Map(
    entries.map(({ item, sourceIndex }) => [openItemKey(item), sourceIndex]),
  );
  const orderRankByKey = new Map(
    entries.map(({ item, sourceIndex }) => [
      openItemKey(item),
      item.firstAddedOrder ?? sourceIndex + 1,
    ]),
  );
  const parentByKey = new Map<string, string>();

  for (const item of items) {
    const key = openItemKey(item);
    const candidates = visibleLineageParentKeys(item, itemByKey);
    const parentKey = candidates.find(
      (candidate) => !wouldCreateCycle(key, candidate, parentByKey),
    );
    if (parentKey) parentByKey.set(key, parentKey);

    // A descendant's lineage can also reveal the relationship between two
    // visible ancestors whose own persisted entries carry no lineage.
    for (let index = 0; index < candidates.length - 1; index += 1) {
      const childKey = candidates[index]!;
      const ancestorKey = candidates[index + 1]!;
      if (
        !parentByKey.has(childKey) &&
        !wouldCreateCycle(childKey, ancestorKey, parentByKey)
      ) {
        parentByKey.set(childKey, ancestorKey);
      }
    }
  }

  const childrenByKey = new Map<string, string[]>();
  for (const [childKey, parentKey] of parentByKey) {
    const children = childrenByKey.get(parentKey) ?? [];
    children.push(childKey);
    childrenByKey.set(parentKey, children);
  }

  const subtreeRankByKey = new Map<string, number>();
  const computeSubtreeRank = (
    key: string,
    visiting = new Set<string>(),
  ): number => {
    const cached = subtreeRankByKey.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return orderRankByKey.get(key) ?? items.length;
    visiting.add(key);
    const descendantRanks = (childrenByKey.get(key) ?? []).map((childKey) =>
      computeSubtreeRank(childKey, visiting),
    );
    visiting.delete(key);
    const rank =
      sortDirection === "oldest"
        ? Math.min(orderRankByKey.get(key) ?? items.length, ...descendantRanks)
        : Math.max(orderRankByKey.get(key) ?? 0, ...descendantRanks);
    subtreeRankByKey.set(key, rank);
    instrumentation?.onSubtreeRankComputed?.(key);
    return rank;
  };
  items.forEach((item) => computeSubtreeRank(openItemKey(item)));

  const direction = sortDirection === "oldest" ? 1 : -1;
  const sortByBranchOrder = (left: string, right: string): number =>
    direction *
      ((subtreeRankByKey.get(left) ?? items.length) -
        (subtreeRankByKey.get(right) ?? items.length)) ||
    direction *
      ((orderRankByKey.get(left) ?? 0) - (orderRankByKey.get(right) ?? 0)) ||
    direction *
      ((sourceIndexByKey.get(left) ?? 0) -
        (sourceIndexByKey.get(right) ?? 0)) ||
    left.localeCompare(right);

  const roots = items
    .map(openItemKey)
    .filter((key) => !parentByKey.has(key))
    .sort(sortByBranchOrder);
  const projected: ProjectedOpenItem[] = [];
  const emitted = new Set<string>();
  const append = (key: string, depth: number) => {
    if (emitted.has(key)) return;
    const item = itemByKey.get(key);
    const sourceIndex = sourceIndexByKey.get(key);
    if (!item || sourceIndex === undefined) return;
    emitted.add(key);
    projected.push({ depth, group, groupId, item, sourceIndex });
    [...(childrenByKey.get(key) ?? [])]
      .sort(sortByBranchOrder)
      .forEach((childKey) => append(childKey, depth + 1));
  };

  roots.forEach((key) => append(key, 0));
  items.forEach((item) => append(openItemKey(item), 0));
  return projected;
};

export const projectOpenItems = (
  items: OpenItem[],
  sortDirectionOrInstrumentation:
    OpenItemsSortDirection | ProjectOpenItemsInstrumentation = "oldest",
  instrumentation?: ProjectOpenItemsInstrumentation,
  groups: readonly OpenItemGroup[] = [],
): ProjectedOpenItem[] => {
  const sortDirection =
    typeof sortDirectionOrInstrumentation === "string"
      ? sortDirectionOrInstrumentation
      : "oldest";
  const resolvedInstrumentation =
    typeof sortDirectionOrInstrumentation === "string"
      ? instrumentation
      : sortDirectionOrInstrumentation;
  const entries = items.map((item, sourceIndex) => ({ item, sourceIndex }));
  const groupIds = new Set(groups.map((group) => group.id));
  const buckets: Array<{ id?: string; entries: IndexedOpenItem[] }> = [
    ...groups.map((group) => ({
      id: group.id,
      entries: entries.filter(({ item }) => item.groupId === group.id),
    })),
    {
      entries: entries.filter(
        ({ item }) => !item.groupId || !groupIds.has(item.groupId),
      ),
    },
  ];
  return buckets.flatMap(({ id, entries: bucketEntries }) => {
    const pinned = bucketEntries.filter(({ item }) => item.pinned === true);
    const unpinned = bucketEntries.filter(({ item }) => item.pinned !== true);
    return [
      ...projectOpenItemGroup(
        pinned,
        "pinned",
        sortDirection,
        id,
        resolvedInstrumentation,
      ),
      ...projectOpenItemGroup(
        unpinned,
        "unpinned",
        sortDirection,
        id,
        resolvedInstrumentation,
      ),
    ];
  });
};

export const expandableProjectedOpenItemKeys = (
  projectedItems: ProjectedOpenItem[],
): ReadonlySet<string> => {
  const expandableKeys = new Set<string>();

  projectedItems.forEach(({ item, depth }, index) => {
    if (projectedItems[index + 1]?.depth > depth) {
      expandableKeys.add(openItemKey(item));
    }
  });

  return expandableKeys;
};

export const collapseProjectedOpenItems = (
  projectedItems: ProjectedOpenItem[],
  collapsedKeys: ReadonlySet<string>,
): ProjectedOpenItem[] => {
  if (collapsedKeys.size === 0) return projectedItems;

  const collapsedDepths: number[] = [];
  const visible: ProjectedOpenItem[] = [];

  for (const projectedItem of projectedItems) {
    while (
      collapsedDepths.length > 0 &&
      collapsedDepths[collapsedDepths.length - 1]! >= projectedItem.depth
    ) {
      collapsedDepths.pop();
    }

    if (collapsedDepths.length > 0) continue;

    visible.push(projectedItem);
    if (collapsedKeys.has(openItemKey(projectedItem.item))) {
      collapsedDepths.push(projectedItem.depth);
    }
  }

  return visible;
};

export const filterProjectedOpenItems = (
  projectedItems: ProjectedOpenItem[],
  query: string,
): ProjectedOpenItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return projectedItems;

  const itemByKey = new Map(
    projectedItems.map(({ item }) => [openItemKey(item), item]),
  );
  const visibleKeys = new Set<string>();

  for (const { item } of projectedItems) {
    if (!openItemTitle(item).toLocaleLowerCase().includes(normalizedQuery)) {
      continue;
    }

    visibleKeys.add(openItemKey(item));
    for (const lineageEntry of (item.lineage ?? []).slice().reverse()) {
      const ancestorKey = `${lineageEntry.entityType}:${lineageEntry.entityId}`;
      if (itemByKey.has(ancestorKey)) visibleKeys.add(ancestorKey);
    }
  }

  return projectedItems.filter(({ item }) =>
    visibleKeys.has(openItemKey(item)),
  );
};

/**
 * Keeps active sessions and the lineage above them. Rows are pre-order with
 * depths, so a reverse scan visits every row after its descendants:
 * visible(row) = isSession(row) ? isActive(row) : row.children.some(visible).
 * The hidden count comes from the same pass so it always matches the removals.
 */
export const filterProjectedOpenItemsByActivity = (
  projectedItems: ProjectedOpenItem[],
  isActiveSession: (item: OpenItem) => boolean,
): { items: ProjectedOpenItem[]; hiddenCount: number } => {
  const visibleAtDepth: boolean[] = [];
  const visible: ProjectedOpenItem[] = [];
  let hiddenCount = 0;

  for (let index = projectedItems.length - 1; index >= 0; index -= 1) {
    const projectedItem = projectedItems[index]!;
    const { depth, item } = projectedItem;
    const hasVisibleDescendant = visibleAtDepth.slice(depth + 1).some(Boolean);
    visibleAtDepth.length = Math.min(visibleAtDepth.length, depth + 1);
    const isVisible =
      item.entityType === "agent_session"
        ? isActiveSession(item)
        : hasVisibleDescendant;
    visibleAtDepth[depth] = (visibleAtDepth[depth] ?? false) || isVisible;
    if (isVisible) visible.push(projectedItem);
    else hiddenCount += 1;
  }

  return { items: visible.reverse(), hiddenCount };
};
