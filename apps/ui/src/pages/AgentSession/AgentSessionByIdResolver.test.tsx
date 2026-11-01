import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionType } from "@hey-hey/ui-common/api";
import { AgentSessionByIdResolver } from "./AgentSessionByIdResolver";

const navigateMock = vi.hoisted(() => vi.fn());
const useAgentSessionMock = vi.hoisted(() => vi.fn());
const useWorkItemMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({
    projectId: "project-1",
    agentSessionId: "session-1",
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSession: (...args: unknown[]) => useAgentSessionMock(...args),
  useWorkItem: (...args: unknown[]) => useWorkItemMock(...args),
  isTask: () => false,
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

describe("AgentSessionByIdResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkItemMock.mockReturnValue({
      workItem: null,
      isFetched: true,
      isLoading: false,
    });
  });

  it("waits for the first session fetch before showing not-found", () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: null,
      error: null,
      isFetched: false,
      isLoading: false,
    });

    render(<AgentSessionByIdResolver />);

    expect(screen.getByText("Loading agent session...")).toBeInTheDocument();
    expect(
      screen.queryByText("Unable to find agent session."),
    ).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("preserves the post-fetch not-found state", () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: null,
      error: null,
      isFetched: true,
      isLoading: false,
    });

    render(<AgentSessionByIdResolver />);

    expect(
      screen.getByText("Unable to find agent session."),
    ).toBeInTheDocument();
  });

  it("routes Daily Session sessions to the project Daily Session view", () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: {
        id: "session-1",
        type: AgentSessionType.DailySession,
      },
      error: null,
      isFetched: true,
      isLoading: false,
    });

    render(<AgentSessionByIdResolver />);

    expect(navigateMock).toHaveBeenCalledWith(
      "/projects/project-1?tab=project&view=daily-session",
      { replace: true },
    );
  });

  it("routes proposal-refining sessions to their owning session view", () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: {
        id: "session-1",
        type: AgentSessionType.ProposalRefining,
        conversationId: "conversation-1",
      },
      error: null,
      isFetched: true,
      isLoading: false,
    });

    render(<AgentSessionByIdResolver />);

    expect(navigateMock).toHaveBeenCalledWith(
      "/projects/project-1/agent-sessions/session-1",
      { replace: true },
    );
  });
});
