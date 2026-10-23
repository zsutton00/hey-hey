import {
  RelationshipValue,
  WorkStatus,
  type ContextRelatedEntityDto,
} from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";
import {
  continueTaskSessionLaunch,
  selectUnfinishedTaskDependencies,
  startTaskSessionLaunch,
} from "./taskCodingSessionLaunchPreflight";

const relatedEntity = (
  overrides: Partial<ContextRelatedEntityDto> = {},
): ContextRelatedEntityDto => ({
  entityId: "dependency-1",
  entityType: "TASK",
  displayName: "Dependency one",
  relationship: RelationshipValue.DependsOn,
  status: WorkStatus.Active,
  taskType: "STANDARD",
  ...overrides,
});

describe("task coding-session launch preflight", () => {
  it("selects only outbound unfinished task dependencies", () => {
    const unfinishedDependency = relatedEntity();
    const unfinishedBugDependency = relatedEntity({
      entityId: "bug-dependency",
      taskType: "BUG",
    });
    const dependencies = selectUnfinishedTaskDependencies([
      unfinishedDependency,
      unfinishedBugDependency,
      relatedEntity({
        entityId: "inverse-dependency",
        relationship: RelationshipValue.DependedOnBy,
      }),
      relatedEntity({ entityId: "service-1", entityType: "SERVICE" }),
      relatedEntity({
        entityId: "completed-dependency",
        status: WorkStatus.Completed,
      }),
      relatedEntity({
        entityId: "verifying-dependency",
        status: WorkStatus.Verifying,
      }),
      relatedEntity({
        entityId: "feature-dependency",
        taskType: "FEATURE",
      }),
      relatedEntity({
        entityId: "contract-dependency",
        taskType: "CONTRACT",
      }),
      relatedEntity({
        entityId: "lowercase-standard-dependency",
        taskType: "standard",
      }),
    ]);

    expect(dependencies).toEqual([
      unfinishedDependency,
      unfinishedBugDependency,
    ]);
  });

  it.each(["STANDARD", "BUG", "FEATURE", "CONTRACT"])(
    "warns before the inactive-task check regardless of the launched %s type and then advances to it",
    (taskType) => {
      const warningState = startTaskSessionLaunch({
        relatedEntities: [relatedEntity()],
        taskType,
        taskNeedsActivation: true,
      });

      expect(warningState.kind).toBe("dependencyWarning");
      expect(continueTaskSessionLaunch(warningState, true)).toEqual({
        kind: "inactiveTaskCheck",
      });
    },
  );

  it("moves directly to creation when no launch check applies", () => {
    expect(
      startTaskSessionLaunch({
        relatedEntities: [],
        taskType: "STANDARD",
        taskNeedsActivation: false,
      }),
    ).toEqual({ kind: "creating" });
  });

  it("skips non-implementation dependency records regardless of the launched type", () => {
    expect(
      startTaskSessionLaunch({
        relatedEntities: [relatedEntity({ taskType: "FEATURE" })],
        taskType: "STANDARD",
        taskNeedsActivation: false,
      }),
    ).toEqual({ kind: "creating" });

    expect(
      startTaskSessionLaunch({
        relatedEntities: [relatedEntity({ taskType: "CONTRACT" })],
        taskType: "FEATURE",
        taskNeedsActivation: true,
      }),
    ).toEqual({ kind: "inactiveTaskCheck" });
  });
});
