import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionStatus, AgentSessionType } from "@hey-hey/ui-common/api";

const agentSession = {
  id: "session-1",
  title: "Feature tree discussion",
  status: AgentSessionStatus.InProgress,
  type: AgentSessionType.ProjectConversation,
  conversationId: "conversation-1",
  projectId: "project-1",
} as never;
const useAcknowledgeOnOpenMock = vi.hoisted(() => vi.fn());

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSession: () => ({
    agentSession,
    error: null,
    isLoading: false,
    isFetched: true,
  }),
  useProject: () => ({ data: { name: "Project" } }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
  createCanonicalPageDescriptor: () => ({ kind: "agent_session" }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  FeatureTreeConversationChat: () => (
    <div data-testid="feature-tree-conversation-chat" />
  ),
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: () => <div />,
}));

vi.mock("./agentSessionPresentation", () => ({
  buildAgentSessionPresentation: () => ({ kind: "agent_session" }),
}));

vi.mock("./AgentSessionDiscussActionCapsule", () => ({
  AgentSessionDiscussActionCapsule: ({
    organizationId,
    projectId,
    agentSession: session,
  }: {
    organizationId: string;
    projectId: string;
    agentSession: { id: string; title: string };
  }) => (
    <div
      data-testid="agent-session-discuss"
      data-organization-id={organizationId}
      data-project-id={projectId}
      data-session-id={session.id}
      data-session-title={session.title}
    />
  ),
}));

vi.mock("./useAcknowledgeAgentSessionOutputAttentionOnOpen", () => ({
  useAcknowledgeAgentSessionOutputAttentionOnOpen: useAcknowledgeOnOpenMock,
}));

import { FeatureTreeConversationPage } from "./FeatureTreeConversationPage";

describe("FeatureTreeConversationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers Discuss for the canonical feature-tree session page", () => {
    render(
      <FeatureTreeConversationPage
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="session-1"
      />,
    );

    expect(screen.getByTestId("agent-session-discuss")).toHaveAttribute(
      "data-session-id",
      "session-1",
    );
    expect(screen.getByTestId("agent-session-discuss")).toHaveAttribute(
      "data-project-id",
      "project-1",
    );
    expect(useAcknowledgeOnOpenMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      enabled: true,
    });
  });

  it("does not register Discuss for observational previews", () => {
    render(
      <FeatureTreeConversationPage
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="session-1"
        preview
      />,
    );

    expect(screen.queryByTestId("agent-session-discuss")).not.toBeInTheDocument();
    expect(useAcknowledgeOnOpenMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      enabled: false,
    });
  });

});
