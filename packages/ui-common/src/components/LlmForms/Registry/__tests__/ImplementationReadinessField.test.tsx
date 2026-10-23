import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  ImplementationReadinessPayload,
  SecondaryActionConfig,
} from "../../../../api";
import { SecondaryActionHandler } from "../../../../api";
import { ImplementationReadinessField } from "../ImplementationReadinessField";
import { ImplementationReadinessSecondaryAction } from "../ImplementationReadinessSecondaryAction";
import { buildImplementationReadinessDispositionValue } from "../implementationReadinessUtils";
import type {
  FieldComponentContext,
  FieldConfig,
  SecondaryActionRenderContext,
} from "../types";

const payload: ImplementationReadinessPayload = {
  responseType: "implementation_readiness_v1",
  disposition: {
    state: "REVIEW_REQUIRED",
    sourceSnapshot: {
      runId: "run-1",
      focalEntityId: "task-1",
      focalEntityType: "TASK",
      sourceRevision: "sha256:source-1",
      capturedAt: "2026-09-17T20:00:00.000Z",
    },
    finding: {
      affectedSourceContext: "The task description and design doc",
      unresolvedDecision: "Which service owns persistence?",
      consequentialInventionRisk:
        "Implementation could assign ownership incorrectly.",
      boundedEvidence: [
        {
          category: "ownership",
          statement: "Two services are named without an authoritative choice.",
          sourceRef: "task.description",
        },
      ],
      answerKind: "Name the owning service.",
    },
    resolution: { kind: "NONE" },
  },
};

const context: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
  interaction: {} as FieldComponentContext["interaction"],
};

const config: FieldConfig = {
  field: "readiness-field",
  description: "Implementation readiness review",
  type: "implementation_readiness",
  payload,
};

const action = (label: string): SecondaryActionRenderContext["action"] =>
  ({
    id: `${label}-id`,
    label,
    disabled: false,
  } as SecondaryActionConfig);

const actionContext: SecondaryActionRenderContext["context"] = context;

describe("ImplementationReadinessField", () => {
  it("renders the read-only finding and bounded evidence", () => {
    render(
      <ImplementationReadinessField
        config={config}
        context={context}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId("implementation-readiness-field")
    ).toBeInTheDocument();
    const finding = screen.getByTestId("implementation-readiness-finding");
    const renderedMarkdown = finding.textContent ?? "";
    expect(renderedMarkdown.indexOf("## Issue")).toBeLessThan(
      renderedMarkdown.indexOf("## What could go wrong"),
    );
    expect(renderedMarkdown.indexOf("## What could go wrong")).toBeLessThan(
      renderedMarkdown.indexOf("## How to resolve"),
    );
    expect(finding).toHaveTextContent("The task description and design doc");
    expect(finding).toHaveTextContent("Which service owns persistence?");
    expect(finding).toHaveTextContent(
      "Implementation could assign ownership incorrectly."
    );
    expect(finding).toHaveTextContent("Name the owning service.");
    expect(finding).toHaveTextContent(
      "Two services are named without an authoritative choice."
    );
    expect(finding).not.toHaveTextContent("ownership:");
  });
});

describe("ImplementationReadinessSecondaryAction", () => {
  it("focuses the shared composer without executing a field-owned submission", async () => {
    const user = userEvent.setup();
    const onFocusComposer = vi.fn();
    const onExecute = vi.fn();

    render(
      <ImplementationReadinessSecondaryAction
        action={action("Clarify")}
        context={{ ...actionContext, onFocusComposer }}
        formValues={{}}
        onExecute={onExecute}
        kind="clarify"
      />
    );

    await user.click(
      screen.getByTestId("implementation-readiness-clarify-action")
    );

    expect(onFocusComposer).toHaveBeenCalledTimes(1);
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("confirmation-gates dismissal execution", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const formValues = { readiness: "displayed" };

    render(
      <ImplementationReadinessSecondaryAction
        action={action("Dismiss")}
        context={actionContext}
        formValues={formValues}
        onExecute={onExecute}
        kind="dismiss"
      />
    );

    await user.click(
      screen.getByTestId("implementation-readiness-dismiss-action")
    );
    expect(onExecute).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("implementation-readiness-dismiss-confirmation")
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("for this run");

    await user.click(
      screen.getByTestId("implementation-readiness-dismiss-confirm")
    );
    expect(onExecute).toHaveBeenCalledWith(formValues);
  });
});

describe("buildImplementationReadinessDispositionValue", () => {
  it("builds a workflow action from the displayed run/source binding", () => {
    const result = buildImplementationReadinessDispositionValue(
      SecondaryActionHandler.ImplementationReadinessDismiss,
      {
        fieldId: "readiness-field",
        payload: {
          handlerType: SecondaryActionHandler.ImplementationReadinessDismiss,
          runId: "run-1",
          sourceRevision: "sha256:source-1",
        },
      },
      { readiness: "displayed" },
    );

    expect(result).toEqual({
      readiness: "displayed",
      "readiness-field": {
        action: SecondaryActionHandler.ImplementationReadinessDismiss,
        payload: {
          runId: "run-1",
          sourceRevision: "sha256:source-1",
          confirmed: true,
        },
      },
    });
  });
});
