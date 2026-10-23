import { describe, expect, it } from "vitest";
import { buildAgentSessionPageComposition } from "./agentSessionPageComposition";

const presentation = {
  kind: "agent_session" as const,
  label: "API - Fix retries",
  sessionType: "CODING" as const,
};

describe("buildAgentSessionPageComposition", () => {
  it("retains the associated work item on a general project session", () => {
    expect(
      buildAgentSessionPageComposition({
        preview: false,
        routeFamily: "project",
        agentSessionId: "session-1",
        taskId: "task-from-session",
        presentation,
      })
    ).toEqual({
      kind: "canonical",
      descriptor: {
        entityType: "agent_session",
        entityId: "session-1",
        lineage: [{ entityType: "task", entityId: "task-from-session" }],
        presentation,
      },
    });
  });

  it("uses plan route parameters and the resolved task for a plan-owned session", () => {
    expect(
      buildAgentSessionPageComposition({
        preview: false,
        routeFamily: "plan",
        agentSessionId: "session-1",
        planId: "plan-1",
        stageId: "stage-1",
        stepId: "step-1",
        taskId: "task-from-session",
        presentation,
      })
    ).toMatchObject({
      kind: "canonical",
      descriptor: {
        entityType: "agent_session",
        entityId: "session-1",
        lineage: [
          { entityType: "task", entityId: "plan-1" },
          { entityType: "task", entityId: "stage-1" },
          { entityType: "task", entityId: "task-from-session" },
        ],
      },
    });
  });

  it("uses the task route parameter for a standalone task session", () => {
    expect(
      buildAgentSessionPageComposition({
        preview: false,
        routeFamily: "task",
        agentSessionId: "session-1",
        taskId: "task-1",
        presentation,
      })
    ).toMatchObject({
      kind: "canonical",
      descriptor: {
        lineage: [{ entityType: "task", entityId: "task-1" }],
      },
    });
  });

  it("keeps Preview observational", () => {
    expect(
      buildAgentSessionPageComposition({
        preview: true,
        routeFamily: "project",
        agentSessionId: "session-1",
        taskId: "task-1",
        presentation,
      })
    ).toEqual({ kind: "observational" });
  });
});
