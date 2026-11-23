import {
  EntityType,
  type OpenItem,
  type OpenItemPresentation,
  type OpenItemsTriageItem,
  type OpenItemsTriageSuggestion,
} from "../../api";
import type { TriageTarget } from "./application";
import {
  GROUP_MISSING_MESSAGE,
  OPEN_ITEMS_CAPACITY,
  OPEN_ITEMS_FULL_MESSAGE,
  decideGroup,
  decideRemove,
  decideReopen,
  itemKey,
  suggestionKeys,
} from "./decisions";

export type RowChange =
  | "unchanged"
  | "removed"
  | "grouped"
  | "ungrouped"
  | "reopened"
  | "tracked"
  | "promoted"
  | "goal";

export interface PreviewRow {
  key: string;
  title: string;
  entityType: string;
  pinned: boolean;
  groupName: string | null;
  change: RowChange;
  /** For a new group row or provisional Goal row. */
  provisional?: boolean;
  isGroup?: boolean;
  trackedOn?: string;
}

export interface PreviewRibbon {
  /** Index into `before`, or null for a row that had no earlier row. */
  from: number | null;
  /** Index into `after`, or null when the item ends in a ✕. */
  to: number | null;
  change: RowChange;
}

export interface PreviewWarning {
  suggestionId: string;
  itemKey: string | null;
  message: string;
}

/** The text marker every changed row carries alongside its colour. */
export type RowMarker =
  | { kind: "remove" }
  | { kind: "group" }
  | { kind: "ungrouped" }
  | { kind: "reopened" }
  | { kind: "promoteGroup" }
  | { kind: "goalLeaves" }
  | { kind: "tracked"; goal: string }
  | { kind: "newGroup"; count: number }
  | { kind: "pinnedGoal" };

export type FlowTone = "same" | "removed" | "moved" | "goal" | "new";

/** One drawn row in a column; folds stand for a run of unchanged items. */
export type LayoutRow =
  | {
      kind: "item";
      key: string;
      title: string;
      entityType: EntityType | "GROUP";
      /** The Open Items row's own presentation; null for rows Open Items has
       * no snapshot of yet (reopened items, new groups, provisional Goals). */
      presentation: OpenItemPresentation | null;
      depth: 0 | 1;
      change: RowChange;
      marker: RowMarker | null;
      isGroup: boolean;
      /** The suggestion that affects this row, for hover highlighting. */
      suggestionId: string | null;
    }
  | { kind: "fold"; key: string; count: number };

export interface LayoutFlow {
  /** Row index in `before`, or null for a row with no earlier row. */
  from: number | null;
  /** Row index in `after`, or null when the item ends in a ✕. */
  to: number | null;
  tone: FlowTone;
  /** The suggestion this ribbon belongs to, for hover highlighting. */
  suggestionId: string | null;
}

export interface PreviewLayout {
  before: LayoutRow[];
  after: LayoutRow[];
  flows: LayoutFlow[];
}

export interface TriagePreview {
  before: PreviewRow[];
  after: PreviewRow[];
  ribbons: PreviewRibbon[];
  /** The two columns as drawn, with unchanged runs folded in original order. */
  layout: PreviewLayout;
  unchangedCount: number;
  warnings: PreviewWarning[];
  /** Projected outcomes the existing reads cannot confirm; never counted as certain. */
  unverified: { suggestionId: string; message: string }[];
  totals: {
    before: number;
    after: number;
    groupsCreated: number;
    /** Items moved into groups this reply creates. */
    groupedIntoNew: number;
    /** Items leaving Open Items for good, not counting promoted members. */
    removed: number;
    goalsCreated: number;
    goalMembersLeaving: number;
    goalMembersUngrouped: number;
  };
}

interface ScratchRow {
  key: string;
  entityType: EntityType;
  entityId: string;
  title: string;
  presentation: OpenItemPresentation | null;
  groupId: string | null;
  pinned: boolean;
  lineage: Set<string>;
  trackedOn?: string;
  reopened?: boolean;
  goal?: boolean;
}

