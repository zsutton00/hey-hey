import type {
  OpenItemsTriageItem,
  OpenItemsTriageSuggestion,
  OpenItemsTriageNewGoalDraft,
  PromoteGroupToGoalRequest,
} from "../../api";

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
  remove: (item: OpenItemsTriageItem, key: string) => Promise<void>;
  reopen: (item: OpenItemsTriageItem, key: string) => Promise<void>;
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
          throw new Error("This group is no longer available.");
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
    suggestion: Exclude<
      OpenItemsTriageSuggestion,
      { kind: "promoteGroupToGoal" }
    >,
    item: OpenItemsTriageItem,
  ) {
    const current = this.ports.target(item);
    const baseline = progress.baseline.get(keyFor(item))!;
    const operationKey = this.operationKey(progress, keyFor(item));
    switch (suggestion.kind) {
      case "removeOpenItems":
        if (!current.open) return;
        if (
          current.groupId !== baseline.groupId ||
          current.pinned !== baseline.pinned
        )
          throw new Error(
            "This item's placement or pin changed. Review it before removing.",
          );
        return this.ports.remove(item, operationKey);
      case "reopenItems":
        if (!current.open) await this.ports.reopen(item, operationKey);
        return;
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
    if (current.open && targetId && current.groupId === targetId) return;
    if (!current.open || current.groupId !== baseline.groupId)
      throw new Error("This item's group changed. Review it before moving.");
    if (suggestion.group.kind === "existingGroup") {
      if (!this.ports.groupExists(suggestion.group.groupId))
        throw new Error("This group is no longer available.");
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
      throw new Error("This item's group changed. Review it before moving.");
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
