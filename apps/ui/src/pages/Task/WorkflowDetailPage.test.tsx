import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import type { TaskResponseDto } from "@hey-hey/ui-common/api";
import { TaskPriority, WorkStatus } from "@hey-hey/ui-common/api";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const viewProps = vi.hoisted(() => ({
  latest: null as null | React.ComponentProps<
    typeof import("./WorkflowDetailPageView").WorkflowDetailPageView
  >,
}));

const debugState = vi.hoisted(() => ({ enabled: true }));

const queryState = vi.hoisted(() => ({
  activeTab: "diagram" as
    "diagram" | "workflow" | "conversations" | "data-debug" | "admin",
  literalValues: [] as string[][],
  setActiveTab: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: vi.fn(),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: "unblocked" }),
}));

vi.mock("nuqs", () => ({
  parseAsStringLiteral: (values: readonly string[]) => {
    queryState.literalValues.push([...values]);
    return {
      withDefault: (value: string) => value,
    };
  },
  useQueryState: () => [queryState.activeTab, queryState.setActiveTab],
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
  useWorkItemGraphDraft: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
  useWorkItems: vi.fn(),
  useSubmitWorkItemGraphProposal: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

vi.mock("./WorkflowDetailPageView", () => ({
  WorkflowDetailPageView: (
    props: React.ComponentProps<
      typeof import("./WorkflowDetailPageView").WorkflowDetailPageView
    >,
  ) => {
    viewProps.latest = props;
    return (
      <div
        data-testid="workflow-detail-page-view"
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
  useWorkItemGraphDraft,
  useWorkItemTypeByKey,
  useWorkItems,
  useSubmitWorkItemGraphProposal,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WorkflowDetailPage } from "./WorkflowDetailPage";

const mockUseParams = vi.mocked(useParams);
const mockUseFullEntityContext = vi.mocked(useFullEntityContext);
const mockUseProject = vi.mocked(useProject);
const mockUseTaskHierarchy = vi.mocked(useTaskHierarchy);
const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseWorkItemGraph = vi.mocked(useWorkItemGraph);
const mockUseWorkItemGraphDraft = vi.mocked(useWorkItemGraphDraft);
const mockUseWorkItemTypeByKey = vi.mocked(useWorkItemTypeByKey);
const mockUseWorkItems = vi.mocked(useWorkItems);
const mockUseSubmitWorkItemGraphProposal = vi.mocked(
  useSubmitWorkItemGraphProposal,
);
const mockUseUserIdentity = vi.mocked(useUserIdentity);

const createTask = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto =>
  ({
    id: "workflow-1",
    name: "Triage Workflow",
    type: WORK_ITEM_TYPE_KEYS.Diagram,
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

describe("WorkflowDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewProps.latest = null;
    debugState.enabled = true;
    queryState.activeTab = "diagram";
    queryState.literalValues = [];
    mockUseParams.mockReturnValue({
      projectId: "project-1",
      taskId: "workflow-1",
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
    mockUseWorkItemTypeByKey.mockImplementation(
      (_organizationId, _projectId, typeKey) =>
        ({
          workItemTypeDefinition:
            typeKey === WORK_ITEM_TYPE_KEYS.DiagramElement
              ? {
                  key: WORK_ITEM_TYPE_KEYS.DiagramElement,
                  name: "Diagram Element",
                  sections: [],
                  allowedStatuses: [],
                  forbiddenScalars: [],
                }
              : {
                  key: WORK_ITEM_TYPE_KEYS.Diagram,
                  name: "Diagram",
                  sections: [
                    {
                      key: "graphLayout",
                      kind: "json",
                      schemaRef: "layout.v1",
                    },
                  ],
                  capabilities: {
                    graph: {
                      nodeChildType: WORK_ITEM_TYPE_KEYS.DiagramElement,
                      layout: {
                        sectionKey: "graphLayout",
                        schemaRef: "layout.v1",
                      },
                      readableRelationships: [
                        {
                          edgeType: "STANDARD",
                          category: "flow",
                          sourceEndpoint: {
                            role: "graphNode",
                            entityTypes: ["TASK"],
                          },
                          targetEndpoint: {
                            role: "graphNode",
                            entityTypes: ["TASK"],
                          },
                        },
                      ],
                      editableRelationships: [],
                      rendererKey: "work-item-graph",
                      editorKey: "work-item-graph-editor",
                      supportedActions: ["viewGraph"],
                    },
                  },
                },
          isFetched: true,
          error: null,
        }) as ReturnType<typeof useWorkItemTypeByKey>,
    );
    mockUseWorkItemGraphDraft.mockImplementation(
      (graphInput) =>
        ({
          draft: {
            context: {
              root: graphInput.root,
              children: graphInput.children,
              incidentRelationships: graphInput.incidentRelationships,
              typeDefinition: graphInput.typeDefinition,
              graphCapability: graphInput.typeDefinition.capabilities?.graph,
              layoutSectionKey: "graphLayout",
            },
          },
          projected: {
            projectedRoot: graphInput.root,
            children: graphInput.children,
            incidentRelationships: graphInput.incidentRelationships,
            effectiveLayout: {
              schemaVersion: "work-item-graph-layout.v1",
              nodes: [],
            },
          },
          operations: [],
          isDirty: false,
          reset: vi.fn(),
        }) as unknown as ReturnType<typeof useWorkItemGraphDraft>,
    );
    mockUseSubmitWorkItemGraphProposal.mockReturnValue({
      submit: vi.fn(),
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSubmitWorkItemGraphProposal>);
  });

  it("hydrates graph data from Diagram and Diagram Element work items", () => {
    const workflow = createTask({
      edges: [
        createEdge("edge-1"),
        { ...createEdge("related"), type: "RELATED_TO" },
      ] as TaskResponseDto["edges"],
    });
    const stepOne = createTask({
      id: "step-1",
      name: "Start",
      type: WORK_ITEM_TYPE_KEYS.DiagramElement,
      edges: [
        createEdge("edge-1"),
        createEdge("edge-2", "step-2"),
      ] as TaskResponseDto["edges"],
    });
    const stepTwo = createTask({
      id: "step-2",
      name: "Finish",
      type: WORK_ITEM_TYPE_KEYS.DiagramElement,
    });

    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: workflow, parent: null },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [stepOne, stepTwo],
      isLoading: false,
      isFetching: false,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);

    const page = render(<WorkflowDetailPage />);

    expect(screen.getByTestId("workflow-detail-page-view")).toHaveAttribute(
      "data-step-count",
      "2",
    );
    expect(screen.getByTestId("workflow-detail-page-view")).toHaveAttribute(
      "data-edge-count",
      "2",
    );
    expect(viewProps.latest?.graphData?.edges.map((edge) => edge.id)).toEqual([
      "edge-1",
      "edge-2",
    ]);
    expect(viewProps.latest?.isTreeVisible).toBe(false);
    act(() => viewProps.latest?.onToggleTree());
    expect(viewProps.latest?.isTreeVisible).toBe(true);
    act(() => viewProps.latest?.onToggleTree());
    expect(viewProps.latest?.isTreeVisible).toBe(false);
    act(() => viewProps.latest?.onToggleTree());
    mockUseParams.mockReturnValue({
      projectId: "project-1",
      taskId: "workflow-2",
    });
    page.rerender(<WorkflowDetailPage />);
    expect(viewProps.latest?.isTreeVisible).toBe(false);

    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: {
        task: createTask({
          id: "workflow-2",
          type: WORK_ITEM_TYPE_KEYS.Workflow,
        }),
        parent: null,
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    page.rerender(<WorkflowDetailPage />);
    expect(viewProps.latest?.isTreeVisible).toBe(true);
    expect(mockUseTaskHierarchy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ refetchOnMount: true }),
    );
  });

  it("shows the loading state while workflow graph data is loading", () => {
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: null,
      isLoading: true,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);

    render(<WorkflowDetailPage />);

    expect(screen.getByText("Loading workflow...")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-detail-page-view"),
    ).not.toBeInTheDocument();
  });

  it("persists the Conversations tab in workflow URL state", () => {
    queryState.activeTab = "conversations";
    const workflow = createTask();
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: workflow, parent: null },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);

    render(<WorkflowDetailPage />);

    expect(
      queryState.literalValues[queryState.literalValues.length - 1],
    ).toEqual(["diagram", "workflow", "conversations", "data-debug", "admin"]);
    expect(viewProps.latest).toEqual(
      expect.objectContaining({
        activeTab: "conversations",
        onTabChange: queryState.setActiveTab,
      }),
    );
  });

  it("exposes the Data Debug tab when debug is enabled", () => {
    queryState.activeTab = "data-debug";
    const workflow = createTask();
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: workflow, parent: null },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);

    render(<WorkflowDetailPage />);

    expect(viewProps.latest).toEqual(
      expect.objectContaining({
        activeTab: "data-debug",
        isPlatformAdmin: true,
      }),
    );
  });

  it("returns to the Workflow tab when debug is disabled", async () => {
    debugState.enabled = false;
    queryState.activeTab = "data-debug";
    const workflow = createTask();
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: workflow, parent: null },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);

    render(<WorkflowDetailPage />);

    await act(async () => {});

    expect(queryState.setActiveTab).toHaveBeenCalledWith("diagram");
    expect(viewProps.latest).toEqual(
      expect.objectContaining({
        activeTab: "data-debug",
        isPlatformAdmin: false,
      }),
    );
  });

  it("submits the root snapshot owned by the displayed draft", async () => {
    const initialWorkflow = createTask({ name: "Initial workflow" });
    const refreshedWorkflow = createTask({ name: "Refreshed workflow" });
    const submit = vi.fn().mockResolvedValue({ id: "proposal-1" });

    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: initialWorkflow, parent: null },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: initialWorkflow,
      isLoading: false,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      error: null,
      remove: vi.fn(),
    } as ReturnType<typeof useWorkItems>);
    mockUseWorkItemGraphDraft.mockImplementation(
      (graphInput) =>
        ({
          draft: {
            context: {
              root: graphInput.root,
              children: graphInput.children,
              incidentRelationships: graphInput.incidentRelationships,
              typeDefinition: graphInput.typeDefinition,
              graphCapability: graphInput.typeDefinition.capabilities?.graph,
              layoutSectionKey: "graphLayout",
            },
          },
          projected: {
            projectedRoot: graphInput.root,
            children: graphInput.children,
            incidentRelationships: graphInput.incidentRelationships,
            effectiveLayout: {
              schemaVersion: "work-item-graph-layout.v1",
              nodes: [],
            },
          },
          operations: [{ op: "clearLayout" }],
          isDirty: true,
          reset: vi.fn(),
        }) as unknown as ReturnType<typeof useWorkItemGraphDraft>,
    );
    mockUseSubmitWorkItemGraphProposal.mockReturnValue({
      submit,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSubmitWorkItemGraphProposal>);

    const { rerender } = render(<WorkflowDetailPage />);

    act(() => {
      viewProps.latest?.onEditGraph?.();
    });

    expect(viewProps.latest?.isEditingGraph).toBe(true);

    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: { task: refreshedWorkflow, parent: null },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHierarchy>);
    mockUseWorkItem.mockReturnValue({
      workItem: refreshedWorkflow,
      isLoading: false,
      isFetching: false,
      error: null,
    } as ReturnType<typeof useWorkItem>);
    rerender(<WorkflowDetailPage />);

    await act(async () => {
      await viewProps.latest?.onReviewGraph?.();
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        root: expect.objectContaining({ name: "Initial workflow" }),
      }),
    );
  });
});
