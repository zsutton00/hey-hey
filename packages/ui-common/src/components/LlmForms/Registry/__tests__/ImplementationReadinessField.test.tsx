import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type {
  ImplementationReadinessPayload,
  SecondaryActionConfig,
} from "../../../../api";
import { SecondaryActionHandler } from "../../../../api";
import { ImplementationReadinessField } from "../ImplementationReadinessField";
import { ImplementationReadinessSecondaryAction } from "../ImplementationReadinessSecondaryAction";
import {
  buildImplementationReadinessDispositionValue,
  buildImplementationReadinessFindingMarkdown,
} from "../implementationReadinessUtils";
import type {
  FieldComponentContext,
  FieldConfig,
  SecondaryActionRenderContext,
} from "../types";

const HOME_ID = "c9a7158b-4817-4a78-a2f7-671de909ec78";
const LOGIN_ID = "0f5e6126-08ca-4b16-af4e-0e6044cba183";

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
      requestedOutcome: "You asked for local users to land in their workspace.",
      reasoningTrail: [
        {
          source: {
            entityType: "TASK",
            entityId: HOME_ID,
            title: "Home page task",
          },
          explanation:
            "It reuses the login page's way of recognizing a local user.",
        },
        {
          source: {
            entityType: "TASK",
            entityId: LOGIN_ID,
            title: "Login task",
          },
          explanation: "It has not decided how the browser proves it is local.",
        },
      ],
      problem: "The home page depends on an undecided recognition method.",
      failureScenario: [
        "A local user opens the home page.",
        "The page needs to recognize the browser.",
        "No method exists, so the page would invent one.",
      ],
      fixSteps: [
        {
          owner: {
            entityType: "TASK",
            entityId: LOGIN_ID,
            title: "Login task",
          },
          action: "Decide how the browser proves it is local.",
          state: "USER_DECISION",
        },
        {
          owner: {
            entityType: "TASK",
            entityId: HOME_ID,
            title: "Home page task",
          },
          action: "Reuse the decided method.",
          state: "REMAINING",
        },
      ],
      userRequest: "Decide the recognition method on the login task.",
      boundedEvidence: [
        {
          category: "security",
          statement: "The login task lists recognition as an open question.",
        },
      ],
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
  }) as SecondaryActionConfig;

const actionContext: SecondaryActionRenderContext["context"] = context;

describe("ImplementationReadinessField", () => {
  it("renders the read-only finding and bounded evidence", () => {
    render(
      <MemoryRouter>
        <ImplementationReadinessField
          config={config}
          context={context}
          isSubmitted={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("implementation-readiness-field"),
    ).toBeInTheDocument();
    const finding = screen.getByTestId("implementation-readiness-finding");
    const renderedMarkdown = finding.textContent ?? "";
    const headings = [
      "## What you asked for",
      "## How the agent got here",
      "## The problem",
      "## What could go wrong",
      "## Steps to fix",
      "## What I need from you",
    ].map((heading) => renderedMarkdown.indexOf(heading));
    expect(headings.every((position) => position >= 0)).toBe(true);
    expect([...headings].sort((x, y) => x - y)).toEqual(headings);
    expect(finding).toHaveTextContent(
      "The page needs to recognize the browser.",
    );
    expect(finding).toHaveTextContent(
      "Decide the recognition method on the login task.",
    );
    expect(finding).not.toHaveTextContent("The login task lists recognition");
  });
});

describe("buildImplementationReadinessFindingMarkdown", () => {
  const finding = payload.disposition.finding;

  it("numbers the scenario, links each source and owner, and labels step states", () => {
    if (!finding) {
      throw new Error("fixture finding missing");
    }

    const markdown = buildImplementationReadinessFindingMarkdown(finding);

    expect(markdown).toContain(`1. @[task:${HOME_ID}|Home page task] — `);
    expect(markdown).toContain(`2. @[task:${LOGIN_ID}|Login task] — `);
    expect(markdown).toContain("1. A local user opens the home page.");
    expect(markdown).toContain(
      `1. Decide how the browser proves it is local. — @[task:${LOGIN_ID}|Login task] (your decision)`,
    );
    expect(markdown).toContain(
      `2. Reuse the decided method. — @[task:${HOME_ID}|Home page task] (work remaining)`,
    );
  });

  it("keeps a finding saved in the earlier layout in its original layout", () => {
    const markdown = buildImplementationReadinessFindingMarkdown({
      affectedSourceContext: "The task description",
      unresolvedDecision: "Which service owns persistence?",
      consequentialInventionRisk: "Ownership could be assigned incorrectly.",
      boundedEvidence: [
        { category: "ownership", statement: "Two services named." },
      ],
      answerKind: "Name the owning service.",
    });

    expect(markdown).toContain("## Issue");
    expect(markdown).toContain("## How to resolve");
    expect(markdown).not.toContain("## The problem");
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
      />,
    );

    await user.click(
      screen.getByTestId("implementation-readiness-clarify-action"),
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
      />,
    );

    await user.click(
      screen.getByTestId("implementation-readiness-dismiss-action"),
    );
    expect(onExecute).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("implementation-readiness-dismiss-confirmation"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("for this run");

    await user.click(
      screen.getByTestId("implementation-readiness-dismiss-confirm"),
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
