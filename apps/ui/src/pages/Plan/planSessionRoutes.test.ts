import { describe, expect, it } from "vitest";
import {
  buildPlanStepTabPath,
  buildPlanAgentSessionPath,
  buildPlanDetailPath,
  buildPlanTabPath,
  buildPlanTaskMonitorPath,
  buildPlanTaskMonitorSetupPath,
  buildPlansIndexPath,
  buildPlanStepPath,
} from "./planSessionRoutes";

describe("planSessionRoutes", () => {
  it("builds plans, plan, and step paths", () => {
    expect(buildPlansIndexPath("project-1")).toBe("/projects/project-1/plans");
    expect(buildPlanDetailPath("project-1", "plan-1")).toBe(
      "/projects/project-1/plans/plan-1",
    );
    expect(buildPlanStepPath("project-1", "plan-1", "stage-1", "step-1")).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1",
    );
  });

  it("builds the canonical stage-scoped Task Monitor setup path", () => {
    expect(
      buildPlanTaskMonitorSetupPath("project-1", "plan-1", "stage-1"),
    ).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/setup",
    );
  });

  it("builds the Plan-hosted Task Monitor path", () => {
    expect(
      buildPlanTaskMonitorPath("project-1", "plan-1", "stage-1", "monitor-1"),
    ).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/monitor-1",
    );
    expect(
      buildPlanTaskMonitorPath("project-1", "plan-1", undefined, "monitor-1"),
    ).toBe("/projects/project-1/plans/plan-1/task-monitor/monitor-1");
  });

  it("builds canonical selected-plan tab destinations", () => {
    expect(buildPlanTabPath("project-1", "plan-1", "stage-1", "plan")).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1",
    );
    expect(
      buildPlanTabPath("project-1", "plan-1", "stage-1", "documents"),
    ).toBe("/projects/project-1/plans/plan-1/stages/stage-1?tab=documents");
    expect(
      buildPlanTabPath("project-1", "plan-1", "stage-1", "automation"),
    ).toBe("/projects/project-1/plans/plan-1/stages/stage-1?tab=automation");
  });

  it("builds a step-scoped coding session path when stage and step are provided", () => {
    expect(
      buildPlanAgentSessionPath(
        "project-1",
        "plan-1",
        "session-1",
        "stage-1",
        "step-1",
      ),
    ).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1/agent-sessions/session-1",
    );
  });

  it("falls back to a plan-scoped coding session path when step context is missing", () => {
    expect(buildPlanAgentSessionPath("project-1", "plan-1", "session-1")).toBe(
      "/projects/project-1/plans/plan-1/agent-sessions/session-1",
    );
  });

  it("builds step tab paths with query parameters for non-details tabs", () => {
    expect(
      buildPlanStepTabPath(
        "project-1",
        "plan-1",
        "stage-1",
        "step-1",
        "details",
      ),
    ).toBe("/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1");
    expect(
      buildPlanStepTabPath(
        "project-1",
        "plan-1",
        "stage-1",
        "step-1",
        "agent-sessions",
      ),
    ).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1?tab=agent-sessions",
    );
    expect(
      buildPlanStepTabPath(
        "project-1",
        "plan-1",
        "stage-1",
        "step-1",
        "relationships",
      ),
    ).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1?tab=relationships",
    );
    expect(
      buildPlanStepTabPath(
        "project-1",
        "plan-1",
        "stage-1",
        "step-1",
        "outbox",
      ),
    ).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1?tab=outbox",
    );
  });
});
