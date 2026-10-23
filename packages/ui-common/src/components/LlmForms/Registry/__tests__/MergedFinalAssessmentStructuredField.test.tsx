import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MergedFinalAssessmentStructuredField } from "../MergedFinalAssessmentStructuredField";
import type { FieldComponentContext, FieldConfig } from "../types";

const baseConfig: FieldConfig = {
  field: "coding_prompt_merged_final_assessment",
  description: "Merged Final Assessment",
  type: "agent_response",
};

const baseContext: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
  agentSessionId: "agent-session-1",
  messageId: "message-1",
  workflowAboutType: "task",
  workflowAboutId: "active-task",
};

const buildMergedValue = () => ({
  responseType: "merged_final_assessment_v1" as const,
  taskAssessment: {
    verdict: "completed" as const,
    summary: "All acceptance criteria met.",
    statusRecommendation: {
      status: "VERIFYING",
      reason: "Ready for manual verification.",
    },
  },
});

describe("MergedFinalAssessmentStructuredField", () => {
  it("renders task assessment verdict and summary", () => {
    render(
      <MergedFinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={buildMergedValue()}
      />
    );

    expect(screen.getByText("Final Assessment")).toBeInTheDocument();
    expect(screen.getByText("Verdict: completed")).toBeInTheDocument();
    expect(
      screen.getByText("Recommended status: VERIFYING")
    ).toBeInTheDocument();
    expect(
      screen.getByText("All acceptance criteria met.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ready for manual verification.")
    ).toBeInTheDocument();
  });

  it("renders empty state when value is not a valid merged payload", () => {
    render(
      <MergedFinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={null}
      />
    );

    expect(
      screen.getByText("Merged final assessment details are unavailable.")
    ).toBeInTheDocument();
  });

  it("renders hierarchyWalk entries as single lines", () => {
    render(
      <MergedFinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={{
          ...buildMergedValue(),
          hierarchyWalk: [
            {
              entityType: "feature",
              entityId: "feat-1",
              name: "Auth Module",
              distance: 1,
              action: "proposed_update",
              rationale:
                "Task completion changes feature progress from 60% to 80%",
            },
            {
              entityType: "feature",
              entityId: "feat-2",
              name: "Platform Security",
              distance: 2,
              action: "no_update",
              rationale: "No material change at this level",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Hierarchy Walk")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Auth Module [proposed_update] - Task completion changes feature progress from 60% to 80%"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Platform Security [no_update] - No material change at this level"
      )
    ).toBeInTheDocument();
  });

  it("does not render hierarchy walk section when array is empty", () => {
    render(
      <MergedFinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={{
          ...buildMergedValue(),
          hierarchyWalk: [],
        }}
      />
    );

    expect(screen.queryByText("Hierarchy Walk")).not.toBeInTheDocument();
  });

  it("does not render hierarchy walk section when field is missing", () => {
    render(
      <MergedFinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={buildMergedValue()}
      />
    );

    expect(screen.queryByText("Hierarchy Walk")).not.toBeInTheDocument();
  });

  it("renders empty state when responseType is wrong", () => {
    render(
      <MergedFinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={{ responseType: "wrong_type" }}
      />
    );

    expect(
      screen.getByText("Merged final assessment details are unavailable.")
    ).toBeInTheDocument();
  });
});
