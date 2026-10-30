import {
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "@hey-hey/ui-common/api";
import {
  AgentConversationView,
  ExistingEntityConversationSession,
  LoadingPanel,
} from "@hey-hey/ui-common/components";
import { useAgentSession, useProposal } from "@hey-hey/ui-common/data";
import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgenticAgentSessionPage } from "./agentic/AgenticAgentSessionPage";
import { AgentSessionContent } from "./AgentSessionContent";
import { FeatureTreeConversationPage } from "./FeatureTreeConversationPage";

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSession: vi.fn(),
  useProposal: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  AgentConversationView: vi.fn(() => (
    <div data-testid="agent-conversation-view" />
  )),
  ExistingEntityConversationSession: vi.fn(() => (
    <div data-testid="existing-entity-conversation-session" />
  )),
  isExistingEntityConversationAgentSession: (session: AgentSessionDto) =>
    session.type === AgentSessionType.EntityConversation &&
    session.id.trim().length > 0 &&
    typeof session.conversationId === "string" &&
    session.conversationId.trim().length > 0,
  LoadingPanel: vi.fn(({ label }: { label: string }) => (
    <div data-testid="loading-panel">{label}</div>
  )),
}));

vi.mock("./agentic/AgenticAgentSessionPage", () => ({
  AgenticAgentSessionPage: vi.fn(() => (
    <div data-testid="agentic-agent-session-page" />
  )),
}));

vi.mock("./FeatureTreeConversationPage", () => ({
  FeatureTreeConversationPage: vi.fn(() => (
    <div data-testid="feature-tree-conversation-page" />
  )),
}));

const useAgentSessionMock = vi.mocked(useAgentSession);

