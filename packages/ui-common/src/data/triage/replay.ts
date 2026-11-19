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

export interface TriagePreview {
  before: PreviewRow[];
  after: PreviewRow[];
  ribbons: PreviewRibbon[];
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
    removed: number;
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

  const changedKeys = order.filter((key) => changeOf(key) !== "unchanged");
  const reopened = [...scratch.keys()].filter((key) => !original.has(key));
  const unchangedCount = order.length - changedKeys.length;

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

  const before: PreviewRow[] = changedKeys.map((key) =>
    toRow(
      original.get(key)!,
      originalGroupName.get(original.get(key)!.groupId ?? "") ?? null,
      changeOf(key),
    ),
  );

  // Right column: new/changed group headers with their moved members beneath,
  // then other changed rows, then reopened rows and provisional Goals.
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
  for (const key of changedKeys) {
    const row = scratch.get(key);
    if (row?.groupId && changeOf(key) === "grouped") {
      pushGroup(row.groupId);
      afterIndex.set(key, after.length);
      after.push(toRow(row, nameOf(row.groupId), "grouped"));
    }
  }
  for (const key of [...changedKeys, ...reopened]) {
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

  const ribbons: PreviewRibbon[] = changedKeys.map((key, from) => ({
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

  const acceptedSet = new Set(input.accepted);
  const pendingNotes = input.suggestions
    .filter((s) => !acceptedSet.has(s.suggestionId))
    .map((s) => ({
      suggestionId: s.suggestionId,
      itemKeys: suggestionItems(s).map(itemKey),
    }));

  return {
    before,
    after,
    ribbons,
    unchangedCount,
    warnings: args.warnings,
    unverified: args.unverified,
    pendingNotes,
    totals: {
      before: order.length,
      after: scratch.size + args.addedGoals.length,
      groupsCreated: args.createdGroups.size,
      removed: [...args.removedKeys].filter((key) => original.has(key)).length,
    },
  };
}