export interface ReplayInput {
  items: readonly OpenItem[];
  groups: readonly { groupId: string; name: string }[];
  suggestions: readonly OpenItemsTriageSuggestion[];
  /** Effective selection, in agent order, minus suggestions already applied. */
  selected: readonly string[];
  /** Suggestions still offered (not yet applied). Items of an offered but
   * unchecked suggestion stay drawn as plain rows instead of folding. */
  offered: ReadonlySet<string>;
  /** Per-reply baseline shared with Apply; absent means "as currently read". */
  baselineFor?: (
    suggestion: OpenItemsTriageSuggestion,
    item: OpenItemsTriageItem,
  ) => TriageTarget | undefined;
  /** Items whose work Apply already finished. */
  isCompleted?: (
    suggestion: OpenItemsTriageSuggestion,
    item: OpenItemsTriageItem,
  ) => boolean;
}

const newGroupId = (suggestionId: string) => `new-group:${suggestionId}`;
const newGoalId = (suggestionId: string) => `new-goal:${suggestionId}`;

const targetOf = (row: ScratchRow | undefined): TriageTarget => ({
  open: !!row,
  groupId: row?.groupId ?? null,
  pinned: row?.pinned ?? false,
});

/** Replays selected suggestions, in agent order, against the collection. */
export function replayTriage(input: ReplayInput): TriagePreview {
  const scratch = new Map<string, ScratchRow>();
  const order: string[] = [];
  const groupNames = new Map(input.groups.map((g) => [g.groupId, g.name]));
  const createdGroups = new Set<string>();
  const warnings: PreviewWarning[] = [];
  const removedKeys = new Set<string>();
  const addedGoals: ScratchRow[] = [];
  const unverified: { suggestionId: string; message: string }[] = [];
  const promotedKeys = new Set<string>();
  // In the same order as addedGoals, so each Goal row matches its group.
  const promotedGroups = new Set<string>();

  for (const row of input.items) {
    const key = itemKey(row);
    scratch.set(key, {
      key,
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.presentation.label,
      presentation: row.presentation,
      groupId: row.groupId,
      pinned: row.pinned,
      lineage: new Set(row.lineage.map(itemKey)),
    });
    order.push(key);
  }
  const original = new Map(
    [...scratch.entries()].map(([key, row]) => [key, { ...row }]),
  );
  const warn = (suggestionId: string, key: string | null, message: string) =>
    warnings.push({ suggestionId, itemKey: key, message });
  const descendantsOf = (rootKey: string) =>
    [...scratch.values()].filter(
      (row) => row.key !== rootKey && row.lineage.has(rootKey),
    );

  const owners = suggestionOwners(input);

  for (const suggestionId of input.selected) {
    const suggestion = input.suggestions.find(
      (s) => s.suggestionId === suggestionId,
    );
    if (!suggestion) {
      continue;
    }
    if (suggestion.kind === "promoteGroupToGoal") {
      promote(suggestion);
      continue;
    }
    for (const item of suggestion.items) {
      if (input.isCompleted?.(suggestion, item)) {
        continue;
      }
      const key = itemKey(item);
      const row = scratch.get(key);
      const current = targetOf(row);
      const baseline = input.baselineFor?.(suggestion, item) ?? current;
      switch (suggestion.kind) {
        case "removeOpenItems": {
          const decision = decideRemove(current, baseline);
          if (decision.kind === "conflict") {
            warn(suggestionId, key, decision.reason);
          } else if (decision.kind === "proceed" && row) {
            const rootGroup = row.groupId;
            const gone = [
              row,
              ...descendantsOf(key).filter(
                (d) =>
                  !d.pinned &&
                  (d.groupId === null ||
                    (rootGroup !== null && d.groupId === rootGroup)),
              ),
            ];
            for (const g of gone) {
              scratch.delete(g.key);
              removedKeys.add(g.key);
            }
          }
          break;
        }
        case "reopenItems": {
          const decision = decideReopen(current, scratch.size);
          if (decision.kind === "conflict") {
            warn(suggestionId, key, decision.reason);
          } else if (decision.kind === "proceed") {
            scratch.set(key, {
              key,
              entityType: item.entityType,
              entityId: item.entityId,
              title: item.title,
              presentation: null,
              groupId: null,
              pinned: false,
              lineage: new Set(),
              reopened: true,
            });
            removedKeys.delete(key);
          }
          break;
        }
        case "groupOpenItems": {
          const destination = suggestion.group;
          const existingId =
            destination.kind === "existingGroup" ? destination.groupId : null;
          const isExisting = existingId !== null;
          const targetId = existingId ?? newGroupId(suggestionId);
          const decision = decideGroup({
            current,
            baseline,
            targetId:
              isExisting || createdGroups.has(targetId) ? targetId : undefined,
            destinationMissing: isExisting && !groupNames.has(existingId),
          });
          if (decision.kind === "conflict") {
            warn(suggestionId, key, decision.reason);
          } else if (decision.kind === "proceed" && row) {
            owners.set(`group:${targetId}`, suggestionId);
            if (!isExisting && !createdGroups.has(targetId)) {
              createdGroups.add(targetId);
              groupNames.set(
                targetId,
                destination.kind === "newGroup" ? destination.newGroupName : "",
              );
            }
            row.groupId = targetId;
            for (const d of descendantsOf(key)) {
              d.groupId = targetId;
            }
          }
          break;
        }
        case "trackOnGoal": {
          if (row) {
            row.trackedOn =
              suggestion.goal.kind === "existingGoal"
                ? suggestion.goal.title
                : suggestion.goal.newGoal.name;
          } else {
            warn(suggestionId, key, "This item is not in Open Items.");
          }
          break;
        }
      }
    }
  }

  function promote(
    suggestion: Extract<
      OpenItemsTriageSuggestion,
      { kind: "promoteGroupToGoal" }
    >,
  ) {
    if (!groupNames.has(suggestion.groupId)) {
      warn(suggestion.suggestionId, null, GROUP_MISSING_MESSAGE);
      return;
    }
    const members = [...scratch.values()].filter(
      (row) => row.groupId === suggestion.groupId,
    );
    const eligible = new Set(suggestion.affectedMembers.map(itemKey));
    const leaving = members.filter((m) => eligible.has(m.key));
    if (scratch.size - leaving.length + 1 > OPEN_ITEMS_CAPACITY) {
      warn(suggestion.suggestionId, null, OPEN_ITEMS_FULL_MESSAGE);
      return;
    }
    for (const member of members) {
      if (eligible.has(member.key)) {
        scratch.delete(member.key);
        removedKeys.add(member.key);
        promotedKeys.add(member.key);
      } else {
        member.groupId = null;
      }
    }
    groupNames.delete(suggestion.groupId);
    promotedGroups.add(suggestion.groupId);
    owners.set(`group:${suggestion.groupId}`, suggestion.suggestionId);
    owners.set(newGoalId(suggestion.suggestionId), suggestion.suggestionId);
    unverified.push({
      suggestionId: suggestion.suggestionId,
      message: `Which members of "${suggestion.groupName}" can be tracked is confirmed when you apply.`,
    });
    addedGoals.push({
      key: newGoalId(suggestion.suggestionId),
      entityType: EntityType.Task,
      entityId: newGoalId(suggestion.suggestionId),
      title: suggestion.goalName,
      presentation: null,
      groupId: null,
      pinned: true,
      lineage: new Set(),
      goal: true,
    });
  }

  return buildPreview({
    input,
    original,
    scratch,
    order,
    groupNames,
    createdGroups,
    removedKeys,
    promotedKeys,
    promotedGroups,
    addedGoals,
    warnings,
    unverified,
    owners,
  });
}

