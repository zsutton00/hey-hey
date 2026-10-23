import {
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import {
  buildProjectWorkspaceNavigation,
} from "@hey-hey/ui-common/data";
import { describe, expect, it } from "vitest";
import {
  getProjectNavigationItemKey,
  PROJECT_DESTINATIONS,
  resolveProjectDestination,
  resolveProjectNavigationItem,
} from "./projectNavigation";

const summary = (
  key: string,
  name: string,
  role: WorkItemTypeRole,
  overrides: Partial<WorkItemTypeSummaryDto> = {},
): WorkItemTypeSummaryDto => ({
  id: `type-${key}`,
  projectId: "project-1",
  status: WorkItemTypeLifecycleStatus.Active,
  effectiveSource: WorkItemTypeEffectiveSource.Canonical,
  definition: { key, name, role, sections: [], allowedStatuses: [] },
  ...overrides,
});

describe("projectNavigation", () => {
  it("defines the seven durable destinations in product order", () => {
    expect(PROJECT_DESTINATIONS).toEqual([
      { value: "overview", label: "Overview" },
      { value: "work", label: "Work" },
      { value: "reviews", label: "Reviews" },
      { value: "agents", label: "Agents" },
      { value: "knowledge", label: "Knowledge" },
      { value: "settings", label: "Settings" },
      { value: "help", label: "Help" },
    ]);
  });

  it("selects from the shared registry groups and preserves explicit adapters", () => {
    const groups = buildProjectWorkspaceNavigation(
      [
        summary("STANDARD", "Tasks", WorkItemTypeRole.WorkItem),
        summary("BUG", "Bugs", WorkItemTypeRole.WorkItem),
        summary("FEATURE", "Features", WorkItemTypeRole.ProjectInfo),
        summary("INITIATIVE", "Initiatives", WorkItemTypeRole.ProjectInfo),
        summary("SCHEDULED_REPORT", "Reports", WorkItemTypeRole.Scheduled),
        summary("WEBHOOK", "Webhooks", WorkItemTypeRole.Trigger),
        summary("TASK_MONITOR", "Task Monitors", WorkItemTypeRole.Monitor),
      ],
      "project-1",
    ).groups;

    expect(groups[0]?.items.map(getProjectNavigationItemKey)).toEqual([
      "STANDARD",
      "BUG",
    ]);
    expect(groups[1]?.items.map(getProjectNavigationItemKey)).toEqual([
      "FEATURE",
      "DESIGN_DOC",
      "PLAN",
    ]);
  });

  it("keeps an empty Work group while retaining Knowledge adapters", () => {
    const groups = buildProjectWorkspaceNavigation(
      [
        summary("ARCHIVED", "Archived", WorkItemTypeRole.WorkItem, {
          status: WorkItemTypeLifecycleStatus.Archived,
        }),
        summary("OTHER", "Other project", WorkItemTypeRole.WorkItem, {
          projectId: "project-2",
        }),
      ],
      "project-1",
    ).groups;

    expect(groups[0]).toEqual({ key: "work", label: "Work", items: [] });
    expect(groups[1]?.items.map(getProjectNavigationItemKey)).toEqual([
      "DESIGN_DOC",
      "PLAN",
    ]);
  });

  it.each([
    [null, "overview"],
    ["overview", "overview"],
    ["project", "overview"],
    ["tasks", "work"],
    ["bugs", "work"],
    ["features", "knowledge"],
    ["plans", "knowledge"],
    ["knowledge-base", "knowledge"],
    ["design-docs", "knowledge"],
    ["help", "help"],
    ["unknown", "overview"],
  ] as const)("resolves tab %s to %s", (tab, expected) => {
    expect(resolveProjectDestination(tab)).toBe(expected);
  });

  it("preserves pre-overhaul role tabs while using the durable destinations", () => {
    const groups = buildProjectWorkspaceNavigation(
      [
        summary("STANDARD", "Tasks", WorkItemTypeRole.WorkItem),
        summary("BUG", "Bugs", WorkItemTypeRole.WorkItem),
        summary("FEATURE", "Features", WorkItemTypeRole.ProjectInfo),
      ],
      "project-1",
    ).groups;

    expect(resolveProjectDestination(WorkItemTypeRole.WorkItem)).toBe("work");
    expect(resolveProjectDestination(WorkItemTypeRole.ProjectInfo)).toBe(
      "knowledge",
    );
    expect(
      getProjectNavigationItemKey(
        resolveProjectNavigationItem(
          groups,
          WorkItemTypeRole.WorkItem,
          "BUG",
        )!,
      ),
    ).toBe("BUG");
    expect(
      resolveProjectNavigationItem(
        groups,
        WorkItemTypeRole.ProjectInfo,
        "DESIGN_DOC",
      )?.kind,
    ).toBe("design-doc");
  });

  it("resolves stable type keys and every compatible legacy URL", () => {
    const groups = buildProjectWorkspaceNavigation(
      [
        summary("STANDARD", "Tasks", WorkItemTypeRole.WorkItem),
        summary("BUG", "Bugs", WorkItemTypeRole.WorkItem),
        summary("FEATURE", "Features", WorkItemTypeRole.ProjectInfo),
      ],
      "project-1",
    ).groups;

    expect(
      getProjectNavigationItemKey(
        resolveProjectNavigationItem(groups, "work", "BUG")!,
      ),
    ).toBe("BUG");
    expect(
      getProjectNavigationItemKey(
        resolveProjectNavigationItem(groups, "knowledge", "FEATURE")!,
      ),
    ).toBe("FEATURE");
    expect(
      getProjectNavigationItemKey(
        resolveProjectNavigationItem(groups, "tasks", null)!,
      ),
    ).toBe("STANDARD");
    expect(
      getProjectNavigationItemKey(
        resolveProjectNavigationItem(groups, "bugs", null)!,
      ),
    ).toBe("BUG");
    expect(
      getProjectNavigationItemKey(
        resolveProjectNavigationItem(groups, "features", null)!,
      ),
    ).toBe("FEATURE");
    expect(resolveProjectNavigationItem(groups, "plans", null)?.kind).toBe(
      "plan",
    );
    expect(
      resolveProjectNavigationItem(groups, "knowledge-base", null)?.kind,
    ).toBe("design-doc");
    expect(resolveProjectNavigationItem(groups, "reviews", null)).toBeUndefined();
  });
});
