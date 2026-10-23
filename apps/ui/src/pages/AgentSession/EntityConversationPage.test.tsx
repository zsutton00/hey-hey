import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
} from "@hey-hey/ui-common/api";

const useAgentSessionMock = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({
  current: {} as Record<string, string | undefined>,
}));
const openBrowserPropsMock = vi.hoisted(() => vi.fn());
const runBrowserProviderValueMock = vi.hoisted(() => vi.fn());
const useFullEntityContextMock = vi.hoisted(() => vi.fn());
const useTaskHierarchyMock = vi.hoisted(() => vi.fn());
const pageBreadcrumbsMock = vi.hoisted(() => vi.fn());
const cachedFeatures = vi.hoisted(
  () =>
    new Map<string, { name: string; parentTaskId: string | null }>([
      ["feature-root", { name: "Root Feature", parentTaskId: null }],
      ["feature-parent", { name: "Parent Feature", parentTaskId: "feature-root" }],
    ]),
);
const useAcknowledgeOnOpenMock = vi.hoisted(() => vi.fn());
const entityConversationChatPropsMock = vi.hoisted(() => vi.fn());
const suppressLayoutMainBottomSpacingMock = vi.hoisted(() => vi.fn());
const layoutMainScrollOwnerMock = vi.hoisted(() => ({
  mainContentRef: { current: null },
  taskContextStickyTop: { xs: "50px", md: "48px" },
}));

const agentSession = {
  id: "session-1",
  title: "Discuss task",
  status: AgentSessionStatus.InProgress,
  type: AgentSessionType.EntityConversation,
  conversationId: "conversation-1",
  machineId: "machine-1",
  entityType: "TASK",
  entityId: "task-1",
  projectId: "project-1",
} as never;

vi.mock("react-router-dom", () => ({
  useParams: () => routeParams.current,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSession: (...args: unknown[]) => useAgentSessionMock(...args),
  useConversation: () => ({ data: null }),
  useFullEntityContext: (...args: unknown[]) =>
    useFullEntityContextMock(...args),
  useProject: () => ({ data: { name: "Project" } }),
  useTaskHierarchy: (...args: unknown[]) => useTaskHierarchyMock(...args),
  useFeatureLookup: () => ({
    isReady: true,
    isLoading: false,
    get: (id: string) => {
      const feature = cachedFeatures.get(id);
      return feature ? { id, ...feature } : undefined;
    },
    resolveAncestry: (startId: string | null) => {
      const ancestors: { id: string; name: string }[] = [];
      let currentId = startId;
      while (currentId) {
        const feature = cachedFeatures.get(currentId);
        if (!feature) return { ancestors: [], complete: false };
        ancestors.unshift({ id: currentId, name: feature.name });
        currentId = feature.parentTaskId;
      }
      return { ancestors, complete: true };
    },
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    feature: ({ projectId, featureId }: Record<string, string>) =>
      `/projects/${projectId}/features/${featureId}`,
    task: ({ projectId, taskId }: Record<string, string>) =>
      `/projects/${projectId}/tasks/${taskId}`,
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "claude-opus-4-7",
    reasoningEffort: "medium",
  }),
  ENTITY_CONVERSATION_SURFACE_ID: "entity-conversation",
  EntityConversationChat: (props: Record<string, unknown>) => {
    entityConversationChatPropsMock(props);
    return <div data-testid="entity-conversation-chat" />;
  },
  OpenBrowserCapsuleAction: (props: Record<string, unknown>) => {
    openBrowserPropsMock(props);
    return <div data-testid="open-browser-action" />;
  },
  RunBrowserProvider: ({
    value,
    children,
  }: {
    value: unknown;
    children: React.ReactNode;
  }) => {
    runBrowserProviderValueMock(value);
    return <>{children}</>;
  },
  readSurfaceSelection: () => null,
  resolveEntityConversationRuntimeSelection: (
    _session: unknown,
    selection: {
      provider: "claude";
      model: string;
      reasoningEffort: "medium";
    }
  ) => selection,
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: (props: unknown) => {
    pageBreadcrumbsMock(props);
    return <div />;
  },
}));

vi.mock("../../components/Layout/LayoutMainBottomSpacingContext", () => ({
  useSuppressLayoutMainBottomSpacing: suppressLayoutMainBottomSpacingMock,
}));

vi.mock("../../components/Layout/LayoutMainScrollOwnerContext", () => ({
  useLayoutMainScrollOwner: () => layoutMainScrollOwnerMock,
}));

