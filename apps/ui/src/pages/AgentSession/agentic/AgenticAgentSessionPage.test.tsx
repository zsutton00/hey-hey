import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionStatus, AgentSessionType } from "@hey-hey/ui-common/api";

const agentSession = {
  id: "session-1",
  title: "Coding session",
  status: AgentSessionStatus.InProgress,
  type: AgentSessionType.Coding,
  entityType: null,
  entityId: null,
  projectId: "project-1",
};
const useAcknowledgeOnOpenMock = vi.hoisted(() => vi.fn());
const acceptInitialPromptMock = vi.hoisted(() => vi.fn());
const codingSessionPropsMock = vi.hoisted(() => vi.fn());
const setupSectionPropsMock = vi.hoisted(() => vi.fn());
const canonicalCompositionMock = vi.hoisted(() => vi.fn());
const layoutMainScrollOwnerMock = vi.hoisted(() => ({
  mainContentRef: { current: null },
  taskContextStickyTop: { xs: "50px", md: "48px" },
}));
const pageStateModeMock = vi.hoisted(() => ({
  title: "Coding session",
  conversationTitle: null as string | null,
  mode: "setup" as "setup" | "active",
  provider: null as string | null,
  serviceId: null as string | null,
  workflowName: null as string | null,
  setupReadLoading: false,
  setupReadFetched: true,
  setupReadError: null as string | null,
  planWorktreeBranch: "plan/shared-branch" as string | null,
  routeTaskId: null as string | null,
  taskData: null as { id: string; name: string; type: string } | null,
  planId: null as string | null,
  launchPlanId: null as string | null,
  launchStepId: null as string | null,
  launchStageId: null as string | null,
}));