/**
 * Which suggestion each item belongs to: the selected suggestion acting on it,
 * otherwise the first still-offered suggestion naming it.
 */
function suggestionOwners(input: ReplayInput): Map<string, string> {
  const owners = new Map<string, string>();
  const selected = new Set(input.selected);
  const claim = (suggestion: OpenItemsTriageSuggestion) => {
    for (const key of suggestionKeys(suggestion, input.items)) {
      if (!owners.has(key)) {
        owners.set(key, suggestion.suggestionId);
      }
    }
  };
  for (const id of input.selected) {
    const suggestion = input.suggestions.find((s) => s.suggestionId === id);
    if (suggestion) {
      claim(suggestion);
    }
  }
  for (const suggestion of input.suggestions) {
    if (
      !selected.has(suggestion.suggestionId) &&
      input.offered.has(suggestion.suggestionId)
    ) {
      claim(suggestion);
    }
  }
  return owners;
}

function buildPreview(args: {
  input: ReplayInput;
  original: Map<string, ScratchRow>;
  scratch: Map<string, ScratchRow>;
  order: string[];
  groupNames: Map<string, string>;
  createdGroups: Set<string>;
  removedKeys: Set<string>;
  promotedKeys: Set<string>;
  promotedGroups: Set<string>;
  addedGoals: ScratchRow[];
  warnings: PreviewWarning[];
  unverified: { suggestionId: string; message: string }[];
  owners: Map<string, string>;
}): TriagePreview {
  const { input, original, scratch, order, groupNames } = args;
  const nameOf = (id: string | null) =>
    id ? (groupNames.get(id) ?? null) : null;
  const originalGroupName = new Map(
    input.groups.map((g) => [g.groupId, g.name]),
  );

  const changeOf = (key: string): RowChange => {
    const before = original.get(key);
    const after = scratch.get(key);
    if (!after) {
      return args.promotedKeys.has(key) ? "promoted" : "removed";
    }
    if (!before) {
      return "reopened";
    }
    if (after.groupId !== before.groupId) {
      return after.groupId === null ? "ungrouped" : "grouped";
    }
    if (after.trackedOn) {
      return "tracked";
    }
    return "unchanged";
  };

  const reopened = [...scratch.keys()].filter((key) => !original.has(key));

  // Items of an offered but unchecked suggestion stay drawn, unchanged, so
  // hovering its card can point at them and toggling never reflows the list.
  const selectedSet = new Set(input.selected);
  const shownKeys = new Set<string>();
  for (const suggestion of input.suggestions) {
    if (
      selectedSet.has(suggestion.suggestionId) ||
      !input.offered.has(suggestion.suggestionId)
    ) {
      continue;
    }
    for (const key of suggestionKeys(suggestion, input.items)) {
      if (original.has(key)) {
        shownKeys.add(key);
      }
    }
  }

  const visibleKeys = order.filter(
    (key) => changeOf(key) !== "unchanged" || shownKeys.has(key),
  );
  const unchangedCount = order.length - visibleKeys.length;

  const toRow = (
    row: ScratchRow,
    groupName: string | null,
    change: RowChange,
  ): PreviewRow => ({
    key: row.key,
    title: row.title,
    entityType: row.entityType,
    pinned: row.pinned,
    groupName,
    change,
    trackedOn: row.trackedOn,
  });

  const before: PreviewRow[] = visibleKeys.map((key) => {
    const row = original.get(key)!;
    return toRow(
      row,
      originalGroupName.get(row.groupId ?? "") ?? null,
      changeOf(key),
    );
  });

  // Right column: new/changed group headers with their moved members beneath,
  // then other visible rows, then reopened rows and provisional Goals.
  const after: PreviewRow[] = [];
  const afterIndex = new Map<string, number>();
  const groupsShown = new Set<string>();
  const pushGroup = (groupId: string) => {
    if (groupsShown.has(groupId)) {
      return;
    }
    groupsShown.add(groupId);
    after.push({
      key: `group:${groupId}`,
      title: nameOf(groupId) ?? groupId,
      entityType: "GROUP",
      pinned: false,
      groupName: null,
      change: "grouped",
      isGroup: true,
      provisional: args.createdGroups.has(groupId),
    });
  };
  for (const key of visibleKeys) {
    const row = scratch.get(key);
    if (row?.groupId && changeOf(key) === "grouped") {
      pushGroup(row.groupId);
      afterIndex.set(key, after.length);
      after.push(toRow(row, nameOf(row.groupId), "grouped"));
    }
  }
  for (const key of [...visibleKeys, ...reopened]) {
    const row = scratch.get(key);
    if (row && !afterIndex.has(key)) {
      afterIndex.set(key, after.length);
      after.push(toRow(row, nameOf(row.groupId), changeOf(key)));
    }
  }
  for (const goal of args.addedGoals) {
    afterIndex.set(goal.key, after.length);
    after.push({ ...toRow(goal, null, "goal"), provisional: true });
  }

  const ribbons: PreviewRibbon[] = visibleKeys.map((key, from) => ({
    from,
    to: afterIndex.get(key) ?? null,
    change: changeOf(key),
  }));
  for (const key of reopened) {
    ribbons.push({
      from: null,
      to: afterIndex.get(key) ?? null,
      change: "reopened",
    });
  }
  for (const goal of args.addedGoals) {
    ribbons.push({
      from: null,
      to: afterIndex.get(goal.key) ?? null,
      change: "goal",
    });
  }

  const removed = [...args.removedKeys].filter(
    (key) => original.has(key) && !args.promotedKeys.has(key),
  ).length;
  const groupedIntoNew = [...scratch.values()].filter((row) =>
    args.createdGroups.has(row.groupId ?? ""),
  ).length;
  const goalMembersUngrouped = order.filter(
    (key) => changeOf(key) === "ungrouped",
  ).length;

  return {
    before,
    after,
    ribbons,
    layout: buildLayout({
      original,
      scratch,
      order,
      originalGroupName,
      groupNames,
      createdGroups: args.createdGroups,
      promotedGroups: args.promotedGroups,
      addedGoals: args.addedGoals,
      reopened,
      shownKeys,
      owners: args.owners,
      changeOf,
    }),
    unchangedCount,
    warnings: args.warnings,
    unverified: args.unverified,
    totals: {
      before: order.length,
      after: scratch.size + args.addedGoals.length,
      groupsCreated: args.createdGroups.size,
      groupedIntoNew,
      removed,
      goalsCreated: args.addedGoals.length,
      goalMembersLeaving: args.promotedKeys.size,
      goalMembersUngrouped,
    },
  };
}

