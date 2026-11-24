import type {
  OpenItem,
  OpenItemsTriageItem,
  OpenItemsTriageSuggestion,
  OpenItemsTriageNewGoalDraft,
  PromoteGroupToGoalRequest,
} from "../../api";
import {
  GROUP_CHANGED_MESSAGE,
  GROUP_MISSING_MESSAGE,
  decideGroup,
  decideRemove,
  decideReopen,
  resolveSelection,
  selectAvailable,
  type ItemSuggestion,
  type TriageItemDecision,
} from "./decisions";

type TriageItemOutcome = {
  item: OpenItemsTriageItem;
  state: "success" | "failure";
  error?: string;
};
export interface TriageOutcome {
  state: "idle" | "pending" | "success" | "failure" | "cancelled";
  items: TriageItemOutcome[];
  error?: string;
  createdGoal?: OpenItemsTriageItem;
  createdGroup?: { groupId: string; name: string };
}
export interface TriageTarget {
  open: boolean;
  groupId: string | null;
  pinned: boolean;
}
export interface TriagePromotionIntent {
  current: PromoteGroupToGoalRequest | null;
}
export interface TriageApplicationPorts {
  refresh: () => Promise<void>;
  target: (item: OpenItemsTriageItem) => TriageTarget;
  groupExists: (groupId: string) => boolean;
  /** Number of entries currently in the collection, as last read. */
  openCount: () => number;
  remove: (item: OpenItemsTriageItem, key: string) => Promise<void>;
  /** `recheck` runs after the target is resolved and before activation is
   * sent; it throws when the reopen must not go ahead, and returns false when
   * nothing is left to do. */
  reopen: (
    item: OpenItemsTriageItem,
    key: string,
    recheck: () => Promise<boolean>,
  ) => Promise<void>;
  createGroup: (name: string, key: string) => Promise<string>;
  group: (
    item: OpenItemsTriageItem,
    groupId: string,
    key: string,
  ) => Promise<void>;
  createGoal: (draft: OpenItemsTriageNewGoalDraft) => Promise<string>;
  track: (item: OpenItemsTriageItem, goalId: string) => Promise<void>;
  promote: (
    suggestion: Extract<
      OpenItemsTriageSuggestion,
      { kind: "promoteGroupToGoal" }
    >,
    intent: TriagePromotionIntent,
  ) => Promise<"success" | "cancelled">;
  revalidateGoals: () => Promise<void>;
}
const keyFor = (item: OpenItemsTriageItem) =>
  `${item.entityType}:${item.entityId}`;
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Unable to apply suggestion";
interface Progress {
  outcome: TriageOutcome;
  baseline: Map<string, TriageTarget>;
  completed: Set<string>;
  keys: Map<string, string>;
  groupId?: string;
  goalId?: string;
  goalCreationError?: string;
  promotionIntent: TriagePromotionIntent;
}

/** Owns local application progress, never a second collection. Fresh reads and
 * manual operations remain the authority; completed item work survives retries. */
