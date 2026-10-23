import { describe, it, expect } from "vitest";
import {
  deriveGoalStatus,
  deriveGoalStatusFromSummary,
  GoalDerivedStatus,
} from "../goalStatus";
import {
  EntityType,
  WorkStatus,
  type GoalTrackedWorkSummary,
  type TrackedEntitySnapshot,
} from "../../api";

const NOW = new Date("2026-05-11T12:00:00.000Z");
const PAST = "2026-05-01T00:00:00.000Z";
const FUTURE = "2026-12-01T00:00:00.000Z";

const snapshot = (
  overrides: Partial<TrackedEntitySnapshot> = {},
): TrackedEntitySnapshot => ({
  targetEntityId: overrides.targetEntityId ?? "entity-1",
  targetEntityType: overrides.targetEntityType ?? EntityType.Task,
  title: overrides.title ?? "Tracked entity",
  status: overrides.status,
  dueDate: overrides.dueDate,
});

describe("deriveGoalStatus", () => {
  it("returns 'done' when every tracked entity is COMPLETED", () => {
    const result = deriveGoalStatus(
      {
        trackedEntities: [
          snapshot({ status: WorkStatus.Completed }),
          snapshot({
            targetEntityId: "entity-2",
            status: WorkStatus.Completed,
          }),
        ],
      },
      NOW,
    );
    expect(result).toBe(GoalDerivedStatus.Done);
  });

  it("does not return 'done' when at least one tracked entity is not COMPLETED", () => {
    const result = deriveGoalStatus(
      {
        dueDate: FUTURE,
        trackedEntities: [
          snapshot({ status: WorkStatus.Completed }),
          snapshot({
            targetEntityId: "entity-2",
            status: WorkStatus.Active,
            dueDate: FUTURE,
          }),
        ],
      },
      NOW,
    );
    expect(result).not.toBe(GoalDerivedStatus.Done);
    expect(result).toBe(GoalDerivedStatus.OnTrack);
  });

  it("returns 'at-risk' when a tracked TASK is CANCELLED and the goal is not done", () => {
    const result = deriveGoalStatus(
      {
        dueDate: FUTURE,
        trackedEntities: [
          snapshot({
            status: WorkStatus.Cancelled,
            targetEntityType: EntityType.Task,
            dueDate: FUTURE,
          }),
          snapshot({
            targetEntityId: "entity-2",
            status: WorkStatus.Active,
            dueDate: FUTURE,
          }),
        ],
      },
      NOW,
    );
    expect(result).toBe(GoalDerivedStatus.AtRisk);
  });

  it("returns 'at-risk' when a tracked entity is past its own dueDate and not COMPLETED", () => {
    const result = deriveGoalStatus(
      {
        dueDate: FUTURE,
        trackedEntities: [
          snapshot({
            status: WorkStatus.Active,
            dueDate: PAST,
          }),
        ],
      },
      NOW,
    );
    expect(result).toBe(GoalDerivedStatus.AtRisk);
  });

  it("returns 'at-risk' when entity has no dueDate but the goal's dueDate is past and entity is not COMPLETED", () => {
    const result = deriveGoalStatus(
      {
        dueDate: PAST,
        trackedEntities: [
          snapshot({
            status: WorkStatus.Active,
          }),
        ],
      },
      NOW,
    );
    expect(result).toBe(GoalDerivedStatus.AtRisk);
  });

  it("returns 'on-track' when all tracked entities are active with future dueDates", () => {
    const result = deriveGoalStatus(
      {
        dueDate: FUTURE,
        trackedEntities: [
          snapshot({
            status: WorkStatus.Active,
            dueDate: FUTURE,
          }),
          snapshot({
            targetEntityId: "entity-2",
            status: WorkStatus.RefiningDescription,
            dueDate: FUTURE,
          }),
        ],
      },
      NOW,
    );
    expect(result).toBe(GoalDerivedStatus.OnTrack);
  });

  it("returns 'on-track' when trackedEntities is an empty array", () => {
    const result = deriveGoalStatus(
      { dueDate: PAST, trackedEntities: [] },
      NOW,
    );
    expect(result).toBe(GoalDerivedStatus.OnTrack);
  });

  it("returns 'on-track' when trackedEntities is missing", () => {
    const result = deriveGoalStatus({ dueDate: PAST }, NOW);
    expect(result).toBe(GoalDerivedStatus.OnTrack);
  });

  it("marks a cancelled plan work item at risk before its due date", () => {
    const result = deriveGoalStatus(
      {
        dueDate: FUTURE,
        trackedEntities: [
          snapshot({
            targetEntityType: EntityType.Task,
            status: WorkStatus.Cancelled,
            dueDate: FUTURE,
          }),
        ],
      },
      NOW,
    );
    expect(result).toBe(GoalDerivedStatus.AtRisk);
  });
});

