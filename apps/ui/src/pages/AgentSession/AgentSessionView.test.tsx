import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionStatus, AgentSessionType } from "@hey-hey/ui-common/api";

const agentSession = {
  id: "session-1",
  title: "Coding session",
  status: AgentSessionStatus.InProgress,
  type: AgentSessionType.Coding,
  conversationId: "conversation-1",
  entityType: null,
  entityId: null,
  projectId: "project-1",
} as never;

vi.mock("@hey-hey/ui-common", () => ({
  getWorkflowAboutInfoForAgentSession: () => ({
    workflowAboutId: null,
    workflowAboutType: null,
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSession: () => ({ agentSession, isLoading: false, isFetched: true }),
  useInitiative: () => ({ data: null }),
  useProject: () => ({
    data: { id: "project-1", name: "Project" },
    isLoading: false,
    error: null,
  }),
  useTaskHierarchy: () => ({ task: null }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    agentSession: () => "/projects/project-1/agent-sessions/session-1",
    initiativeDetail: () => "/projects/project-1/initiatives/initiative-1",
    task: () => "/projects/project-1/tasks/task-1",
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsString: { withDefault: (value: string) => value },
  useQueryState: () => ["conversations", vi.fn()],
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageHeader: ({ title }: { title: string }) => <div>{title}</div>,
  DetailPageTabs: () => null,
  PageBreadcrumbs: () => null,
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: () => <div />,
  buildAdminMetadataItems: () => [],
}));

vi.mock("../../components/Tabs/ConversationListTab", () => ({
  ConversationListTab: () => <div />,
}));

vi.mock("../../components/Tabs/ImplementationHintsTab", () => ({
  ImplementationHintsTab: () => <div />,
}));

vi.mock("../../components/Conversation/ActiveConversation", () => ({
  ActiveConversation: () => <div />,
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

import { AgentSessionView } from "./AgentSessionView";

describe("AgentSessionView", () => {
  it("registers Discuss for the conversation sub-route", () => {
    render(
      <AgentSessionView
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="session-1"
        disableTracking
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
  });
});
