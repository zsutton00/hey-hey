import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRequestWorktreeAttachPayload,
  AgentSessionServicePlace,
  AgentSessionWorktreeAttachRequest,
} from "../../../../api";
import { FIELD_REGISTRY } from "../Registry";
import { getRegistryType } from "../fieldResponseMetadata";

const submitDecisionMock = vi.hoisted(() => vi.fn());
const invalidateSessionMock = vi.hoisted(() => vi.fn());
const useServicesMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  current: { currentState: "awaiting_approval" } as Record<string, unknown>,
}));
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
  useServices: () => useServicesMock(),
}));
vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: sessionMock.current }),
}));
vi.mock("../../../../data/collections/agentSessions", async (original) => ({
  ...(await original<object>()),
  invalidateAgentSessionDetail: invalidateSessionMock,
}));

const worktreePath = "/code/hey-hey/.worktrees/feature/changes-page";

const request: AgentSessionWorktreeAttachRequest = {
  id: "attach-1",
  runId: "run-1",
  sessionId: "provider-session-1",
  agentId: "coding-freeform",
  agentType: "claude",
  timestamp: "2026-11-25T00:00:00.000Z",
  idempotencyToken: "attach-token-1",
  serviceId: "service-1",
  currentPlace: { kind: "MAIN_FOLDER", branch: "dev" },
  branch: "feature/changes-page",
  worktreePath,
  reason: "The Changes page work is on feature/changes-page.",
  planBranch: null,
};

const payload = (
  overrides: Partial<AgentRequestWorktreeAttachPayload> = {},
): AgentRequestWorktreeAttachPayload => ({
  responseType: "agent_request_worktree_attach_v1",
  worktreeAttachRequest: request,
  ...overrides,
});

// Resolved from the element type the CLI posts, as the conversation does.
const Field =
  FIELD_REGISTRY[getRegistryType("agent-request-worktree-attach")].Component;

const field = (value: AgentRequestWorktreeAttachPayload) => (
  <QueryClientProvider client={new QueryClient()}>
    <Field
      config={{
        field: "worktree-attach",
        description: "Worktree request",
        type: "agent-request-worktree-attach",
        payload: value,
      }}
      context={{
        conversationId: "conversation-1",
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
      }}
      isSubmitted={false}
    />
  </QueryClientProvider>
);

describe("worktree attach request card", () => {
  beforeEach(() => {
    submitDecisionMock.mockReset();
    invalidateSessionMock.mockReset();
    sessionMock.current = { currentState: "awaiting_approval" };
    useServicesMock.mockReturnValue({
      services: [{ id: "service-1", name: "hey-hey" }],
      isLoading: false,
      error: null,
    });
  });

  it.each(["approve", "deny"] as const)(
    "shows the request and sends %s with its token",
    async (decision) => {
      render(field(payload()));

      expect(
        screen.getByTestId("agent-worktree-attach-service"),
      ).toHaveTextContent("hey-hey");
      expect(
        screen.getByTestId("agent-worktree-attach-current"),
      ).toHaveTextContent("dev (main folder)");
      const target = screen.getByTestId("agent-worktree-attach-target");
      expect(target).toHaveTextContent(worktreePath);
      expect(target).toHaveTextContent("feature/changes-page");
      expect(screen.getByText(`Reason: ${request.reason}`)).toBeInTheDocument();
      expect(
        screen.getByTestId("agent-worktree-attach-effect"),
      ).toHaveTextContent("No files are moved");
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-worktree-attach-plan-note"),
      ).not.toBeInTheDocument();

      await userEvent.click(
        screen.getByTestId(`agent-worktree-attach-${decision}`),
      );

      expect(submitDecisionMock).toHaveBeenCalledExactlyOnceWith({
        decision,
        requestId: "attach-1",
        sessionId: "provider-session-1",
        agentType: "claude",
        reason: request.reason,
        idempotencyToken: "attach-token-1",
      });
      expect(
        screen.getByTestId("agent-worktree-attach-approve"),
      ).toBeDisabled();
    },
  );

  it("says the plan keeps its branch in a plan session", () => {
    render(
      field(
        payload({
          worktreeAttachRequest: {
            ...request,
            currentPlace: {
              kind: "WORKTREE",
              branch: "plan/commit-modal",
              worktreePath: "/code/hey-hey/.worktrees/plan/commit-modal",
            },
            planBranch: "plan/commit-modal",
          },
        }),
      ),
    );

    expect(
      screen.getByTestId("agent-worktree-attach-plan-note"),
    ).toHaveTextContent(
      "This plan works on plan/commit-modal. Approving changes the branch for this session only; the plan keeps its branch.",
    );
    expect(
      screen.getByTestId("agent-worktree-attach-current"),
    ).toHaveTextContent("plan branch");
  });

  it("keeps only Deny available when the Service can't be resolved", () => {
    useServicesMock.mockReturnValue({
      services: [],
      isLoading: false,
      error: new Error("network unavailable"),
    });

    render(field(payload()));

    expect(screen.getByTestId("agent-worktree-attach-approve")).toBeDisabled();
    expect(screen.getByTestId("agent-worktree-attach-deny")).toBeEnabled();
  });

  it("shows why a decision could not be delivered and allows a retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    submitDecisionMock.mockRejectedValue(new Error("Machine is offline"));
    render(field(payload()));

    await userEvent.click(screen.getByTestId("agent-worktree-attach-approve"));

    expect(
      screen.getByTestId("agent-worktree-attach-delivery-error"),
    ).toHaveTextContent("Machine is offline");
    expect(screen.getByTestId("agent-worktree-attach-approve")).toBeEnabled();
  });

  it("shows a denial without offering another answer", () => {
    render(field(payload({ decision: "deny" })));

    expect(
      screen.getByTestId("agent-worktree-attach-denied"),
    ).toHaveTextContent("still working in dev (main folder)");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reports a failed attach, even though it was approved", () => {
    render(
      field(
        payload({
          decision: "approve",
          failureReason: `${worktreePath} is no longer a worktree.`,
        }),
      ),
    );

    expect(
      screen.getByTestId("agent-worktree-attach-failed"),
    ).toHaveTextContent("is no longer a worktree.Nothing changed.");
    expect(
      screen.queryByTestId("agent-worktree-attach-approved"),
    ).not.toBeInTheDocument();
  });

  it("claims the move only once the session records it, re-reading until then", () => {
    const approved = payload({
      decision: "approve",
      decidedAt: "2026-11-25T00:01:00.000Z",
    });
    const view = render(field(approved));

    const outcome = () =>
      screen.getByTestId("agent-worktree-attach-approved").textContent;
    expect(outcome()).toBe("Approved");
    expect(invalidateSessionMock).toHaveBeenCalledTimes(1);

    sessionMock.current = { currentState: "working" };
    view.rerender(field(approved));
    expect(invalidateSessionMock).toHaveBeenCalledTimes(2);

    const place: AgentSessionServicePlace = {
      serviceId: "service-1",
      kind: "WORKTREE",
      branch: "feature/changes-page",
      worktreePath,
      recordedAt: "2026-11-25T00:01:01.000Z",
      changedDuringSession: true,
    };
    sessionMock.current = { currentState: "idle", servicePlaces: [place] };
    view.rerender(field(approved));

    expect(outcome()).toContain("continued in feature/changes-page");
    expect(invalidateSessionMock).toHaveBeenCalledTimes(2);
  });
});