vi.mock("@hey-hey/ui-common", () => ({
  createNavigationLineageEntry: (entityType: string, entityId: string) => ({
    entityType,
    entityId,
  }),
  WebPathService: {
    agentSession: ({ projectId, agentSessionId }: Record<string, string>) =>
      `/projects/${projectId}/agent-sessions/${agentSessionId}`,
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  AgentBridgeTrackingProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  AgenticSetupSection: (props: { userId: string | null }) => {
    setupSectionPropsMock(props);
    return (
      <div data-testid="agentic-setup" data-user-id={props.userId ?? ""} />
    );
  },
  CodingSession: (props: Record<string, unknown>) => {
    codingSessionPropsMock(props);
    return <div data-testid="conversation-content" data-conversation-content />;
  },
  DataStateBoundary: ({
    loading,
    fetched,
    children,
  }: {
    loading: boolean;
    fetched: boolean;
    children: React.ReactNode;
  }) =>
    loading || !fetched ? <div>Loading required data...</div> : <>{children}</>,
  LocalRuntimeUnavailableAlert: () => <div />,
  ValidationSession: () => <div />,
  useValidationLauncher: () => ({ launch: vi.fn() }),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  createCanonicalPageDescriptor: (
    entityType: string,
    entityId: string,
    lineage: unknown,
    presentation: unknown,
  ) => ({ entityType, entityId, lineage, presentation }),
  CanonicalPageBoundary: ({
    children,
    composition,
  }: {
    children: React.ReactNode;
    composition: unknown;
  }) => {
    canonicalCompositionMock(composition);
    return children;
  },
}));

vi.mock("nuqs", () => ({
  parseAsStringLiteral: () => ({
    withDefault: (value: string) => value,
  }),
  useQueryState: () => ["session", vi.fn()],
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("../../../components/Layout/LayoutMainBottomSpacingContext", () => ({
  useSuppressLayoutMainBottomSpacing: vi.fn(),
}));

vi.mock("../../../components/Layout/LayoutMainScrollOwnerContext", () => ({
  useLayoutMainScrollOwner: () => layoutMainScrollOwnerMock,
}));

vi.mock("../../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: () => <div />,
}));

vi.mock("../AgentSessionStatusActionCapsule", () => ({
  AgentSessionStatusActionCapsule: () => <div data-testid="status-action" />,
}));

vi.mock("../AgentSessionDiscussActionCapsule", () => ({
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

vi.mock("../useAcknowledgeAgentSessionOutputAttentionOnOpen", () => ({
  useAcknowledgeAgentSessionOutputAttentionOnOpen: useAcknowledgeOnOpenMock,
}));

vi.mock("./AgenticAgentSessionBreadcrumbs", () => ({
  AgenticAgentSessionBreadcrumbs: () => <div />,
}));

vi.mock("./useAgenticAgentSessionPageState", () => ({
  useAgenticAgentSessionPageState: () => ({
    organizationId: "org-1",
    userId: "user-1",
    pathname: "/projects/project-1/agent-sessions/session-1",
    projectId: "project-1",
    routeTaskId: pageStateModeMock.routeTaskId,
    planId: pageStateModeMock.planId,
    stageId: null,
    stepId: null,
    agentSessionId: "session-1",
    projectQuery: {
      data: { name: "Project" },
      isLoading: false,
      isFetched: true,
    },
    agentSessionQuery: {
      error: null,
      isLoading: false,
      isFetched: true,
      refetch: vi.fn(),
    },
    taskQuery: { isLoading: false, isFetched: true },
    planQuery: { aggregate: null, status: "loading", error: null },
    setupRead: {
      loading: pageStateModeMock.setupReadLoading,
      fetched: pageStateModeMock.setupReadFetched,
      error: pageStateModeMock.setupReadError,
    },
    planWorktreeBranch: pageStateModeMock.planWorktreeBranch,
    initiativeQuery: { data: null },
    agentSession: {
      ...agentSession,
      title: pageStateModeMock.title,
      entityId: pageStateModeMock.taskData?.id,
    },
    conversationTitle: pageStateModeMock.conversationTitle,
    taskData: pageStateModeMock.taskData,
    hasRequiredRouteParams: true,
    mode: pageStateModeMock.mode,
    onPromptSubmitted: vi.fn(),
    planPath: null,
    stepPath: null,
    taskOverviewPath: null,
    taskCodingTabPath: null,
    serviceId: pageStateModeMock.serviceId,
    taskServiceIds: [],
    provider: pageStateModeMock.provider,
    planData: null,
    planTitle: null,
    stepCrumbTitle: "Task",
    launchPlanId: pageStateModeMock.launchPlanId,
    launchStepId: pageStateModeMock.launchStepId,
    launchStageId: pageStateModeMock.launchStageId,
    nodeDecisionWorkflowName: pageStateModeMock.workflowName,
    sessionModel: null,
    sessionReasoningEffort: null,
    sessionMachineId: null,
    pendingInitialPromptDraft: "  unchanged prompt\n",
    pendingInitialPromptAttachments: [
      {
        attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
        fileName: "notes.txt",
      },
    ],
    onInitialPromptAccepted: acceptInitialPromptMock,
  }),
}));

import { AgenticAgentSessionPage } from "./AgenticAgentSessionPage";

describe("AgenticAgentSessionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageStateModeMock.title = "Coding session";
    pageStateModeMock.conversationTitle = null;
    pageStateModeMock.mode = "setup";
    pageStateModeMock.provider = null;
    pageStateModeMock.serviceId = null;
    pageStateModeMock.workflowName = null;
    pageStateModeMock.setupReadLoading = false;
    pageStateModeMock.setupReadFetched = true;
    pageStateModeMock.setupReadError = null;
    pageStateModeMock.planWorktreeBranch = "plan/shared-branch";
    pageStateModeMock.routeTaskId = null;
    pageStateModeMock.taskData = null;
    pageStateModeMock.planId = null;
    pageStateModeMock.launchPlanId = null;
    pageStateModeMock.launchStepId = null;
    pageStateModeMock.launchStageId = null;
  });

  it.each(["BUG", "STANDARD"])(
    "retains a resolved %s parent across task and general-page revisits",
    (type) => {
      pageStateModeMock.taskData = {
        id: "associated-task",
        name: "Parent",
        type,
      };
      pageStateModeMock.routeTaskId = "route-task";
      const { rerender } = render(
        <AgenticAgentSessionPage routeFamily="task" />,
      );
      const expected = expect.objectContaining({
        kind: "canonical",
        descriptor: expect.objectContaining({
          lineage: [{ entityType: "task", entityId: "associated-task" }],
          presentation: expect.objectContaining({
            label: "Coding session",
            sessionType: "CODING",
          }),
        }),
      });
      expect(canonicalCompositionMock).toHaveBeenLastCalledWith(expected);
      pageStateModeMock.routeTaskId = null;
      rerender(<AgenticAgentSessionPage routeFamily="project" />);
      expect(canonicalCompositionMock).toHaveBeenLastCalledWith(expected);
      rerender(<AgenticAgentSessionPage routeFamily="project" preview />);
      expect(canonicalCompositionMock).toHaveBeenLastCalledWith({
        kind: "observational",
      });
    },
  );

  it("refreshes the snapshot as the parent and conversation title arrive", () => {
    pageStateModeMock.title = "Agent Session";
    const { rerender } = render(
      <AgenticAgentSessionPage routeFamily="project" />,
    );
    const expectLabel = (label: string) => {
      expect(canonicalCompositionMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "canonical",
          descriptor: expect.objectContaining({
            entityId: "session-1",
            presentation: expect.objectContaining({ label }),
          }),
        }),
      );
    };
    expectLabel("Agent Session");

    pageStateModeMock.taskData = {
      id: "parent-task",
      name: "Retries",
      type: "STANDARD",
    };
    rerender(<AgenticAgentSessionPage routeFamily="project" />);
    expectLabel("Agent Session - Retries");

    pageStateModeMock.conversationTitle = "Discuss retries";
    rerender(<AgenticAgentSessionPage routeFamily="project" />);
    expectLabel("Discuss retries");
    rerender(<AgenticAgentSessionPage routeFamily="project" />);
    expectLabel("Discuss retries");

    rerender(<AgenticAgentSessionPage routeFamily="project" preview />);
    expect(canonicalCompositionMock).toHaveBeenLastCalledWith({
      kind: "observational",
    });
  });

  it("opens graph-only feature verification without a Service", () => {
    pageStateModeMock.mode = "active";
    pageStateModeMock.provider = "CODEX";
    pageStateModeMock.workflowName = "feature-sync";
    render(<AgenticAgentSessionPage routeFamily="project" />);
    expect(codingSessionPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: undefined,
        workflowName: "feature-sync",
      }),
    );
    expect(
      screen.queryByText(
        "Service or provider is not configured for this coding session.",
      ),
    ).not.toBeInTheDocument();
  });

  it("uses the shared boundary for setup-only required reads", () => {
    pageStateModeMock.setupReadLoading = true;
    pageStateModeMock.setupReadFetched = false;
    render(<AgenticAgentSessionPage routeFamily="task" />);
    expect(screen.getByText("Loading required data...")).toBeInTheDocument();
    expect(screen.queryByTestId("agentic-setup")).not.toBeInTheDocument();
  });

  it("shows setup read failures instead of launching without Plan configuration", () => {
    pageStateModeMock.setupReadError = "Plan context unavailable";
    render(<AgenticAgentSessionPage routeFamily="task" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Plan context unavailable",
    );
    expect(screen.queryByTestId("agentic-setup")).not.toBeInTheDocument();
  });

  it("renders an existing conversation while setup-only reads are delayed", () => {
    pageStateModeMock.mode = "active";
    pageStateModeMock.provider = "CODEX";
    pageStateModeMock.serviceId = "service-1";
    pageStateModeMock.setupReadLoading = true;
    pageStateModeMock.setupReadFetched = false;

    render(<AgenticAgentSessionPage routeFamily="task" />);

    expect(screen.getByTestId("conversation-content")).toBeInTheDocument();
  });

  it("passes the transient starting-message attachments and acceptance callback into the active coding surface", () => {
    pageStateModeMock.mode = "active";
    pageStateModeMock.provider = "CODEX";
    pageStateModeMock.serviceId = "service-1";
    render(<AgenticAgentSessionPage routeFamily="task" />);
    expect(codingSessionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialPromptDraft: "  unchanged prompt\n",
        initialPromptAttachments: [
          {
            attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
            fileName: "notes.txt",
          },
        ],
        onInitialPromptAccepted: acceptInitialPromptMock,
      }),
    );
  });

  it("renders an existing conversation when setup-only reads fail", () => {
    pageStateModeMock.mode = "active";
    pageStateModeMock.provider = "CODEX";
    pageStateModeMock.serviceId = "service-1";
    pageStateModeMock.setupReadError = "Plan context unavailable";

    render(<AgenticAgentSessionPage routeFamily="task" />);

    expect(screen.getByTestId("conversation-content")).toBeInTheDocument();
    expect(
      screen.queryByText("Plan context unavailable"),
    ).not.toBeInTheDocument();
  });

  it("acknowledges output attention for a loaded canonical coding session", () => {
    render(<AgenticAgentSessionPage routeFamily="task" />);

    expect(useAcknowledgeOnOpenMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      enabled: true,
    });
  });

  it("keeps Discuss alongside coding-session status controls", () => {
    render(<AgenticAgentSessionPage routeFamily="project" />);

    expect(screen.getByTestId("agent-session-discuss")).toHaveAttribute(
      "data-session-id",
      "session-1",
    );
    expect(screen.getByTestId("status-action")).toBeInTheDocument();
    expect(screen.getByTestId("agentic-setup")).toBeInTheDocument();
    expect(screen.getByTestId("agentic-setup")).toHaveAttribute(
      "data-user-id",
      "user-1",
    );
    expect(setupSectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: "plan/shared-branch",
      }),
    );
  });

  it("passes a configured Plan branch into a direct Task launch", () => {
    pageStateModeMock.routeTaskId = "task-1";
    pageStateModeMock.planId = "plan-1";
    pageStateModeMock.planWorktreeBranch = "plan/shared-branch";

    render(<AgenticAgentSessionPage routeFamily="task" />);

    expect(setupSectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: "plan/shared-branch",
      }),
    );
  });

  it("passes null for a branchless Plan so direct Task setup stays editable", () => {
    pageStateModeMock.routeTaskId = "task-1";
    pageStateModeMock.planId = "plan-1";
    pageStateModeMock.planWorktreeBranch = null;

    render(<AgenticAgentSessionPage routeFamily="task" />);

    expect(setupSectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: null,
      }),
    );
  });

  it("does not register Discuss for observational previews", () => {
    render(<AgenticAgentSessionPage routeFamily="project" preview />);

    expect(
      screen.queryByTestId("agent-session-discuss"),
    ).not.toBeInTheDocument();
    expect(useAcknowledgeOnOpenMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      enabled: false,
    });
  });

  it("leaves desktop wheel scrolling uncontained and unclipped", () => {
    pageStateModeMock.mode = "active";
    pageStateModeMock.provider = "CODEX";
    pageStateModeMock.serviceId = "service-1";

    render(<AgenticAgentSessionPage routeFamily="task" />);

    const conversationContent = document.querySelector(
      "[data-conversation-content]",
    );
    expect(conversationContent).not.toBeNull();
    expect(
      window.getComputedStyle(conversationContent as Element)
        .overscrollBehaviorY,
    ).not.toBe("contain");

    const sessionPage = conversationContent?.closest(".MuiStack-root");
    expect(sessionPage).not.toBeNull();
    const sessionPageStyle = window.getComputedStyle(sessionPage as Element);
    expect(sessionPageStyle.height).not.toBe("320px");
    expect(sessionPageStyle.overflow).not.toBe("hidden");
    expect(codingSessionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scrollPolicy: {
          mode: "owned",
          ownerRef: layoutMainScrollOwnerMock.mainContentRef,
        },
        taskContextStickyTop: layoutMainScrollOwnerMock.taskContextStickyTop,
      }),
    );
  });
});
