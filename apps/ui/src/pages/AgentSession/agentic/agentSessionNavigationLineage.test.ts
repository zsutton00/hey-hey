import { describe, expect, it } from "vitest";
import { buildAgentSessionNavigationLineage } from "./agentSessionNavigationLineage";

describe("buildAgentSessionNavigationLineage", () => {
  it.each(["project", "plan", "task"] as const)(
    "preserves ordered plan ancestry on %s routes",
    (routeFamily) => {
      expect(
        buildAgentSessionNavigationLineage({
          routeFamily,
          planId: "plan-1",
          stageId: "stage-1",
          stepId: "step-1",
          taskId: "task-1",
        }),
      ).toEqual([
        { entityType: "task", entityId: "plan-1" },
        { entityType: "task", entityId: "stage-1" },
        { entityType: "task", entityId: "task-1" },
      ]);
    },
  );

  it("appends the parent session after task lineage without displacing it", () => {
    expect(
      buildAgentSessionNavigationLineage({
        routeFamily: "task",
        taskId: "task-1",
        parentAgentSessionId: "parent-session",
      }),
    ).toEqual([
      { entityType: "task", entityId: "task-1" },
      { entityType: "agent_session", entityId: "parent-session" },
    ]);
    expect(
      buildAgentSessionNavigationLineage({
        routeFamily: "project",
        parentAgentSessionId: "parent-session",
      }),
    ).toEqual([{ entityType: "agent_session", entityId: "parent-session" }]);
  });

  it.each(["project", "plan", "task"] as const)(
    "retains standalone ancestry on %s routes",
    (routeFamily) => {
      expect(
        buildAgentSessionNavigationLineage({
          routeFamily,
          taskId: "task-1",
        }),
      ).toEqual([{ entityType: "task", entityId: "task-1" }]);
      expect(
        buildAgentSessionNavigationLineage({ routeFamily: "project" }),
      ).toBeNull();
    },
  );
});
