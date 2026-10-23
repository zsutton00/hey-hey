import { WORK_ITEM_TYPE_KEYS } from "../types/workItemTypes";
import type { TaskResponseDto } from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";
import { describe, expect, it } from "vitest";

import { buildTaskBreadcrumbItems } from "./TaskBreadcrumbs";

const buildTask = (overrides: Partial<TaskResponseDto> = {}): TaskResponseDto =>
  ({
    id: "task-1",
    name: "Current Task",
    type: WORK_ITEM_TYPE_KEYS.Standard,
    ...overrides,
  } as TaskResponseDto);

describe("buildTaskBreadcrumbItems", () => {
  it("renders project → task when no plan or parent is provided", () => {
    const items = buildTaskBreadcrumbItems({
      projectId: "project-1",
      projectName: "Project One",
      task: buildTask(),
    });

    const types = items.map((item) => item.type);
    expect(types).toEqual([undefined, "project", "task"]);

    expect(items.find((item) => item.type === "plan")).toBeUndefined();

    const taskItem = items.find((item) => item.entityId === "task-1");
    expect(taskItem?.isCurrent).toBe(true);
  });

  it("renders structural feature ancestors from project chrome to the task", () => {
    const items = buildTaskBreadcrumbItems({
      projectId: "project-1",
      projectName: "Project One",
      task: buildTask(),
      featureAncestors: [
        { id: "feature-root", name: "Product Experience" },
        { id: "feature-chrome", name: "Project Chrome" },
      ],
    });

    expect(items.map((item) => item.label)).toEqual([
      "Projects",
      "Project One",
      "Product Experience",
      "Project Chrome",
      "Current Task",
    ]);
    expect(items.find((item) => item.label === "Project Chrome")).toMatchObject(
      {
        type: "feature",
        entityId: "feature-chrome",
        to: "/projects/project-1/features/feature-chrome",
      }
    );
  });

  it("inserts a plan segment after the project when a plan is provided", () => {
    const items = buildTaskBreadcrumbItems({
      projectId: "project-1",
      projectName: "Project One",
      task: buildTask(),
      plan: { id: "plan-7", displayName: "Q2 Rollout" },
    });

    const types = items.map((item) => item.type);
    expect(types).toEqual([undefined, "project", "plan", "task"]);

    const planItem = items.find((item) => item.entityId === "plan-7");
    expect(planItem?.to).toBe(
      WebPathService.plan({ projectId: "project-1", planId: "plan-7" })
    );
    expect(planItem?.label).toBe("Q2 Rollout");

    const projectIndex = items.findIndex((item) => item.type === "project");
    const planIndex = items.findIndex((item) => item.type === "plan");
    const taskIndex = items.findIndex((item) => item.entityId === "task-1");
    expect(planIndex).toBe(projectIndex + 1);
    expect(taskIndex).toBeGreaterThan(planIndex);
  });

  it("places the plan segment before the task's parent breadcrumb", () => {
    const parent = buildTask({ id: "task-parent", name: "Parent Task" });
    const items = buildTaskBreadcrumbItems({
      projectId: "project-1",
      projectName: "Project One",
      task: buildTask(),
      parent,
      plan: { id: "plan-7", displayName: "Q2 Rollout" },
    });

    const types = items.map((item) => item.type);
    expect(types).toEqual([undefined, "project", "plan", "task", "task"]);

    const planIndex = items.findIndex((item) => item.entityId === "plan-7");
    const parentIndex = items.findIndex(
      (item) => item.entityId === "task-parent"
    );
    expect(parentIndex).toBe(planIndex + 1);
  });

  it("omits the parent crumb when the parent is a feature ancestor", () => {
    const parent = buildTask({
      id: "feature-chrome",
      name: "Project Chrome",
      type: WORK_ITEM_TYPE_KEYS.Feature,
    });
    const items = buildTaskBreadcrumbItems({
      projectId: "project-1",
      projectName: "Project One",
      task: buildTask(),
      parent,
      featureAncestors: [{ id: "feature-chrome", name: "Project Chrome" }],
    });

    expect(
      items.filter((item) => item.entityId === "feature-chrome")
    ).toHaveLength(1);
    expect(items.find((item) => item.entityId === "feature-chrome")?.kind).toBe(
      "feature"
    );
    expect(items.find((item) => item.entityId === "task-1")?.kind).toBe(
      "entity"
    );
  });

  it("uses canonical breadcrumb types for Diagram entities", () => {
    const workflow = buildTask({
      id: "workflow-1",
      name: "Triage Workflow",
      type: WORK_ITEM_TYPE_KEYS.Diagram,
    });
    const step = buildTask({
      id: "step-1",
      name: "Review Request",
      type: WORK_ITEM_TYPE_KEYS.DiagramElement,
    });
    const items = buildTaskBreadcrumbItems({
      projectId: "project-1",
      projectName: "Project One",
      task: step,
      parent: workflow,
    });

    expect(items.find((item) => item.entityId === "workflow-1")?.type).toBe(
      "diagram"
    );
    expect(items.find((item) => item.entityId === "step-1")?.type).toBe(
      "diagram_element"
    );
  });

  it("preserves a project-defined type and its registry label", () => {
    const items = buildTaskBreadcrumbItems({
      projectId: "project-1",
      projectName: "Project One",
      task: buildTask({ type: "MARKETING", name: "Launch campaign" }),
      taskTypeName: "Campaign",
    });

    expect(items.find((item) => item.entityId === "task-1")).toMatchObject({
      type: "marketing",
      typeLabel: "Campaign",
    });
  });
});
