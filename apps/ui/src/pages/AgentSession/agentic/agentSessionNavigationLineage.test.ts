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
        })
      ).toEqual([
        { entityType: "task", entityId: "plan-1" },
        { entityType: "task", entityId: "stage-1" },
        { entityType: "task", entityId: "task-1" },
      ]);
    }
  );

  it.each(["project", "plan", "task"] as const)(
    "retains standalone ancestry on %s routes",
    (routeFamily) => {
      expect(
        buildAgentSessionNavigationLineage({
          routeFamily,
          taskId: "task-1",
        })
      ).toEqual([{ entityType: "task", entityId: "task-1" }]);
      expect(
        buildAgentSessionNavigationLineage({ routeFamily: "project" })
      ).toBeNull();
    }
  );
});