/**
 * Mirrors the API aggregate: tracked TASK snapshots only, past-due and undated
 * counts over open targets (neither completed nor cancelled).
 */
const summarize = (
  snapshots: TrackedEntitySnapshot[],
  now: Date,
): GoalTrackedWorkSummary => {
  const summary: GoalTrackedWorkSummary = {
    totalCount: snapshots.length,
    completedCount: 0,
    cancelledCount: 0,
    pastDueCount: 0,
    openUndatedCount: 0,
  };
  for (const entity of snapshots) {
    if (entity.status === WorkStatus.Completed) {
      summary.completedCount += 1;
    } else if (entity.status === WorkStatus.Cancelled) {
      summary.cancelledCount += 1;
    } else if (!entity.dueDate) {
      summary.openUndatedCount += 1;
    } else if (Date.parse(entity.dueDate) < now.getTime()) {
      summary.pastDueCount += 1;
    }
  }
  return summary;
};

describe("deriveGoalStatusFromSummary parity", () => {
  const cases: Array<{
    name: string;
    dueDate?: string | null;
    tracked: TrackedEntitySnapshot[];
    expected: GoalDerivedStatus;
  }> = [
    { name: "no tracked work", dueDate: FUTURE, tracked: [], expected: GoalDerivedStatus.OnTrack },
    {
      name: "no tracked work with a past goal due date",
      dueDate: PAST,
      tracked: [],
      expected: GoalDerivedStatus.OnTrack,
    },
    {
      name: "all completed, including past-dated",
      dueDate: PAST,
      tracked: [
        snapshot({ status: WorkStatus.Completed, dueDate: PAST }),
        snapshot({ targetEntityId: "e2", status: WorkStatus.Completed }),
      ],
      expected: GoalDerivedStatus.Done,
    },
    {
      name: "open target past its own due date",
      dueDate: FUTURE,
      tracked: [snapshot({ status: WorkStatus.Active, dueDate: PAST })],
      expected: GoalDerivedStatus.AtRisk,
    },
    {
      name: "cancelled task",
      dueDate: FUTURE,
      tracked: [
        snapshot({ status: WorkStatus.Completed }),
        snapshot({ targetEntityId: "e2", status: WorkStatus.Cancelled }),
      ],
      expected: GoalDerivedStatus.AtRisk,
    },
    {
      name: "undated open target inherits a past goal due date",
      dueDate: PAST,
      tracked: [snapshot({ status: WorkStatus.Active })],
      expected: GoalDerivedStatus.AtRisk,
    },
    {
      name: "undated open target inherits a future goal due date",
      dueDate: FUTURE,
      tracked: [snapshot({ status: WorkStatus.Backlog })],
      expected: GoalDerivedStatus.OnTrack,
    },
    {
      name: "dated future open target ignores a past goal due date",
      dueDate: PAST,
      tracked: [snapshot({ status: WorkStatus.Active, dueDate: FUTURE })],
      expected: GoalDerivedStatus.OnTrack,
    },
    {
      name: "undated open target with no goal due date",
      dueDate: null,
      tracked: [snapshot({ status: WorkStatus.Active })],
      expected: GoalDerivedStatus.OnTrack,
    },
  ];

  it.each(cases)("$name", ({ dueDate, tracked, expected }) => {
    const fromSnapshots = deriveGoalStatus(
      { dueDate, trackedEntities: tracked },
      NOW,
    );
    const fromSummary = deriveGoalStatusFromSummary(
      { dueDate, trackedWorkSummary: summarize(tracked, NOW) },
      NOW,
    );
    expect(fromSnapshots).toBe(expected);
    expect(fromSummary).toBe(fromSnapshots);
  });
});