export class TriageApplicationCoordinator {
  private progress = new Map<string, Progress>();
  private selections = new Map<string, ReadonlySet<string>>();
  private listeners = new Set<() => void>();
  private version = 0;
  constructor(private ports: TriageApplicationPorts) {}
  updatePorts(ports: TriageApplicationPorts) {
    this.ports = ports;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }
  observe(scope: string, suggestion: OpenItemsTriageSuggestion) {
    const id = `${scope}:${suggestion.suggestionId}`;
    if (!this.progress.has(id)) {
      const items =
        suggestion.kind === "promoteGroupToGoal"
          ? suggestion.affectedMembers
          : suggestion.items;
      this.progress.set(id, {
        outcome: { state: "idle", items: [] },
        baseline: new Map(
          items.map((item) => [keyFor(item), this.ports.target(item)]),
        ),
        completed: new Set(),
        keys: new Map(),
        promotionIntent: { current: null },
      });
    }
    return id;
  }
  /** The per-reply baseline Apply compares against, shared with the preview. */
  baselineFor(
    scope: string,
    suggestion: OpenItemsTriageSuggestion,
    item: OpenItemsTriageItem,
  ): TriageTarget | undefined {
    return this.progress
      .get(`${scope}:${suggestion.suggestionId}`)
      ?.baseline.get(keyFor(item));
  }
  /** Whether this item's work already finished, so projection skips it. */
  isCompleted(
    scope: string,
    suggestion: OpenItemsTriageSuggestion,
    item: OpenItemsTriageItem,
  ): boolean {
    return (
      this.progress
        .get(`${scope}:${suggestion.suggestionId}`)
        ?.completed.has(keyFor(item)) ?? false
    );
  }
  outcome(scope: string, suggestion: OpenItemsTriageSuggestion): TriageOutcome {
    return (
      this.progress.get(`${scope}:${suggestion.suggestionId}`)?.outcome ?? {
        state: "idle",
        items: [],
      }
    );
  }
  private operationKey(progress: Progress, itemKey: string) {
    let key = progress.keys.get(itemKey);
    if (!key) {
      key = crypto.randomUUID();
      progress.keys.set(itemKey, key);
    }
    return key;
  }
  apply = async (scope: string, suggestion: OpenItemsTriageSuggestion) => {
    const id = this.observe(scope, suggestion);
    const progress = this.progress.get(id)!;
    if (
      progress.outcome.state === "pending" ||
      progress.outcome.state === "success"
    )
      return;
    progress.outcome = {
      ...progress.outcome,
      state: "pending",
      error: undefined,
    };
    this.emit();
    try {
      await this.ports.refresh();
      if (suggestion.kind === "promoteGroupToGoal") {
        if (
          !this.ports.groupExists(suggestion.groupId) &&
          !progress.promotionIntent.current
        )
          throw new Error(GROUP_MISSING_MESSAGE);
        progress.outcome = {
          state: await this.ports.promote(suggestion, progress.promotionIntent),
          items: [],
        };
      } else {
        await this.applyItems(progress, suggestion);
      }
    } catch (cause) {
      progress.outcome = {
        ...progress.outcome,
        state: "failure",
        error: message(cause),
      };
    } finally {
      // Revalidate even after partial failure: earlier manual writes may stand.
      const revalidations = await Promise.allSettled([
        Promise.resolve().then(() => this.ports.refresh()),
        Promise.resolve().then(() => this.ports.revalidateGoals()),
      ]);
      const errors = revalidations.flatMap((result) =>
        result.status === "rejected" ? [message(result.reason)] : [],
      );
      if (errors.length) {
        progress.outcome = {
          ...progress.outcome,
          error: [progress.outcome.error, ...errors].filter(Boolean).join("; "),
        };
      }
      this.emit();
    }
  };
  applyAll = async (
    scope: string,
    suggestions: OpenItemsTriageSuggestion[],
  ) => {
    for (const suggestion of suggestions) await this.apply(scope, suggestion);
  };

  /**
   * The suggestions checked for this reply. Every available suggestion starts
   * checked, in agent order, the first time a reply's suggestions are seen.
   * Seeding emits nothing, so it is safe to call while rendering.
   */
  selected(
    scope: string,
    suggestions: readonly OpenItemsTriageSuggestion[],
    items: readonly OpenItem[],
  ): ReadonlySet<string> {
    let selection = this.selections.get(scope);
    if (!selection) {
      selection = selectAvailable(suggestions, new Set(), items);
      this.selections.set(scope, selection);
    }
    return selection;
  }
  toggle(scope: string, suggestionId: string) {
    const next = new Set(this.selections.get(scope));
    if (next.has(suggestionId)) {
      next.delete(suggestionId);
    } else {
      next.add(suggestionId);
    }
    this.selections.set(scope, next);
    this.emit();
  }
  selectAll(
    scope: string,
    suggestions: readonly OpenItemsTriageSuggestion[],
    items: readonly OpenItem[],
  ) {
    const current = this.selected(scope, suggestions, items);
    this.selections.set(scope, selectAvailable(suggestions, current, items));
    this.emit();
  }
  clear(scope: string) {
    this.selections.set(scope, new Set());
    this.emit();
  }

