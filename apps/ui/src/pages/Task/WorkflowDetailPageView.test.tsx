import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import type {
  AgentEdgeResponseDto,
  TaskResponseDto,
} from "@hey-hey/ui-common/api";
import { TaskPriority, WorkStatus } from "@hey-hey/ui-common/api";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { WorkflowDetailPageView } from "./WorkflowDetailPageView";

const { mockDataDebugTab } = vi.hoisted(() => ({
  mockDataDebugTab: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  CapsuleAction: ({
    id,
    label,
    onClick,
    disabled,
    iconStyle,
  }: {
    id: string;
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    iconStyle?: React.CSSProperties;
  }) => (
    <button
      type="button"
      data-testid={`capsule-${id}`}
      data-icon-style-background={iconStyle?.backgroundColor}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  ),
  DiscussCapsuleAction: ({
    entityId,
    entityTitle,
  }: {
    entityId: string;
    entityTitle?: string;
  }) => (
    <button
      type="button"
      data-testid="capsule-discuss"
      data-entity-id={entityId}
      data-entity-title={entityTitle}
    >
      Discuss
    </button>
  ),
  WorkItemGraphEditor: () => <div data-testid="work-item-graph-editor" />,
  WorkItemReadView: () => (
    <div data-testid="work-item-read-view">Workflow owned description</div>
  ),
}));

vi.mock(
  "@hey-hey/ui-common/components/shared/WorkflowMentionInlineRenderer",
  () => ({
    WorkflowGraphSurface: ({
      graphData,
      projection,
      allowFullscreen,
    }: {
      graphData?: {
        steps: Array<{ id: string }>;
        edges: Array<{ id: string }>;
      };
      projection?: unknown;
      allowFullscreen?: boolean;
    }) => (
      <div
        data-testid="workflow-graph-surface"
        data-step-count={graphData?.steps.length ?? 0}
        data-edge-count={graphData?.edges.length ?? 0}
        data-graph-source={
          graphData ? "loaded" : projection ? "projection" : "none"
        }
        data-allow-fullscreen={String(allowFullscreen)}
      />
    ),
  }),
);

