import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import type {
  AgentEdgeResponseDto,
  TaskResponseDto,
} from "@hey-hey/ui-common/api";
import {
  AgentEdgeType,
  TaskPriority,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WorkflowDetailPageView } from "./WorkflowDetailPageView";
import { WorkflowStepPageView } from "./WorkflowStepPageView";

vi.mock("@mui/material/SvgIcon", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="mui-svg-icon">{children}</span>
  ),
}));

vi.mock("@mui/material/SvgIcon/SvgIcon", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="mui-svg-icon">{children}</span>
  ),
}));

vi.mock("@mui/icons-material/AccountTree", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/ArrowForward", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/CallSplit", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/CheckCircle", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/Close", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/CloseFullscreen", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/Delete", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/FitScreen", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/Loop", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/OpenInFull", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/OpenInNew", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/ZoomIn", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@mui/icons-material/ZoomOut", () => ({
  default: () => <span data-testid="mui-icon" />,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  DiscussCapsuleAction: () => null,
  WorkItemReadView: () => (
    <div data-testid="work-item-read-view">Workflow owned description</div>
  ),
}));

vi.mock("@hey-hey/ui-common/utils", () => ({
  getTaskContentFromSections: () => ({
    description: "Workflow owned description",
    acceptanceCriteria: null,
  }),
}));

vi.mock(
  "@hey-hey/ui-common/components/shared/WorkflowMentionInlineRenderer",
  () => ({
    WorkflowGraphSurface: ({
      graphData,
    }: {
      graphData: {
        steps: Array<{ id: string; name?: string }>;
      };
    }) => (
      <div data-testid="workflow-inline-diagram" style={{ width: "900px" }}>
        <div data-testid="workflow-inline-diagram-viewport">
          {graphData.steps.map((step) => (
            <div key={step.id} data-testid="workflow-inline-step">
              {step.name}
            </div>
          ))}
        </div>
        <div data-testid="workflow-inline-diagram-controls">
          <button type="button">Fit view</button>
          <button type="button">Zoom in</button>
          <button type="button">Fullscreen</button>
        </div>
      </div>
    ),
  }),
);

vi.mock("../../components/Layout", () => ({
  DetailPageBody: ({
    content,
    sidebar,
  }: {
    content: React.ReactNode;
    sidebar: React.ReactNode;
  }) => (
    <>
      {content}
      {sidebar}
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
  DetailPageTabs: () => null,
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: () => <section data-testid="admin-tab" />,
  buildAdminMetadataItems: () => [],
}));

vi.mock("../../components/TaskBreadcrumbs", () => ({
  TaskBreadcrumbs: () => <nav data-testid="task-breadcrumbs" />,
}));

vi.mock("./TaskDetailSidebar", () => ({
  TaskDetailSidebar: () => <aside data-testid="task-detail-sidebar" />,
}));

const ensureResizeObserver = (): void => {
  if ("ResizeObserver" in globalThis) {
    return;
  }

  globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })) as unknown as typeof ResizeObserver;
};

const createWorkflow = (): TaskResponseDto =>
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
  }) as TaskResponseDto;

const createStep = (id: string, name: string): TaskResponseDto =>
  ({
    id,
    name,
    type: WORK_ITEM_TYPE_KEYS.WorkflowStep,
    organizationId: "org-1",
    projectId: "project-1",
    parentTaskId: "workflow-1",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Low,
    source: "user",
    sections: [],
  }) as TaskResponseDto;

