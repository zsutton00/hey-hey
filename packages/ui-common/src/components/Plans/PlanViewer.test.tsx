import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlanConfigurationV1SchemaVersionEnum,
  PlanType,
  TaskSource,
  WorkStatus,
} from "../../api";
import type {
  CanonicalPlanAggregate,
  PlanStageStandardTask,
  PlanStageWorkItem,
  PlanWorkItem,
} from "../../data";
import { useCanonicalPlanAggregate, useWorkItems } from "../../data";
import { PlanViewer } from "./PlanViewer";

vi.mock("../../data", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../data")>();
  return {
    ...original,
    useCanonicalPlanAggregate: vi.fn(),
    useWorkItems: vi.fn(),
  };
});

vi.mock("../../contexts", () => ({
  usePathService: () => ({
    planTask: ({ taskId }: { taskId: string }) => `/canonical-tasks/${taskId}`,
  }),
}));

vi.mock("../InteractionComponent", () => ({
  InteractionComponent: (props: {
    children: React.ReactNode;
    disablePreview?: boolean;
  }) => (
    <div
      data-testid="plan-interaction"
      data-disable-preview={String(props.disablePreview)}
    >
      {props.children}
    </div>
  ),
}));

vi.mock("../ActionsCapsule", () => ({
  CapsuleAction: ({
    id,
    label,
    onClick,
  }: {
    id: string;
    label: string;
    onClick?: () => void;
  }) => (
    <button data-testid={`capsule-action-${id}`} onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("../shared/ExecutionGraph", () => ({
  ExecutionGraphSurface: ({
    viewModel,
    onNodeSelect,
  }: {
    viewModel: { nodes: { id: string; title: string }[] };
    onNodeSelect: (id: string) => void;
  }) => (
    <div data-testid="execution-graph-surface">
      {viewModel.nodes.map((node) => (
        <button key={node.id} onClick={() => onNodeSelect(node.id)}>
          {node.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./PlanCompletionAction", () => ({
  PlanCompletionAction: ({ planTitle }: { planTitle: string }) => (
    <div data-testid="plan-completion-action">Complete {planTitle}</div>
  ),
}));

const mockUseCanonicalPlanAggregate = vi.mocked(useCanonicalPlanAggregate);
const mockUseWorkItems = vi.mocked(useWorkItems);
const refetchAutomation = vi.fn();

const plan: PlanWorkItem = {
  id: "plan-1",
  name: "Canonical Plan",
  type: "PLAN",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
};

const stage = (id: string, name: string): PlanStageWorkItem => ({
  id,
  name,
  type: "PLAN_STAGE",
  parentTaskId: plan.id,
  organizationId: plan.organizationId,
  projectId: plan.projectId,
  status: WorkStatus.Active,
  source: TaskSource.System,
  sections: [
    {
      id: `${id}-description`,
      key: "description",
      order: 0,
      materializedMarkdown: `${name} description`,
    },
  ],
});

const task = (
  id: string,
  parentTaskId: string,
  status = WorkStatus.Backlog
): PlanStageStandardTask => ({
  id,
  name: id,
  type: "STANDARD",
  parentTaskId,
  organizationId: plan.organizationId,
  projectId: plan.projectId,
  status,
  source: TaskSource.System,
});

const firstStage = stage("stage-1", "First Stage");
const secondStage = stage("stage-2", "Second Stage");
const firstTask = task("task-1", firstStage.id, WorkStatus.Completed);
const secondTask = task("task-2", firstStage.id);
const aggregate: CanonicalPlanAggregate = {
  plan,
  configuration: {
    schemaVersion: PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1,
    planType: PlanType.Standard,
    worktreeBranch: null,
  },
  stages: [
    {
      stage: firstStage,
      orderedTasks: [firstTask, secondTask],
      dependenciesByTaskId: new Map(),
    },
    {
      stage: secondStage,
      orderedTasks: [],
      dependenciesByTaskId: new Map(),
    },
  ],
};

const renderViewer = (
  props: Partial<React.ComponentProps<typeof PlanViewer>> = {}
) =>
  render(
    <MemoryRouter>
      <PlanViewer
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
        {...props}
      />
    </MemoryRouter>
  );

describe("PlanViewer canonical aggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCanonicalPlanAggregate.mockReturnValue({
      status: "ready",
      aggregate,
      error: null,
    });
    refetchAutomation.mockResolvedValue([]);
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
      refetch: refetchAutomation,
      markStale: vi.fn(),
    });
  });

  it("hides Stage descriptions while retaining canonical data and Task progress", async () => {
    renderViewer();

    expect(await screen.findByText("task-1")).toBeInTheDocument();
    expect(screen.queryByText("First Stage description")).toBeNull();
    expect(screen.queryByText("Second Stage description")).toBeNull();
    expect(screen.getByText("First Stage")).toBeInTheDocument();
    expect(screen.getByText("Second Stage")).toBeInTheDocument();
    expect(aggregate.stages.map(({ stage }) => stage.sections)).toEqual([
      stage("stage-1", "First Stage").sections,
      stage("stage-2", "Second Stage").sections,
    ]);
    expect(screen.getByText("1/2 tasks")).toBeInTheDocument();
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.getByText("task-2")).toBeInTheDocument();
    expect(screen.getByTestId("execution-graph-surface")).toBeInTheDocument();
    expect(screen.queryByText(/guidance/i)).toBeNull();
  });

  it("switches between dependency-ordered Stages", async () => {
    renderViewer();
    await screen.findByText("task-1");
    expect(
      screen
        .getAllByTestId("plan-viewer-stage-button")
        .map((button) => button.getAttribute("data-work-item-id"))
    ).toEqual([firstStage.id, secondStage.id]);

    fireEvent.click(screen.getByRole("button", { name: /Second Stage/i }));

    expect(
      await screen.findByTestId("plan-execution-graph-empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("First Stage description")).toBeNull();
    expect(screen.queryByText("Second Stage description")).toBeNull();
    expect(screen.getByText("First Stage")).toBeInTheDocument();
    expect(screen.getByText("Second Stage")).toBeInTheDocument();
    expect(screen.getByText("0/0 tasks")).toBeInTheDocument();
    expect(aggregate.stages.map(({ stage }) => stage.sections)).toEqual([
      stage("stage-1", "First Stage").sections,
      stage("stage-2", "Second Stage").sections,
    ]);
    expect(
      screen.getByText(
        "No implementation Tasks are defined for this Plan Stage."
      )
    ).toBeInTheDocument();
  });

  it("renders explicit loading and contract errors", () => {
    mockUseCanonicalPlanAggregate.mockReturnValue({
      status: "loading",
      aggregate: null,
      error: null,
    });
    const rendered = renderViewer();
    expect(screen.getByTestId("plan-viewer-loading")).toBeInTheDocument();

    rendered.unmount();
    mockUseCanonicalPlanAggregate.mockReturnValue({
      status: "error",
      aggregate: null,
      error: new Error("Invalid Plan hierarchy"),
    });
    renderViewer();
    expect(screen.getByTestId("plan-viewer-error")).toHaveTextContent(
      "Invalid Plan hierarchy"
    );
  });

  it("forwards the page-level Preview opt-out to the plan interaction", () => {
    renderViewer({ disablePreview: true });

    expect(screen.getByTestId("plan-interaction")).toHaveAttribute(
      "data-disable-preview",
      "true"
    );
  });

  it("offers completion only for editable VERIFYING Plans", () => {
    mockUseCanonicalPlanAggregate.mockReturnValue({
      status: "ready",
      aggregate: {
        ...aggregate,
        plan: { ...aggregate.plan, status: WorkStatus.Verifying },
      },
      error: null,
    });
    const verifying = renderViewer();
    expect(screen.getByTestId("plan-completion-action")).toHaveTextContent(
      "Complete Canonical Plan"
    );

    verifying.unmount();
    mockUseCanonicalPlanAggregate.mockReturnValue({
      status: "ready",
      aggregate: {
        ...aggregate,
        plan: { ...aggregate.plan, status: WorkStatus.Verifying },
      },
      error: null,
    });
    const page = renderViewer({ disablePreview: true });
    expect(screen.getByTestId("plan-completion-action")).toHaveTextContent(
      "Complete Canonical Plan"
    );

    page.unmount();
    renderViewer({ disablePreview: true, readOnly: true });
    expect(screen.queryByTestId("plan-completion-action")).toBeNull();
  });

  it("launches Stage automation after checking canonical Plan relationships", async () => {
    const onAutomateStage = vi.fn();
    renderViewer({ onAutomateStage, onViewAutomation: vi.fn() });
    await screen.findByText("task-1");

    fireEvent.click(screen.getByTestId("capsule-action-automate-plan-stage"));

    await waitFor(() =>
      expect(onAutomateStage).toHaveBeenCalledWith("stage-1")
    );
    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        relatedEntityId: "plan-1",
        relatedEntityType: "TASK",
      })
    );
  });
});
