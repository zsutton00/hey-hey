import type {
  AgentEdgeResponseDto,
  TaskResponseDto,
} from "@hey-hey/ui-common/api";
import { TaskPriority, WorkStatus } from "@hey-hey/ui-common/api";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { WorkflowStepPageView } from "./WorkflowStepPageView";
import type { NormalizedWorkflowStepEdge } from "./workflowStepEdges";

const { mockDataDebugTab } = vi.hoisted(() => ({
  mockDataDebugTab: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  DiscussCapsuleAction: ({
    entityId,
    entityType,
    entityTitle,
  }: {
    entityId: string;
    entityType: string;
    entityTitle?: string;
  }) => (
    <button
      type="button"
      data-testid="capsule-discuss"
      data-entity-id={entityId}
      data-entity-type={entityType}
      data-entity-title={entityTitle}
    >
      Discuss
    </button>
  ),
  WorkItemReadView: () => <div data-testid="work-item-read-view" />,
}));

vi.mock(
  "@hey-hey/ui-common/components/shared/WorkflowMentionInlineRenderer",
  () => ({
    WorkflowGraphSurface: ({
      graphData,
      highlightedStepId,
    }: {
      graphData: {
        steps: unknown[];
        edges: unknown[];
      };
      highlightedStepId?: string;
    }) => (
      <div
        data-testid="workflow-graph-surface"
        data-step-count={graphData.steps.length}
        data-edge-count={graphData.edges.length}
        data-highlighted-step-id={highlightedStepId ?? ""}
      />
    ),
  }),
);

vi.mock("@hey-hey/ui-common/utils", () => ({
  getTaskContentFromSections: () => ({
    description: "Step body",
    acceptanceCriteria: null,
  }),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageBody: ({
    content,
    sidebar,
    contextualRail,
  }: {
    content: React.ReactNode;
    sidebar: React.ReactNode;
    contextualRail?: { expanded: boolean; onToggle: () => void };
  }) => (
    <>
      {content}
      {contextualRail && (
        <button type="button" onClick={contextualRail.onToggle}>
          {contextualRail.expanded ? "Hide Context" : "Show Context"}
        </button>
      )}
      {contextualRail?.expanded && sidebar}
    </>
  ),
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="detail-page-container">{children}</div>
  ),
  DetailPageHeader: ({
    title,
    subtitle,
  }: {
    title: React.ReactNode;
    subtitle?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  ),
  DetailPageTabs: ({
    tabs,
  }: {
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <nav>
      {tabs.map((tab) => (
        <button key={tab.value} type="button">
          {tab.label}
        </button>
      ))}
    </nav>
  ),
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: ({
    actions,
  }: {
    metadataItems?: unknown[];
    actions?: React.ReactNode;
  }) => <section data-testid="admin-tab">{actions}</section>,
  buildAdminMetadataItems: () => [{ label: "Created At", value: "today" }],
}));

vi.mock("../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: (props: { entityId: string; entityType: string }) => {
    mockDataDebugTab(props);
    return <div data-testid="workflow-step-data-debug-tab" />;
  },
}));

vi.mock("../../components/Tabs/ConversationListTab", () => ({
  ConversationListTab: ({
    conversationPathForId,
    workflowAboutId,
    workflowAboutType,
  }: {
    conversationPathForId: (conversationId: string) => string;
    workflowAboutId?: string;
    workflowAboutType?: string;
  }) => (
    <section
      data-testid="workflow-step-conversations-tab"
      data-workflow-about-id={workflowAboutId}
      data-workflow-about-type={workflowAboutType}
    >
      <a href={conversationPathForId("conversation-1")}>
        Existing conversation
      </a>
    </section>
  ),
}));

vi.mock("../../components/TaskBreadcrumbs", () => ({
  TaskBreadcrumbs: ({ linksEnabled = true }: { linksEnabled?: boolean }) => (
    <nav
      data-testid="task-breadcrumbs"
      data-links-enabled={String(linksEnabled)}
    />
  ),
}));

vi.mock("./TaskDetailSidebar", () => ({
  TaskDetailSidebar: () => (
    <aside data-testid="task-detail-sidebar">
      <div>Feature Tree</div>
      <div>Related Card</div>
    </aside>
  ),
}));

const createTask = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto =>
  ({
    id: "step-1",
    name: "Review Request",
    type: "workflow_step",
    organizationId: "org-1",
    projectId: "project-1",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Low,
    source: "user",
    sections: [],
    ...overrides,
  }) as TaskResponseDto;

