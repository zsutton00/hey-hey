import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type {
  ImplementationReadinessPayload,
  SecondaryActionConfig,
} from "../../../../api";
import { SecondaryActionHandler } from "../../../../api";
import { ProjectContext } from "../../../../contexts";
import { createHeyTheme } from "../../../../contexts/ThemeContext";
import { ImplementationReadinessField } from "../ImplementationReadinessField";
import { ImplementationReadinessSecondaryAction } from "../ImplementationReadinessSecondaryAction";
import {
  buildImplementationReadinessDispositionValue,
  buildLegacyFindingMarkdown,
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
        {
          owner: {
            entityType: "TASK",
            entityId: LOGIN_ID,
            title: "Login task",
          },
          action: "Record the open question.",
          state: "DONE",
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

const renderField = (fieldConfig: FieldConfig) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProjectContext.Provider
          value={{
            organizationId: "org-1",
            projectId: "project-1",
            navigate: vi.fn(),
          }}
        >
          <ThemeProvider theme={createHeyTheme("light")}>
            <ImplementationReadinessField
              config={fieldConfig}
              context={context}
              isSubmitted={false}
            />
          </ThemeProvider>
        </ProjectContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("ImplementationReadinessField", () => {
  it("shows the problem as the lead and the parts in the required order", () => {
    renderField(config);

    expect(screen.getByTestId("implementation-readiness-field")).toBeVisible();
    expect(screen.getByText("Readiness review")).toBeInTheDocument();
    expect(screen.getByText("Blocks planning")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-card-lead")).toHaveTextContent(
      "The home page depends on an undecided recognition method.",
    );
    expect(
      screen
        .getAllByTestId("conversation-card-section-label")
        .map((label) => label.textContent),
    ).toEqual([
      "What you asked for",
      "How the agent got here",
      "What could go wrong",
      "Steps to fix",
    ]);
    expect(
      screen.getByTestId("implementation-readiness-ask-label"),
    ).toHaveTextContent("What I need from you");
  });

  it("numbers the trail and failure scenario with each source and explanation", () => {
    renderField(config);

    const [trail] = screen.getAllByTestId("conversation-card-related-rows");
    const rows = within(trail).getAllByTestId("conversation-card-related-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Home page task");
    expect(rows[0]).toHaveTextContent(
      "It reuses the login page's way of recognizing a local user.",
    );
    expect(rows[1]).toHaveTextContent("Login task");
    expect(
      within(
        screen.getByTestId("implementation-readiness-failure-scenario"),
      ).getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  it("names each fix step's owner, action and state", () => {
    renderField(config);

    const [, steps] = screen.getAllByTestId("conversation-card-related-rows");
    const rows = within(steps).getAllByTestId("conversation-card-related-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Login task");
    expect(rows[0]).toHaveTextContent(
      "Decide how the browser proves it is local.",
    );
    expect(rows[0]).toHaveTextContent("your decision");
    expect(rows[1]).toHaveTextContent("Home page task");
    expect(rows[1]).toHaveTextContent("work remaining");
    expect(rows[2]).toHaveTextContent("already done");
  });

  it("puts the request in the ask block and keeps evidence hidden", () => {
    renderField(config);

    expect(
      screen.getByTestId("implementation-readiness-ask"),
    ).toHaveTextContent("Decide the recognition method on the login task.");
    expect(
      screen.queryByText(/The login task lists recognition/),
    ).not.toBeInTheDocument();
  });

  it("still shows a finding saved in the earlier layout inside the card", () => {
    renderField({
      ...config,
      payload: {
        ...payload,
        disposition: {
          ...payload.disposition,
          finding: {
            affectedSourceContext: "The task description",
            unresolvedDecision: "Which service owns persistence?",
            consequentialInventionRisk: "Ownership could be assigned wrongly.",
            boundedEvidence: [],
            answerKind: "Name the owning service.",
          },
        },
      },
    });

    expect(screen.getByText("Readiness review")).toBeInTheDocument();
    const finding = screen.getByTestId("implementation-readiness-finding");
    expect(finding).toHaveTextContent("Issue");
    expect(finding).toHaveTextContent("Ownership could be assigned wrongly.");
    expect(finding).toHaveTextContent("Which service owns persistence?");
    expect(screen.queryByTestId("conversation-card-lead")).toBeNull();
  });
});

describe("buildLegacyFindingMarkdown", () => {
  it("keeps a finding saved in the earlier layout in its original layout", () => {
    const markdown = buildLegacyFindingMarkdown({
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
      <ThemeProvider theme={createHeyTheme("light")}>
        <ImplementationReadinessSecondaryAction
          action={action("Clarify")}
          context={{ ...actionContext, onFocusComposer }}
          formValues={{}}
          onExecute={onExecute}
          kind="clarify"
        />
      </ThemeProvider>,
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
