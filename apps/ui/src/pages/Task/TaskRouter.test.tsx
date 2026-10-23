import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import type { WorkItemTypeDefinitionDto } from "@hey-hey/ui-common/api";

const mockNavigate = vi.fn();
const mockPlanPage = vi.fn();

vi.mock("../Plan/PlanPage", () => ({
  PlanPage: (props: unknown) => {
    mockPlanPage(props);
    return <div data-testid="plan-page" />;
  },
}));

vi.mock("../Goals/GoalPage", () => ({
  GoalPage: (props: {
    organizationId: string;
    projectId: string;
    taskId: string;
  }) => (
    <div
      data-testid="goal-page"
      data-organization-id={props.organizationId}
      data-project-id={props.projectId}
      data-task-id={props.taskId}
    />
  ),
}));

vi.mock("react-router-dom", () => ({
  useParams: vi.fn(),
  useNavigate: () => mockNavigate,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItem: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
  createCanonicalPageDescriptor: vi.fn(
    (
      entityType: string,
      entityId: string,
      lineage: unknown,
      presentation: unknown,
    ) => ({ entityType, entityId, lineage, presentation }),
  ),
}));

vi.mock("@hey-hey/ui-common/components", () => ({}));

vi.mock("./TaskMonitorPage", () => ({
  TaskMonitorPage: (props: {
    organizationId: string;
    projectId: string;
    monitorId: string;
  }) => (
    <div
      data-testid="task-monitor"
      data-organization-id={props.organizationId}
      data-project-id={props.projectId}
      data-monitor-id={props.monitorId}
    />
  ),
}));

vi.mock("../Features/FeaturePage", () => ({
  FeaturePage: ({ task }: { task: { id: string; name?: string } }) => (
    <div
      data-testid="feature-page"
      data-task-id={task.id}
      data-task-name={task.name}
    />
  ),
}));

vi.mock("../Eval/EvalPage", () => ({
  EvalPage: ({ task }: { task: { id: string } }) => (
    <div data-testid="eval-page" data-task-id={task.id} />
  ),
}));

vi.mock("./TaskPage", () => ({
  TaskPage: (props: { taskId?: string }) => (
    <div data-testid="task-page" data-task-id={props.taskId} />
  ),
}));

vi.mock("./WorkflowStepPage", () => ({
  WorkflowStepPage: () => <div data-testid="workflow-step-page" />,
}));

vi.mock("./WorkflowDetailPage", () => ({
  WorkflowDetailPage: () => <div data-testid="workflow-detail-page" />,
}));

import { useParams } from "react-router-dom";
import { useWorkItem, useWorkItemTypeByKey } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { createCanonicalPageDescriptor } from "@hey-hey/ui-common/context";
import { TaskRouter } from "./TaskRouter";

const mockUseParams = vi.mocked(useParams);
const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseWorkItemTypeByKey = vi.mocked(useWorkItemTypeByKey);
const mockUseUserIdentity = vi.mocked(useUserIdentity);
const mockCreateCanonicalPageDescriptor = vi.mocked(
  createCanonicalPageDescriptor,
);

const typeDefinition = (
  key: string,
  graph?: Record<string, unknown>,
): WorkItemTypeDefinitionDto =>
  ({
    key,
    name: key,
    sections: [
      {
        key: "graphLayout",
        kind: "json",
        schemaRef: "#/components/schemas/WorkItemGraphLayoutValue",
      },
    ],
    capabilities: graph === undefined ? {} : { graph },
  }) as unknown as WorkItemTypeDefinitionDto;

const graphCapability = {
  nodeChildType: "workflow_step",
  layout: {
    sectionKey: "graphLayout",
    schemaRef: "#/components/schemas/WorkItemGraphLayoutValue",
  },
  readableRelationships: [],
  editableRelationships: [],
  rendererKey: "work-item-graph",
  editorKey: "work-item-graph-editor",
  supportedActions: ["viewGraph", "replaceLayout"],
};

