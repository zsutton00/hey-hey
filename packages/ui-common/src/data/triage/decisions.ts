import type {
  OpenItem,
  OpenItemsTriageItem,
  OpenItemsTriageSuggestion,
} from "../../api";
import type { TriageTarget } from "./application";

/** The server's Open Items cap (MAX_OPEN_ITEMS in the API's open-items domain). */
export const OPEN_ITEMS_CAPACITY = 100;

export const OPEN_ITEMS_FULL_MESSAGE =
  "Open Items is full, so this item was not reopened.";
export const PLACEMENT_CHANGED_MESSAGE =
  "This item's placement or pin changed. Review it before removing.";
export const GROUP_CHANGED_MESSAGE =
  "This item's group changed. Review it before moving.";
export const GROUP_MISSING_MESSAGE = "This group is no longer available.";

/** What applying one item should do against the state it is shown. */
export type TriageItemDecision =
  { kind: "proceed" } | { kind: "noop" } | { kind: "conflict"; reason: string };

const proceed: TriageItemDecision = { kind: "proceed" };
const noop: TriageItemDecision = { kind: "noop" };
const conflict = (reason: string): TriageItemDecision => ({
  kind: "conflict",
  reason,
});

export function decideRemove(
  current: TriageTarget,
  baseline: TriageTarget,
): TriageItemDecision {
  if (!current.open) {
    return noop;
  }
  if (
    current.groupId !== baseline.groupId ||
    current.pinned !== baseline.pinned
  ) {
    return conflict(PLACEMENT_CHANGED_MESSAGE);
  }
  return proceed;
}

/** An already-open target is checked before capacity, so a full collection
 * never blocks an item that needs no new slot. */
export function decideReopen(
  current: TriageTarget,
  openCount: number,
): TriageItemDecision {
  if (current.open) {
    return noop;
  }
  if (openCount >= OPEN_ITEMS_CAPACITY) {
    return conflict(OPEN_ITEMS_FULL_MESSAGE);
  }
  return proceed;
}

export function decideGroup(input: {
  current: TriageTarget;
  baseline: TriageTarget;
  /** The destination group id, when it is already known. */
  targetId: string | undefined;
  /** For an existing destination: whether it still exists. */
  destinationMissing: boolean;
}): TriageItemDecision {
  const { current, baseline, targetId, destinationMissing } = input;
  if (current.open && targetId && current.groupId === targetId) {
    return noop;
  }
  if (!current.open || current.groupId !== baseline.groupId) {
    return conflict(GROUP_CHANGED_MESSAGE);
  }
  if (destinationMissing) {
    return conflict(GROUP_MISSING_MESSAGE);
  }
  return proceed;
}

export type ItemSuggestion = Exclude<
  OpenItemsTriageSuggestion,
  { kind: "promoteGroupToGoal" }
>;

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

/** Keys a selected suggestion occupies, including a promoted group's live members. */
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
  /** The selected suggestion that holds the shared item. */
  blockedBy: string;
  itemTitle: string;
}

/**
 * Which suggestions cannot be selected because an earlier selected suggestion
 * already holds one of their items. An existing selection always wins, so a
 * live membership change never evicts an earlier choice.
 */
export function resolveSelection(
  suggestions: readonly OpenItemsTriageSuggestion[],
  selected: ReadonlySet<string>,
  items: readonly OpenItem[],
): { selected: string[]; blocked: Map<string, SuggestionBlock> } {
  const held = new Map<string, string>();
  const effective: string[] = [];
  const blocked = new Map<string, SuggestionBlock>();
  const titles = new Map<string, string>();
  for (const row of items) {
    titles.set(itemKey(row), row.presentation.label);
  }
  for (const suggestion of suggestions) {
    for (const item of suggestionItems(suggestion)) {
      titles.set(itemKey(item), item.title);
    }
  }
  const block = (suggestion: OpenItemsTriageSuggestion) => {
    const conflict = [...suggestionKeys(suggestion, items)].find((key) =>
      held.has(key),
    );
    if (conflict) {
      blocked.set(suggestion.suggestionId, {
        blockedBy: held.get(conflict)!,
        itemTitle: titles.get(conflict) ?? conflict,
      });
    }
    return !!conflict;
  };
  // Selected suggestions are processed first, in agent order, so an
  // unselected card is judged against everything selected.
  for (const suggestion of suggestions) {
    if (!selected.has(suggestion.suggestionId) || block(suggestion)) {
      continue;
    }
    effective.push(suggestion.suggestionId);
    for (const key of suggestionKeys(suggestion, items)) {
      held.set(key, suggestion.suggestionId);
    }
  }
  for (const suggestion of suggestions) {
    if (!selected.has(suggestion.suggestionId)) {
      block(suggestion);
    }
  }
  return { selected: effective, blocked };
}

/**
 * Keeps what is already selected and adds every other suggestion that does
 * not overlap it, in agent order. With nothing selected this is the default
 * selection: an overlapping later suggestion is left out, not secretly kept.
 */
export function selectAvailable(
  suggestions: readonly OpenItemsTriageSuggestion[],
  selected: ReadonlySet<string>,
  items: readonly OpenItem[],
): Set<string> {
  const next = new Set(resolveSelection(suggestions, selected, items).selected);
  const held = new Set<string>();
  for (const suggestion of suggestions) {
    if (next.has(suggestion.suggestionId)) {
      suggestionKeys(suggestion, items).forEach((key) => held.add(key));
    }
  }
  for (const suggestion of suggestions) {
    if (next.has(suggestion.suggestionId)) {
      continue;
    }
    const keys = [...suggestionKeys(suggestion, items)];
    if (keys.some((key) => held.has(key))) {
      continue;
    }
    next.add(suggestion.suggestionId);
    keys.forEach((key) => held.add(key));
  }
  return next;
}
