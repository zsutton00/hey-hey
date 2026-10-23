import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionResolver } from "./AgentSessionResolver";
import { AgentSessionType, EntityType, WorkflowName } from "@hey-hey/ui-common/api";

const navigateMock = vi.hoisted(() => vi.fn());
const useConversationMock = vi.hoisted(() => vi.fn());
const useAgentSessionsMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({
    projectId: "project-1",
    conversationId: "conversation-1",
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useConversation: (...args: unknown[]) => useConversationMock(...args),
  useAgentSessions: (...args: unknown[]) => useAgentSessionsMock(...args),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

describe("AgentSessionResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationMock.mockReturnValue({
      data: { id: "conversation-1", workflowName: WorkflowName.AgentEntityConversation },
      error: null,
      isFetched: true,
      isLoading: false,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      error: null,
      isFetched: true,
      isLoading: false,
    });
  });

  it("waits for both lookups before showing not-found", () => {
    useConversationMock.mockReturnValue({
      data: null,
      error: null,
      isFetched: false,
      isLoading: false,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      error: null,
      isFetched: false,
      isLoading: false,
    });

    render(<AgentSessionResolver />);

    expect(screen.getByText("Loading agent session...")).toBeInTheDocument();
    expect(
      screen.queryByText("Unable to find an agent session for this conversation."),
    ).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("uses a distinct sessionless destination after a successful empty lookup", () => {
    render(<AgentSessionResolver />);
    expect(navigateMock).toHaveBeenCalledWith(
      "/projects/project-1/sessionless-conversations/conversation-1", { replace: true },
    );
  });

  const owner = {
    id: "session-1", conversationId: "conversation-1",
    type: AgentSessionType.EntityConversation, entityId: "owner-document",
    entityType: EntityType.DesignDoc,
  };

  it("selects the matching owner and derives scope from that session", () => {
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [{ ...owner, id: "unrelated", conversationId: "another" }, owner],
      isFetched: true, isLoading: false,
    });
    render(<AgentSessionResolver />);
    expect(navigateMock).toHaveBeenCalledWith(
      "/projects/project-1/agent-sessions/session-1/entity-conversations/conversation-1?entityId=owner-document&entityType=DESIGN_DOC",
      { replace: true },
    );
    expect(useAgentSessionsMock).toHaveBeenCalledWith("org-1", "project-1",
      expect.objectContaining({ conversationId: "conversation-1", enabled: true }));
  });

  it("shows errors before loading and never redirects cached owner data on failure", () => {
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [owner], error: new Error("Ownership lookup failed"), isFetched: false,
    });
    render(<AgentSessionResolver />);
    expect(screen.getByRole("alert")).toHaveTextContent("Ownership lookup failed");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("never redirects on a conversation lookup error", () => {
    useConversationMock.mockReturnValue({
      data: { workflowName: WorkflowName.AgentEntityConversation },
      error: new Error("Conversation lookup failed"), isFetched: true,
    });
    useAgentSessionsMock.mockReturnValue({ agentSessions: [owner], isFetched: true });
    render(<AgentSessionResolver />);
    expect(screen.getByRole("alert")).toHaveTextContent("Conversation lookup failed");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("never treats a lookup error without a message as successful empty ownership", () => {
    useAgentSessionsMock.mockReturnValue({ agentSessions: [], error: new Error(""), isFetched: true });
    render(<AgentSessionResolver />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load conversation ownership");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it.each([
    { sessions: [owner, { ...owner, id: "second-owner" }], message: "Multiple agent sessions" },
    { sessions: [{ ...owner, conversationId: "another" }], message: "do not own this conversation" },
    { sessions: [{ ...owner, entityId: "" }], message: "missing its entity context" },
  ])("rejects invalid ownership: $message", ({ sessions, message }) => {
    useAgentSessionsMock.mockReturnValue({ agentSessions: sessions, isFetched: true });
    render(<AgentSessionResolver />);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps non-entity sessions on their standard session page", () => {
    useConversationMock.mockReturnValue({
      data: { id: "conversation-1", workflowName: WorkflowName.AgentCoding }, isFetched: true,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [{ ...owner, type: AgentSessionType.Coding }], isFetched: true,
    });
    render(<AgentSessionResolver />);
    expect(navigateMock).toHaveBeenCalledWith("/projects/project-1/agent-sessions/session-1", { replace: true });
  });

  it("rejects a missing or mismatched conversation instead of selecting sessionless fallback", () => {
    useConversationMock.mockReturnValue({ data: { id: "another-conversation" }, isFetched: true });
    render(<AgentSessionResolver />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to find this conversation");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
