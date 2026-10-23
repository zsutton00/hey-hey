import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentReviewFileScopeRequestField } from "../AgentReviewFileScopeRequestField";

const useServicesMock = vi.fn();

const submitDecisionMock = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision",
  () => ({
    useSubmitControllerAuthorizedPermissionDecision: () => ({
      submit: submitDecisionMock,
      isPending: false,
    }),
  })
);
vi.mock("../../../../data/hooks/useServices", () => ({
  useServices: (...args: unknown[]) => useServicesMock(...args),
}));

const request = {
  id: "review-file-request-1",
  runId: "run-1",
  sessionId: "session-1",
  agentId: "code_review",
  agentType: "codex" as const,
  timestamp: "2026-08-14T00:00:00.000Z",
  idempotencyToken: "review-file-idem-1",
  files: new Set([
    {
      serviceId: "service-cli",
      filePath: "src/run/run.ts",
      reason: "The repair must update the durable lifecycle owner.",
    },
  ]),
};

const renderField = () =>
  render(
    <AgentReviewFileScopeRequestField
      config={{
        field: "review-file-scope",
        description: "Review file scope",
        type: "agent_request_review_file_scope",
        payload: {
          responseType: "agent_request_review_file_scope_v1",
          reviewFileScopeRequest: request,
        },
      }}
      context={{
        conversationId: "conversation-1",
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
      }}
      isSubmitted={false}
    />
  );

describe("AgentReviewFileScopeRequestField", () => {
  beforeEach(() => {
    submitDecisionMock.mockReset();
  });

  it("renders Service names, exact paths, reasons, and submits approval", async () => {
    useServicesMock.mockReturnValue({
      services: [{ id: "service-cli", name: "CLI" }],
      isLoading: false,
      error: null,
    });
    renderField();

    expect(screen.getByText("CLI: src/run/run.ts")).toBeInTheDocument();
    expect(
      screen.getByText("The repair must update the durable lifecycle owner.")
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByTestId("agent-review-file-scope-approve")
    );

    await vi.waitFor(() =>
      expect(submitDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "approve",
          requestId: "review-file-request-1",
          idempotencyToken: "review-file-idem-1",
        })
      )
    );
  });

  it("disables approval without exposing an unresolved Service id and keeps denial", async () => {
    useServicesMock.mockReturnValue({
      services: [],
      isLoading: false,
      error: null,
    });
    renderField();

    expect(
      screen.getByTestId("agent-review-file-scope-resolution-error")
    ).toBeInTheDocument();
    expect(screen.queryByText("service-cli")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-review-file-scope-approve")
    ).toBeDisabled();

    await userEvent.click(screen.getByTestId("agent-review-file-scope-deny"));
    await vi.waitFor(() =>
      expect(submitDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "deny",
        })
      )
    );
  });

  it("keeps denial available when Service resolution fails", async () => {
    useServicesMock.mockReturnValue({
      services: [],
      isLoading: false,
      error: new Error("unavailable"),
    });
    renderField();

    expect(
      screen.getByTestId("agent-review-file-scope-approve")
    ).toBeDisabled();
    await userEvent.click(screen.getByTestId("agent-review-file-scope-deny"));
    await vi.waitFor(() => expect(submitDecisionMock).toHaveBeenCalledOnce());
  });
});
