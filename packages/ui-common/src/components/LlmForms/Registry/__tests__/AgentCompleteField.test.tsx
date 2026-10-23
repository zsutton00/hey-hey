import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentCompleteField } from "../AgentCompleteField";
import { FIELD_REGISTRY } from "../Registry";
import type { FieldComponentContext, FieldConfig } from "../types";

const baseConfig: FieldConfig = {
  field: "agent_complete_field",
  description: "Agent Complete",
  type: "agent_complete",
};

const baseContext: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
};

describe("AgentCompleteField", () => {
  it("renders with the expected test id", () => {
    render(
      <AgentCompleteField
        config={baseConfig}
        isSubmitted={false}
        context={baseContext}
      />
    );

    expect(
      screen.getByTestId("agent-complete-field-agent_complete_field")
    ).toBeInTheDocument();
  });

  it("is registered with dynamicSecondaryActions", () => {
    const entry = FIELD_REGISTRY["agent_complete"];
    expect(entry).toBeDefined();
    expect(entry.dynamicSecondaryActions).toEqual({
      actionHint: "task_complete",
    });
  });

  it("reports hasContent as true", () => {
    const entry = FIELD_REGISTRY["agent_complete"];
    expect(entry.getHasContent(undefined)).toBe(true);
  });

  it("hides form-level buttons", () => {
    const entry = FIELD_REGISTRY["agent_complete"];
    expect(entry.shouldShowButtons?.(undefined)).toBe(false);
  });
});
