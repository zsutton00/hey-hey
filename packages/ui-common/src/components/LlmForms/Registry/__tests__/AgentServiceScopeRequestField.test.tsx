import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentServiceScopeRequestField } from "../AgentServiceScopeRequestField";
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
  id: "scope-request-1",
  runId: "run-1",
  sessionId: "session-1",
  agentId: "coding-freeform",
  agentType: "codex" as const,
  timestamp: "2026-08-10T00:00:00.000Z",
  idempotencyToken: "scope-idem-1",
  currentServiceIds: ["service-cli"],
  requestedServiceIds: ["service-cli", "service-api"],
  reason: "Need to update the API contract.",
};
const renderField = () =>
  render(
    <AgentServiceScopeRequestField
      config={{
        field: "service-scope",
        description: "Service scope",
        type: "agent_request_service_scope",
        payload: {
          responseType: "agent_request_service_scope_v1",
          serviceScopeRequest: request,
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
describe("AgentServiceScopeRequestField", () => {
  beforeEach(() => {
    submitDecisionMock.mockClear();
  });

  it("renders current and proposed Services by name and submits approval", async () => {
    useServicesMock.mockReturnValue({
      services: [
        { id: "service-cli", name: "CLI" },
        { id: "service-api", name: "API" },
      ],
      isLoading: false,
      error: null,
    });
    renderField();
    expect(screen.getByText("Current scope: CLI")).toBeInTheDocument();
    expect(screen.getByText("Proposed scope: CLI, API")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agent-service-scope-approve"));
    await vi.waitFor(() =>
      expect(submitDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "approve",
          requestId: "scope-request-1",
          idempotencyToken: "scope-idem-1",
        })
      )
    );
  });

  it("keeps denial available when a requested Service is unavailable", async () => {
    useServicesMock.mockReturnValue({
      services: [{ id: "service-cli", name: "CLI" }],
      isLoading: false,
      error: null,
    });
    renderField();
    expect(
      screen.getByTestId("agent-service-scope-unresolved-scope-request-1")
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();

    await userEvent.click(screen.getByTestId("agent-service-scope-deny"));
    await vi.waitFor(() =>
      expect(submitDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "deny",
          requestId: "scope-request-1",
        })
      )
    );
  });

  it("keeps denial available when the Service lookup fails", async () => {
    useServicesMock.mockReturnValue({
      services: [],
      isLoading: false,
      error: new Error("network unavailable"),
    });
    renderField();
    expect(
      screen.getByTestId("agent-service-scope-error-scope-request-1")
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();

    await userEvent.click(screen.getByTestId("agent-service-scope-deny"));
    await vi.waitFor(() =>
      expect(submitDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "deny",
          requestId: "scope-request-1",
        })
      )
    );
  });
});
