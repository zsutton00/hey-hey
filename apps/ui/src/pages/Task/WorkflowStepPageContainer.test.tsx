import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import type { TaskResponseDto } from "@hey-hey/ui-common/api";
import { TaskPriority, WorkStatus } from "@hey-hey/ui-common/api";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewProps = vi.hoisted(() => ({
  latest: null as null | React.ComponentProps<
    typeof import("./WorkflowStepPageView").WorkflowStepPageView
  >,
}));
const debugState = vi.hoisted(() => ({ enabled: true }));
const queryStateMocks = vi.hoisted(() => ({
  parseAsStringLiteral: vi.fn(() => ({
    withDefault: (value: string) => value,
  })),
  useQueryState: vi.fn(() => ["step", vi.fn()]),
}));

vi.mock("react-router-dom", () => ({
  useParams: vi.fn(),
  useNavigate: () => vi.fn(),
}));

vi.mock("nuqs", () => ({
  ...queryStateMocks,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({
    isPlatformAdmin: debugState.enabled,
    isResolved: true,
  }),
  // Cached hierarchy unavailable, so pages use the server-derived ancestry.
  useFeatureLookup: () => ({
    isReady: false,
    isLoading: false,
    get: () => undefined,
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
  useFullEntityContext: vi.fn(),
  useProject: vi.fn(),
  useTaskHierarchy: vi.fn(),
  useWorkItem: vi.fn(),
  useWorkItemGraph: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
  useWorkItems: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

vi.mock("./WorkflowStepPageView", () => ({
  WorkflowStepPageView: (
    props: React.ComponentProps<
      typeof import("./WorkflowStepPageView").WorkflowStepPageView
    >,
  ) => {
    viewProps.latest = props;
    return (
      <div
        data-testid="workflow-step-page-view"
        data-step-count={props.graphData?.steps.length ?? 0}
        data-edge-count={props.graphData?.edges.length ?? 0}
      />
    );
  },
}));

import { useParams } from "react-router-dom";
import {
  useFullEntityContext,
  useProject,
  useTaskHierarchy,
  useWorkItem,
  useWorkItemGraph,
  useWorkItemTypeByKey,
  useWorkItems,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WorkflowStepPage } from "./WorkflowStepPage";

const mockUseParams = vi.mocked(useParams);
const mockUseFullEntityContext = vi.mocked(useFullEntityContext);
const mockUseProject = vi.mocked(useProject);
const mockUseTaskHierarchy = vi.mocked(useTaskHierarchy);
const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseWorkItemGraph = vi.mocked(useWorkItemGraph);
const mockUseWorkItemTypeByKey = vi.mocked(useWorkItemTypeByKey);
const mockUseWorkItems = vi.mocked(useWorkItems);
const mockUseUserIdentity = vi.mocked(useUserIdentity);

const createTask = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto =>
  ({
    id: "step-1",
    name: "Review Request",
    type: WORK_ITEM_TYPE_KEYS.WorkflowStep,
    organizationId: "org-1",
    projectId: "project-1",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Low,
    source: "user",
    sections: [],
    ...overrides,
  }) as TaskResponseDto;

const createEdge = (id: string, sourceNodeId = "step-1") => ({
  id,
  type: "STANDARD",
  sourceNodeId,
  targetNodeId: "step-2",
});

describe("WorkflowStepPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    debugState.enabled = true;
    viewProps.latest = null;
    mockUseParams.mockReturnValue({
      projectId: "project-1",
      taskId: "step-1",
    });
    mockUseUserIdentity.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);
    mockUseProject.mockReturnValue({
      data: { id: "project-1", name: "Project" },
    } as ReturnType<typeof useProject>);
    mockUseFullEntityContext.mockReturnValue({
      data: {
        featureHierarchy: [],
        relatedEntities: [],
        proposals: [],
      },
    } as ReturnType<typeof useFullEntityContext>);
    mockUseWorkItemGraph.mockImplementation(
      (organizationId, projectId, workItemId) => {
        const workflowQuery = mockUseWorkItem(
          organizationId,
          "task",
          workItemId,
          { projectId },
        );
        const stepsQuery = mockUseWorkItems(
          organizationId,
          "task",
          projectId,
          undefined,
          { parentTaskId: workItemId },
        );
        const root = workflowQuery.workItem;
        const children = stepsQuery.workItems ?? [];
        const relationships = Array.from(
          new Map(
            [root, ...children]
              .flatMap((item) => item?.edges ?? [])
              .filter((edge) =>
                [
                  "STANDARD",
                  "CONDITIONAL",
                  "LOOP",
                  "FULFILLED_BY",
                  "DEPENDS_ON",
                ].includes(edge.type),
              )
              .map((edge) => [edge.id, edge]),
          ).values(),
        );
        return {
          data: root
            ? {
                root,
                children,
                relationships,
                layout: null,
                derivedReferences: [],
              }
            : null,
          isLoading: workflowQuery.isLoading || stepsQuery.isLoading,
          isFetching: workflowQuery.isFetching || stepsQuery.isFetching,
          isFetched: true,
          isReady: true,
          error: workflowQuery.error ?? stepsQuery.error ?? null,
          isStale: false,
          refetch: vi.fn(),
          markStale: vi.fn(),
        } as ReturnType<typeof useWorkItemGraph>;
      },
    );
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeDefinition: {
        key: "workflow",
        name: "Workflow",
        sections: [],
        allowedStatuses: [],
        iconKey: "workflow",
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    } as ReturnType<typeof useWorkItemTypeByKey>);
  });

  it.each([
    "ready",
    "loading",
    "unavailable",
    "wrong-type",
    "absent",
    "owner-unavailable",
  ] as const)(
    "reads the canonical target independently of the owning Diagram: %s",
    (outcome) => {
      const parent = createTask({
        id: "owner",
        name: "Owning Diagram",
        type: "DIAGRAM",
      });
      const target = createTask({
        id: "target",
        name: "Actual target title",
        type: outcome === "wrong-type" ? "STANDARD" : "DIAGRAM",
      });
      const step = createTask({
        type: "DIAGRAM_ELEMENT",
        parentTaskId: parent.id,
        sections:
          outcome === "absent"
            ? []
            : [
                {
                  id: "metadata",
                  key: "diagramElementMetadata",
                  order: 0,
                  materializedMarkdown: JSON.stringify({
                    role: "DIAGRAM_REFERENCE",
                    canonicalReference: {
                      entityType: "TASK",
                      entityId: target.id,
                    },
                  }),
                },
              ],
      });
      mockUseTaskHierarchy.mockReturnValue({
        hierarchy: {
          task: step,
          parent: outcome === "owner-unavailable" ? null : parent,
        },
        isLoading: false,
        error: null,
      } as ReturnType<typeof useTaskHierarchy>);
      mockUseWorkItem.mockImplementation(
        (_org, _type, id) =>
          ({
            workItem:
              id === parent.id
                ? parent
                : outcome === "ready" ||
                    outcome === "wrong-type" ||
                    outcome === "owner-unavailable"
                  ? target
                  : null,
            isLoading: id === target.id && outcome === "loading",
            error:
              id === target.id && outcome === "unavailable"
                ? new Error("Read failed")
                : null,
          }) as ReturnType<typeof useWorkItem>,
      );
      mockUseWorkItems.mockReturnValue({
        workItems: [step],
        isLoading: false,
        error: null,
        remove: vi.fn(),
      } as ReturnType<typeof useWorkItems>);
      if (outcome === "owner-unavailable") {
        mockUseWorkItemGraph.mockReturnValue({
          data: null,
          isLoading: false,
          error: new Error("Owner unavailable"),
        } as ReturnType<typeof useWorkItemGraph>);
      }
      render(<WorkflowStepPage />);
      expect(viewProps.latest?.parentWorkflow?.id).toBe(
        outcome === "owner-unavailable" ? undefined : parent.id,
      );
      expect(viewProps.latest?.isTreeVisible).toBe(false);
      expect(viewProps.latest?.linkedDiagram).toEqual(
        outcome === "ready" || outcome === "owner-unavailable"
          ? { status: "ready", diagram: target }
          : { status: outcome === "wrong-type" ? "unavailable" : outcome },
      );
      expect(mockUseWorkItem).toHaveBeenCalledWith(
        "org-1",
        "task",
        outcome === "absent" ? "" : target.id,
        { projectId: "project-1", enabled: outcome !== "absent" },
      );
    },
  );

  it("hydrates the same workflow graph data for workflow_step routes", () => {
    const step = createTask({ parentTaskId: "workflow-1" });
    const parentWorkflow = createTask({
      id: "workflow-1",
      name: "Triage Workflow",
      type: WORK_ITEM_TYPE_KEYS.Workflow,
      edges: [
        createEdge("edge-1"),
        { ...createEdge("related"), type: "RELATED_TO" },
      ] as TaskResponseDto["edges"],
    });
    const siblingStep = createTask({
      id: "step-2",
      name: "Finish",
      parentTaskId: "workflow-1",
      edges: [
        createEdge("edge-1"),
        createEdge("edge-2", "step-2"),
      ] as TaskResponseDto["edges"],
    });

    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: step, parent: parentWorkflow },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: parentWorkflow,
      isLoading: false,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [step, siblingStep],
      isLoading: false,
      isFetching: false,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);

    const page = render(<WorkflowStepPage />);

    expect(screen.getByTestId("workflow-step-page-view")).toHaveAttribute(
      "data-step-count",
      "2",
    );
    expect(screen.getByTestId("workflow-step-page-view")).toHaveAttribute(
      "data-edge-count",
      "2",
    );
    expect(viewProps.latest?.parentWorkflow?.id).toBe("workflow-1");
    expect(viewProps.latest?.isPlatformAdmin).toBe(true);
    expect(queryStateMocks.parseAsStringLiteral).toHaveBeenCalledWith([
      "step",
      "conversations",
      "data-debug",
      "admin",
    ]);
    expect(viewProps.latest?.graphData?.workflow.id).toBe("workflow-1");
    expect(viewProps.latest?.conversationPathForId("conversation-1")).toBe(
      "/projects/project-1/resolve-agent-session/conversation-1",
    );
    expect(viewProps.latest?.graphData?.edges.map((edge) => edge.id)).toEqual([
      "edge-1",
      "edge-2",
    ]);
    expect(viewProps.latest?.isTreeVisible).toBe(true);
    act(() => viewProps.latest?.onToggleTree());
    expect(viewProps.latest?.isTreeVisible).toBe(false);
    act(() => viewProps.latest?.onToggleTree());
    expect(viewProps.latest?.isTreeVisible).toBe(true);
    mockUseParams.mockReturnValue({ projectId: "project-1", taskId: "step-2" });
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: {
        task: createTask({
          id: "step-2",
          type: WORK_ITEM_TYPE_KEYS.DiagramElement,
        }),
        parent: parentWorkflow,
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    page.rerender(<WorkflowStepPage />);
    expect(viewProps.latest?.isTreeVisible).toBe(false);

    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: {
        task: createTask({
          id: "step-2",
          type: WORK_ITEM_TYPE_KEYS.WorkflowStep,
        }),
        parent: parentWorkflow,
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    page.rerender(<WorkflowStepPage />);
    expect(viewProps.latest?.isTreeVisible).toBe(true);
    expect(mockUseTaskHierarchy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ refetchOnMount: true }),
    );
    expect(mockUseWorkItemGraph).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "workflow-1",
      { enabled: true },
    );
  });

  it("keeps the hydrated detail view mounted during graph refetches", () => {
    const step = createTask({ parentTaskId: "workflow-1" });
    const parentWorkflow = createTask({
      id: "workflow-1",
      name: "Triage Workflow",
      type: WORK_ITEM_TYPE_KEYS.Workflow,
    });

    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: step, parent: parentWorkflow },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: parentWorkflow,
      isLoading: false,
      isFetching: true,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [step],
      isLoading: false,
      isFetching: true,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);

    render(<WorkflowStepPage />);

    expect(screen.getByTestId("workflow-step-page-view")).toBeInTheDocument();
    expect(screen.queryByText("Loading workflow step...")).toBeNull();
  });
});