vi.mock("./entityConversationPageComposition", () => ({
  buildEntityConversationPageComposition: () => ({ kind: "canonical" }),
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

import { EntityConversationPage } from "./EntityConversationPage";

describe("EntityConversationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParams.current = {
      projectId: "project-1",
      agentSessionId: "session-1",
      conversationId: "conversation-1",
    };
    useAgentSessionMock.mockReturnValue({
      agentSession,
      isFetched: true,
      isLoading: false,
      error: null,
    });
    useFullEntityContextMock.mockReturnValue({
      data: { displayName: "Task", featureHierarchy: [] },
    });
    useTaskHierarchyMock.mockReturnValue({
      hierarchy: {
        task: { id: "task-1", parentTaskId: "feature-parent" },
      },
    });
  });

  const featureCrumbLabels = () =>
    (
      pageBreadcrumbsMock.mock.lastCall?.[0] as {
        items: { label: string; type?: string }[];
      }
    ).items
      .filter((item) => item.type === "feature")
      .map((item) => item.label);

  it("resolves a task subject's nearest feature from the cached hierarchy", () => {
    render(<EntityConversationPage />);

    expect(useTaskHierarchyMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "task-1",
      expect.objectContaining({ enabled: true }),
    );
    expect(featureCrumbLabels()).toEqual(["Parent Feature"]);
  });

  it("skips the hierarchy read when the subject is a cached feature", () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: { ...(agentSession as object), entityId: "feature-parent" },
      isFetched: true,
      isLoading: false,
      error: null,
    });

    render(<EntityConversationPage />);

    expect(useTaskHierarchyMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "feature-parent",
      expect.objectContaining({ enabled: false }),
    );
    expect(featureCrumbLabels()).toEqual(["Root Feature"]);
  });

  it("keeps the page in loading state until the session fetch completes", () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: null,
      isFetched: false,
      isLoading: false,
      error: null,
    });

    render(<EntityConversationPage />);

    expect(
      screen.getByTestId("entity-conversation-loading")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-discuss")
    ).not.toBeInTheDocument();
    expect(useAcknowledgeOnOpenMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      enabled: false,
    });
  });

  it("acknowledges output attention after the canonical entity conversation loads", () => {
    render(<EntityConversationPage />);

    expect(useAcknowledgeOnOpenMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      enabled: true,
    });
  });

  it("registers Discuss for the entity conversation session", () => {
    render(<EntityConversationPage />);

    expect(screen.getByTestId("agent-session-discuss")).toHaveAttribute(
      "data-session-id",
      "session-1"
    );
    expect(screen.getByTestId("agent-session-discuss")).toHaveAttribute(
      "data-organization-id",
      "org-1"
    );
  });

  it("enables Open browser for the conversation's Run on its owning machine", () => {
    render(<EntityConversationPage />);

    expect(screen.getAllByTestId("open-browser-action")).toHaveLength(1);
    expect(openBrowserPropsMock).toHaveBeenLastCalledWith({
      runId: "session-1",
      sessionMachineId: "machine-1",
      order: 35,
    });
    expect(runBrowserProviderValueMock).toHaveBeenLastCalledWith({
      runId: "session-1",
      sessionMachineId: "machine-1",
    });
  });

  it("hands Open browser the owning machine so another computer's CLI is refused", () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: { ...(agentSession as object), machineId: "machine-2" },
      isFetched: true,
      isLoading: false,
      error: null,
    });

    render(<EntityConversationPage />);

    expect(openBrowserPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionMachineId: "machine-2" })
    );
  });

  it("withholds the Run from Open browser before the conversation exists", () => {
    routeParams.current = { projectId: "project-1", agentSessionId: "session-1" };
    useAgentSessionMock.mockReturnValue({
      agentSession: {
        ...(agentSession as object),
        conversationId: null,
        machineId: null,
      },
      isFetched: true,
      isLoading: false,
      error: null,
    });

    render(<EntityConversationPage />);

    expect(openBrowserPropsMock).toHaveBeenLastCalledWith({
      runId: null,
      sessionMachineId: null,
      order: 35,
    });
    expect(runBrowserProviderValueMock).toHaveBeenLastCalledWith({
      runId: null,
      sessionMachineId: null,
    });
  });

  it("loads canonical entity context for the page breadcrumbs", () => {
    render(<EntityConversationPage />);

    expect(useFullEntityContextMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      entityType: "TASK",
      entityId: "task-1",
      enabled: true,
      includeFeatureHierarchy: true,
      includeProposals: false,
      includeAvailableMcpTools: false,
    });
  });

  it("passes the layout main scroll owner without creating a bounded conversation scrollport", () => {
    render(<EntityConversationPage />);

    expect(suppressLayoutMainBottomSpacingMock).toHaveBeenLastCalledWith(
      true,
      { suppressMainScroll: false }
    );
    expect(entityConversationChatPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scrollPolicy: {
          mode: "owned",
          ownerRef: layoutMainScrollOwnerMock.mainContentRef,
        },
      })
    );
    expect(entityConversationChatPropsMock.mock.lastCall?.[0]).not.toHaveProperty(
      "scrollable"
    );

    const page = screen.getByTestId("entity-conversation-page");
    expect(window.getComputedStyle(page).height).not.toBe("100dvh");
    expect(window.getComputedStyle(page).overflow).not.toBe("hidden");
  });
});