  /**
   * Applies every checked suggestion not yet applied, each on its own through
   * `apply`. Promotions run first so the Goal-name confirmation comes before
   * anything changes; cancelling one stops the rest.
   */
  applySelected = async (
    scope: string,
    suggestions: readonly OpenItemsTriageSuggestion[],
    items: readonly OpenItem[],
  ) => {
    const { selected } = resolveSelection(
      suggestions,
      this.selected(scope, suggestions, items),
      items,
    );
    const pending = suggestions.filter(
      (suggestion) =>
        selected.includes(suggestion.suggestionId) &&
        this.outcome(scope, suggestion).state !== "success",
    );
    const promotions = pending.filter(
      (suggestion) => suggestion.kind === "promoteGroupToGoal",
    );
    for (const promotion of promotions) {
      await this.apply(scope, promotion);
      if (this.outcome(scope, promotion).state === "cancelled") {
        return;
      }
    }
    for (const suggestion of pending) {
      if (suggestion.kind !== "promoteGroupToGoal") {
        await this.apply(scope, suggestion);
      }
    }
  };
  private async applyItems(
    progress: Progress,
    suggestion: Exclude<
      OpenItemsTriageSuggestion,
      { kind: "promoteGroupToGoal" }
    >,
  ) {
    const results: TriageItemOutcome[] = [];
    for (const item of suggestion.items) {
      const key = keyFor(item);
      if (progress.completed.has(key)) {
        results.push({ item, state: "success" });
        continue;
      }
      try {
        await this.ports.refresh();
        await this.applyItem(progress, suggestion, item);
        progress.completed.add(key);
        results.push({ item, state: "success" });
      } catch (cause) {
        results.push({ item, state: "failure", error: message(cause) });
      }
      progress.outcome = {
        ...progress.outcome,
        state: "pending",
        items: [...results],
      };
      this.emit();
    }
    progress.outcome = {
      ...progress.outcome,
      state: results.some((result) => result.state === "failure")
        ? "failure"
        : "success",
      items: results,
    };
  }
  private async applyItem(
    progress: Progress,
    suggestion: ItemSuggestion,
    item: OpenItemsTriageItem,
  ) {
    const settle = (decision: TriageItemDecision) => {
      if (decision.kind === "conflict") {
        throw new Error(decision.reason);
      }
    };
    const current = this.ports.target(item);
    const baseline = progress.baseline.get(keyFor(item))!;
    const operationKey = this.operationKey(progress, keyFor(item));
    switch (suggestion.kind) {
      case "removeOpenItems": {
        const decision = decideRemove(current, baseline);
        if (decision.kind === "proceed") {
          await this.ports.remove(item, operationKey);
        }
        return settle(decision);
      }
      case "reopenItems": {
        const decision = decideReopen(current, this.ports.openCount());
        if (decision.kind === "proceed") {
          await this.ports.reopen(item, operationKey, async () => {
            await this.ports.refresh();
            const latest = decideReopen(
              this.ports.target(item),
              this.ports.openCount(),
            );
            settle(latest);
            return latest.kind === "proceed";
          });
        }
        return settle(decision);
      }
      case "groupOpenItems":
        return this.groupItem(
          progress,
          suggestion,
          item,
          current,
          baseline,
          operationKey,
        );
      case "trackOnGoal":
        return this.ports.track(
          item,
          await this.resolveGoal(progress, suggestion),
        );
    }
  }

  private async groupItem(
    progress: Progress,
    suggestion: Extract<OpenItemsTriageSuggestion, { kind: "groupOpenItems" }>,
    item: OpenItemsTriageItem,
    current: TriageTarget,
    baseline: TriageTarget,
    operationKey: string,
  ) {
    const targetId =
      suggestion.group.kind === "existingGroup"
        ? suggestion.group.groupId
        : progress.groupId;
    const decision = decideGroup({
      current,
      baseline,
      targetId,
      destinationMissing:
        suggestion.group.kind === "existingGroup" &&
        !this.ports.groupExists(suggestion.group.groupId),
    });
    if (decision.kind === "noop") {
      return;
    }
    if (decision.kind === "conflict") {
      throw new Error(decision.reason);
    }
    if (suggestion.group.kind === "existingGroup") {
      progress.groupId = suggestion.group.groupId;
    } else if (!progress.groupId) {
      progress.groupId = await this.ports.createGroup(
        suggestion.group.newGroupName,
        this.operationKey(progress, "group"),
      );
      progress.outcome.createdGroup = {
        groupId: progress.groupId,
        name: suggestion.group.newGroupName,
      };
    }
    await this.ports.group(item, progress.groupId!, operationKey);
    // Manual assignment can successfully return an unchanged result when its
    // item or group disappeared after our read. Confirm the requested outcome
    // before recording completed work; HTTP success alone is insufficient.
    await this.ports.refresh();
    const assigned = this.ports.target(item);
    if (!assigned.open || assigned.groupId !== progress.groupId)
      throw new Error(GROUP_CHANGED_MESSAGE);
  }

  private async resolveGoal(
    progress: Progress,
    suggestion: Extract<OpenItemsTriageSuggestion, { kind: "trackOnGoal" }>,
  ): Promise<string> {
    if (progress.goalCreationError) throw new Error(progress.goalCreationError);
    if (progress.goalId) return progress.goalId;
    if (suggestion.goal.kind === "existingGoal") {
      progress.goalId = suggestion.goal.goalId;
    } else {
      try {
        progress.goalId = await this.ports.createGoal(suggestion.goal.newGoal);
        progress.outcome.createdGoal = {
          entityType: "TASK",
          entityId: progress.goalId,
          title: suggestion.goal.newGoal.name,
        };
      } catch (cause) {
        // Ordinary Goal creation has no retry identity. A lost response must
        // never trigger another blind create.
        progress.goalCreationError = `Goal creation could not be confirmed. Review Goals before creating another: ${message(cause)}`;
        throw new Error(progress.goalCreationError);
      }
    }
    return progress.goalId;
  }
}
