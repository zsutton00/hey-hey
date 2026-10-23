import { describe, expect, it } from "vitest";
import { getPathService } from "../../services";
import { buildEntityHref } from "../buildEntityHref";

describe("buildEntityHref", () => {
  it.each(["STANDARD", "mockups_v2", "mockups_v3", "CONTRACT"])(
    "builds the task path for the registry work-item key %s",
    (entityType) => {
      expect(
        buildEntityHref(getPathService(), "project-1", {
          entityType,
          entityId: "item-1",
        }),
      ).toBe("/projects/project-1/tasks/item-1");
    },
  );

  it("routes BUG mentions through the task-backed work-item path", () => {
    expect(
      buildEntityHref(getPathService(), "project-1", {
        entityType: "BUG",
        entityId: "bug-1",
      }),
    ).toBe("/projects/project-1/tasks/bug-1");
  });

  it("routes workflow mentions through the task-backed work-item path", () => {
    expect(
      buildEntityHref(getPathService(), "project-1", {
        entityType: "workflow",
        entityId: "workflow-1",
      }),
    ).toBe("/projects/project-1/tasks/workflow-1");
  });

  it("keeps task hrefs unchanged", () => {
    expect(
      buildEntityHref(getPathService(), "project-1", {
        entityType: "task",
        entityId: "task-1",
      }),
    ).toBe("/projects/project-1/tasks/task-1");
  });

  it("routes report mentions through the project report path", () => {
    expect(
      buildEntityHref(getPathService(), "project-1", {
        entityType: "report",
        entityId: "report-1",
      }),
    ).toBe("/projects/project-1/reports/report-1");
  });

  it("routes proposal mentions through the canonical proposal path", () => {
    expect(
      buildEntityHref(getPathService(), "project-1", {
        entityType: "PROPOSAL",
        entityId: "proposal-1",
      }),
    ).toBe("/projects/project-1/proposals/proposal-1");
  });

  it("routes conversation mentions through the agent-session resolver", () => {
    expect(
      buildEntityHref(getPathService(), "project-1", {
        entityType: "conversation",
        entityId: "conversation-1",
      }),
    ).toBe("/projects/project-1/resolve-agent-session/conversation-1");
  });
});