vi.mock("@hey-hey/ui-common/utils", () => ({
  getTaskContentFromSections: () => ({
    description: "Workflow owned description",
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
      data-testid="workflow-conversations-tab"
      data-workflow-about-id={workflowAboutId}
      data-workflow-about-type={workflowAboutType}
    >
      <p>
        No conversations yet. Start a conversation to discuss this workflow.
      </p>
      <a href={conversationPathForId("conversation-1")}>
        Existing conversation
      </a>
      <button type="button">Start new conversation</button>
    </section>
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
  DataDebugTab: (props: {
    organizationId: string;
    projectId: string;
    entityId: string;
    entityType: string;
  }) => {
    mockDataDebugTab(props);
    return <section data-testid="workflow-data-debug-tab" />;
  },
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

const createWorkflow = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto =>
  ({
    id: "workflow-1",
    name: "Triage Workflow",
    type: WORK_ITEM_TYPE_KEYS.Workflow,
    organizationId: "org-1",
    projectId: "project-1",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Low,
    source: "user",
    sections: [],
    ...overrides,
  }) as TaskResponseDto;

const createStep = (id: string, name: string): TaskResponseDto =>
  ({
    id,
    name,
    type: WORK_ITEM_TYPE_KEYS.WorkflowStep,
    organizationId: "org-1",
    projectId: "project-1",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Low,
    source: "user",
    sections: [],
  }) as TaskResponseDto;

const createEdge = (id: string): AgentEdgeResponseDto =>
  ({
    id,
    type: "STANDARD",
    sourceNodeId: "step-1",
    targetNodeId: "step-2",
  }) as AgentEdgeResponseDto;

const renderView = (
  overrides: Partial<React.ComponentProps<typeof WorkflowDetailPageView>> = {},
): ReturnType<typeof render> => {
  const workflow = createWorkflow();
  return render(
    <MemoryRouter>
      <WorkflowDetailPageView
        organizationId="org-1"
        projectId="project-1"
        workflow={workflow}
        parent={createWorkflow({
          id: "feature-1",
          name: "Workflow Graphs",
          type: WORK_ITEM_TYPE_KEYS.Feature,
        })}
        project={{ id: "project-1", name: "Project" }}
        graphData={{
          workflow: workflow as TaskResponseDto & {
            type: typeof WORK_ITEM_TYPE_KEYS.Workflow;
          },
          steps: [
            createStep("step-1", "Start") as TaskResponseDto & {
              type: typeof WORK_ITEM_TYPE_KEYS.WorkflowStep;
            },
            createStep("step-2", "Finish") as TaskResponseDto & {
              type: typeof WORK_ITEM_TYPE_KEYS.WorkflowStep;
            },
          ],
          edges: [createEdge("edge-1")],
        }}
        featureAncestors={[]}
        relatedEntities={[]}
        proposals={[]}
        isPlatformAdmin
        activeTab="workflow"
        onTabChange={vi.fn()}
        isTreeVisible
        onToggleTree={vi.fn()}
        isDeleteDialogOpen={false}
        isDeletingWorkflow={false}
        onDeleteClick={vi.fn()}
        onCancelDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
};

describe("WorkflowDetailPageView", () => {
  it("renders the graph as the primary artifact with description and sidebar context", () => {
    renderView();

    expect(
      screen.getByRole("heading", { name: "Triage Workflow" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Diagram" }),
    ).toBeInTheDocument();

    const graph = screen.getByTestId("workflow-graph-surface");
    expect(graph).toHaveAttribute("data-step-count", "2");
    expect(graph).toHaveAttribute("data-edge-count", "1");
    expect(graph).toHaveAttribute("data-allow-fullscreen", "true");

    expect(screen.getByTestId("workflow-detail-description")).toHaveTextContent(
      "Workflow owned description",
    );
    expect(screen.getByTestId("task-detail-sidebar")).toBeInTheDocument();
  });

  it("shows both context cards when the page disclosure is opened", () => {
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

  it("prefers loaded workflow data over the lossy edit projection in view mode", () => {
    renderView({
      graphProjection: {
        projectedRoot: {},
        children: [],
        incidentRelationships: [],
        effectiveLayout: { nodes: [] },
      } as React.ComponentProps<
        typeof WorkflowDetailPageView
      >["graphProjection"],
    });

    expect(screen.getByTestId("workflow-graph-surface")).toHaveAttribute(
      "data-graph-source",
      "loaded",
    );
  });

  it("does not render workflow edit or runtime execution controls", () => {
    renderView();

    expect(screen.queryByTestId("work-item-metadata")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /execute/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /run/i }),
    ).not.toBeInTheDocument();
  });

  it("registers the edit entry point through the Action Capsule", () => {
    const onEditGraph = vi.fn();

    renderView({ canEditGraph: true, onEditGraph });

    expect(screen.getByTestId("capsule-edit-workflow-graph")).toHaveTextContent(
      "Edit",
    );
    expect(screen.queryByTestId("workflow-graph-edit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("capsule-edit-workflow-graph"));

    expect(onEditGraph).toHaveBeenCalledOnce();
  });

  it("registers Discuss for the workflow entity in view mode", () => {
    renderView();

    expect(screen.getByTestId("capsule-discuss")).toHaveTextContent("Discuss");
    expect(screen.getByTestId("capsule-discuss")).toHaveAttribute(
      "data-entity-id",
      "workflow-1",
    );
    expect(screen.getByTestId("capsule-discuss")).toHaveAttribute(
      "data-entity-title",
      "Triage Workflow",
    );
  });

  it("uses Action Capsule save and cancel/done actions while giving the editor full width", () => {
    const onDiscardGraph = vi.fn();
    const onReviewGraph = vi.fn();
    const graphDraft = {
      isDirty: false,
    } as unknown as React.ComponentProps<
      typeof WorkflowDetailPageView
    >["graphDraft"];

    renderView({
      canEditGraph: true,
      isEditingGraph: true,
      graphDraft,
      onDiscardGraph,
      onReviewGraph,
    });

    expect(
      screen.getByTestId("capsule-cancel-workflow-graph"),
    ).toHaveTextContent("Done");
    expect(screen.getByTestId("capsule-cancel-workflow-graph")).toHaveAttribute(
      "data-icon-style-background",
      "#6B7280",
    );
    expect(screen.getByTestId("capsule-save-workflow-graph")).toBeDisabled();
    expect(screen.queryByTestId("task-detail-sidebar")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Feature Tree" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("capsule-discuss")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("capsule-cancel-workflow-graph"));

    expect(onDiscardGraph).toHaveBeenCalledOnce();
    expect(onReviewGraph).not.toHaveBeenCalled();
  });

  it("labels the dirty-state action Cancel when the graph has unsaved changes", () => {
    const graphDraft = {
      isDirty: true,
    } as unknown as React.ComponentProps<
      typeof WorkflowDetailPageView
    >["graphDraft"];

    renderView({
      canEditGraph: true,
      isEditingGraph: true,
      graphDraft,
    });

    expect(
      screen.getByTestId("capsule-cancel-workflow-graph"),
    ).toHaveTextContent("Cancel");
    expect(screen.getByTestId("capsule-save-workflow-graph")).toBeEnabled();
  });

  it("renders Admin tab access without task lifecycle metadata", () => {
    renderView({ activeTab: "admin" });

    expect(screen.getByRole("button", { name: "Diagram" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-tab")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-delete-button")).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-metadata")).not.toBeInTheDocument();
    expect(screen.queryByTestId("capsule-discuss")).not.toBeInTheDocument();
  });

  it("renders the shared workflow-scoped Conversations tab", () => {
    renderView({ activeTab: "conversations" });

    expect(
      screen.getByRole("button", { name: "Conversations" }),
    ).toBeInTheDocument();
    const conversations = screen.getByTestId("workflow-conversations-tab");
    expect(conversations).toHaveAttribute(
      "data-workflow-about-id",
      "workflow-1",
    );
    expect(conversations).toHaveAttribute("data-workflow-about-type", "task");
    expect(conversations).toHaveTextContent(
      "No conversations yet. Start a conversation to discuss this workflow.",
    );
    expect(
      screen.getByRole("link", { name: "Existing conversation" }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session/conversation-1",
    );
    expect(
      screen.getByRole("button", { name: "Start new conversation" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-detail-page"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-tab")).not.toBeInTheDocument();
  });

  it("renders the scoped Data Debug tab when debug is enabled", () => {
    renderView({ activeTab: "data-debug" });

    expect(
      screen.getByRole("button", { name: "Data Debug" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workflow-data-debug-tab")).toBeInTheDocument();
    expect(mockDataDebugTab).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      entityId: "workflow-1",
      entityType: "task",
    });
    expect(
      screen.queryByTestId("workflow-detail-page"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-tab")).not.toBeInTheDocument();
  });

  it("omits Data Debug access when debug is disabled", () => {
    renderView({ isPlatformAdmin: false, activeTab: "workflow" });

    expect(
      screen.queryByRole("button", { name: "Data Debug" }),
    ).not.toBeInTheDocument();
  });

  it("renders unavailable and edge-refresh fallback states", () => {
    renderView({
      graphData: null,
      graphLoadError: new Error("Failed to refresh"),
    });

    expect(
      screen.queryByTestId("workflow-graph-surface"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Diagram data is unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Diagram links could not be refreshed/i),
    ).toBeInTheDocument();
  });
});
