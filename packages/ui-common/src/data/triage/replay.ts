import type {
  OpenItem,
  OpenItemsTriageItem,
  OpenItemsTriageSuggestion,
} from "../../api";
import type { TriageTarget } from "./application";
import {
  GROUP_MISSING_MESSAGE,
  OPEN_ITEMS_CAPACITY,
  OPEN_ITEMS_FULL_MESSAGE,
  decideGroup,
  decideRemove,
  decideReopen,
} from "./decisions";

export const itemKey = (item: { entityType: string; entityId: string }) =>
  `${item.entityType}:${item.entityId}`;

/** Every item a suggestion names, plus a promoted group's current members. */
export function suggestionItems(
  suggestion: OpenItemsTriageSuggestion,
): OpenItemsTriageItem[] {
  return suggestion.kind === "promoteGroupToGoal"
    ? suggestion.affectedMembers
    : suggestion.items;
}

/** Keys an accepted suggestion occupies, including a promoted group's live members. */
export function suggestionKeys(
  suggestion: OpenItemsTriageSuggestion,
  items: readonly OpenItem[],
): Set<string> {
  const keys = new Set(suggestionItems(suggestion).map(itemKey));
  if (suggestion.kind === "promoteGroupToGoal") {
    for (const row of items) {
      if (row.groupId === suggestion.groupId) {
        keys.add(itemKey(row));
      }
    }
  }
  return keys;
}

export interface SuggestionBlock {
  /** The accepted suggestion that holds the shared item. */
  blockedBy: string;
  item: OpenItemsTriageItem | { entityType: string; entityId: string };
  itemTitle: string;
}

/**
 * Which suggestions cannot be accepted because an earlier accepted suggestion
 * already holds one of their items. An existing acceptance always wins, so a
 * live membership change never evicts an earlier choice.
 */
export function resolveSelection(
  suggestions: readonly OpenItemsTriageSuggestion[],
  accepted: ReadonlySet<string>,
  items: readonly OpenItem[],
): { accepted: string[]; blocked: Map<string, SuggestionBlock> } {
  const held = new Map<string, string>();
  const effective: string[] = [];
  const blocked = new Map<string, SuggestionBlock>();
  const titles = new Map<string, string>();
  for (const suggestion of suggestions) {
    for (const item of suggestionItems(suggestion)) {
      titles.set(itemKey(item), item.title);
    }
  }
  for (const row of items) {
    titles.set(
      itemKey(row),
      titles.get(itemKey(row)) ?? row.presentation.label,
    );
  }
  const ownKeys = (suggestion: OpenItemsTriageSuggestion) =>
    suggestionKeys(suggestion, items);
  // Accepted suggestions are processed first, in reply order, so a competing
  // unaccepted card is judged against everything accepted.
  for (const suggestion of suggestions) {
    if (!accepted.has(suggestion.suggestionId)) {
      continue;
    }
    const conflict = [...ownKeys(suggestion)].find((key) => held.has(key));
    if (conflict) {
      blocked.set(suggestion.suggestionId, {
        blockedBy: held.get(conflict)!,
        item: { entityType: conflict.split(":")[0], entityId: conflict },
        itemTitle: titles.get(conflict) ?? conflict,
      });
      continue;
    }
    effective.push(suggestion.suggestionId);
    for (const key of ownKeys(suggestion)) {
      held.set(key, suggestion.suggestionId);
    }
  }
  for (const suggestion of suggestions) {
    if (accepted.has(suggestion.suggestionId)) {
      continue;
    }
    const conflict = [...ownKeys(suggestion)].find((key) => held.has(key));
    if (conflict) {
      blocked.set(suggestion.suggestionId, {
        blockedBy: held.get(conflict)!,
        item: { entityType: conflict.split(":")[0], entityId: conflict },
        itemTitle: titles.get(conflict) ?? conflict,
      });
    }
  }
  return { accepted: effective, blocked };
}

export type RowChange =
  | "unchanged"
  | "removed"
  | "grouped"
  | "ungrouped"
  | "reopened"
  | "tracked"
  | "promoted"
  | "goal"
  | "pending";

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
  /** For a not-accepted suggestion, e.g. "Remove? not accepted". */
  note?: string;
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
  | { kind: "pinnedGoal" }
  | { kind: "pending"; verb: OpenItemsTriageSuggestion["kind"] };

