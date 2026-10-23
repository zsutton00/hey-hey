import { describe, expect, it } from "vitest";
import { getWorkflowAboutTypeForEntityType } from "../agentSessionUtils";

describe("getWorkflowAboutTypeForEntityType", () => {
  it.each([
    ["AGENT_SESSION", "agent-session"],
    ["agent_session", "agent-session"],
    ["agent-session", "agent-session"],
    ["DESIGN_DOC", "design-doc"],
    ["TASK", "task"],
  ])("maps %s to %s", (entityType, expected) => {
    expect(getWorkflowAboutTypeForEntityType(entityType)).toBe(expected);
  });

  it("returns undefined for an entity type without a workflow-about mapping", () => {
    expect(getWorkflowAboutTypeForEntityType("SERVICE")).toBeUndefined();
  });
});