/**
 * Lays both columns out row by row. Unchanged runs fold into one row at the
 * same place on both sides, so the before and after columns stay in original
 * Open Items order and every ribbon joins two fixed-height rows.
 */
function buildLayout(args: {
  original: Map<string, ScratchRow>;
  scratch: Map<string, ScratchRow>;
  order: string[];
  originalGroupName: Map<string, string>;
  groupNames: Map<string, string>;
  createdGroups: Set<string>;
  promotedGroups: Set<string>;
  addedGoals: ScratchRow[];
  reopened: string[];
  shownKeys: Set<string>;
  owners: Map<string, string>;
  changeOf: (key: string) => RowChange;
}): PreviewLayout {
  const { original, scratch, order, changeOf, shownKeys, owners } = args;
  const ownerOf = (key: string) => owners.get(key) ?? null;
  const before: LayoutRow[] = [];
  const after: LayoutRow[] = [];
  const flows: LayoutFlow[] = [];
  const beforeIndex = new Map<string, number>();
  const afterIndex = new Map<string, number>();

  const isVisible = (key: string) =>
    changeOf(key) !== "unchanged" || shownKeys.has(key);

  // Pinned provisional Goals lead the right column, as Goals pin first.
  for (const goal of args.addedGoals) {
    after.push({
      kind: "item",
      key: goal.key,
      title: goal.title,
      entityType: goal.entityType,
      presentation: goalPresentation(goal.title),
      depth: 0,
      change: "goal",
      marker: { kind: "pinnedGoal" },
      isGroup: false,
      suggestionId: ownerOf(goal.key),
    });
  }
  const goalIndexFor = (groupId: string) =>
    [...args.promotedGroups].indexOf(groupId);

  // Original structure: each group's members sit together under its header.
  const units: { groupId: string | null; keys: string[] }[] = [];
  const unitOf = new Map<string, { groupId: string | null; keys: string[] }>();
  for (const key of order) {
    const groupId = original.get(key)!.groupId;
    if (groupId === null) {
      units.push({ groupId: null, keys: [key] });
      continue;
    }
    const existing = unitOf.get(groupId);
    if (existing) {
      existing.keys.push(key);
      continue;
    }
    const unit = { groupId, keys: [key] };
    unitOf.set(groupId, unit);
    units.push(unit);
  }

  let run = 0;
  const flushFold = () => {
    if (run === 0) {
      return;
    }
    // Two unchanged runs with nothing drawn between them read as one run.
    const lastBefore = before.at(-1);
    const lastAfter = after.at(-1);
    if (lastBefore?.kind === "fold" && lastAfter?.kind === "fold") {
      lastBefore.count += run;
      if (lastAfter !== lastBefore) {
        lastAfter.count += run;
      }
      run = 0;
      return;
    }
    const key = `fold:${before.length}`;
    flows.push({
      from: before.length,
      to: after.length,
      tone: "same",
      suggestionId: null,
    });
    before.push({ kind: "fold", key, count: run });
    after.push({ kind: "fold", key, count: run });
    run = 0;
  };

  const markerBefore = (key: string): RowMarker | null => {
    switch (changeOf(key)) {
      case "removed":
        return { kind: "remove" };
      case "promoted":
        return { kind: "goalLeaves" };
      case "grouped":
        return { kind: "group" };
      case "ungrouped":
        return { kind: "ungrouped" };
      case "tracked":
        return { kind: "tracked", goal: scratch.get(key)!.trackedOn! };
      default:
        return null;
    }
  };

  const itemRow = (
    row: ScratchRow,
    depth: 0 | 1,
    change: RowChange,
    marker: RowMarker | null,
  ): LayoutRow => ({
    kind: "item",
    key: row.key,
    title: row.title,
    entityType: row.entityType,
    presentation: row.presentation,
    depth,
    change,
    marker,
    isGroup: false,
    suggestionId: ownerOf(row.key),
  });

  const shownAfterGroups = new Set<string>();
  const pushAfterGroupHeader = (groupId: string) => {
    if (shownAfterGroups.has(groupId)) {
      return;
    }
    shownAfterGroups.add(groupId);
    const isNew = args.createdGroups.has(groupId);
    const count = [...scratch.values()].filter(
      (r) => r.groupId === groupId,
    ).length;
    afterIndex.set(`group:${groupId}`, after.length);
    after.push({
      kind: "item",
      key: `group:${groupId}`,
      title: args.groupNames.get(groupId) ?? "",
      entityType: "GROUP",
      presentation: null,
      depth: 0,
      change: isNew ? "grouped" : "unchanged",
      marker: isNew ? { kind: "newGroup", count } : null,
      isGroup: true,
      suggestionId: ownerOf(`group:${groupId}`),
    });
    if (isNew) {
      flows.push({
        from: null,
        to: afterIndex.get(`group:${groupId}`)!,
        tone: "new",
        suggestionId: ownerOf(`group:${groupId}`),
      });
    }
    // Everything moving into this group converges here, in original order.
    for (const key of [...order, ...args.reopened]) {
      const row = scratch.get(key);
      if (row?.groupId !== groupId || afterIndex.has(key)) {
        continue;
      }
      if (!isVisible(key) && args.original.has(key)) {
        continue;
      }
      afterIndex.set(key, after.length);
      after.push(
        itemRow(
          row,
          1,
          changeOf(key),
          changeOf(key) === "tracked"
            ? { kind: "tracked", goal: row.trackedOn! }
            : null,
        ),
      );
    }
  };

  const placeAfter = (key: string) => {
    const row = scratch.get(key);
    if (!row || afterIndex.has(key)) {
      return;
    }
    if (row.groupId !== null) {
      pushAfterGroupHeader(row.groupId);
      return;
    }
    const change = changeOf(key);
    afterIndex.set(key, after.length);
    after.push(
      itemRow(
        row,
        0,
        change,
        change === "ungrouped"
          ? { kind: "ungrouped" }
          : change === "tracked"
            ? { kind: "tracked", goal: row.trackedOn! }
            : change === "reopened"
              ? { kind: "reopened" }
              : null,
      ),
    );
  };

  for (const unit of units) {
    const visibleKeys = unit.keys.filter(isVisible);
    const promoted =
      unit.groupId !== null && args.promotedGroups.has(unit.groupId);
    if (visibleKeys.length === 0 && !promoted) {
      run += unit.keys.length;
      continue;
    }
    flushFold();
    if (unit.groupId !== null) {
      const headerKey = `group:${unit.groupId}`;
      beforeIndex.set(headerKey, before.length);
      before.push({
        kind: "item",
        key: headerKey,
        title: args.originalGroupName.get(unit.groupId) ?? "",
        entityType: "GROUP",
        presentation: null,
        depth: 0,
        change: promoted ? "promoted" : "unchanged",
        marker: promoted ? { kind: "promoteGroup" } : null,
        isGroup: true,
        suggestionId: promoted ? ownerOf(headerKey) : null,
      });
    }
    for (const key of unit.keys) {
      if (!isVisible(key)) {
        run += 1;
        continue;
      }
      flushFold();
      beforeIndex.set(key, before.length);
      before.push(
        itemRow(
          original.get(key)!,
          unit.groupId === null ? 0 : 1,
          changeOf(key),
          markerBefore(key),
        ),
      );
      placeAfter(key);
    }
    const headerKey = `group:${unit.groupId}`;
    if (unit.groupId !== null && !promoted && afterIndex.has(headerKey)) {
      // A group that still exists keeps its header joined across.
      flows.push({
        from: beforeIndex.get(headerKey)!,
        to: afterIndex.get(headerKey)!,
        tone: "same",
        suggestionId: null,
      });
    }
  }

  // Reopened items sit before the last fold.
  const trailing = run;
  run = 0;
  for (const key of args.reopened) {
    placeAfter(key);
  }
  for (const key of args.reopened) {
    const to = afterIndex.get(key);
    if (to !== undefined) {
      flows.push({ from: null, to, tone: "new", suggestionId: ownerOf(key) });
    }
  }
  run = trailing;
  flushFold();

  // Item ribbons: each before row to where it ends up.
  for (const [key, from] of beforeIndex) {
    if (key.startsWith("group:")) {
      const groupId = key.slice("group:".length);
      if (args.promotedGroups.has(groupId)) {
        flows.push({
          from,
          to: goalIndexFor(groupId),
          tone: "goal",
          suggestionId: ownerOf(key),
        });
      }
      continue;
    }
    const change = changeOf(key);
    if (change === "promoted") {
      const groupId = original.get(key)!.groupId!;
      flows.push({
        from,
        to: goalIndexFor(groupId),
        tone: "goal",
        suggestionId: ownerOf(key),
      });
      continue;
    }
    const to = afterIndex.get(key) ?? null;
    flows.push({
      from,
      to,
      tone:
        change === "removed"
          ? "removed"
          : change === "grouped" || change === "ungrouped"
            ? "moved"
            : change === "tracked"
              ? "goal"
              : "same",
      suggestionId: ownerOf(key),
    });
  }

  return { before, after, flows };
}

/** A provisional Goal is drawn with the Goal icon Open Items uses for Goals. */
const goalPresentation = (label: string): OpenItemPresentation => ({
  label,
  workItemTypeKey: "GOAL",
  routeParams: { workItemRoute: "goal" },
});
