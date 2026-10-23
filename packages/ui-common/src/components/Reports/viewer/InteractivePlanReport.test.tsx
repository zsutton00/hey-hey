import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ReportAudience,
  ReportType,
  type PlanReportPayload,
  type ReportDto,
} from "../../../api";
import type { StartupPlanStructuredResponseValue } from "../../LlmForms/Registry/StartupPlanStructuredField";
import {
  InteractivePlanReport,
  projectInteractivePlanSubmission,
  toStartupPlanResponse,
  type PlanReportInteractionContext,
} from "./InteractivePlanReport";

vi.mock("../../LlmForms/Registry/StartupPlanStructuredField", () => ({
  StartupPlanStructuredField: ({ value, onValidityChange, disabled }) => (
    <div data-testid="startup-plan-field-mock" data-disabled={disabled}>
      <span>{value.sessionTitle}</span>
      <button
        data-testid="mark-plan-valid"
        onClick={() => onValidityChange?.("valid")}
        type="button"
      >
        valid
      </button>
    </div>
  ),
  isStartupPlanStructuredResponseValue: (value: unknown) =>
    typeof value === "object" && value !== null && "responseType" in value,
}));

const payload: PlanReportPayload = {
  reportType: "PLAN",
  summary: "Review this durable plan without editing its output state.",
  sessionTitle: "Interactive PLAN attachment",
  requiredServiceIds: new Set(["service-1"]),
  primaryImplementations: [],
  executionPlan: [],
  discrepancies: [],
  clarificationQuestions: [],
};

const report: ReportDto = {
  id: "plan-report-1",
  organizationId: "org-1",
  audience: ReportAudience.ProjectVisible,
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "run-1",
  createdAt: "2026-08-20T00:00:00.000Z",
  expiresAt: null,
  entities: [],
  reportType: ReportType.Plan,
  title: "Interactive PLAN attachment",
  payload,
};

const buildInteraction = (submit = vi.fn()): PlanReportInteractionContext => ({
  sourceUiElement: {
    id: "startup-plan-field",
    type: "coding_prompt_startup_plan",
    label: "Startup plan",
  },
  parentMessageId: "message-1",
  fieldContext: {
    conversationId: "conversation-1",
    projectId: "project-1",
    organizationId: "org-1",
    messageId: "message-1",
  },
  disabled: false,
  submit,
});

describe("InteractivePlanReport", () => {
  it("adapts only the startup-plan input vocabulary", () => {
    expect(toStartupPlanResponse(payload)).toEqual({
      responseType: "startup_plan_v1",
      sessionTitle: "Interactive PLAN attachment",
      requiredServiceIds: new Set(["service-1"]),
      primaryImplementations: [],
      executionPlan: [],
      discrepancies: [],
      clarificationQuestions: [],
    });
  });

  it("projects APPROVED and REFINE with the inner startup-plan payload", () => {
    const submit = vi.fn();
    const context = buildInteraction(submit);
    const value: StartupPlanStructuredResponseValue = {
      ...toStartupPlanResponse(payload),
      feedback: "Keep the typed renderer boundary.",
    };

    projectInteractivePlanSubmission({
      context,
      value,
      action: "APPROVED",
    });
    projectInteractivePlanSubmission({
      context,
      value,
      action: "REFINE",
    });

    expect(submit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        "startup-plan-field": {
          action: "APPROVED",
          payload: expect.objectContaining({
            feedback: "Keep the typed renderer boundary.",
          }),
        },
        comment: expect.stringContaining("Keep the typed renderer boundary."),
      }),
      "message-1"
    );
    expect(submit).toHaveBeenNthCalledWith(
      2,
      {
        "startup-plan-field": {
          action: "REFINE",
          payload: expect.objectContaining({
            feedback: "Keep the typed renderer boundary.",
          }),
        },
      },
      "message-1"
    );
  });

  it("renders report output state read-only while delegating the plan hierarchy to the startup review field", () => {
    const submit = vi.fn();
    render(
      <InteractivePlanReport
        interaction={buildInteraction(submit)}
        payload={payload}
        report={report}
        reportTestId="interactive-plan"
      />
    );

    expect(
      screen.getByTestId("interactive-plan-plan-summary")
    ).toHaveTextContent("Review this durable plan");
    expect(screen.getByTestId("startup-plan-field-mock")).toHaveTextContent(
      "Interactive PLAN attachment"
    );
    expect(
      screen.getByTestId("interactive-plan-approve-button")
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId("mark-plan-valid"));
    fireEvent.click(screen.getByTestId("interactive-plan-approve-button"));

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        "startup-plan-field": expect.objectContaining({
          action: "APPROVED",
          payload: expect.objectContaining({
            responseType: "startup_plan_v1",
          }),
        }),
      }),
      "message-1"
    );
  });

  it("keeps the interactive presentation visible but disables review controls when submission is unavailable", () => {
    const submit = vi.fn();
    render(
      <InteractivePlanReport
        interaction={{ ...buildInteraction(submit), disabled: true }}
        payload={payload}
        report={report}
        reportTestId="disabled-interactive-plan"
      />
    );

    expect(screen.getByTestId("startup-plan-field-mock")).toHaveAttribute(
      "data-disabled",
      "true"
    );
    fireEvent.click(screen.getByTestId("mark-plan-valid"));
    expect(
      screen.getByTestId("interactive-plan-approve-button")
    ).toBeDisabled();
    expect(
      screen.getByTestId("interactive-plan-continue-refining-button")
    ).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });
});
