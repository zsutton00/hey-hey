import {
  EntityType,
  WorkStatus,
  type GoalTrackedWorkSummary,
  type TrackedEntitySnapshot,
} from "../api";

export const GoalDerivedStatus = {
  Done: "done",
  AtRisk: "at-risk",
  OnTrack: "on-track",
} as const;

export type GoalDerivedStatus =
  (typeof GoalDerivedStatus)[keyof typeof GoalDerivedStatus];

export type GoalStatusChipColor = "success" | "warning" | "info";

export interface GoalStatusChipDescriptor {
  i18nKey: string;
  fallback: string;
  color: GoalStatusChipColor;
}

export const goalStatusChipDescriptor = (
  status: GoalDerivedStatus
): GoalStatusChipDescriptor => {
  switch (status) {
    case GoalDerivedStatus.Done:
      return {
        i18nKey: "goals.status.done",
        fallback: "Done",
        color: "success",
      };
    case GoalDerivedStatus.AtRisk:
      return {
        i18nKey: "goals.status.atRisk",
        fallback: "At risk",
        color: "warning",
      };
    case GoalDerivedStatus.OnTrack:
    default:
      return {
        i18nKey: "goals.status.onTrack",
        fallback: "On track",
        color: "info",
      };
  }
};

export interface DeriveGoalStatusInput {
  dueDate?: string | null;
  trackedEntities?: TrackedEntitySnapshot[];
}

const isPastDue = (isoDate: string | null | undefined, now: Date): boolean => {
  if (!isoDate) return false;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return false;
  return parsed < now.getTime();
};

export const deriveGoalStatus = (
  input: DeriveGoalStatusInput,
  now: Date = new Date()
): GoalDerivedStatus => {
  const tracked = input.trackedEntities ?? [];

  if (
    tracked.length > 0 &&
    tracked.every((entity) => entity.status === WorkStatus.Completed)
  ) {
    return GoalDerivedStatus.Done;
  }

  for (const entity of tracked) {
    if (entity.status === WorkStatus.Completed) continue;

    const effectiveDueDate = entity.dueDate ?? input.dueDate ?? null;
    if (isPastDue(effectiveDueDate, now)) {
      return GoalDerivedStatus.AtRisk;
    }

    if (
      entity.targetEntityType === EntityType.Task &&
      entity.status === WorkStatus.Cancelled
    ) {
      return GoalDerivedStatus.AtRisk;
    }
  }

  return GoalDerivedStatus.OnTrack;
};

export interface DeriveGoalStatusFromSummaryInput {
  dueDate?: string | null;
  trackedWorkSummary: GoalTrackedWorkSummary;
}

/**
 * Same v1 rule as `deriveGoalStatus`, read from the compact list aggregate
 * instead of tracked snapshots. Undated open targets inherit the goal's own
 * due date, which is why the aggregate carries `openUndatedCount` separately.
 */
export const deriveGoalStatusFromSummary = (
  input: DeriveGoalStatusFromSummaryInput,
  now: Date = new Date()
): GoalDerivedStatus => {
  const summary = input.trackedWorkSummary;

  if (summary.totalCount > 0 && summary.completedCount === summary.totalCount) {
    return GoalDerivedStatus.Done;
  }

  if (summary.pastDueCount > 0 || summary.cancelledCount > 0) {
    return GoalDerivedStatus.AtRisk;
  }

  if (summary.openUndatedCount > 0 && isPastDue(input.dueDate, now)) {
    return GoalDerivedStatus.AtRisk;
  }

  return GoalDerivedStatus.OnTrack;
};
