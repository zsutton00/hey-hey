import { describe, expect, it } from "vitest";
import {
  EntityType,
  WorkItemTypeLifecycleStatus,
  type WorkItemTypeSummaryDto,
} from "../../api";
import {
  buildWorkItemTypeRelationshipIndex,
  selectAllowedChildWorkItemTypes,
  selectAllowedParentEntityTypes,
  selectCanParentEntityType,
  selectIsTrackingSourceAllowed,
  selectTrackingTargetTaskTypes,
} from "../workItemTypeRelationshipIndex";

const summary = (
  key: string,
  options: {
    allowedParentTypes?: string[];
    allowedParentEntityTypes?: EntityType[];
    allowedSourceEntityTypes?: EntityType[];
    allowedSourceTaskTypes?: string[];
    status?: WorkItemTypeLifecycleStatus;
  } = {},
): WorkItemTypeSummaryDto =>
  ({
    id: key,
    projectId: "project",
    status: options.status ?? WorkItemTypeLifecycleStatus.Active,
    definition: {
      key,
      allowedParentTypes: options.allowedParentTypes ?? [],
      allowedParentEntityTypes: options.allowedParentEntityTypes ?? [],
      tracking: {
        allowedSourceEntityTypes: options.allowedSourceEntityTypes ?? [],
        allowedSourceTaskTypes: options.allowedSourceTaskTypes ?? [],
      },
    },
  }) as WorkItemTypeSummaryDto;

describe("WorkItemTypeRelationshipIndex", () => {
  const snapshot = [
    summary("FEATURE"),
    summary("TASK_MONITOR", {
      allowedParentTypes: ["FEATURE", "ARCHIVED_PARENT"],
      allowedParentEntityTypes: [EntityType.Task],
    }),
    summary("GOAL"),
    summary("CUSTOM_DELIVERABLE", {
      allowedParentTypes: ["FEATURE"],
      allowedParentEntityTypes: [EntityType.Task],
      allowedSourceEntityTypes: [EntityType.Task, EntityType.User],
      allowedSourceTaskTypes: ["GOAL", "ARCHIVED_TRACKER"],
    }),
    summary("INVALID_MESSAGE_TARGET", {
      allowedSourceEntityTypes: [EntityType.Message],
      allowedSourceTaskTypes: ["GOAL"],
    }),
    summary("ARCHIVED_PARENT", {
      status: WorkItemTypeLifecycleStatus.Archived,
    }),
    summary("ARCHIVED_TRACKER", {
      status: WorkItemTypeLifecycleStatus.Archived,
    }),
  ];

  it("derives child-owned parentage in both directions for canonical and open keys", () => {
    const index = buildWorkItemTypeRelationshipIndex(snapshot);

    expect(index?.canParentWorkItemType("FEATURE", "TASK_MONITOR")).toBe(true);
    expect(index?.canParentWorkItemType("FEATURE", "CUSTOM_DELIVERABLE")).toBe(
      true,
    );
    expect(index?.getAllowedParentWorkItemTypes("CUSTOM_DELIVERABLE")).toEqual([
      "FEATURE",
    ]);
    expect(selectAllowedChildWorkItemTypes(index, "FEATURE")).toEqual([
      "CUSTOM_DELIVERABLE",
      "TASK_MONITOR",
    ]);
  });

  it("keeps entity-type parentage distinct and treats an empty list as unrestricted", () => {
    const index = buildWorkItemTypeRelationshipIndex(snapshot);

    expect(selectAllowedParentEntityTypes(index, "TASK_MONITOR")).toEqual([
      EntityType.Task,
    ]);
    expect(
      selectCanParentEntityType(index, EntityType.Task, "TASK_MONITOR"),
    ).toBe(true);
    expect(
      selectCanParentEntityType(index, EntityType.Project, "TASK_MONITOR"),
    ).toBe(false);
    expect(
      selectCanParentEntityType(index, EntityType.DesignDoc, "FEATURE"),
    ).toBe(true);
    expect(
      selectCanParentEntityType(index, EntityType.Task, "CUSTOM_DELIVERABLE"),
    ).toBe(true);
  });

  it("fails closed for archived or missing relationship endpoints", () => {
    const index = buildWorkItemTypeRelationshipIndex(snapshot);

    expect(
      index?.canParentWorkItemType("ARCHIVED_PARENT", "TASK_MONITOR"),
    ).toBe(false);
    expect(index?.getAllowedParentWorkItemTypes("MISSING")).toEqual([]);
    expect(selectAllowedChildWorkItemTypes(index, "ARCHIVED_PARENT")).toEqual(
      [],
    );
    expect(
      selectCanParentEntityType(index, EntityType.Task, "ARCHIVED_PARENT"),
    ).toBe(false);
  });

  it("derives tracker-to-trackable answers from active target declarations", () => {
    const index = buildWorkItemTypeRelationshipIndex(snapshot);

    expect(index?.getTrackingSourceTypes()).toEqual(["GOAL"]);
    expect(selectTrackingTargetTaskTypes(index, "GOAL")).toEqual([
      "CUSTOM_DELIVERABLE",
    ]);
    expect(
      selectIsTrackingSourceAllowed(
        index,
        "CUSTOM_DELIVERABLE",
        EntityType.Task,
        "GOAL",
      ),
    ).toBe(true);
    expect(
      selectIsTrackingSourceAllowed(
        index,
        "CUSTOM_DELIVERABLE",
        EntityType.User,
      ),
    ).toBe(false);
    expect(
      index
        ?.getTrackingEligibilityIndex()
        .allowedSourcesByTargetTaskType.get("CUSTOM_DELIVERABLE"),
    ).toEqual({
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: ["GOAL"],
    });
    expect(
      index
        ?.getTrackingEligibilityIndex()
        .allowedSourcesByTargetTaskType.get("INVALID_MESSAGE_TARGET"),
    ).toEqual({
      allowedSourceEntityTypes: [],
      allowedSourceTaskTypes: [],
    });
  });

  it("rejects archived tracking sources and targets", () => {
    const index = buildWorkItemTypeRelationshipIndex(snapshot);

    expect(
      index?.isTrackingSourceAllowed(
        "CUSTOM_DELIVERABLE",
        EntityType.Task,
        "ARCHIVED_TRACKER",
      ),
    ).toBe(false);
    expect(index?.isTrackingSourceAllowed("MISSING", EntityType.User)).toBe(
      false,
    );
    expect(index?.getTrackingTargetTaskTypes("ARCHIVED_TRACKER")).toEqual([]);
  });

  it("keeps unavailable snapshots distinct from loaded empty snapshots", () => {
    expect(buildWorkItemTypeRelationshipIndex(undefined)).toBeUndefined();
    expect(
      buildWorkItemTypeRelationshipIndex([])?.getAllowedChildWorkItemTypes(
        "FEATURE",
      ),
    ).toEqual([]);
    expect(
      selectAllowedChildWorkItemTypes(undefined, "FEATURE"),
    ).toBeUndefined();
    expect(
      selectCanParentEntityType(undefined, EntityType.Task, "FEATURE"),
    ).toBeUndefined();
    expect(
      selectCanParentEntityType(
        buildWorkItemTypeRelationshipIndex(snapshot),
        EntityType.Task,
        "MISSING",
      ),
    ).toBe(false);
  });
});
