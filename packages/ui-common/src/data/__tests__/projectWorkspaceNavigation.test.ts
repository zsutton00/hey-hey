import { describe, expect, it } from "vitest";
import {
  EntityType,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type WorkItemTypeSummaryDto,
} from "../../api";
import { buildProjectWorkspaceNavigation } from "../projectWorkspaceNavigation";

const SELECTED_PROJECT_ID = "selected-project";

const summary = (
  key: string,
  name: string,
  role: WorkItemTypeSummaryDto["definition"]["role"],
  options: {
    projectId?: string;
    status?: WorkItemTypeSummaryDto["status"];
  } = {}
): WorkItemTypeSummaryDto => ({
  id: `${options.projectId ?? SELECTED_PROJECT_ID}:${key}`,
  projectId: options.projectId ?? SELECTED_PROJECT_ID,
  status: options.status ?? WorkItemTypeLifecycleStatus.Active,
  effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
  definition: {
    key,
    name,
    role,
    sections: [],
    allowedStatuses: [],
  },
});

const itemsFor = (
  navigation: ReturnType<typeof buildProjectWorkspaceNavigation>,
  groupKey: "work" | "knowledge"
) => navigation.groups.find(({ key }) => key === groupKey)?.items ?? [];

describe("buildProjectWorkspaceNavigation", () => {
  it("projects custom work-item keys without a hard-coded type catalog", () => {
    const navigation = buildProjectWorkspaceNavigation(
      [
        summary(
          "CUSTOM_DELIVERABLE",
          "Custom Deliverables",
          WorkItemTypeRole.WorkItem
        ),
        summary("BUG", "Bugs", WorkItemTypeRole.WorkItem),
      ],
      SELECTED_PROJECT_ID
    );

    expect(navigation.groups.map(({ key, label }) => ({ key, label }))).toEqual(
      [
        { key: "work", label: "Work" },
        { key: "knowledge", label: "Knowledge" },
      ]
    );
    expect(itemsFor(navigation, "work")).toEqual([
      {
        kind: "registry-work-item",
        typeKey: "CUSTOM_DELIVERABLE",
        name: "Custom Deliverables",
      },
      { kind: "registry-work-item", typeKey: "BUG", name: "Bugs" },
    ]);
  });

  it("combines role-driven placement while excluding the active Initiative key", () => {
    const navigation = buildProjectWorkspaceNavigation(
      [
        summary("STANDARD", "Tasks", WorkItemTypeRole.WorkItem),
        summary("FEATURE", "Features", WorkItemTypeRole.ProjectInfo),
        summary("INITIATIVE", "Initiatives", WorkItemTypeRole.ProjectInfo),
        summary("CONTRACT", "Contracts", WorkItemTypeRole.ProjectInfo),
      ],
      SELECTED_PROJECT_ID
    );

    expect(itemsFor(navigation, "work")).toEqual([
      { kind: "registry-work-item", typeKey: "STANDARD", name: "Tasks" },
    ]);
    expect(itemsFor(navigation, "knowledge")).toEqual([
      { kind: "registry-work-item", typeKey: "FEATURE", name: "Features" },
      { kind: "registry-work-item", typeKey: "CONTRACT", name: "Contracts" },
      {
        kind: "design-doc",
        entityType: EntityType.DesignDoc,
        name: "Design Docs",
      },
      { kind: "plan", entityType: EntityType.Task, name: "Plans" },
    ]);
    expect(
      itemsFor(navigation, "knowledge").some(
        (item) => item.kind === "registry-work-item" && item.typeKey === "INITIATIVE"
      )
    ).toBe(false);
  });

  it("excludes wrong-project and archived definitions", () => {
    const navigation = buildProjectWorkspaceNavigation(
      [
        summary("SELECTED", "Selected", WorkItemTypeRole.WorkItem),
        summary("OTHER_PROJECT", "Other Project", WorkItemTypeRole.WorkItem, {
          projectId: "other-project",
        }),
        summary("ARCHIVED", "Archived", WorkItemTypeRole.ProjectInfo, {
          status: WorkItemTypeLifecycleStatus.Archived,
        }),
      ],
      SELECTED_PROJECT_ID
    );

    expect(itemsFor(navigation, "work")).toEqual([
      { kind: "registry-work-item", typeKey: "SELECTED", name: "Selected" },
    ]);
    expect(itemsFor(navigation, "knowledge")).toEqual([
      {
        kind: "design-doc",
        entityType: EntityType.DesignDoc,
        name: "Design Docs",
      },
      { kind: "plan", entityType: EntityType.Task, name: "Plans" },
    ]);
  });

  it("does not create Initiative or destinations for non-navigation roles", () => {
    const navigation = buildProjectWorkspaceNavigation(
      [
        summary("SCHEDULED", "Scheduled", WorkItemTypeRole.Scheduled),
        summary("TRIGGER", "Trigger", WorkItemTypeRole.Trigger),
        summary("TASK_MONITOR", "Task Monitor", WorkItemTypeRole.Monitor),
      ],
      SELECTED_PROJECT_ID
    );
    const items = navigation.groups.flatMap(({ items }) => items);

    expect(items).not.toContainEqual(
      expect.objectContaining({ typeKey: "SCHEDULED" })
    );
    expect(items).not.toContainEqual(
      expect.objectContaining({ typeKey: "TRIGGER" })
    );
    expect(items).not.toContainEqual(
      expect.objectContaining({ typeKey: "TASK_MONITOR" })
    );
    expect(items).not.toContainEqual(
      expect.objectContaining({ entityType: EntityType.Initiative })
    );
  });

  it("preserves registry order and selects the same project deterministically", () => {
    const snapshot = [
      summary(
        "KNOWLEDGE_SECOND",
        "Knowledge Second",
        WorkItemTypeRole.ProjectInfo
      ),
      summary("WORK_FIRST", "Work First", WorkItemTypeRole.WorkItem),
      summary(
        "KNOWLEDGE_THIRD",
        "Knowledge Third",
        WorkItemTypeRole.ProjectInfo
      ),
      summary("WORK_FOURTH", "Work Fourth", WorkItemTypeRole.WorkItem),
      summary("WRONG_PROJECT", "Wrong Project", WorkItemTypeRole.WorkItem, {
        projectId: "other-project",
      }),
    ];

    const first = buildProjectWorkspaceNavigation(
      snapshot,
      SELECTED_PROJECT_ID
    );
    const second = buildProjectWorkspaceNavigation(
      snapshot,
      SELECTED_PROJECT_ID
    );

    expect(first).toEqual(second);
    expect(
      itemsFor(first, "work").map((item) =>
        item.kind === "registry-work-item" ? item.typeKey : item.entityType
      )
    ).toEqual(["WORK_FIRST", "WORK_FOURTH"]);
    expect(
      itemsFor(first, "knowledge").map((item) =>
        item.kind === "registry-work-item" ? item.typeKey : item.entityType
      )
    ).toEqual([
      "KNOWLEDGE_SECOND",
      "KNOWLEDGE_THIRD",
      EntityType.DesignDoc,
      EntityType.Task,
    ]);
  });
});