export type FlowTone =
  "same" | "removed" | "moved" | "goal" | "new" | "pending";

/** One drawn row in a column; folds stand for a run of unchanged items. */
export type LayoutRow =
  | {
      kind: "item";
      key: string;
      title: string;
      entityType: string;
      depth: 0 | 1;
      change: RowChange;
      marker: RowMarker | null;
      isGroup: boolean;
    }
  | { kind: "fold"; key: string; count: number };

export interface LayoutFlow {
  /** Row index in `before`, or null for a row with no earlier row. */
  from: number | null;
  /** Row index in `after`, or null when the item ends in a ✕. */
  to: number | null;
  tone: FlowTone;
  dashed: boolean;
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
  /** Suggestions not accepted, shown only as notes outside the totals. */
  pendingNotes: { suggestionId: string; itemKeys: string[] }[];
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
  entityType: string;
  entityId: string;
  title: string;
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
  accepted: readonly string[];
  /** Per-reply baseline shared with Apply; absent means "as currently read". */
  baselineFor?: (
    suggestion: OpenItemsTriageSuggestion,
    item: OpenItemsTriageItem,
  ) => TriageTarget | undefined;
  /** Suggestions that must not appear as pending notes (applied or blocked). */
  hidePending?: ReadonlySet<string>;
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

/** Replays accepted suggestions, in reply order, against the collection. */
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

  for (const suggestionId of input.accepted) {
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
    unverified.push({
      suggestionId: suggestion.suggestionId,
      message: `Which members of "${suggestion.groupName}" can be tracked is confirmed when you apply.`,
    });
    addedGoals.push({
      key: newGoalId(suggestion.suggestionId),
      entityType: "TASK",
      entityId: newGoalId(suggestion.suggestionId),
      title: suggestion.goalName,
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
  });
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

  // Not-accepted suggestions appear only as dashed rows; they never change
  // the projected right column or the totals.
  const acceptedSet = new Set(input.accepted);
  const pendingVerbs: Record<OpenItemsTriageSuggestion["kind"], string> = {
    removeOpenItems: "Remove",
    reopenItems: "Reopen",
    groupOpenItems: "Group",
    trackOnGoal: "Track on Goal",
    promoteGroupToGoal: "Promote",
  };
  const pendingNote = new Map<string, string>();
  const ghosts = new Map<
    string,
    { title: string; entityType: string; note: string }
  >();
  for (const suggestion of input.suggestions) {
    if (
      acceptedSet.has(suggestion.suggestionId) ||
      input.hidePending?.has(suggestion.suggestionId)
    ) {
      continue;
    }
    const note = `${pendingVerbs[suggestion.kind]}? not accepted`;
    for (const item of suggestionItems(suggestion)) {
      const key = itemKey(item);
      if (suggestion.kind === "reopenItems") {
        if (!scratch.has(key) && !ghosts.has(key)) {
          ghosts.set(key, {
            title: item.title,
            entityType: item.entityType,
            note,
          });
        }
      } else if (
        original.has(key) &&
        changeOf(key) === "unchanged" &&
        !pendingNote.has(key)
      ) {
        pendingNote.set(key, note);
      }
    }
  }

  const visibleKeys = order.filter(
    (key) => changeOf(key) !== "unchanged" || pendingNote.has(key),
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
    const change = changeOf(key);
    return {
      ...toRow(
        row,
        originalGroupName.get(row.groupId ?? "") ?? null,
        change === "unchanged" ? "pending" : change,
      ),
      note: pendingNote.get(key),
    };
  });

  // Right column: new/changed group headers with their moved members beneath,
  // then other visible rows, then reopened rows, ghosts and provisional Goals.
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
  for (const [key, ghost] of ghosts) {
    afterIndex.set(`ghost:${key}`, after.length);
    after.push({
      key: `ghost:${key}`,
      title: ghost.title,
      entityType: ghost.entityType,
      pinned: false,
      groupName: null,
      change: "pending",
      note: ghost.note,
    });
  }
  for (const goal of args.addedGoals) {
    afterIndex.set(goal.key, after.length);
    after.push({ ...toRow(goal, null, "goal"), provisional: true });
  }