const createEdge = (
  overrides: Partial<NormalizedWorkflowStepEdge>,
): NormalizedWorkflowStepEdge => ({
  id: "edge-1",
  type: "STANDARD",
  sourceNodeId: "step-1",
  targetNodeId: "step-2",
  connectedNodeId: "step-2",
  connectedNodeName: "Next Step",
  directionFromStep: "outbound",
  ...overrides,
});

const renderView = (
  overrides: Partial<React.ComponentProps<typeof WorkflowStepPageView>> = {},
): ReturnType<typeof render> => {
  return render(
    <MemoryRouter>
      <WorkflowStepPageView
        linkedDiagram={{ status: "absent" }}
        organizationId="org-1"
        projectId="project-1"
        task={createTask()}
        parentWorkflow={createTask({
          id: "workflow-1",
          name: "Triage Workflow",
          type: "workflow",
        })}
        project={{ id: "project-1", name: "Project" }}
        graphData={{
          workflow: createTask({
            id: "workflow-1",
            name: "Triage Workflow",
            type: "workflow",
          }) as TaskResponseDto & { type: "workflow" },
          steps: [
            createTask() as TaskResponseDto & { type: "workflow_step" },
            createTask({
              id: "step-2",
              name: "Next Step",
            }) as TaskResponseDto & { type: "workflow_step" },
          ],
          edges: [
            {
              id: "flow-1",
              type: "CONDITIONAL",
              sourceNodeId: "step-1",
              targetNodeId: "step-2",
            },
          ] as AgentEdgeResponseDto[],
        }}
        featureAncestors={[]}
        relatedEntities={[]}
        proposals={[]}
        isPlatformAdmin
        conversationPathForId={(conversationId) =>
          `/projects/project-1/resolve-agent-session/${conversationId}`
        }
        activeTab="step"
        onTabChange={vi.fn()}
        flowLinks={[
          createEdge({
            id: "flow-1",
            type: "CONDITIONAL",
            connectedNodeName: "Needs Revision",
          }),
        ]}
        fulfillmentLinks={[
          createEdge({
            id: "fulfilled-1",
            type: "FULFILLED_BY",
            connectedNodeId: "task-1",
            connectedNodeName: "Implement Review",
          }),
        ]}
        isTreeVisible
        onToggleTree={vi.fn()}
        isDeleteDialogOpen={false}
        isDeletingStep={false}
        onDeleteClick={vi.fn()}
        onCancelDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
};

describe("WorkflowStepPageView", () => {
  it("shows independent relationship links before the graph with context collapsed", () => {
    renderView({
      isTreeVisible: false,
      linkedDiagram: {
        status: "ready",
        diagram: createTask({
          id: "linked-diagram",
          name: "Canonical target title",
          type: "DIAGRAM",
        }),
      },
    });
    expect(screen.getByText("Part of diagram")).toBeVisible();
    expect(screen.getByText("Links to diagram")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Diagram" })).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/workflow-1",
    );
    expect(
      screen.getByRole("link", { name: "Open linked Diagram" }),
    ).toHaveAttribute("href", "/projects/project-1/tasks/linked-diagram");
    expect(screen.getByText("Canonical target title")).toBeVisible();
    expect(screen.queryByTestId("task-detail-sidebar")).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId("workflow-step-linked-diagram")
        .compareDocumentPosition(screen.getByTestId("workflow-step-graph")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each(["loading", "unavailable"] as const)(
    "keeps the owning destination visible when the linked destination is %s",
    (status) => {
      renderView({ linkedDiagram: { status }, isTreeVisible: false });
      expect(screen.getByRole("link", { name: "Open Diagram" })).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(
        status === "loading"
          ? "Loading linked Diagram"
          : "Linked Diagram is unavailable",
      );
      expect(
        screen.queryByRole("link", { name: "Open linked Diagram" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps the linked destination visible when structural parentage is unavailable", () => {
    renderView({
      parentWorkflow: null,
      linkedDiagram: {
        status: "ready",
        diagram: createTask({
          id: "linked-diagram",
          name: "Target",
          type: "DIAGRAM",
        }),
      },
    });
    expect(
      screen.getByText(
        "Part of diagram context is unavailable for this element.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open linked Diagram" }),
    ).toBeVisible();
  });

  it("reveals both context cards through the page disclosure", () => {
    const onToggleTree = vi.fn();
    const view = renderView({ isTreeVisible: false, onToggleTree });

    expect(
      screen.getByRole("button", { name: "Show Context" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-sidebar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show Context" }));
    expect(onToggleTree).toHaveBeenCalledOnce();
    view.unmount();

    renderView({ isTreeVisible: true, onToggleTree });
    expect(
      screen.getByRole("button", { name: "Hide Context" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Feature Tree")).toBeInTheDocument();
    expect(screen.getByText("Related Card")).toBeInTheDocument();
  });
  it("registers Discuss for the displayed Diagram Element task identity", () => {
    renderView();

    expect(screen.getByTestId("capsule-discuss")).toHaveTextContent("Discuss");
    expect(screen.getByTestId("capsule-discuss")).toHaveAttribute(
      "data-entity-id",
      "step-1",
    );
    expect(screen.getByTestId("capsule-discuss")).toHaveAttribute(
      "data-entity-type",
      "TASK",
    );
    expect(screen.getByTestId("capsule-discuss")).toHaveAttribute(
      "data-entity-title",
      "Review Request",
    );
  });

  it("does not substitute the parent workflow as the Discuss target", () => {
    renderView();

    expect(screen.getByTestId("capsule-discuss")).not.toHaveAttribute(
      "data-entity-id",
      "workflow-1",
    );
  });

  it("renders parent workflow navigation and separates flow from fulfillment", () => {
    renderView();

    expect(
      screen.getByRole("heading", { name: "Review Request" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-step-parent-workflow"),
    ).toHaveTextContent("Triage Workflow");
    expect(screen.getByTestId("workflow-graph-surface")).toHaveAttribute(
      "data-step-count",
      "2",
    );
    expect(screen.getByTestId("workflow-graph-surface")).toHaveAttribute(
      "data-edge-count",
      "1",
    );
    expect(screen.getByTestId("workflow-graph-surface")).toHaveAttribute(
      "data-highlighted-step-id",
      "step-1",
    );
    expect(screen.getByRole("link", { name: /Open Diagram/i })).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/workflow-1",
    );

    const flowSection = screen.getByTestId("workflow-step-flow-links");
    expect(within(flowSection).getByText("CONDITIONAL")).toBeInTheDocument();
    expect(within(flowSection).getByText("Needs Revision")).toBeInTheDocument();
    expect(
      within(flowSection).queryByText("FULFILLED_BY"),
    ).not.toBeInTheDocument();

    const fulfillmentSection = screen.getByTestId(
      "workflow-step-fulfillment-links",
    );
    expect(
      within(fulfillmentSection).getByText("FULFILLED_BY"),
    ).toBeInTheDocument();
    expect(
      within(fulfillmentSection).getByText("Implement Review"),
    ).toBeInTheDocument();
  });

  it("can render workflow context without entity links", () => {
    renderView({ enableEntityLinks: false });

    expect(
      screen.getByTestId("workflow-step-parent-workflow"),
    ).toHaveTextContent("Triage Workflow");
    expect(
      screen.queryByRole("link", { name: /Open Diagram/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("task-breadcrumbs")).toHaveAttribute(
      "data-links-enabled",
      "false",
    );
  });

  it("does not render child-management controls", () => {
    renderView();

    expect(screen.queryByTestId("work-item-metadata")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("task-children-create-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add Task/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tasks" }),
    ).not.toBeInTheDocument();
  });

  it("renders Admin tab access without task lifecycle metadata", () => {
    renderView({ activeTab: "admin" });

    expect(
      screen.getByRole("button", { name: "Diagram Element" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-tab")).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-step-delete-button"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-metadata")).not.toBeInTheDocument();
    expect(screen.queryByTestId("capsule-discuss")).not.toBeInTheDocument();
  });

  it("renders the task-scoped Conversations tab", () => {
    renderView({ activeTab: "conversations" });

    expect(
      screen.getByRole("button", { name: "Conversations" }),
    ).toBeInTheDocument();
    const conversations = screen.getByTestId("workflow-step-conversations-tab");
    expect(conversations).toHaveAttribute("data-workflow-about-id", "step-1");
    expect(conversations).toHaveAttribute("data-workflow-about-type", "task");
    expect(
      screen.getByRole("link", { name: "Existing conversation" }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session/conversation-1",
    );
    expect(screen.queryByTestId("workflow-step-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-tab")).not.toBeInTheDocument();
  });

  it("exposes and renders the scoped Data Debug tab when debug is enabled", () => {
    renderView({ activeTab: "data-debug" });

    expect(
      screen.getByRole("button", { name: "Data Debug" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-step-data-debug-tab"),
    ).toBeInTheDocument();
    expect(mockDataDebugTab).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      entityId: "step-1",
      entityType: "task",
    });
  });

  it("omits the Data Debug tab when debug is disabled", () => {
    renderView({ isPlatformAdmin: false });

    expect(
      screen.queryByRole("button", { name: "Data Debug" }),
    ).not.toBeInTheDocument();
  });
});
