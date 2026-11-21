import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServicePlacesState } from "../../../AgentSession/runtime/hooks/useServicePlaces";
import { AgentServiceScopeRequestField } from "../AgentServiceScopeRequestField";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  places: { current: { status: "loading" } as unknown },
}));

vi.mock(
  "../../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision",
  () => ({
    useSubmitControllerAuthorizedPermissionDecision: () => ({
      submit: mocks.submit,
      isPending: false,
    }),
  }),
);
vi.mock("../../../../data/hooks/useServices", () => ({
  useServices: () => ({
    services: [
      { id: "service-cli", name: "CLI" },
      { id: "service-api", name: "API" },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: "machine-1" } }),
}));
vi.mock("../../../AgentSession/runtime/hooks/useServicePlaces", () => ({
  useServicePlaces: () => mocks.places.current,
}));

const readyPlaces = (mainBranch: string): ServicePlacesState => ({
  status: "ready",
  searching: false,
  searchError: null,
  byServiceId: {
    "service-api": {
      status: "ready",
      mainFolder: { path: "/api", branch: mainBranch },
      worktrees: [],
      recentBranches: [],
      branchMatches: [],
      branchMatchesTruncated: false,
    },
  },
});

const proposedWorktree = {
  serviceId: "service-api",
  kind: "WORKTREE",
  branch: "feat/launch",
  newBranch: false,
};

const card = () => (
  <AgentServiceScopeRequestField
    config={{
      field: "service-scope",
      description: "Service scope",
      type: "agent_request_service_scope",
      payload: {
        responseType: "agent_request_service_scope_v1",
        serviceScopeRequest: {
          id: "scope-request-1",
          runId: "run-1",
          sessionId: "session-1",
          agentId: "coding-freeform",
          agentType: "codex",
          timestamp: "2026-08-10T00:00:00.000Z",
          idempotencyToken: "scope-idem-1",
          currentServiceIds: ["service-cli"],
          requestedServiceIds: ["service-cli", "service-api"],
          reason: "Need to update the API contract.",
          proposedPlaces: [proposedWorktree],
        },
      } as never,
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

describe("AgentServiceScopeRequestField Work in readiness", () => {
  beforeEach(() => {
    mocks.submit.mockReset();
  });

  it("cannot approve the proposal before where the Service works is shown, but can deny", async () => {
    mocks.places.current = { status: "loading" };
    const view = render(card());

    expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();
    fireEvent.click(screen.getByTestId("agent-service-scope-approve"));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByTestId("agent-service-scope-deny")).toBeEnabled();

    mocks.places.current = readyPlaces("main");
    view.rerender(card());

    expect(screen.getByTestId("work-in-select")).toHaveTextContent(
      "feat/launch",
    );
    await userEvent.click(screen.getByTestId("agent-service-scope-approve"));
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ servicePlaceChoices: [proposedWorktree] }),
    );
  });

  it("shows a worktree proposed on the main folder's own branch as a worktree and holds Approve", async () => {
    mocks.places.current = readyPlaces("feat/launch");
    render(card());

    expect(screen.getByTestId("work-in-select")).toHaveTextContent(
      "feat/launch (new worktree)",
    );
    expect(screen.getByTestId("work-in-select")).not.toHaveTextContent(
      "(main folder)",
    );
    expect(screen.getByTestId("work-in-conflict")).toBeInTheDocument();
    expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();
    expect(screen.getByTestId("agent-service-scope-deny")).toBeEnabled();
  });
});
