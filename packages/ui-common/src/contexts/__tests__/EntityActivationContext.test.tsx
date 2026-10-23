import { describe, expect, it } from "vitest";
import { createNavigationLineageEntry } from "../../types/userTracking";
import {
  createEntityActivation,
  entityActivationsEqual,
} from "../EntityActivationContext";

describe("entity activation", () => {
  it("requires canonical callers to declare null lineage explicitly", () => {
    expect(createEntityActivation("task", "task-123", null)).toEqual({
      entityType: "task",
      entityId: "task-123",
      lineage: null,
    });
  });

  it("compares ordered lineage members by value", () => {
    const first = createEntityActivation("agent_session", "session-123", [
      createNavigationLineageEntry("plan", "plan-123"),
      createNavigationLineageEntry("plan_step", "step-123"),
    ]);
    const equal = createEntityActivation("agent_session", "session-123", [
      createNavigationLineageEntry("plan", "plan-123"),
      createNavigationLineageEntry("plan_step", "step-123"),
    ]);
    const reordered = createEntityActivation("agent_session", "session-123", [
      createNavigationLineageEntry("plan_step", "step-123"),
      createNavigationLineageEntry("plan", "plan-123"),
    ]);

    expect(entityActivationsEqual(first, equal)).toBe(true);
    expect(entityActivationsEqual(first, reordered)).toBe(false);
  });

  it("compares presentation snapshots by value", () => {
    const presentation = {
      kind: "agent_session" as const,
      label: "API - Fix retries",
      sessionType: "CODING" as const,
    };
    const first = createEntityActivation(
      "agent_session",
      "session-123",
      null,
      presentation
    );
    const equal = createEntityActivation("agent_session", "session-123", null, {
      ...presentation,
    });
    const renamed = createEntityActivation(
      "agent_session",
      "session-123",
      null,
      { ...presentation, label: "API - Fix retry handling" }
    );

    expect(entityActivationsEqual(first, equal)).toBe(true);
    expect(entityActivationsEqual(first, renamed)).toBe(false);
  });

  it("compares all presentation labels and task types by value", () => {
    const first = createEntityActivation("design_doc", "doc-1", null, {
      kind: "design_doc",
      label: "Retry policy",
    });
    const equal = createEntityActivation("design_doc", "doc-1", null, {
      kind: "design_doc",
      label: "Retry policy",
    });
    const renamed = createEntityActivation("design_doc", "doc-1", null, {
      kind: "design_doc",
      label: "Request retry policy",
    });
    const task = createEntityActivation("task", "task-1", null, {
      kind: "task",
      label: "Retry policy",
      taskType: "STANDARD",
    });
    const retyped = createEntityActivation("task", "task-1", null, {
      kind: "task",
      label: "Retry policy",
      taskType: "BUG",
    });

    expect(entityActivationsEqual(first, equal)).toBe(true);
    expect(entityActivationsEqual(first, renamed)).toBe(false);
    expect(entityActivationsEqual(task, retyped)).toBe(false);
  });
});