const buildSession = (
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto => ({
  id: "session-1",
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  status: AgentSessionStatus.InProgress,
  conversationId: "conversation-1",
  sessionDate: "2026-07-18",
  title: "Agent session",
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
  type: AgentSessionType.Coding,
  ...overrides,
});

const setSessionQuery = ({
  agentSession = buildSession(),
  error = null,
  isFetched = true,
  isLoading = false,
}: {
  agentSession?: AgentSessionDto | null;
  error?: Error | null;
  isFetched?: boolean;
  isLoading?: boolean;
} = {}) => {
  useAgentSessionMock.mockReturnValue({
    agentSession,
    data: agentSession,
    error,
    isFetched,
    isFetching: false,
    isLoading,
    isReady: isFetched && error === null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  });
};

const renderContent = (agentSessionId = "session-1") =>
  render(
    <AgentSessionContent
      organizationId="org-1"
      projectId="project-1"
      agentSessionId={agentSessionId}
      preview
    />,
  );

const renderCanonicalContent = () =>
  render(
    <AgentSessionContent
      organizationId="org-1"
      projectId="project-1"
      agentSessionId="session-1"
    />,
  );

describe("AgentSessionContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionQuery();
    vi.mocked(useProposal).mockReturnValue({
      proposal: null,
      data: null,
      error: null,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isReady: false,
      isStale: false,
      refetch: vi.fn(),
    });
  });

  it("renders an explicit loading state while session metadata resolves", () => {
    setSessionQuery({ agentSession: null, isFetched: false, isLoading: false });

    renderContent();

    expect(screen.getByTestId("loading-panel")).toHaveTextContent(
      "Loading agent session...",
    );
    expect(LoadingPanel).toHaveBeenCalled();
  });

  it("renders explicit errors for missing request scope and failed metadata", () => {
    const { rerender } = renderContent(" ");
    expect(
      screen.getByTestId("agent-session-preview-scope-error"),
    ).toBeInTheDocument();

    setSessionQuery({ agentSession: null, error: new Error("Session failed") });
    rerender(
      <AgentSessionContent
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="session-1"
        preview
      />,
    );
    expect(
      screen.getByTestId("agent-session-preview-query-error"),
    ).toHaveTextContent("Session failed");
  });

  it("renders the persisted entity conversation instead of agent setup", () => {
    const agentSession = buildSession({
      type: AgentSessionType.EntityConversation,
    });
    setSessionQuery({ agentSession });

    renderContent();

    expect(
      screen.getByTestId("existing-entity-conversation-session"),
    ).toBeInTheDocument();
    expect(ExistingEntityConversationSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        agentSession,
      }),
      undefined,
    );
    expect(AgenticAgentSessionPage).not.toHaveBeenCalled();
  });

  it("rejects an entity conversation without persisted conversation metadata", () => {
    setSessionQuery({
      agentSession: buildSession({
        type: AgentSessionType.EntityConversation,
        conversationId: null,
      }),
    });

    renderContent();

    expect(
      screen.getByTestId("entity-conversation-preview-metadata-error"),
    ).toBeInTheDocument();
    expect(ExistingEntityConversationSession).not.toHaveBeenCalled();
    expect(AgenticAgentSessionPage).not.toHaveBeenCalled();
  });

  it("renders proposal-refining sessions as continuable proposal conversations", () => {
    const agentSession = buildSession({
      type: AgentSessionType.ProposalRefining,
      entityId: "proposal-1",
    });
    setSessionQuery({ agentSession });
    vi.mocked(useProposal).mockReturnValue({
      proposal: {
        id: "proposal-1",
        action: "UPDATE",
        status: "DRAFT",
        targetEntityId: "target-1",
        targetEntityType: "TASK",
        title: "Proposal",
        updates: {},
      },
      data: null,
      error: null,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isReady: true,
      isStale: false,
      refetch: vi.fn(),
    });

    renderContent();

    expect(screen.getByTestId("agent-conversation-view")).toBeInTheDocument();
    expect(AgenticAgentSessionPage).not.toHaveBeenCalled();
    const props = vi.mocked(AgentConversationView).mock.calls.at(-1)?.[0];
    expect(props?.hideComposer).toBeFalsy();
    const reply = props?.buildReplyMessage?.("Continue this proposal fix");
    expect(reply?.data.agentInput).toMatchObject({
      promptType: "proposal_refiner",
      userMessage: "Continue this proposal fix",
      proposal: { id: "proposal-1" },
    });
  });

  it("leaves the canonical entity-conversation route on its existing lifecycle", () => {
    setSessionQuery({
      agentSession: buildSession({
        type: AgentSessionType.EntityConversation,
      }),
    });

    renderCanonicalContent();

    expect(
      screen.getByTestId("agentic-agent-session-page"),
    ).toBeInTheDocument();
    expect(AgenticAgentSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ preview: false }),
      undefined,
    );
    expect(ExistingEntityConversationSession).not.toHaveBeenCalled();
  });

  it("preserves the existing coding-session composition", () => {
    const agentSession = buildSession({ type: AgentSessionType.Coding });
    setSessionQuery({ agentSession });

    renderContent();

    expect(
      screen.getByTestId("agentic-agent-session-page"),
    ).toBeInTheDocument();
    expect(AgenticAgentSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({
        routeFamily: "project",
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
        preview: true,
      }),
      undefined,
    );
    expect(ExistingEntityConversationSession).not.toHaveBeenCalled();
  });

  it("opens canonical coding sessions through the general project page", () => {
    renderCanonicalContent();
    expect(AgenticAgentSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({
        routeFamily: "project",
        agentSessionId: "session-1",
        preview: false,
      }),
      undefined,
    );
  });

  it("preserves the project-conversation branch", () => {
    setSessionQuery({
      agentSession: buildSession({
        type: AgentSessionType.ProjectConversation,
      }),
    });

    renderContent();

    expect(
      screen.getByTestId("feature-tree-conversation-page"),
    ).toBeInTheDocument();
    expect(FeatureTreeConversationPage).toHaveBeenCalledWith(
      expect.objectContaining({ preview: true }),
      undefined,
    );
    expect(AgenticAgentSessionPage).not.toHaveBeenCalled();
  });
});
