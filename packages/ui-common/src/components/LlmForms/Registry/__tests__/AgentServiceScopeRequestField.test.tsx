import { act, render, screen } from "@testing-library/react";
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
  }),
);
vi.mock("../../../../data/hooks/useServices", () => ({
  useServices: (...args: unknown[]) => useServicesMock(...args),
}));
const workInMock = vi.hoisted(() => ({
  choices: {} as Record<string, unknown>,
  services: [] as { serviceId: string; requireChoice?: boolean }[],
  change: null as null | ((choice: unknown) => void),
  setUnavailable: null as null | ((unavailable: boolean) => void),
}));
vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: "machine-1" } }),
}));
vi.mock("../../../AgentSession/ServicesWorkIn", () => ({
  ServicesWorkIn: ({
    services,
    choices,
    onChange,
    onUnavailableChange,
  }: {
    services: { serviceId: string; requireChoice?: boolean }[];
    choices: Record<string, unknown>;
    onChange: (choice: unknown) => void;
    onUnavailableChange: (unavailable: boolean) => void;
  }) => {
    workInMock.services = services;
    workInMock.choices = choices;
    workInMock.change = onChange;
    workInMock.setUnavailable = onUnavailableChange;
    return <div data-testid="mock-services-work-in" />;
  },
}));
const request: Record<string, unknown> = {
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
const renderField = (
  requestOverride: Record<string, unknown> = request,
  settledPayload: Record<string, unknown> = {},
) =>
  render(
    <AgentServiceScopeRequestField
      config={{
        field: "service-scope",
        description: "Service scope",
        type: "agent_request_service_scope",
        payload: {
          responseType: "agent_request_service_scope_v1",
          ...settledPayload,
          serviceScopeRequest: requestOverride as typeof request & {
            agentType: "codex";
          },
        },
      }}
      context={{
        conversationId: "conversation-1",
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
      }}
      isSubmitted={false}
    />,
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
        }),
      ),
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
      screen.getByTestId("agent-service-scope-unresolved-scope-request-1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();

    await userEvent.click(screen.getByTestId("agent-service-scope-deny"));
    await vi.waitFor(() =>
      expect(submitDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "deny",
          requestId: "scope-request-1",
        }),
      ),
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
      screen.getByTestId("agent-service-scope-error-scope-request-1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();

    await userEvent.click(screen.getByTestId("agent-service-scope-deny"));
    await vi.waitFor(() =>
      expect(submitDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "deny",
          requestId: "scope-request-1",
        }),
      ),
    );
  });

  describe("Work in", () => {
    const twoServices = () =>
      useServicesMock.mockReturnValue({
        services: [
          { id: "service-cli", name: "CLI" },
          { id: "service-api", name: "API" },
        ],
        isLoading: false,
        error: null,
      });

    it("offers a choice only for the added Service, starting from its proposed place, and sends it on Approve", async () => {
      twoServices();
      const apiWorktree = {
        serviceId: "service-api",
        kind: "WORKTREE",
        branch: "feat/a",
        newBranch: false,
      };
      renderField({ ...request, proposedPlaces: [apiWorktree] });
      expect(workInMock.services.map((entry) => entry.serviceId)).toEqual([
        "service-api",
      ]);
      expect(workInMock.choices).toEqual({ "service-api": apiWorktree });
      expect(screen.getByText("Current scope: CLI")).toBeInTheDocument();

      const changed = {
        serviceId: "service-api",
        kind: "WORKTREE",
        branch: "feat/b",
        newBranch: true,
      };
      act(() => workInMock.change?.(changed));
      await userEvent.click(screen.getByTestId("agent-service-scope-approve"));
      await vi.waitFor(() =>
        expect(submitDecisionMock).toHaveBeenCalledWith(
          expect.objectContaining({
            decision: "approve",
            servicePlaceChoices: [changed],
          }),
        ),
      );
    });

    it("requires an explicit choice for a Service the CLI left unproposed", async () => {
      twoServices();
      renderField({ ...request, proposedPlaces: [] });
      expect(workInMock.choices).toEqual({});
      expect(workInMock.services[0]?.requireChoice).toBe(true);
      expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();
      expect(screen.getByTestId("agent-service-scope-deny")).toBeEnabled();

      const chosen = { serviceId: "service-api", kind: "MAIN_FOLDER" };
      act(() => workInMock.change?.(chosen));
      expect(screen.getByTestId("agent-service-scope-approve")).toBeEnabled();
      await userEvent.click(screen.getByTestId("agent-service-scope-approve"));
      await vi.waitFor(() =>
        expect(submitDecisionMock).toHaveBeenCalledWith(
          expect.objectContaining({ servicePlaceChoices: [chosen] }),
        ),
      );
    });

    it("sends no places on Deny", async () => {
      twoServices();
      renderField();
      await userEvent.click(screen.getByTestId("agent-service-scope-deny"));
      await vi.waitFor(() => expect(submitDecisionMock).toHaveBeenCalled());
      expect(submitDecisionMock.mock.calls[0][0]).not.toHaveProperty(
        "servicePlaceChoices",
      );
    });

    it("defaults the added Service to the main folder for an older CLI's request", () => {
      twoServices();
      renderField();
      expect(workInMock.choices).toEqual({
        "service-api": { serviceId: "service-api", kind: "MAIN_FOLDER" },
      });
      expect(screen.getByTestId("agent-service-scope-approve")).toBeEnabled();
    });

    it("shows why an approval failed once the CLI settles the request", () => {
      twoServices();
      renderField(request, {
        decision: "approve",
        decidedAt: "2026-08-10T00:01:00.000Z",
        failureReason: "Branch feat/a is already checked out elsewhere.",
      });
      expect(
        screen.getByTestId("agent-service-scope-failure-reason"),
      ).toHaveTextContent("Branch feat/a is already checked out elsewhere.");
      expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();
    });

    it("holds Approve while where the Services can work could not be read, even for one Service", () => {
      twoServices();
      renderField();
      act(() => workInMock.setUnavailable?.(true));
      expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();
      expect(screen.getByTestId("agent-service-scope-deny")).toBeEnabled();
    });
  });
});