  const ribbons: PreviewRibbon[] = visibleKeys.map((key, from) => ({
    from,
    to: afterIndex.get(key) ?? null,
    change: pendingNote.has(key) ? "pending" : changeOf(key),
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

  const pendingNotes = input.suggestions
    .filter(
      (s) =>
        !acceptedSet.has(s.suggestionId) &&
        !input.hidePending?.has(s.suggestionId),
    )
    .map((s) => ({
      suggestionId: s.suggestionId,
      itemKeys: suggestionItems(s).map(itemKey),
    }));

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
      ghosts,
      pendingVerb: pendingVerbOf(input),
      changeOf,
    }),
    unchangedCount,
    warnings: args.warnings,
    unverified: args.unverified,
    pendingNotes,
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

/** The first not-accepted, still-offered suggestion naming each existing item. */
function pendingVerbOf(
  input: ReplayInput,
): Map<string, OpenItemsTriageSuggestion["kind"]> {
  const accepted = new Set(input.accepted);
  const verbs = new Map<string, OpenItemsTriageSuggestion["kind"]>();
  for (const suggestion of input.suggestions) {
    if (
      accepted.has(suggestion.suggestionId) ||
      input.hidePending?.has(suggestion.suggestionId) ||
      suggestion.kind === "reopenItems"
    ) {
      continue;
    }
    for (const item of suggestionItems(suggestion)) {
      if (!verbs.has(itemKey(item))) {
        verbs.set(itemKey(item), suggestion.kind);
      }
    }
  }
  return verbs;
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
  ghosts: Map<string, { title: string; entityType: string; note: string }>;
  pendingVerb: Map<string, OpenItemsTriageSuggestion["kind"]>;
  changeOf: (key: string) => RowChange;
}): PreviewLayout {
  const { original, scratch, order, changeOf, pendingVerb } = args;
  const before: LayoutRow[] = [];
  const after: LayoutRow[] = [];
  const flows: LayoutFlow[] = [];
  const beforeIndex = new Map<string, number>();
  const afterIndex = new Map<string, number>();

  const isVisible = (key: string) =>
    changeOf(key) !== "unchanged" || pendingVerb.has(key);

  // Pinned provisional Goals lead the right column, as Goals pin first.
  for (const goal of args.addedGoals) {
    after.push({
      kind: "item",
      key: goal.key,
      title: goal.title,
      entityType: goal.entityType,
      depth: 0,
      change: "goal",
      marker: { kind: "pinnedGoal" },
      isGroup: false,
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
    const key = `fold:${before.length}`;
    flows.push({
      from: before.length,
      to: after.length,
      tone: "same",
      dashed: false,
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
      default: {
        const verb = pendingVerb.get(key);
        return verb ? { kind: "pending", verb } : null;
      }
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
    depth,
    change,
    marker,
    isGroup: false,
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
      depth: 0,
      change: isNew ? "grouped" : "unchanged",
      marker: isNew ? { kind: "newGroup", count } : null,
      isGroup: true,
    });
    if (isNew) {
      flows.push({
        from: null,
        to: afterIndex.get(`group:${groupId}`)!,
        tone: "new",
        dashed: false,
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
        depth: 0,
        change: promoted ? "promoted" : "unchanged",
        marker: promoted ? { kind: "promoteGroup" } : null,
        isGroup: true,
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
          changeOf(key) === "unchanged" ? "pending" : changeOf(key),
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
        dashed: false,
      });
    }
  }

  // Reopened items and not-accepted reopen ghosts sit before the last fold.
  const trailing = run;
  run = 0;
  for (const key of args.reopened) {
    placeAfter(key);
  }
  for (const [key, ghost] of args.ghosts) {
    const ghostKey = `ghost:${key}`;
    afterIndex.set(ghostKey, after.length);
    after.push({
      kind: "item",
      key: ghostKey,
      title: ghost.title,
      entityType: ghost.entityType,
      depth: 0,
      change: "pending",
      marker: { kind: "pending", verb: "reopenItems" },
      isGroup: false,
    });
    flows.push({
      from: null,
      to: afterIndex.get(ghostKey)!,
      tone: "new",
      dashed: true,
    });
  }
  for (const key of args.reopened) {
    const to = afterIndex.get(key);
    if (to !== undefined) {
      flows.push({ from: null, to, tone: "new", dashed: false });
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
          dashed: false,
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
        dashed: false,
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
      dashed: change === "unchanged" && pendingVerb.has(key),
    });
  }

  return { before, after, flows };
}
