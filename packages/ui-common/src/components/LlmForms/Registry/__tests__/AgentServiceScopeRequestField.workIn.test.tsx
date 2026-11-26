import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServicePlacesState } from "../../../AgentSession/runtime/hooks/useServicePlaces";
import { AgentServiceScopeRequestField } from "../AgentServiceScopeRequestField";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  places: { current: { status: "loading" } as unknown },
  session: { current: { machineId: "machine-1" } as Record<string, unknown> },
  workItem: vi.fn(),
  readPlaces: vi.fn(),
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
  useAgentSession: () => ({ agentSession: mocks.session.current }),
}));
vi.mock("../../../../data/hooks/useWorkItem", () => ({
  useWorkItem: mocks.workItem,
}));
vi.mock("../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: [{ machineId: "machine-1" }],
  }),
}));
vi.mock("../../../AgentSession/runtime/hooks/readServicePlaces", () => ({
  readServicePlaces: mocks.readPlaces,
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
    mocks.session.current = { machineId: "machine-1" };
    mocks.workItem.mockReset();
    mocks.workItem.mockReturnValue({ workItem: null });
    mocks.readPlaces.mockReset();
  });

  it("holds Approve, never Deny, while a name from the session's work item is open", async () => {
    mocks.places.current = readyPlaces("main");
    mocks.session.current = {
      machineId: "machine-1",
      entityType: "TASK",
      entityId: "task-1",
    };
    mocks.workItem.mockReturnValue({
      workItem: { name: "Fix the pairing poll" },
    });
    mocks.readPlaces.mockResolvedValue(
      new Map([
        [
          "service-api",
          {
            serviceId: "service-api",
            status: "ok",
            mainFolder: { path: "/api", branch: "main" },
            worktrees: [],
            branchMatches: ["fix-the-pairing-poll"],
            branchMatchesTruncated: false,
          },
        ],
      ]),
    );
    render(card());
    const approve = screen.getByTestId("agent-service-scope-approve");

    await userEvent.click(screen.getByTestId("work-in-new-worktree-button"));
    await screen.findByDisplayValue("fix-the-pairing-poll-2");

    expect(mocks.workItem).toHaveBeenCalledWith("org-1", "task", "task-1", {
      projectId: "project-1",
      enabled: true,
    });
    expect(approve).toBeDisabled();
    expect(screen.getByTestId("agent-service-scope-deny")).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await userEvent.click(approve);

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        servicePlaceChoices: [
          {
            serviceId: "service-api",
            kind: "WORKTREE",
            branch: "fix-the-pairing-poll-2",
            newBranch: true,
          },
        ],
      }),
    );
  });

  it("still denies while a name is open, and starts empty without a work item", async () => {
    mocks.places.current = readyPlaces("main");
    render(card());

    await userEvent.click(screen.getByTestId("work-in-new-worktree-button"));
    expect(screen.getByTestId("work-in-new-input")).toHaveValue("");
    await userEvent.click(screen.getByTestId("agent-service-scope-deny"));

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny" }),
    );
    expect(mocks.readPlaces).not.toHaveBeenCalled();
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

    expect(screen.getByTestId("work-in-select")).toHaveValue(
      "feat/launch · new worktree",
    );
    await userEvent.click(screen.getByTestId("agent-service-scope-approve"));
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ servicePlaceChoices: [proposedWorktree] }),
    );
  });

  it("shows a worktree proposed on the main folder's own branch as a worktree and holds Approve", async () => {
    mocks.places.current = readyPlaces("feat/launch");
    render(card());

    expect(screen.getByTestId("work-in-select")).toHaveValue(
      "feat/launch · new worktree",
    );
    expect(screen.getByTestId("work-in-conflict")).toBeInTheDocument();
    expect(screen.getByTestId("agent-service-scope-approve")).toBeDisabled();
    expect(screen.getByTestId("agent-service-scope-deny")).toBeEnabled();
  });
});
