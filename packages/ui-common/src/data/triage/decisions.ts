import type { OpenItemsTriageSuggestion } from "../../api";
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