describe("WorkflowDetailPageView graph surface", () => {
  beforeAll(() => {
    ensureResizeObserver();
  });

  it("passes workflow detail graph data into the shared graph surface", () => {
    const workflow = createWorkflow();
    const steps = [
      createStep("step-1", "Start"),
      createStep("step-2", "Finish"),
    ];
    const edges = [
      {
        id: "edge-1",
        type: AgentEdgeType.Standard,
        sourceNodeId: "step-1",
        targetNodeId: "step-2",
      },
    ] as AgentEdgeResponseDto[];

    render(
      <MemoryRouter>
        <WorkflowDetailPageView
          organizationId="org-1"
          projectId="project-1"
          workflow={workflow}
          parent={null}
          project={{ id: "project-1", name: "Project" }}
          graphData={{
            workflow: workflow as TaskResponseDto & {
              type: typeof WORK_ITEM_TYPE_KEYS.Workflow;
            },
            steps: steps as Array<
              TaskResponseDto & {
                type: typeof WORK_ITEM_TYPE_KEYS.WorkflowStep;
              }
            >,
            edges,
          }}
          featureAncestors={[]}
          relatedEntities={[]}
          proposals={[]}
          isPlatformAdmin={false}
          activeTab="workflow"
          onTabChange={vi.fn()}
          isTreeVisible
          onToggleTree={vi.fn()}
          isDeleteDialogOpen={false}
          isDeletingWorkflow={false}
          onDeleteClick={vi.fn()}
          onCancelDelete={vi.fn()}
          onConfirmDelete={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-inline-diagram-viewport"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("workflow-inline-step")).toHaveLength(2);
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Finish")).toBeInTheDocument();
  });

  it("passes workflow step graph data into the shared graph surface", () => {
    const workflow = createWorkflow();
    const steps = [
      createStep("step-1", "Start"),
      createStep("step-2", "Finish"),
    ];
    const edges = [
      {
        id: "edge-1",
        type: AgentEdgeType.Standard,
        sourceNodeId: "step-1",
        targetNodeId: "step-2",
      },
    ] as AgentEdgeResponseDto[];

    render(
      <MemoryRouter>
        <WorkflowStepPageView
          linkedDiagram={{ status: "absent" }}
          organizationId="org-1"
          projectId="project-1"
          task={steps[0]}
          parentWorkflow={workflow}
          project={{ id: "project-1", name: "Project" }}
          graphData={{
            workflow: workflow as TaskResponseDto & {
              type: typeof WORK_ITEM_TYPE_KEYS.Workflow;
            },
            steps: steps as Array<
              TaskResponseDto & {
                type: typeof WORK_ITEM_TYPE_KEYS.WorkflowStep;
              }
            >,
            edges,
          }}
          featureAncestors={[]}
          relatedEntities={[]}
          proposals={[]}
          isPlatformAdmin={false}
          activeTab="step"
          onTabChange={vi.fn()}
          flowLinks={[]}
          fulfillmentLinks={[]}
          isTreeVisible
          onToggleTree={vi.fn()}
          isDeleteDialogOpen={false}
          isDeletingStep={false}
          onDeleteClick={vi.fn()}
          onCancelDelete={vi.fn()}
          onConfirmDelete={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-inline-diagram-viewport"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("workflow-inline-step")).toHaveLength(2);
    expect(screen.getAllByText("Start").length).toBeGreaterThan(0);
    expect(screen.getByText("Finish")).toBeInTheDocument();
  });

  it("contains a wide workflow graph without hiding its controls", () => {
    const workflow = createWorkflow();
    const steps = [createStep("step-1", "Start")];

    render(
      <MemoryRouter>
        <WorkflowDetailPageView
          organizationId="org-1"
          projectId="project-1"
          workflow={workflow}
          parent={null}
          project={{ id: "project-1", name: "Project" }}
          graphData={{
            workflow: workflow as TaskResponseDto & {
              type: typeof WORK_ITEM_TYPE_KEYS.Workflow;
            },
            steps: steps as Array<
              TaskResponseDto & {
                type: typeof WORK_ITEM_TYPE_KEYS.WorkflowStep;
              }
            >,
            edges: [],
          }}
          featureAncestors={[]}
          relatedEntities={[]}
          proposals={[]}
          isPlatformAdmin={false}
          activeTab="workflow"
          onTabChange={vi.fn()}
          isTreeVisible
          onToggleTree={vi.fn()}
          isDeleteDialogOpen={false}
          isDeletingWorkflow={false}
          onDeleteClick={vi.fn()}
          onCancelDelete={vi.fn()}
          onConfirmDelete={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("workflow-detail-page")).toHaveStyle({
      minWidth: "0",
      width: "100%",
    });
    expect(screen.getByTestId("workflow-detail-graph")).toHaveStyle({
      minWidth: "0",
      maxWidth: "100%",
    });
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveStyle({
      width: "900px",
    });
    expect(
      screen.getByRole("button", { name: "Fit view" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fullscreen" }),
    ).toBeInTheDocument();
  });

  it("contains a wide workflow-step graph without hiding its controls", () => {
    const workflow = createWorkflow();
    const steps = [createStep("step-1", "Start")];

    render(
      <MemoryRouter>
        <WorkflowStepPageView
          linkedDiagram={{ status: "absent" }}
          organizationId="org-1"
          projectId="project-1"
          task={steps[0]}
          parentWorkflow={workflow}
          project={{ id: "project-1", name: "Project" }}
          graphData={{
            workflow: workflow as TaskResponseDto & {
              type: typeof WORK_ITEM_TYPE_KEYS.Workflow;
            },
            steps: steps as Array<
              TaskResponseDto & {
                type: typeof WORK_ITEM_TYPE_KEYS.WorkflowStep;
              }
            >,
            edges: [],
          }}
          featureAncestors={[]}
          relatedEntities={[]}
          proposals={[]}
          isPlatformAdmin={false}
          conversationPathForId={vi.fn()}
          activeTab="step"
          onTabChange={vi.fn()}
          flowLinks={[]}
          fulfillmentLinks={[]}
          isTreeVisible
          onToggleTree={vi.fn()}
          isDeleteDialogOpen={false}
          isDeletingStep={false}
          onDeleteClick={vi.fn()}
          onCancelDelete={vi.fn()}
          onConfirmDelete={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("workflow-step-page")).toHaveStyle({
      minWidth: "0",
      width: "100%",
    });
    expect(screen.getByTestId("workflow-step-graph")).toHaveStyle({
      minWidth: "0",
      maxWidth: "100%",
    });
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveStyle({
      width: "900px",
    });
    expect(
      screen.getByRole("button", { name: "Fit view" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fullscreen" }),
    ).toBeInTheDocument();
  });
});
