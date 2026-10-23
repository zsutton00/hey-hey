import { AgentSessionType } from "@hey-hey/ui-common/api";
import {
  useAgentSessions,
  usePlatformAdminAccess,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DailySessionView } from "./DailySessionView";

const conversationView = vi.hoisted(() => vi.fn());
const briefing = vi.hoisted(() => vi.fn());

vi.mock("@hey-hey/ui-common/components", () => ({
  AgentConversationView: (props: Record<string, unknown>) => {
    conversationView(props);
    return <div data-testid="agent-conversation-view" />;
  },
  LoadingPanel: ({ label }: { label?: string }) => <div>{label}</div>,
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSessions: vi.fn(),
  useUserPairedMachines: vi.fn(),
  usePlatformAdminAccess: vi.fn(),
}));
vi.mock("./daily-session", () => ({
  DailySessionBriefing: (props: Record<string, unknown>) => {
    briefing(props);
    return <div data-testid="daily-session-briefing" />;
  },
}));

const sessionsHook = vi.mocked(useAgentSessions);
const machinesHook = vi.mocked(useUserPairedMachines);
const platformAdminAccessHook = vi.mocked(usePlatformAdminAccess);
const session = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: AgentSessionType.DailySession,
  conversationId: `${id}-conversation`,
  machineId: "machine-1",
  sessionDate: "2026-09-01T12:00:00.000Z",
  ...overrides,
});

describe("DailySessionView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformAdminAccessHook.mockReturnValue({
      isPlatformAdmin: true,
      isResolved: true,
    });
    sessionsHook.mockReturnValue({
      agentSessions: [],
      error: null,
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useAgentSessions>);
    machinesHook.mockReturnValue({
      machines: [{ machineId: "machine-1" }],
      error: null,
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useUserPairedMachines>);
  });

  it("waits for both discovery sources", () => {
    machinesHook.mockReturnValue({
      machines: [],
      error: null,
      isFetched: false,
      isLoading: true,
    } as ReturnType<typeof useUserPairedMachines>);
    render(<DailySessionView organizationId="org-1" projectId="project-1" />);
    expect(sessionsHook).toHaveBeenCalledWith("org-1", "project-1", {
      type: AgentSessionType.DailySession,
      enabled: true,
    });
    expect(screen.getByText("Loading daily session...")).toBeInTheDocument();
    expect(conversationView).not.toHaveBeenCalled();
  });

  it("shows paired-machine discovery errors", () => {
    machinesHook.mockReturnValue({
      machines: [],
      error: new Error("Pairing lookup failed"),
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useUserPairedMachines>);
    render(<DailySessionView organizationId="org-1" projectId="project-1" />);
    expect(screen.getByText("Pairing lookup failed")).toBeInTheDocument();
    expect(conversationView).not.toHaveBeenCalled();
  });

  it("shows session discovery errors", () => {
    sessionsHook.mockReturnValue({
      agentSessions: [],
      error: new Error("Session lookup failed"),
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useAgentSessions>);
    render(<DailySessionView organizationId="org-1" projectId="project-1" />);
    expect(screen.getByText("Session lookup failed")).toBeInTheDocument();
  });

  it("keeps the briefing when all candidates are unusable", () => {
    machinesHook.mockReturnValue({
      machines: [
        { machineId: "machine-1" },
        { machineId: "revoked-machine", revokedAt: "2026-09-01T00:00:00.000Z" },
      ],
      error: null,
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useUserPairedMachines>);
    sessionsHook.mockReturnValue({
      agentSessions: [
        session("unbound", { machineId: null }),
        session("without-conversation", { conversationId: null }),
        session("revoked-binding", { machineId: "revoked-machine" }),
      ],
      error: null,
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useAgentSessions>);
    render(<DailySessionView organizationId="org-1" projectId="project-1" />);
    expect(screen.getByTestId("daily-session-briefing")).toBeInTheDocument();
    expect(briefing).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(conversationView).not.toHaveBeenCalled();
  });

  it("selects only the newest usable identity from an unordered backlog", () => {
    sessionsHook.mockReturnValue({
      agentSessions: [
        session("older", { updatedAt: "2026-09-02T12:00:00.000Z" }),
        session("newest-unbound", {
          updatedAt: "2026-09-05T12:00:00.000Z",
          machineId: null,
        }),
        session("newest-usable", { updatedAt: "2026-09-04T12:00:00.000Z" }),
        session("newer-without-conversation", {
          updatedAt: "2026-09-06T12:00:00.000Z",
          conversationId: null,
        }),
        session("ordinary", {
          type: AgentSessionType.ProjectConversation,
          updatedAt: "2026-09-07T12:00:00.000Z",
        }),
      ],
      error: null,
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useAgentSessions>);
    render(<DailySessionView organizationId="org-1" projectId="project-1" />);
    expect(conversationView).toHaveBeenCalledTimes(1);
    expect(conversationView).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "newest-usable",
      conversationId: "newest-usable-conversation",
      sessionResumability: "resumable",
    });
  });

  it("uses the stable identifier tie-breaker for equal timestamps", () => {
    sessionsHook.mockReturnValue({
      agentSessions: [session("session-a"), session("session-z")],
      error: null,
      isFetched: true,
      isLoading: false,
    } as ReturnType<typeof useAgentSessions>);
    render(<DailySessionView organizationId="org-1" projectId="project-1" />);
    expect(conversationView).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: "session-z" }),
    );
  });

  it("does not discover or render Daily Session without debug access", () => {
    platformAdminAccessHook.mockReturnValue({
      isPlatformAdmin: false,
      isResolved: true,
    });

    render(<DailySessionView organizationId="org-1" projectId="project-1" />);

    expect(sessionsHook).toHaveBeenCalledWith("org-1", "project-1", {
      type: AgentSessionType.DailySession,
      enabled: false,
    });
    expect(machinesHook).toHaveBeenCalledWith({ enabled: false });
    expect(conversationView).not.toHaveBeenCalled();
    expect(briefing).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("agent-conversation-view"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("daily-session-briefing"),
    ).not.toBeInTheDocument();
  });
});