describe("TaskRouter", () => {
  it.each([
    {
      type: "PLAN",
      id: "plan-1",
      parentTaskId: "feature-1",
      planId: "plan-1",
      stageId: undefined,
    },
    {
      type: "PLAN_STAGE",
      id: "stage-1",
      parentTaskId: "plan-1",
      planId: "plan-1",
      stageId: "stage-1",
    },
  ])(
    "routes $type Work Items through Plan presentation",
    ({ type, id, parentTaskId, planId, stageId }) => {
      mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: id });
      mockUseWorkItem.mockReturnValue({
        workItem: { id, name: type, type, parentTaskId, projectId: "proj-1" },
        isLoading: false,
        error: null,
      } as ReturnType<typeof useWorkItem>);
      render(<TaskRouter />);
      expect(screen.getByTestId("plan-page")).toBeInTheDocument();
      expect(mockPlanPage.mock.calls[0][0]).toMatchObject({
        organizationId: "org-1",
        projectId: "proj-1",
        planId,
      });
      expect(mockPlanPage.mock.calls[0][0].stageId).toBe(stageId);
    },
  );
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserIdentity.mockReturnValue({ currentOrgId: "org-1" } as ReturnType<
      typeof useUserIdentity
    >);
    mockUseWorkItemTypeByKey.mockImplementation(
      (_organizationId, _projectId, typeKey) =>
        ({
          workItemTypeDefinition: typeKey ? typeDefinition(typeKey) : undefined,
          isFetched: Boolean(typeKey),
          error: null,
        }) as ReturnType<typeof useWorkItemTypeByKey>,
    );
  });

  it.each([
    "STANDARD",
    "BUG",
    "FEATURE",
    "CONTRACT",
    "workflow",
    "workflow_step",
    "TASK_MONITOR",
    "MARKETING",
  ])("publishes loaded presentation for %s work items", (taskType) => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "item-1" });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "item-1",
        name: `${taskType} name`,
        type: taskType,
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(mockCreateCanonicalPageDescriptor).toHaveBeenCalledWith(
      "task",
      "item-1",
      null,
      {
        kind: "task",
        label: `${taskType} name`,
        taskType,
      },
    );
  });

  it("renders EvalPage for EVAL work items", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "eval-1" });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "eval-1",
        name: "Eval name",
        type: "EVAL",
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.getByTestId("eval-page")).toHaveAttribute(
      "data-task-id",
      "eval-1",
    );
    expect(screen.queryByTestId("task-page")).not.toBeInTheDocument();
  });

  it("renders FeaturePage for FEATURE work items", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "feature-1" });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "feature-1",
        name: "Feature name",
        type: "FEATURE",
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.getByTestId("feature-page")).toBeInTheDocument();
    expect(screen.getByTestId("feature-page")).toHaveAttribute(
      "data-task-id",
      "feature-1",
    );
    expect(screen.getByTestId("feature-page")).toHaveAttribute(
      "data-task-name",
      "Feature name",
    );
    expect(screen.queryByTestId("task-page")).not.toBeInTheDocument();
    expect(mockCreateCanonicalPageDescriptor).toHaveBeenCalledWith(
      "task",
      "feature-1",
      null,
      { kind: "task", label: "Feature name", taskType: "FEATURE" },
    );
  });

  it("routes GOAL work items on the project task path to GoalPage", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "goal-1" });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "goal-1",
        name: "Goal name",
        type: WORK_ITEM_TYPE_KEYS.Goal,
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.getByTestId("goal-page")).toHaveAttribute(
      "data-organization-id",
      "org-1",
    );
    expect(screen.getByTestId("goal-page")).toHaveAttribute(
      "data-project-id",
      "proj-1",
    );
    expect(screen.getByTestId("goal-page")).toHaveAttribute(
      "data-task-id",
      "goal-1",
    );
    expect(screen.queryByTestId("task-page")).not.toBeInTheDocument();
    expect(mockCreateCanonicalPageDescriptor).not.toHaveBeenCalled();
  });

  it("renders TaskPage for STANDARD work items", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "task-1" });
    mockUseWorkItem.mockReturnValue({
      workItem: { id: "task-1", type: "STANDARD", projectId: "proj-1" },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.getByTestId("task-page")).toBeInTheDocument();
  });

  it("renders TaskPage for a custom work-item type on the canonical URL", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "task-123" });
    mockUseWorkItem.mockReturnValue({
      workItem: { id: "task-123", type: "MARKETING", projectId: "proj-1" },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.getByTestId("task-page")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-page")).not.toBeInTheDocument();
  });

  it("does not render FeaturePage for a custom work-item type", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "task-123" });
    mockUseWorkItem.mockReturnValue({
      workItem: { id: "task-123", type: "MARKETING", projectId: "proj-1" },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.queryByTestId("feature-page")).not.toBeInTheDocument();
  });

  it("renders the Diagram Element page for canonical DIAGRAM_ELEMENT work items", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "step-123" });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "step-123",
        type: "DIAGRAM_ELEMENT",
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.getByTestId("workflow-step-page")).toBeInTheDocument();
    expect(screen.queryByTestId("task-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-page")).not.toBeInTheDocument();
  });

  it("routes canonical DIAGRAM work items through the shared graph detail page", () => {
    mockUseParams.mockReturnValue({
      projectId: "proj-1",
      taskId: "workflow-123",
    });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "workflow-123",
        type: "DIAGRAM",
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeDefinition: typeDefinition("DIAGRAM", graphCapability),
      isFetched: true,
      error: null,
    } as ReturnType<typeof useWorkItemTypeByKey>);

    render(<TaskRouter />);

    expect(screen.getByTestId("workflow-detail-page")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-step-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-page")).not.toBeInTheDocument();
  });

  it("keeps a differently named configured graph type on the ordinary work-item page", () => {
    mockUseParams.mockReturnValue({
      projectId: "proj-1",
      taskId: "approval-flow-1",
    });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "approval-flow-1",
        type: "APPROVAL_FLOW",
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeDefinition: typeDefinition("APPROVAL_FLOW", graphCapability),
      isFetched: true,
      error: null,
    } as ReturnType<typeof useWorkItemTypeByKey>);

    render(<TaskRouter />);

    expect(screen.getByTestId("task-page")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-detail-page"),
    ).not.toBeInTheDocument();
  });

  it("renders a Task Monitor directly from its canonical identity", () => {
    mockUseParams.mockReturnValue({
      projectId: "proj-1",
      taskId: "monitor-123",
    });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "monitor-123",
        name: "Release monitor",
        type: "TASK_MONITOR",
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.getByTestId("task-monitor")).toHaveAttribute(
      "data-organization-id",
      "org-1",
    );
    expect(screen.getByTestId("task-monitor")).toHaveAttribute(
      "data-project-id",
      "proj-1",
    );
    expect(screen.getByTestId("task-monitor")).toHaveAttribute(
      "data-monitor-id",
      "monitor-123",
    );
    expect(screen.queryByTestId("task-page")).not.toBeInTheDocument();
    expect(mockCreateCanonicalPageDescriptor).toHaveBeenCalledWith(
      "task",
      "monitor-123",
      null,
      {
        kind: "task",
        label: "Release monitor",
        taskType: "TASK_MONITOR",
      },
    );
  });

  it("recovers project context before rendering TaskMonitor", async () => {
    mockUseParams.mockReturnValue({ id: "monitor-123" });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "monitor-123",
        type: "TASK_MONITOR",
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        "/projects/proj-1/tasks/monitor-123",
        { replace: true },
      );
    });
    expect(screen.queryByTestId("task-monitor")).not.toBeInTheDocument();
  });

  it("canonicalizes /work-items/:id before rendering the GOAL page", async () => {
    mockUseParams.mockReturnValue({ id: "goal-123" });
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "goal-123",
        type: WORK_ITEM_TYPE_KEYS.Goal,
        projectId: "proj-1",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    const { rerender } = render(<TaskRouter />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        "/projects/proj-1/tasks/goal-123",
        { replace: true },
      );
    });

    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "goal-123" });
    rerender(<TaskRouter />);

    expect(screen.getByTestId("goal-page")).toHaveAttribute(
      "data-task-id",
      "goal-123",
    );
  });

  it("shows loading state while task is being fetched", () => {
    mockUseParams.mockReturnValue({ projectId: "proj-1", taskId: "task-123" });
    mockUseWorkItem.mockReturnValue({
      workItem: null,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useWorkItem>);

    render(<TaskRouter />);

    expect(screen.queryByTestId("task-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-page")).not.toBeInTheDocument();
  });
});
