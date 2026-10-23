import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  MessageType,
  type AgentSessionDto,
  type CreateUserMessage,
} from "../../../api";
import { ExistingEntityConversationSession } from "../ExistingEntityConversationSession";
import { isExistingEntityConversationAgentSession } from "../existingEntityConversationAgentSession";

const postMessageMock = vi.fn<(message: CreateUserMessage) => Promise<void>>();
const apiPostMessageMock = vi.fn();
const trackingContextMock = vi.fn();
const canonicalCompositionMock = vi.fn();
const useWorkItemMock = vi.fn(
  (..._args: unknown[]) => ({ workItem: null as { type: string } | null })
);

vi.mock("../../../clients/client.js", () => ({
  apiClient: {
    postMessage: (...args: unknown[]) => apiPostMessageMock(...args),
  },
}));

vi.mock("../../../contexts", () => ({
  TrackingProvider: ({
    children,
    context,
  }: {
    children: ReactNode;
    context: unknown;
  }) => {
    trackingContextMock(context);
    return <div data-testid="tracking-provider">{children}</div>;
  },
  CanonicalPageBoundary: ({
    children,
    composition,
  }: {
    children: ReactNode;
    composition: unknown;
  }) => {
    canonicalCompositionMock(composition);
    return <div data-testid="canonical-page-boundary">{children}</div>;
  },
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (...args: unknown[]) => useWorkItemMock(...args),
}));

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: (props: Record<string, unknown>) => {
    return (
      <div
        data-testid="agent-conversation-view"
        data-props={JSON.stringify(props)}
      />
    );
  },
}));

const buildSession = (
  overrides: Partial<AgentSessionDto> = {}
): AgentSessionDto => ({
  id: "session-1",
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  status: AgentSessionStatus.InProgress,
  conversationId: "conversation-1",
  sessionDate: "2026-07-18",
  title: "Entity conversation",
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
  type: AgentSessionType.EntityConversation,
  ...overrides,
});

describe("ExistingEntityConversationSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkItemMock.mockReturnValue({ workItem: null });
  });

  it("recognizes only persisted entity-conversation sessions", () => {
    expect(isExistingEntityConversationAgentSession(buildSession())).toBe(true);
    expect(
      isExistingEntityConversationAgentSession(
        buildSession({ conversationId: null })
      )
    ).toBe(false);
    expect(
      isExistingEntityConversationAgentSession(
        buildSession({ id: " ", conversationId: "conversation-1" })
      )
    ).toBe(false);
    expect(
      isExistingEntityConversationAgentSession(
        buildSession({ type: AgentSessionType.Coding })
      )
    ).toBe(false);
  });

  it("mounts the existing conversation with observational tracking", () => {
    const agentSession = buildSession();
    if (!isExistingEntityConversationAgentSession(agentSession)) {
      throw new Error("Expected a persisted entity-conversation fixture.");
    }

    render(
      <ExistingEntityConversationSession
        organizationId="org-1"
        projectId="project-1"
        agentSession={agentSession}
      />
    );

    expect(screen.getByTestId("tracking-provider")).toBeInTheDocument();
    expect(trackingContextMock).toHaveBeenCalledWith({
      page: {
        name: "entity-conversation-preview",
        path: "/projects/project-1/agent-sessions/session-1/preview",
        section: "preview",
      },
      workflow: {
        id: "session-1",
        name: "entity-conversation",
      },
      attentionEntity: undefined,
    });
    expect(canonicalCompositionMock).toHaveBeenCalledWith({
      kind: "observational",
    });
    expect(
      JSON.parse(
        screen.getByTestId("agent-conversation-view").dataset.props ?? "{}"
      )
    ).toMatchObject({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      conversationId: "conversation-1",
      sessionResumability: "legacy_non_resumable",
      scrollable: true,
    });
  });

  it("passes a verified task scope to the existing conversation composer", () => {
    useWorkItemMock.mockReturnValue({ workItem: { type: "FEATURE" } });
    const agentSession = buildSession({
      entityType: "TASK",
      entityId: "feature-1",
    });
    if (!isExistingEntityConversationAgentSession(agentSession)) {
      throw new Error("Expected a persisted entity-conversation fixture.");
    }

    render(
      <ExistingEntityConversationSession
        organizationId="org-1"
        projectId="project-1"
        agentSession={agentSession}
      />
    );

    expect(
      JSON.parse(
        screen.getByTestId("agent-conversation-view").dataset.props ?? "{}"
      )
    ).toMatchObject({
      fileReferenceScope: { kind: "feature", featureId: "feature-1" },
    });
  });
});
