import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it, vi, beforeEach, onTestFinished } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { defaultUrlTransform } from "react-markdown";
import { Position } from "@xyflow/react";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  AgentEdgeEndpointEntityType,
  EntityType,
  TargetEntityType,
  TaskSource,
  WorkStatus,
  type AgentEdgeResponseDto,
  type TaskResponseDto,
} from "../../../api";
import { ProjectContext } from "../../../contexts";
import { ConversationScrollPolicyContext } from "../../Conversation/hooks/useConversationScrolling";
import { WORKFLOW_COMPACT_DESCRIPTION_MAX_LENGTH } from "../../../utils/workflowDescriptionFormatting";
import { useSystemMessageMarkdownComponents } from "../../Conversation/Components/SystemMessage";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { serializeFileReferenceMarkdown } from "../../SmarterTextAreaCard/fileReferences/fileReferenceMarkdown";
import { escapeMentionTokens, MarkdownRenderer } from "../MarkdownRenderer";
import {
  buildWorkflowGraphModel,
  getDiagramElementMetadata,
  getDiagramMetadata,
  getWorkflowEdgeLabelPosition,
  projectWorkItemGraphForWorkflowSurface,
  renderMentionNode,
  WorkflowGraphSurface,
  WorkflowMentionInlineRenderer,
  WorkflowConditionalTargetMarker,
  WorkflowEdgeLabel,
  type WorkItemGraphProjectionData,
  type WorkflowGraphSurfaceData,
} from "../WorkflowMentionInlineRenderer";
import { WorkItemMentionInlineRenderer } from "../WorkItemMentionInlineRenderer";
import { MentionExpansionProvider } from "../MentionExpansionContext";
import * as diagramLayoutCandidates from "../diagramLayoutCandidates";
import { diagramLayoutPreferenceKey } from "../useDiagramLayoutPreference";

const LocationEvidence = () => (
  <output data-testid="current-path">{useLocation().pathname}</output>
);

const hookMocks = vi.hoisted(() => ({
  useWorkItem: vi.fn(),
  useWorkItems: vi.fn(),
  useWorkItemGraph: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
  getTopologyEntityGraph: vi.fn(),
  useLocalRepoBindings: vi.fn(),
}));

class EagerIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect(): void {}

  unobserve(): void {}
}

class DeferredIntersectionObserver {
  static readonly instances: DeferredIntersectionObserver[] = [];

  readonly options: IntersectionObserverInit | undefined;
  private readonly callback: IntersectionObserverCallback;
  private target: Element | null = null;

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    DeferredIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.target = target;
  }

  trigger(isIntersecting: boolean): void {
    if (!this.target) return;
    this.callback(
      [{ target: this.target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect(): void {}

  unobserve(): void {}
}

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: hookMocks.useWorkItem,
}));

vi.mock("../../../data/hooks/useWorkItems", () => ({
  useWorkItems: hookMocks.useWorkItems,
}));

vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: hookMocks.useWorkItemGraph,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../data/hooks/useWorkItemTypes")
  >()),
  useWorkItemTypeByKey: hookMocks.useWorkItemTypeByKey,
}));

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getTopologyEntityGraph: hookMocks.getTopologyEntityGraph,
  },
}));

vi.mock("../../../data/hooks/useLocalRepoBindings", () => ({
  useLocalRepoBindings: hookMocks.useLocalRepoBindings,
}));

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: ({
    anchorEl,
    entityId,
    entityType,
    onPopoverMouseEnter,
    onPopoverMouseLeave,
    organizationId,
    projectId,
    titleHref,
    onClose,
    focusOnOpen,
  }: {
    anchorEl: HTMLElement | null;
    entityId: string;
    entityType: string;
    onPopoverMouseEnter?: () => void;
    onPopoverMouseLeave?: () => void;
    organizationId?: string;
    projectId?: string;
    titleHref?: string;
    onClose?: () => void;
    focusOnOpen?: boolean;
  }) =>
    anchorEl ? (
      <div
        data-testid="entity-hover-card"
        data-entity-id={entityId}
        data-entity-type={entityType}
        data-organization-id={organizationId}
        data-project-id={projectId}
        data-focus-on-open={String(Boolean(focusOnOpen))}
        onMouseEnter={onPopoverMouseEnter}
        onMouseLeave={onPopoverMouseLeave}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose?.();
        }}
      >
        {titleHref ? (
          <a href={titleHref} data-testid="entity-hover-card-title-link">
            Preview title
          </a>
        ) : null}
        Entity preview
      </div>
    ) : null,
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
  </MemoryRouter>
);

const projectWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>
      <ProjectContext.Provider
        value={{
          organizationId: "org-1",
          projectId: "project-1",
          navigate: vi.fn(),
        }}
      >
        {children}
      </ProjectContext.Provider>
    </ThemeProvider>
  </MemoryRouter>
);

const makeTask = (
  overrides: Partial<TaskResponseDto> & Pick<TaskResponseDto, "id" | "name">,
): TaskResponseDto => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type ?? "STANDARD",
  sections: overrides.sections ?? [],
  organizationId: overrides.organizationId ?? "org-1",
  projectId: overrides.projectId ?? "project-1",
  status: overrides.status ?? WorkStatus.Backlog,
  source: overrides.source ?? TaskSource.System,
  edges: overrides.edges,
});

const makeWorkflow = (
  overrides: Omit<Partial<TaskResponseDto>, "type"> &
    Pick<TaskResponseDto, "id" | "name">,
): TaskResponseDto & { type: "workflow" } => ({
  ...makeTask(overrides),
  type: "workflow",
});

const makeWorkflowStep = (
  overrides: Omit<Partial<TaskResponseDto>, "type"> &
    Pick<TaskResponseDto, "id" | "name">,
): TaskResponseDto & { type: "workflow_step" } => ({
  ...makeTask(overrides),
  type: "workflow_step",
});

const makeEdge = (
  overrides: Partial<AgentEdgeResponseDto> &
    Pick<
      AgentEdgeResponseDto,
      "id" | "sourceNodeId" | "targetNodeId" | "type"
    > & {
      sourceNodeName?: string;
      targetNodeName?: string;
      targetNodeType?: string;
    },
): AgentEdgeResponseDto => ({
  id: overrides.id,
  sourceNodeId: overrides.sourceNodeId,
  sourceNodeName: overrides.sourceNodeName,
  targetNodeId: overrides.targetNodeId,
  targetEntityType: overrides.targetEntityType,
  targetNodeName: overrides.targetNodeName,
  targetNodeType: overrides.targetNodeType,
  type: overrides.type,
  category: overrides.category,
  direction: overrides.direction,
  predicate: overrides.predicate,
  reasoning: overrides.reasoning ?? "",
  createdAt: overrides.createdAt ?? "2026-07-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-07-01T00:00:00.000Z",
});

const makeLinearWorkflowGraph = (stepCount: number, prefix = "linear") => {
  const workflow = makeWorkflow({
    id: `${prefix}-workflow`,
    name: "Linear workflow",
  });
  const steps = Array.from({ length: stepCount }, (_, index) =>
    makeWorkflowStep({
      id: `${prefix}-step-${index}`,
      name: `Step ${String(index + 1).padStart(2, "0")}`,
      parentTaskId: workflow.id,
    }),
  );
  const edges = steps.slice(0, -1).map((step, index) =>
    makeEdge({
      id: `${prefix}-edge-${index}`,
      sourceNodeId: step.id,
      targetNodeId: steps[index + 1].id,
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    }),
  );

  return { workflow, steps, edges };
};

// Supply only the browser geometry React Flow needs to mount its real edges.
// The edge components, portals, callbacks and surface state stay unmocked.
const mockFlowMeasurements = () => {
  const width = vi
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockReturnValue(140);
  const height = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(140);
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    },
  );
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      private targets = new Set<Element>();
      private notify: () => void;
      constructor(callback: ResizeObserverCallback) {
        this.notify = () =>
          callback(
            [...this.targets].map((target) => ({
              target,
              contentRect: target.getBoundingClientRect(),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            })),
            this,
          );
        observers.push(this.notify);
      }
      observe(target: Element) {
        this.targets.add(target);
        queueMicrotask(() => {
          if (this.targets.size) this.notify();
        });
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
  onTestFinished(() => {
    width.mockRestore();
    height.mockRestore();
    vi.unstubAllGlobals();
  });
  return () => act(() => observers.forEach((notify) => notify()));
};

// Unpositioned diagrams render no nodes until the layout engine resolves.
// React Flow adopts arranged nodes through its store one tick after the
// surface leaves "arranging", so also wait for populated surfaces' cards.
const waitForDiagramArranged = () =>
  waitFor(
    () => {
      expect(
        document.querySelector('[data-workflow-view-mode="arranging"]'),
      ).toBeNull();
      document
        .querySelectorAll(
          '[data-workflow-view-mode="natural-size"], [data-workflow-view-mode="fit-to-view"]',
        )
        .forEach((surface) =>
          expect(
            surface.querySelector('[data-testid="workflow-inline-step"]'),
          ).not.toBeNull(),
        );
    },
    { timeout: 5000 },
  );

const emptyWorkflowStepHandles = {
  hasLeftSourceHandle: false,
  hasLeftTargetHandle: false,
  hasRightSourceHandle: false,
  hasRightTargetHandle: false,
  forwardSourceHandleIds: [],
  hasLoopSourceHandle: false,
  hasLoopTargetHandle: false,
  hasCrossBandTargetHandle: false,
  returnSourceHandleIds: [],
  returnTargetHandleIds: [],
} as const;

const getNodeHandles = (
  model: ReturnType<typeof buildWorkflowGraphModel>,
  stepId: string,
) => {
  const node = model.nodes.find((candidate) => candidate.id === stepId);
  expect(node).toBeDefined();
  return node?.data.handles;
};

const getNodeData = (
  model: ReturnType<typeof buildWorkflowGraphModel>,
  stepId: string,
) => {
  const node = model.nodes.find((candidate) => candidate.id === stepId);
  expect(node).toBeDefined();
  return node?.data;
};

const getNodePositionByTitle = (
  model: ReturnType<typeof buildWorkflowGraphModel>,
): Map<string, { x: number; y: number }> =>
  new Map(
    model.nodes.map((node) => [
      node.data.title,
      {
        x: node.position.x,
        y: node.position.y,
      },
    ]),
  );

const getSortedConditionalLabels = (
  model: ReturnType<typeof buildWorkflowGraphModel>,
): string[] =>
  model.edges
    .flatMap((edge) => {
      const label = edge.data?.label?.trim();
      return label ? [label] : [];
    })
    .sort((left, right) => left.localeCompare(right));

const makeReadyWorkItemQuery = (workItem: TaskResponseDto | null) => ({
  workItem,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
});

const makeReadyWorkItemsQuery = (workItems: TaskResponseDto[] = []) => ({
  workItems,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
  createTask: vi.fn(),
  createInitiative: vi.fn(),
  updateTask: vi.fn(),
  updateInitiative: vi.fn(),
  remove: vi.fn(),
});

const setDefaultHookMocks = (): void => {
  hookMocks.getTopologyEntityGraph.mockResolvedValue({
    data: {
      data: {
        relationships: [],
      },
    },
  });
  hookMocks.useWorkItem.mockReturnValue(makeReadyWorkItemQuery(null));
  hookMocks.useWorkItems.mockReturnValue(makeReadyWorkItemsQuery());
  hookMocks.useWorkItemGraph.mockImplementation(
    (organizationId: string, projectId: string, workItemId: string) => {
      const workflowQuery = hookMocks.useWorkItem(
        organizationId,
        "task",
        workItemId,
        {
          projectId,
          includeEdges: true,
          edgeTypes: [
            AgentEdgeType.Standard,
            AgentEdgeType.Conditional,
            AgentEdgeType.Loop,
            AgentEdgeType.FulfilledBy,
            AgentEdgeType.DependsOn,
          ],
          enabled: true,
        },
      );
      const stepsQuery = hookMocks.useWorkItems(
        organizationId,
        "task",
        projectId,
        undefined,
        {
          parentTaskId: workItemId,
          taskType: "workflow_step",
          includeSectionKeys: ["description"],
          includeEdges: true,
          edgeTypes: [
            AgentEdgeType.Standard,
            AgentEdgeType.Conditional,
            AgentEdgeType.Loop,
            AgentEdgeType.FulfilledBy,
            AgentEdgeType.DependsOn,
          ],
          enabled: true,
        },
      );
      const root = workflowQuery.workItem as TaskResponseDto | null;
      const children = (stepsQuery.workItems ?? []) as TaskResponseDto[];
      const relationships = Array.from(
        new Map(
          [root, ...children]
            .flatMap((item) => item?.edges ?? [])
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
        isFetched: workflowQuery.isFetched && stepsQuery.isFetched,
        isReady: workflowQuery.isReady && stepsQuery.isReady,
        error: workflowQuery.error ?? stepsQuery.error ?? null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      };
    },
  );
  hookMocks.useWorkItemTypeByKey.mockReturnValue({
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
  });
  hookMocks.useLocalRepoBindings.mockReturnValue({
    status: "empty",
    bindings: [],
    bindingsByServiceId: {},
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
  setDefaultHookMocks();
});

const fileReferenceValue = {
  version: 1 as const,
  serviceId: "service-1",
  serviceName: "UI Common",
  normalizedPath: "src/components/Editor.tsx",
};

const fileReferenceMarkdown =
  serializeFileReferenceMarkdown(fileReferenceValue);

const fileReferenceBinding = {
  serviceId: "service-1",
  repositoryPath: "/work/ui-common",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T01:00:00.000Z",
};

const SystemMessageMarkdownTestHarness: React.FC<{
  children: string;
}> = ({ children }) => {
  const components = useSystemMessageMarkdownComponents();
  return (
    <MarkdownRenderer components={components}>{children}</MarkdownRenderer>
  );
};

describe("diagram layout comparison controls", () => {
  beforeEach(() => localStorage.clear());
  it.each(["success", "failure"] as const)(
    "keeps automatic layouts editable and restores editing after preview %s",
    async (outcome) => {
      mockFlowMeasurements();
      const identity = { refType: "existing", id: "editable-start" } as const;
      const projection: WorkItemGraphProjectionData = {
        layoutSource: "canonical",
        projectedRoot: {
          identity: { refType: "existing", id: "editable-diagram" },
          label: "Editable diagram",
          name: "Editable diagram",
          type: "DIAGRAM",
          sections: [],
          deleted: false,
        },
        children: [
          {
            identity,
            label: "Start",
            name: "Start",
            type: "DIAGRAM_ELEMENT",
            sections: [],
            deleted: false,
          },
        ],
        incidentRelationships: [],
        effectiveLayout: { nodes: [] },
      };
      const onNodeContextMenu = vi.fn();
      const compute = vi
        .spyOn(diagramLayoutCandidates, "computeDiagramLayoutCandidate")
        .mockResolvedValue(new Map([[identity.id, { x: 32, y: 32 }]]));
      onTestFinished(() => compute.mockRestore());
      const { container } = render(
        <WorkflowGraphSurface
          projection={projection}
          organizationId="org-1"
          projectId="project-1"
          mode="edit"
          allowNodeDragging
          onNodeContextMenu={onNodeContextMenu}
        />,
        { wrapper: projectWrapper },
      );
      const openMenu = async () => {
        const element = container.querySelector('[data-id="editable-start"]');
        expect(element).not.toBeNull();
        await act(async () => {
          fireEvent.contextMenu(element!, { clientX: 40, clientY: 40 });
        });
      };
      await waitFor(() =>
        expect(
          container.querySelector('[data-id="editable-start"]'),
        ).not.toBeNull(),
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Original" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("diagram-layout-cancel-preview"),
      ).not.toBeInTheDocument();
      await openMenu();
      expect(onNodeContextMenu).toHaveBeenCalledWith(
        expect.objectContaining({
          child: identity,
        }),
      );
      onNodeContextMenu.mockClear();
      let fail: (reason: Error) => void = () => {};
      let finish: (
        positions: ReadonlyMap<string, { x: number; y: number }>,
      ) => void = () => {};
      compute.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      );
      fireEvent.click(screen.getByTestId("diagram-layout-elk-layered"));
      expect(screen.getByRole("status")).toHaveTextContent("Arranging");
      // Unpositioned diagrams show no nodes (so no editable node menu) until
      // the selected engine resolves.
      expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
        "data-workflow-view-mode",
        "arranging",
      );
      expect(container.querySelector('[data-id="editable-start"]')).toBeNull();
      await act(async () => {
        if (outcome === "failure") fail(new Error("Alternative unavailable"));
        else finish(new Map([[identity.id, { x: 400, y: 300 }]]));
      });
      if (outcome === "failure") {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Alternative unavailable",
        );
        expect(
          screen.getByTestId("workflow-inline-diagram-arranging"),
        ).toHaveTextContent("Layout unavailable");
        expect(
          container.querySelector('[data-id="editable-start"]'),
        ).toBeNull();
      } else {
        await waitFor(() =>
          expect(
            container.querySelector<HTMLElement>('[data-id="editable-start"]')
              ?.style.transform,
          ).toContain("400px"),
        );
        await openMenu();
        expect(onNodeContextMenu).not.toHaveBeenCalled();
      }
      fireEvent.click(screen.getByTestId("diagram-layout-cancel-preview"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("diagram-layout-cancel-preview"),
      ).not.toBeInTheDocument();
      await waitForDiagramArranged();
      await openMenu();
      expect(onNodeContextMenu).toHaveBeenCalledTimes(1);
      expect(projection.effectiveLayout.nodes).toEqual([]);
    },
  );

  it("previews selected positions through the shared renderer and restores authored positions", async () => {
    const first = makeWorkflowStep({ id: "comparison-start", name: "Start" });
    const second = makeWorkflowStep({
      id: "comparison-finish",
      name: "Finish",
    });
    const graphData: WorkflowGraphSurfaceData = {
      workflow: makeWorkflow({
        id: "comparison-flow",
        name: "Comparison flow",
      }),
      steps: [first, second],
      edges: [
        makeEdge({
          id: "comparison-edge",
          sourceNodeId: first.id,
          targetNodeId: second.id,
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "When accepted",
        }),
      ],
      layout: {
        schemaVersion: "work-item-graph-layout.v1",
        nodes: [
          {
            node: { kind: "persistedWorkItem", workItemId: first.id },
            position: { x: 800, y: 600 },
          },
          {
            node: { kind: "persistedWorkItem", workItemId: second.id },
            position: { x: 1200, y: 600 },
          },
        ],
      },
    };
    const onNodeDragStop = vi.fn();
    let finish: (
      positions: ReadonlyMap<string, { x: number; y: number }>,
    ) => void = () => {};
    const compute = vi
      .spyOn(diagramLayoutCandidates, "computeDiagramLayoutCandidate")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    onTestFinished(() => compute.mockRestore());
    const { container, unmount } = render(
      <WorkflowGraphSurface
        graphData={graphData}
        mode="edit"
        allowFullscreen
        allowNodeDragging
        onNodeDragStop={onNodeDragStop}
      />,
      { wrapper: projectWrapper },
    );
    const startNode = () =>
      container.querySelector<HTMLElement>('[data-id="comparison-start"]');
    await waitFor(() =>
      expect(startNode()?.style.transform).toContain("800px"),
    );
    const originalPosition = startNode()?.style.transform;
    expect(compute).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("diagram-layout-elk-layered"),
    ).toHaveAccessibleName("Layered");
    expect(screen.getByTestId("diagram-layout-dagre")).toHaveAccessibleName(
      "Flow",
    );
    expect(
      screen.getByTestId("diagram-layout-elk-stress"),
    ).toHaveAccessibleName("Network");
    fireEvent.click(screen.getByTestId("diagram-layout-elk-layered"));
    expect(screen.getByRole("status")).toHaveTextContent("Arranging");
    expect(compute).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          { id: first.id, title: "Start", width: 140, height: 140 },
        ]),
        edges: [
          { source: first.id, target: second.id, label: "When accepted" },
        ],
      }),
      "elk-layered",
      "RIGHT",
    );
    await act(async () => {
      finish(
        new Map([
          [first.id, { x: 32, y: 32 }],
          [second.id, { x: 350, y: 32 }],
        ]),
      );
    });
    await waitFor(() => expect(startNode()?.style.transform).toContain("32px"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
      "data-layout-candidate",
      "elk-layered",
    );
    expect(onNodeDragStop).not.toHaveBeenCalled();
    compute.mockResolvedValueOnce(
      new Map([
        [first.id, { x: 32, y: 32 }],
        [second.id, { x: 350, y: 32 }],
      ]),
    );
    fireEvent.click(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    );
    const fullscreen = screen.getByTestId("workflow-fullscreen-diagram");
    expect(fullscreen).toHaveAttribute("data-layout-candidate", "elk-layered");
    expect(
      within(fullscreen).getByTestId("diagram-layout-elk-layered"),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      within(fullscreen).getByTestId("diagram-layout-cancel-preview"),
    );
    await waitFor(() =>
      expect(startNode()?.style.transform).toBe(originalPosition),
    );
    expect(graphData.layout?.nodes[0]?.position).toEqual({ x: 800, y: 600 });
    unmount();
    compute.mockClear();
    localStorage.setItem(
      diagramLayoutPreferenceKey({
        organizationId: graphData.workflow.organizationId,
        projectId: graphData.workflow.projectId,
        diagramId: graphData.workflow.id,
      }),
      JSON.stringify({ candidate: "elk-stress", direction: "DOWN" }),
    );
    const reopened = render(<WorkflowGraphSurface graphData={graphData} />, {
      wrapper: projectWrapper,
    });
    expect(screen.getByTestId("diagram-layout-elk-stress")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(
        reopened.container.querySelector<HTMLElement>(
          '[data-id="comparison-start"]',
        )?.style.transform,
      ).toBe(originalPosition),
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it("uses Flow automatically and restores a selected style and direction after reopening", async () => {
    const graphData: WorkflowGraphSurfaceData = {
      workflow: makeWorkflow({
        id: "remembered-flow",
        name: "Remembered flow",
      }),
      steps: [makeWorkflowStep({ id: "remembered-start", name: "Start" })],
      edges: [],
    };
    const compute = vi
      .spyOn(diagramLayoutCandidates, "computeDiagramLayoutCandidate")
      .mockResolvedValue(new Map([["remembered-start", { x: 32, y: 32 }]]));
    onTestFinished(() => compute.mockRestore());
    const first = render(<WorkflowGraphSurface graphData={graphData} />, {
      wrapper: projectWrapper,
    });
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(compute).toHaveBeenCalledWith(expect.anything(), "dagre", "RIGHT");
    fireEvent.click(screen.getByTestId("diagram-layout-elk-layered"));
    fireEvent.click(screen.getByTestId("diagram-layout-vertical"));
    await waitFor(() =>
      expect(compute).toHaveBeenLastCalledWith(
        expect.anything(),
        "elk-layered",
        "DOWN",
      ),
    );
    first.unmount();
    compute.mockClear();
    render(<WorkflowGraphSurface graphData={graphData} />, {
      wrapper: projectWrapper,
    });
    expect(screen.getByTestId("diagram-layout-elk-layered")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("diagram-layout-vertical")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(compute).toHaveBeenCalledWith(
        expect.anything(),
        "elk-layered",
        "DOWN",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});

describe("diagram graph metadata", () => {
  it("reads canonical diagram metadata from materialized JSON sections", () => {
    const diagram = makeTask({
      id: "diagram-1",
      name: "Architecture",
      type: "DIAGRAM",
      sections: [
        {
          id: "metadata-1",
          key: "diagramMetadata",
          order: 0,
          materializedMarkdown: JSON.stringify({
            kind: "ARCHITECTURE",
            level: "CONTAINER",
          }),
          materializedProposalId: "proposal-1",
        },
      ],
    });
    const element = makeTask({
      id: "element-1",
      name: "API",
      type: "DIAGRAM_ELEMENT",
      sections: [
        {
          id: "metadata-2",
          key: "diagramElementMetadata",
          order: 0,
          materializedMarkdown: JSON.stringify({ role: "CONTAINER" }),
          materializedProposalId: "proposal-1",
        },
      ],
    });

    expect(getDiagramMetadata(diagram)).toEqual({
      kind: "ARCHITECTURE",
      level: "CONTAINER",
    });
    expect(getDiagramElementMetadata(element)).toEqual({ role: "CONTAINER" });
  });

  it.each([
    ["success", "inline"],
    ["unavailable", "inline"],
    ["cycle", "inline"],
    ["success", "fullscreen"],
    ["success", "edit"],
    ["success", "review"],
    ["success", "keyboard"],
  ] as const)(
    "opens canonical Diagram references with %s outcome on %s and returns to the placement",
    async (outcome, surface) => {
      const diagram = makeTask({
        id: "8b0a1d69-0642-40e9-abd5-36795cd7bb14",
        name: "Stage and Publish a Future Revision",
        type: "DIAGRAM",
      });
      const targetId = "2fd9690d-b093-4ab5-8c93-595dff273c7a";
      const metadata = {
        role: "DIAGRAM_REFERENCE",
        canonicalReference: { entityType: "TASK", entityId: targetId },
      } satisfies import("../../../api").DiagramElementMetadata;
      const element = makeTask({
        id: "b72eed85-afa6-434c-83a8-a0ce252dbfad",
        name: "Reconcile a Proposal with Current Content",
        type: "DIAGRAM_ELEMENT",
        parentTaskId: diagram.id,
        sections: [
          {
            id: "c4a545fb-fda8-4b55-8c73-e6152aadb448",
            key: "diagramElementMetadata",
            order: 0,
            materializedMarkdown: JSON.stringify(metadata),
            materializedProposalId: "a1f0fd1d-c5c6-4df7-89e5-21773af4c741",
          },
        ],
      });
      const definition = {
        key: "DIAGRAM_ELEMENT",
        name: "Diagram element",
        allowedStatuses: [],
        sections: [
          {
            key: "diagramElementMetadata",
            name: "Metadata",
            type: "JSON",
            required: true,
            order: 0,
            diagramElementPolicy: {
              roles: [
                {
                  key: "DIAGRAM_REFERENCE",
                  label: "Diagram reference",
                  notation: "frame",
                },
              ],
              referenceTargets: [],
            },
          },
        ],
      } satisfies import("../../../api").WorkItemTypeDefinitionDto;
      const diagramDefinition = {
        key: "DIAGRAM",
        name: "Diagram",
        iconKey: "workflow" as const,
        sections: [],
        allowedStatuses: [],
      };
      hookMocks.useWorkItemTypeByKey.mockImplementation(
        (_org, _project, key) => ({
          workItemTypeDefinition:
            key === "DIAGRAM" ? diagramDefinition : definition,
          isFetched: true,
          error: null,
        }),
      );
      let pending = true;
      hookMocks.useWorkItemGraph.mockImplementation(() => ({
        isFetched: !pending,
        isFetching: pending,
        error:
          outcome === "unavailable" && !pending
            ? new Error("Unavailable")
            : null,
        data: pending
          ? null
          : {
              root: makeTask({
                id: targetId,
                name: "Canonical reconciliation",
                type: "DIAGRAM",
              }),
              children: [element],
              relationships: [],
              derivedReferences: [],
              layout: null,
            },
      }));
      const graphData = {
        workflow: diagram,
        steps: [element],
        edges: [],
        nodeTypeDefinition: definition,
        workflowTypeDefinition: {
          key: "DIAGRAM",
          name: "Diagram",
          iconKey: "workflow" as const,
          sections: [],
          allowedStatuses: [],
        },
      };
      const rootIdentity = { refType: "existing", id: diagram.id } as const;
      const childIdentity = { refType: "existing", id: element.id } as const;
      const projection: WorkItemGraphProjectionData = {
        layoutSource: "authored",
        projectedRoot: {
          identity: rootIdentity,
          name: diagram.name,
          label: diagram.name,
          type: "DIAGRAM",
          deleted: false,
          sections: [],
        },
        children: [
          {
            identity: childIdentity,
            name: element.name,
            label: element.name,
            type: "DIAGRAM_ELEMENT",
            deleted: false,
            parent: rootIdentity,
            sections: [{ key: "diagramElementMetadata", content: metadata }],
          },
        ],
        incidentRelationships: [],
        effectiveLayout: {
          nodes: [{ node: childIdentity, position: { x: 125, y: 175 } }],
        },
      };
      const projected = surface === "edit" || surface === "review";
      const renderSurface = () => (
        <>
          <LocationEvidence />
          <WorkflowGraphSurface
            graphData={projected ? undefined : graphData}
            projection={projected ? projection : undefined}
            organizationId="org-1"
            projectId="project-1"
            mode={surface === "edit" ? "edit" : "view"}
            allowFullscreen
            explorationAncestors={
              outcome === "cycle" ? [diagram.id, targetId] : [diagram.id]
            }
          />
          ,
        </>
      );
      const view = render(renderSurface(), { wrapper: projectWrapper });
      await waitForDiagramArranged();
      if (surface === "fullscreen") {
        fireEvent.click(
          screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
        );
        await waitForDiagramArranged();
      }
      const scope =
        surface === "fullscreen"
          ? within(screen.getByRole("dialog"))
          : within(view.container);
      const card = scope.getByTestId("workflow-inline-step");
      expect(card).toHaveAttribute("data-diagram-notation", "frame");
      expect(
        scope.queryByTestId("diagram-reference-expand"),
      ).not.toBeInTheDocument();
      if (surface !== "edit") {
        const icon = scope.getByRole("link", { name: "Open linked Diagram" });
        expect(icon).toHaveAttribute("href", expect.stringContaining(targetId));
        expect(card).toHaveAttribute(
          "href",
          expect.stringContaining(element.id),
        );
        expect(card.contains(icon)).toBe(false);
      } else {
        expect(card).not.toHaveAttribute("href");
      }
      expect(scope.queryByText("Open reference")).not.toBeInTheDocument();
      if (surface === "keyboard") {
        act(() => card.focus());
        fireEvent.keyDown(card, { key: "F10", shiftKey: true });
      } else {
        fireEvent.contextMenu(card);
      }
      const explore = scope.getByRole("button", {
        name: "Explore linked Diagram",
      });
      act(() => explore.focus());
      const frame = scope.getByTestId("workflow-inline-step-frame");
      const graphNode = frame.closest(".react-flow__node");
      if (surface === "edit" && graphNode) {
        fireEvent.click(graphNode);
        await waitFor(() => expect(graphNode).toHaveClass("selected"));
      }
      const originalPosition = graphNode?.getAttribute("style");
      const viewport = frame.closest(".react-flow__viewport");
      const originalViewport = viewport?.getAttribute("style");
      fireEvent.click(explore);
      expect(hookMocks.useWorkItemGraph).toHaveBeenCalledWith(
        "org-1",
        "project-1",
        targetId,
        expect.objectContaining({ enabled: outcome !== "cycle" }),
      );
      if (outcome === "cycle") {
        expect(
          screen.getByTestId("diagram-exploration-cycle"),
        ).toBeInTheDocument();
      } else {
        expect(
          screen.getByTestId("diagram-exploration-loading"),
        ).toBeInTheDocument();
        pending = false;
        view.rerender(renderSurface());
        await waitForDiagramArranged();
        if (outcome === "unavailable")
          expect(
            screen.getByTestId("diagram-exploration-unavailable"),
          ).toBeInTheDocument();
        else {
          expect(
            within(screen.getAllByRole("dialog").at(-1)!).getByText(
              "Canonical reconciliation",
            ),
          ).toBeInTheDocument();
          expect(
            within(screen.getAllByRole("dialog").at(-1)!).getByTestId(
              "workflow-inline-step",
            ),
          ).toHaveAttribute("data-diagram-notation", "frame");
        }
      }
      fireEvent.click(screen.getByTestId("diagram-exploration-return"));
      await waitFor(() =>
        expect(
          screen.queryByTestId("diagram-exploration-return"),
        ).not.toBeInTheDocument(),
      );
      expect(card).toHaveAttribute("data-step-id", element.id);
      expect(getDiagramElementMetadata(element)).toEqual(metadata);
      await waitFor(() => expect(explore).toHaveFocus());
      expect(frame).toBeInTheDocument();
      expect(graphNode).toHaveAttribute("style", originalPosition);
      expect(viewport).toHaveAttribute("style", originalViewport);
      if (surface === "edit") expect(graphNode).toHaveClass("selected");
      expect(projection.children[0].sections[0].content).toEqual(metadata);
      if (surface === "inline" || surface === "keyboard") {
        const icon = scope.getByRole("link", { name: "Open linked Diagram" });
        const user = userEvent.setup();
        if (surface === "keyboard") {
          act(() => icon.focus());
          await user.keyboard("{Enter}");
        } else await user.click(icon);
        expect(screen.getByTestId("current-path")).toHaveTextContent(targetId);
        if (surface === "keyboard") {
          act(() => card.focus());
          await user.keyboard("{Enter}");
        } else await user.click(card);
        expect(screen.getByTestId("current-path")).toHaveTextContent(
          element.id,
        );
      }
      if (surface === "inline" && outcome === "success") {
        hookMocks.useWorkItemTypeByKey.mockReturnValue({
          workItemTypeDefinition: undefined,
          isFetched: false,
          error: null,
        });
        view.rerender(
          <WorkflowGraphSurface
            graphData={{ ...graphData, workflowTypeDefinition: undefined }}
          />,
        );
        await waitForDiagramArranged();
        expect(
          screen.queryByTestId("diagram-reference-open"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("diagram-reference-expand"),
        ).not.toBeInTheDocument();
        view.rerender(
          <WorkflowGraphSurface graphData={graphData} disableLinks />,
        );
        await waitForDiagramArranged();
        fireEvent.focus(screen.getByTestId("workflow-inline-step"));
        expect(
          screen.queryByTestId("diagram-reference-open"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("diagram-reference-expand"),
        ).not.toBeInTheDocument();
        view.rerender(
          <WorkflowGraphSurface
            graphData={{
              ...graphData,
              steps: [{ ...element, id: "temporary:element" }],
            }}
          />,
        );
        await waitForDiagramArranged();
        expect(screen.getByTestId("workflow-inline-step")).not.toHaveAttribute(
          "href",
        );
        expect(
          screen.queryByTestId("diagram-reference-open"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("diagram-reference-expand"),
        ).not.toBeInTheDocument();
      }
    },
  );

  it.each([
    ["TASK", "/tasks/"],
    ["SERVICE", "/services/"],
  ] as const)(
    "opens a %s canonical reference from a small icon, not a text button",
    async (entityType, pathFragment) => {
      const diagram = makeTask({
        id: "d1f0c2aa-0a5e-4b52-9c1a-6a0a4f9c1001",
        name: "Overview",
        type: "DIAGRAM",
      });
      const targetId = "e2a1d3bb-1b6f-4c63-8d2b-7b1b5a0d2002";
      const metadata = {
        role: "SYSTEM",
        canonicalReference: { entityType, entityId: targetId },
      } satisfies import("../../../api").DiagramElementMetadata;
      const element = makeTask({
        id: "f3b2e4cc-2c70-4d74-9e3c-8c2c6b1e3003",
        name: "Referenced element",
        type: "DIAGRAM_ELEMENT",
        parentTaskId: diagram.id,
        sections: [
          {
            id: "a4c3f5dd-3d81-4e85-8f4d-9d3d7c2f4004",
            key: "diagramElementMetadata",
            order: 0,
            materializedMarkdown: JSON.stringify(metadata),
            materializedProposalId: "b5d4a6ee-4e92-4f96-9a5e-0e4e8d3a5005",
          },
        ],
      });
      const definition = {
        key: "DIAGRAM_ELEMENT",
        name: "Diagram element",
        allowedStatuses: [],
        sections: [
          {
            key: "diagramElementMetadata",
            name: "Metadata",
            type: "JSON",
            required: true,
            order: 0,
            diagramElementPolicy: {
              roles: [{ key: "SYSTEM", label: "System", notation: "box" }],
              referenceTargets: [],
            },
          },
        ],
      } satisfies import("../../../api").WorkItemTypeDefinitionDto;
      hookMocks.useWorkItemTypeByKey.mockImplementation(
        (_org, _project, key) => ({
          workItemTypeDefinition:
            key === "DIAGRAM"
              ? {
                  key: "DIAGRAM",
                  name: "Diagram",
                  iconKey: "workflow" as const,
                  sections: [],
                  allowedStatuses: [],
                }
              : definition,
          isFetched: true,
          error: null,
        }),
      );
      const view = render(
        <WorkflowGraphSurface
          graphData={{
            workflow: diagram,
            steps: [element],
            edges: [],
            nodeTypeDefinition: definition,
            workflowTypeDefinition: {
              key: "DIAGRAM",
              name: "Diagram",
              iconKey: "workflow" as const,
              sections: [],
              allowedStatuses: [],
            },
          }}
          organizationId="org-1"
          projectId="project-1"
        />,
        { wrapper: projectWrapper },
      );
      await waitForDiagramArranged();
      const scope = within(view.container);
      const open = scope.getByRole("link", { name: "Open reference" });
      expect(open).toHaveAttribute("data-testid", "diagram-reference-open");
      expect(open).toHaveAttribute(
        "href",
        expect.stringContaining(`${pathFragment}${targetId}`),
      );
      expect(open.textContent).toBe("");
      expect(scope.queryByText("Open reference")).not.toBeInTheDocument();
    },
  );

  it("keeps diagram metadata out of the graph header", () => {
    const diagram = makeTask({
      id: "diagram-relationships",
      name: "Contract responsibilities",
      type: "DIAGRAM",
      sections: [
        {
          id: "diagram-metadata",
          key: "diagramMetadata",
          order: 0,
          materializedMarkdown: JSON.stringify({
            kind: "ARCHITECTURE",
            level: "CONTAINER",
          }),
          materializedProposalId: "proposal-1",
        },
      ],
    });
    const element = makeTask({
      id: "diagram-element",
      name: "API",
      type: "DIAGRAM_ELEMENT",
      parentTaskId: diagram.id,
      sections: [
        {
          id: "element-metadata",
          key: "diagramElementMetadata",
          order: 0,
          materializedMarkdown: JSON.stringify({ role: "SERVICE_BOUNDARY" }),
          materializedProposalId: "proposal-1",
        },
      ],
    });
    const relationshipTypes = [
      AgentEdgeType.Guarantees,
      AgentEdgeType.Implements,
      AgentEdgeType.Consumes,
    ];
    const edges = relationshipTypes.map((type) =>
      makeEdge({
        id: `contract-${type}`,
        sourceNodeId: element.id,
        targetNodeId: `contract-target-${type}`,
        targetNodeName: `${type} contract`,
        targetNodeType: "CONTRACT",
        type,
        category: AgentEdgeCategory.Meta,
      }),
    );

    render(
      <WorkflowGraphSurface
        graphData={{
          workflow: diagram,
          steps: [element],
          edges,
          nodeTypeDefinition: {
            key: "DIAGRAM_ELEMENT",
            name: "Diagram element",
            sections: [
              {
                key: "diagramElementMetadata",
                name: "Diagram element metadata",
                type: "JSON",
                required: true,
                order: 0,
                diagramElementPolicy: {
                  roles: [
                    {
                      key: "SERVICE_BOUNDARY",
                      label: "Service boundary",
                      notation: "box",
                    },
                  ],
                  referenceTargets: [],
                },
              },
            ],
            allowedStatuses: [],
          },
        }}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-title-link"),
    ).toHaveTextContent("Contract responsibilities");
    expect(screen.queryByTestId("diagram-legend")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("diagram-element-role"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("diagram-participation-open"),
    ).not.toBeInTheDocument();
  });

  it.each(
    [
      { role: "PERSON", label: "Person", notation: "person" as const },
      { role: "AGENT", label: "Agent", notation: "box" as const },
      { role: "START", label: "Start", notation: "box" as const },
      { role: "END", label: "End", notation: "box" as const },
    ].flatMap((entry) =>
      (["view", "edit"] as const).map((mode) => ({ ...entry, mode })),
    ),
  )(
    "renders $role through the shared registry-defined card in $mode mode",
    async ({ role, label, notation, mode }) => {
      const longPersonTitle =
        "Administrator reviews the full signup request before approving access";
      const diagram = makeTask({
        id: "diagram-person",
        name: "Signup review",
        type: "DIAGRAM",
      });
      const personElement = makeTask({
        id: "diagram-person-element",
        name: longPersonTitle,
        type: "DIAGRAM_ELEMENT",
        parentTaskId: diagram.id,
        sections: [
          {
            id: "person-metadata",
            key: "diagramElementMetadata",
            order: 0,
            materializedMarkdown: JSON.stringify({ role }),
            materializedProposalId: "proposal-person",
          },
        ],
      });

      render(
        <WorkflowGraphSurface
          mode={mode}
          allowFullscreen
          graphData={{
            workflow: diagram,
            steps:
              role === "START" || role === "END"
                ? [
                    personElement,
                    {
                      ...personElement,
                      id: "second-marker",
                      name: "Second explicit marker",
                    },
                  ]
                : [personElement],
            edges: [],
            nodeTypeDefinition: {
              key: "DIAGRAM_ELEMENT",
              name: "Diagram element",
              sections: [
                {
                  key: "diagramElementMetadata",
                  name: "Diagram element metadata",
                  type: "JSON",
                  required: true,
                  order: 0,
                  diagramElementPolicy: {
                    roles: [
                      {
                        key: role,
                        label,
                        notation,
                      },
                    ],
                    referenceTargets: [],
                  },
                },
              ],
              allowedStatuses: [],
            },
          }}
        />,
        { wrapper: projectWrapper },
      );

      const expectSquarePersonCard = (): void => {
        const card = screen.getAllByTestId("workflow-inline-step")[0];
        if (role === "START" || role === "END") {
          expect(screen.getAllByTestId("workflow-inline-step")).toHaveLength(2);
          expect(
            within(card).getByRole("img", { name: `${label} role` }),
          ).toBeInTheDocument();
          expect(
            within(card).getByTestId(
              role === "START"
                ? "diagram-element-start-icon"
                : "diagram-element-end-icon",
            ),
          ).toBeInTheDocument();
          expect(screen.getByTestId("diagram-legend")).toHaveTextContent(
            "parallel paths may continue",
          );
        }
        expect(card).toHaveAttribute("data-diagram-notation", notation);
        expect(card).toHaveAttribute("data-diagram-role", label);
        expect(card).toHaveStyle({ borderRadius: "4px" });
        if (role === "AGENT") {
          expect(
            within(card).getByTestId("diagram-element-agent-icon"),
          ).toHaveStyle({ fontSize: "1rem" });
        } else {
          expect(
            within(card).queryByTestId("diagram-element-agent-icon"),
          ).not.toBeInTheDocument();
        }
        if (role === "PERSON") {
          expect(
            within(card).getByTestId("diagram-element-person-icon"),
          ).toHaveStyle({ fontSize: "1rem" });
        } else {
          expect(
            within(card).queryByTestId("diagram-element-person-icon"),
          ).not.toBeInTheDocument();
        }
        expect(
          within(card).getByTestId("workflow-inline-step-title"),
        ).toHaveTextContent(longPersonTitle);
        expect(
          within(card).queryByTestId("diagram-element-role"),
        ).not.toBeInTheDocument();
      };

      await waitForDiagramArranged();
      expectSquarePersonCard();
      fireEvent.click(screen.getByTestId("workflow-inline-diagram-size-small"));
      await waitForDiagramArranged();
      expectSquarePersonCard();
      fireEvent.click(screen.getByTestId("workflow-inline-diagram-size-large"));
      await waitForDiagramArranged();
      expectSquarePersonCard();
      if (role === "START" || role === "END") {
        fireEvent.click(
          screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
        );
        await waitForDiagramArranged();
        const fullscreen = within(screen.getByRole("dialog"));
        expect(
          fullscreen.getAllByRole("img", { name: `${label} role` }),
        ).toHaveLength(2);
        expect(fullscreen.getByTestId("diagram-legend")).toHaveTextContent(
          "parallel paths may continue",
        );
      }
    },
  );

  it("shows a neutral generic role, hover previews, and navigable direct entity links", async () => {
    const diagram = makeTask({
      id: "diagram-with-entity-links",
      name: "Diagram with entity links",
      type: "DIAGRAM",
    });
    const element = makeTask({
      id: "generic-linked-element",
      name: "Generic linked element",
      type: "DIAGRAM_ELEMENT",
      parentTaskId: diagram.id,
      sections: [
        {
          id: "generic-role-section",
          key: "diagramElementMetadata",
          order: 0,
          materializedMarkdown: JSON.stringify({ role: "GENERIC" }),
          materializedProposalId: "generic-role-proposal",
        },
      ],
    });
    const linkedTask = makeEdge({
      id: "element-related-task",
      sourceNodeId: element.id,
      targetNodeId: "related-task-id",
      targetEntityType: EntityType.Task,
      targetNodeName: "Feature search",
      targetNodeType: "BUG",
      type: AgentEdgeType.RelatedTo,
      category: AgentEdgeCategory.Meta,
    });
    const linkedService = makeEdge({
      id: "element-depends-on-service",
      sourceNodeId: element.id,
      targetNodeId: "service-id",
      targetEntityType: EntityType.Service,
      targetNodeName: "Search API",
      type: AgentEdgeType.DependsOn,
      category: AgentEdgeCategory.Meta,
    });
    const linkedDesignDoc = makeEdge({
      id: "element-derives-from-design-doc",
      sourceNodeId: element.id,
      targetNodeId: "design-doc-id",
      targetEntityType: EntityType.DesignDoc,
      targetNodeName: "General diagram design",
      type: AgentEdgeType.DerivesFrom,
      category: AgentEdgeCategory.Meta,
    });
    const flowEdge = makeEdge({
      id: "element-flow-edge",
      sourceNodeId: element.id,
      targetNodeId: "other-element-id",
      targetEntityType: EntityType.Task,
      targetNodeName: "Another element",
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    });
    const elementDefinition = {
      key: "DIAGRAM_ELEMENT",
      name: "Diagram element",
      sections: [
        {
          key: "diagramElementMetadata",
          name: "Diagram element metadata",
          type: "JSON",
          required: true,
          order: 0,
          diagramElementPolicy: {
            roles: [{ key: "GENERIC", label: "Generic", notation: "box" }],
            referenceTargets: [],
          },
        },
      ],
      allowedStatuses: [],
    } satisfies import("../../../api").WorkItemTypeDefinitionDto;
    const graphData = {
      workflow: diagram,
      steps: [element],
      edges: [linkedTask, linkedService, linkedDesignDoc, flowEdge],
      participation: null,
      nodeTypeDefinition: elementDefinition,
      workflowTypeDefinition: {
        key: "DIAGRAM",
        name: "Diagram",
        iconKey: "workflow" as const,
        sections: [],
        allowedStatuses: [],
      },
    } satisfies WorkflowGraphSurfaceData;
    const proposalLink = {
      sourceNodeId: element.id,
      targetEntityId: "linked-proposal-id",
      targetEntityType: "PROPOSAL",
      targetTitle: "Diagram design",
      relationshipType: AgentEdgeType.RelatedTo,
    };
    const proposalTaskLink = {
      sourceNodeId: element.id,
      targetEntityId: "proposal-task-id",
      targetEntityType: EntityType.Task,
      targetTitle: "Task from proposal",
      relationshipType: AgentEdgeType.Evolves,
    };
    hookMocks.useWorkItem.mockImplementation(
      (_organizationId, _entityType, workItemId) =>
        makeReadyWorkItemQuery(
          workItemId === "proposal-task-id"
            ? makeTask({
                id: workItemId,
                name: "Task from proposal",
                type: "BUG",
              })
            : null,
        ),
    );
    hookMocks.useWorkItemTypeByKey.mockReturnValue({
      workItemTypeDefinition: {
        key: "BUG",
        name: "Bug",
        iconKey: "bug",
        sections: [],
        allowedStatuses: [],
      } satisfies import("../../../api").WorkItemTypeDefinitionDto,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    render(
      <>
        <LocationEvidence />
        <WorkflowGraphSurface
          graphData={graphData}
          directEntityLinks={[proposalLink, proposalTaskLink]}
        />
      </>,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    const card = screen.getByTestId("workflow-inline-step");
    const roleIcon = within(card).getByRole("img", { name: "Generic role" });
    expect(roleIcon).toHaveStyle({
      position: "absolute",
      top: "6px",
      left: "6px",
    });
    const linkStrip = screen.getByRole("group", {
      name: "Directly linked entities",
    });
    expect(linkStrip).toHaveStyle({
      position: "absolute",
      bottom: "4px",
      left: "4px",
    });
    expect(screen.getAllByTestId("diagram-element-direct-link")).toHaveLength(
      5,
    );

    const taskLink = screen.getByRole("button", {
      name: "Preview Feature search; Related to",
    });
    const serviceLink = screen.getByRole("button", {
      name: "Preview Search API; Depends on",
    });
    const designDocLink = screen.getByRole("button", {
      name: "Preview General diagram design; Derives from",
    });
    const proposalLinkControl = screen.getByRole("button", {
      name: "Preview Diagram design; Related to",
    });
    const proposalTaskLinkControl = screen.getByRole("button", {
      name: "Preview Task from proposal; Evolves",
    });
    // Icons open previews and never navigate on their own.
    [taskLink, serviceLink, designDocLink, proposalLinkControl].forEach(
      (icon) => {
        expect(icon).not.toHaveAttribute("href");
        expect(icon).not.toHaveAttribute("aria-disabled");
      },
    );
    expect(taskLink).toHaveAttribute("data-target-work-item-type", "BUG");
    expect(
      taskLink.querySelector(
        '[data-testid="diagram-element-direct-link-icon"]',
      ),
    ).toHaveAttribute("data-work-item-type", "BUG");
    expect(hookMocks.useWorkItemTypeByKey).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "BUG",
    );
    expect(proposalTaskLinkControl).toHaveAttribute(
      "data-target-work-item-type",
      "BUG",
    );
    expect(hookMocks.useWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "proposal-task-id",
      expect.objectContaining({ enabled: true, projectId: "project-1" }),
    );

    fireEvent.mouseEnter(proposalLinkControl);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    const entityPreview = screen.getByTestId("entity-hover-card");
    expect(entityPreview).toHaveAttribute(
      "data-entity-id",
      "linked-proposal-id",
    );
    expect(entityPreview).toHaveAttribute("data-entity-type", "PROPOSAL");
    expect(entityPreview).toHaveAttribute("data-project-id", "project-1");
    expect(
      within(entityPreview).getByTestId("entity-hover-card-title-link"),
    ).toHaveAttribute("href", expect.stringContaining("linked-proposal-id"));

    fireEvent.mouseLeave(proposalLinkControl);
    fireEvent.mouseEnter(entityPreview);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    expect(screen.getByTestId("entity-hover-card")).toBeInTheDocument();
    fireEvent.mouseLeave(entityPreview);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 175));
    });
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();

    const pathBeforeClick = screen.getByTestId("current-path").textContent;
    fireEvent.click(taskLink);
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      pathBeforeClick ?? "",
    );
    const taskPreview = screen.getByTestId("entity-hover-card");
    expect(taskPreview).toHaveAttribute("data-entity-id", "related-task-id");
    expect(taskLink).toHaveAttribute("aria-expanded", "true");
    expect(
      within(taskPreview).getByTestId("entity-hover-card-title-link"),
    ).toHaveAttribute("href", expect.stringContaining("related-task-id"));
    // Activation pins the preview past hover-out; a second click closes it.
    fireEvent.mouseLeave(taskLink);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    expect(screen.getByTestId("entity-hover-card")).toBeInTheDocument();
    fireEvent.click(taskLink);
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();

    fireEvent.click(serviceLink);
    expect(
      within(screen.getByTestId("entity-hover-card")).getByTestId(
        "entity-hover-card-title-link",
      ),
    ).toHaveAttribute("href", expect.stringContaining("service-id"));
  });
});

describe("escapeMentionTokens", () => {
  const canonical = "@[task:abc-123|Task A]";
  const safeForRemark = "@\\[task:abc-123\\|Task A]";

  it("normalizes a canonical token to the remark-safe form", () => {
    expect(escapeMentionTokens(`See ${canonical} here`)).toBe(
      `See ${safeForRemark} here`,
    );
  });

  it("strict mode leaves a pipe-escaped agent token alone (regex does not match)", () => {
    const agentEscaped = "@\\[task:abc-123\\|Task A]";
    // The strict regex does not accept backslashes before `|`, so the token is
    // not matched and is passed through verbatim — remark consumes the
    // escapes and the standard post-parse regex picks the canonical token up.
    expect(escapeMentionTokens(`See ${agentEscaped} here`)).toBe(
      `See ${agentEscaped} here`,
    );
  });

  it("relaxed mode normalizes a pipe-escaped agent token to the canonical-then-safe form", () => {
    const agentEscaped = "@\\[task:abc-123\\|Task A]";
    expect(
      escapeMentionTokens(`See ${agentEscaped} here`, {
        allowMentionEscapes: true,
      }),
    ).toBe(`See ${safeForRemark} here`);
  });

  it("relaxed mode handles a doubled-backslash agent token without double-escaping", () => {
    const doubleEscaped = "@\\\\[task:abc-123\\\\|Task A]";
    expect(
      escapeMentionTokens(`See ${doubleEscaped} here`, {
        allowMentionEscapes: true,
      }),
    ).toBe(`See ${safeForRemark} here`);
  });

  it("relaxed mode produces the same output as strict for unescaped canonical input", () => {
    expect(escapeMentionTokens(`See ${canonical} here`)).toBe(
      escapeMentionTokens(`See ${canonical} here`, {
        allowMentionEscapes: true,
      }),
    );
  });

  it("preserves connective prose and punctuation between adjacent tokens", () => {
    const next = "@[contract:def-456|Contract B]";
    expect(
      escapeMentionTokens(`${canonical}, and ${next}`, {
        allowMentionEscapes: true,
      }),
    ).toBe(`${safeForRemark}, and @\\[contract:def-456\\|Contract B]`);
  });
});

describe("MarkdownRenderer typography", () => {
  it("renders markdown content at the enlarged reading size", () => {
    render(<MarkdownRenderer>Readable description</MarkdownRenderer>, {
      wrapper,
    });

    expect(screen.getByText("Readable description").parentElement).toHaveStyle({
      fontSize: "1.125rem",
    });
  });
});

describe("MarkdownRenderer file-reference links", () => {
  it("exposes Show Tasks on right-click for an unmapped reference", () => {
    render(<MarkdownRenderer>{fileReferenceMarkdown}</MarkdownRenderer>, {
      wrapper: projectWrapper,
    });

    expect(
      screen.queryByRole("button", { name: "Show Tasks" }),
    ).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId("file-reference"));
    expect(
      screen.getByTestId("file-reference-menu-show-tasks"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it("omits file actions when Markdown has no project context", () => {
    render(<MarkdownRenderer>{fileReferenceMarkdown}</MarkdownRenderer>, {
      wrapper,
    });
    fireEvent.contextMenu(screen.getByTestId("file-reference"));

    expect(
      screen.queryByTestId("file-reference-context-menu"),
    ).not.toBeInTheDocument();
  });

  it("keeps a mapped reference as a portable non-interactive label", () => {
    hookMocks.useLocalRepoBindings.mockReturnValue({
      status: "ready",
      bindings: [fileReferenceBinding],
      bindingsByServiceId: { "service-1": fileReferenceBinding },
    });

    render(<MarkdownRenderer>{fileReferenceMarkdown}</MarkdownRenderer>, {
      wrapper,
    });

    expect(screen.getByTestId("file-reference")).toHaveTextContent(
      "UI Common/src/components/Editor.tsx",
    );
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it("renders an unmapped portable reference as readable non-interactive text", () => {
    render(<MarkdownRenderer>{fileReferenceMarkdown}</MarkdownRenderer>, {
      wrapper,
    });

    expect(screen.getByTestId("file-reference")).toHaveTextContent(
      "UI Common/src/components/Editor.tsx",
    );
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it("does not claim malformed or unsupported file-reference destinations", () => {
    const malformed =
      "[$UI Common/other.ts](heyhey-file:v1:service-1:src%2Fcomponents%2FEditor.tsx)";
    const unsupported =
      "[$UI Common/src/components/Editor.tsx](heyhey-file:v2:service-1:src%2Fcomponents%2FEditor.tsx)";

    render(
      <MarkdownRenderer>{`${malformed}\n\n${unsupported}`}</MarkdownRenderer>,
      { wrapper },
    );

    expect(screen.queryByTestId("file-reference")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "$UI Common/other.ts" }),
    ).toHaveAttribute(
      "href",
      "heyhey-file:v1:service-1:src%2Fcomponents%2FEditor.tsx",
    );
    const unsupportedLabel = screen.getByText(
      "$UI Common/src/components/Editor.tsx",
    );
    expect(unsupportedLabel.closest("a")).toHaveAttribute("href", "");
  });

  it("keeps ordinary web links on the default Markdown anchor path", () => {
    render(
      <MarkdownRenderer>
        {"[Open documentation](https://example.com/docs)"}
      </MarkdownRenderer>,
      { wrapper },
    );

    expect(
      screen.getByRole("link", { name: "Open documentation" }),
    ).toHaveAttribute("href", "https://example.com/docs");
  });

  it("passes image URL transforms through without changing ordinary link safety", () => {
    render(
      <MarkdownRenderer
        urlTransform={(url, key, _node) =>
          key === "src" && url.startsWith("assets/")
            ? `/api/v1/help/assets/${url.slice("assets/".length)}`
            : defaultUrlTransform(url)
        }
      >
        {
          "![Guide](assets/guide.png) [Docs](https://example.com/docs) [Unsafe](javascript:alert(1))"
        }
      </MarkdownRenderer>,
      { wrapper },
    );

    expect(screen.getByRole("img", { name: "Guide" })).toHaveAttribute(
      "src",
      "/api/v1/help/assets/guide.png",
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    expect(screen.getByText("Unsafe").closest("a")).toHaveAttribute("href", "");
  });

  it("composes around a caller-supplied anchor component", () => {
    const onClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
    });
    const CustomAnchor = ({
      node: _node,
      ...props
    }: React.ComponentProps<"a"> & { node?: Element }) => (
      <a data-testid="custom-anchor" {...props} />
    );

    render(
      <MarkdownRenderer
        components={{
          a: ({ node: _node, ...props }) => (
            <CustomAnchor {...props} onClick={onClick} />
          ),
        }}
      >
        {"[Open documentation](https://example.com/docs)"}
      </MarkdownRenderer>,
      { wrapper },
    );

    const link = screen.getByTestId("custom-anchor");
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("preserves the system-message absolute source-link behavior", () => {
    render(
      <SystemMessageMarkdownTestHarness>
        {
          "[Open source](/Users/zac/Desktop/code/hey-hey/ui-common/src/App.tsx:12:4)"
        }
      </SystemMessageMarkdownTestHarness>,
      { wrapper },
    );

    expect(screen.getByTestId("system-message-source-link")).toHaveAttribute(
      "href",
      "#",
    );
    expect(screen.getByTestId("system-message-source-link")).toHaveAttribute(
      "data-source-path",
      "/Users/zac/Desktop/code/hey-hey/ui-common/src/App.tsx",
    );
  });
});

describe("MarkdownRenderer mention rendering", () => {
  it.each([
    [
      "canonical",
      "@[contract:ae0fa1ff-249a-422e-b051-9a9d-2f811a78ae1c|IMPLEMENT report emission boundary], and @[contract:46cfe463-f2a9-48a9-9227-8de95b4bc351|Run file-membership attribution boundary]",
    ],
    [
      "escaped",
      "@\\[contract:ae0fa1ff-249a-422e-b051-9a9d-2f811a78ae1c\\|IMPLEMENT report emission boundary], and @\\[contract:46cfe463-f2a9-48a9-9227-8de95b4bc351\\|Run file-membership attribution boundary]",
    ],
  ])(
    "preserves connective prose between %s adjacent mentions",
    (_format, markdown) => {
      hookMocks.useWorkItem.mockImplementation(
        (_organizationId: string, _entityType: string, entityId: string) =>
          makeReadyWorkItemQuery(
            makeTask({ id: entityId, name: "Contract", type: "contract" }),
          ),
      );

      render(
        <MarkdownRenderer allowMentionEscapes mentionMode="minimal">
          {markdown}
        </MarkdownRenderer>,
        { wrapper: projectWrapper },
      );

      expect(screen.getAllByTestId("mention-badge")).toHaveLength(2);
      expect(screen.getByText(", and")).toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention-error"),
      ).not.toBeInTheDocument();
    },
  );

  it("preserves connective prose in the task's inline-code reproduction", () => {
    hookMocks.useWorkItem.mockImplementation(
      (_organizationId: string, _entityType: string, entityId: string) =>
        makeReadyWorkItemQuery(
          makeTask({ id: entityId, name: "Contract", type: "contract" }),
        ),
    );
    hookMocks.useWorkItemTypeByKey.mockReturnValue({
      workItemTypeDefinition: undefined,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: false,
      error: new Error("failed"),
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    const { container } = render(
      <MarkdownRenderer allowMentionEscapes mentionMode="minimal">
        {
          "Reproduce it with `@[contract:ae0fa1ff-249a-422e-b051-9a9d-2f811a78ae1c|IMPLEMENT report emission boundary] and @[contract:46cfe463-f2a9-48a9-9227-8de95b4bc351|Run file-membership attribution boundary]`: both Contract mentions appear,"
        }
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(screen.getAllByTestId("mention-badge")).toHaveLength(2);
    expect(container).toHaveTextContent(
      "IMPLEMENT report emission boundary and Run file-membership attribution boundary`: both Contract mentions appear,",
    );
    expect(
      screen.queryByTestId("work-item-inline-mention-error"),
    ).not.toBeInTheDocument();
  });

  it("keeps workflow mentions on their dedicated renderer and routes ordinary work items generically", () => {
    const workflowNode = renderMentionNode({
      entityType: "workflow",
      entityId: "workflow-1",
      entityName: "Release workflow",
    });
    const workItemNode = renderMentionNode({
      entityType: "mockups_v3",
      entityId: "mockup-1",
      entityName: "Checkout mockup",
    });

    expect(React.isValidElement(workflowNode) && workflowNode.type).toBe(
      WorkflowMentionInlineRenderer,
    );
    expect(React.isValidElement(workItemNode) && workItemNode.type).toBe(
      WorkItemMentionInlineRenderer,
    );
  });

  it.each([
    [
      "canonical",
      "@[mockups_v3:ca685312-a6ed-405d-85f3-138c0caf8580|Organizations Directory — Desktop and Mobile]",
    ],
    [
      "escaped",
      "@\\[mockups_v3:ca685312-a6ed-405d-85f3-138c0caf8580\\|Organizations Directory — Desktop and Mobile]",
    ],
  ])(
    "renders %s numeric custom work-item mentions as interactive exact-identity output",
    (_format, token) => {
      render(
        <MarkdownRenderer allowMentionEscapes mentionMode="minimal">
          {token}
        </MarkdownRenderer>,
        { wrapper: projectWrapper },
      );

      const badge = screen.getByTestId("mention-badge");
      expect(badge).toHaveAttribute("data-entity-type", "mockups_v3");
      expect(badge).toHaveAttribute(
        "data-entity-id",
        "ca685312-a6ed-405d-85f3-138c0caf8580",
      );
      expect(badge).toHaveAttribute(
        "data-entity-name",
        "Organizations Directory — Desktop and Mobile",
      );
      expect(badge).toHaveTextContent(
        "Organizations Directory — Desktop and Mobile",
      );
      expect(screen.queryByText(token)).not.toBeInTheDocument();
    },
  );
  it.each([
    ["canonical", "@[conversation:conversation-123|Planning discussion]"],
    ["escaped", "@\\[conversation:conversation-123\\|Planning discussion]"],
  ])(
    "links %s conversation mentions through the agent-session resolver",
    (_format, token) => {
      render(
        <MarkdownRenderer allowMentionEscapes mentionMode="minimal">
          {token}
        </MarkdownRenderer>,
        { wrapper: projectWrapper },
      );

      expect(screen.getByTestId("mention-badge")).toHaveAttribute(
        "href",
        "/projects/project-1/resolve-agent-session/conversation-123",
      );
    },
  );

  it("renders workflow mention tokens as shared mention badges", () => {
    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper },
    );

    expect(screen.getByTestId("mention-badge")).toHaveTextContent(
      "Launch workflow",
    );
    expect(
      screen.queryByText("@[workflow:wf-123|Launch workflow]"),
    ).not.toBeInTheDocument();
  });

  it("renders a skeleton while an inline workflow mention is loading", () => {
    hookMocks.useWorkItem.mockReturnValue({
      workItem: null,
      isLoading: true,
      isFetching: false,
      isFetched: false,
      isReady: false,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-loading"),
    ).toHaveAttribute("data-workflow-id", "wf-123");
  });

  it("defers workflow reads until the mention enters the preload region", () => {
    DeferredIntersectionObserver.instances.length = 0;
    vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver);

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-placeholder"),
    ).toHaveAttribute("data-workflow-id", "wf-123");
    expect(
      screen.queryByTestId("workflow-inline-diagram-loading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-inline-diagram"),
    ).not.toBeInTheDocument();
    expect(hookMocks.useWorkItemGraph).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "wf-123",
      { enabled: false },
    );
    expect(hookMocks.useWorkItemTypeByKey).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
    );
    expect(DeferredIntersectionObserver.instances).toHaveLength(1);
    expect(DeferredIntersectionObserver.instances[0].options).toEqual(
      expect.objectContaining({ rootMargin: "1500px 0px" }),
    );
  });

  it("starts hydration on preload entry and latches it across re-entry", async () => {
    DeferredIntersectionObserver.instances.length = 0;
    vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver);
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const step = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: workflow.id,
    });
    hookMocks.useWorkItem.mockReturnValue(makeReadyWorkItemQuery(workflow));
    hookMocks.useWorkItems.mockReturnValue(makeReadyWorkItemsQuery([step]));

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    const observer = DeferredIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    act(() => observer?.trigger(true));

    await screen.findByTestId("workflow-inline-diagram");
    await waitForDiagramArranged();
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Draft release",
    );
    const callsAfterEntry = hookMocks.useWorkItemGraph.mock.calls.length;
    expect(screen.getByTestId("workflow-inline-mention")).toHaveAttribute(
      "data-workflow-hydration-state",
      "eligible",
    );
    expect(hookMocks.useWorkItemGraph).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "wf-123",
      { enabled: true },
    );

    act(() => observer?.trigger(false));
    act(() => observer?.trigger(true));

    expect(screen.getByTestId("workflow-inline-diagram")).toBeInTheDocument();
    expect(hookMocks.useWorkItemGraph.mock.calls.length).toBe(callsAfterEntry);
  });

  it("loads eagerly when visibility observation is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    hookMocks.useWorkItem.mockReturnValue(makeReadyWorkItemQuery(workflow));
    hookMocks.useWorkItems.mockReturnValue(makeReadyWorkItemsQuery());

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toBeInTheDocument();
    expect(hookMocks.useWorkItemGraph).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "wf-123",
      { enabled: true },
    );
    expect(hookMocks.useWorkItemTypeByKey).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "workflow",
    );
  });

  it("keeps multiple workflow mentions independently gated", () => {
    DeferredIntersectionObserver.instances.length = 0;
    vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver);

    render(
      <MarkdownRenderer>
        {
          "@[workflow:wf-123|Launch workflow] then @[workflow:wf-456|Cleanup workflow]"
        }
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getAllByTestId("workflow-inline-diagram-placeholder"),
    ).toHaveLength(2);
    expect(DeferredIntersectionObserver.instances).toHaveLength(2);
    expect(hookMocks.useWorkItemGraph).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "wf-123",
      { enabled: false },
    );
    expect(hookMocks.useWorkItemGraph).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "wf-456",
      { enabled: false },
    );
  });

  it.each(["workflow", "diagram"])(
    "uses the declared owner for offscreen inline %s preload eligibility",
    (entityType) => {
      DeferredIntersectionObserver.instances.length = 0;
      vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver);
      const ownerRef = React.createRef<HTMLElement>();
      render(
        <main ref={ownerRef}>
          <ConversationScrollPolicyContext.Provider
            value={{ mode: "owned", ownerRef }}
          >
            <MentionExpansionProvider presentation="inline">
              <WorkflowMentionInlineRenderer
                mention={{
                  entityType,
                  entityId: "wf-123",
                  entityName: "Launch workflow",
                }}
              />
            </MentionExpansionProvider>
          </ConversationScrollPolicyContext.Provider>
        </main>,
        { wrapper: projectWrapper },
      );
      expect(DeferredIntersectionObserver.instances[0].options).toEqual({
        root: ownerRef.current,
        rootMargin: "1500px 0px",
      });
      expect(hookMocks.useWorkItemGraph).toHaveBeenCalledWith(
        "org-1",
        "project-1",
        "wf-123",
        expect.objectContaining({ enabled: false }),
      );
    },
  );

  it("leaves layout changes to native anchoring when hydration grows", async () => {
    DeferredIntersectionObserver.instances.length = 0;
    vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver);
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    hookMocks.useWorkItem.mockReturnValue(makeReadyWorkItemQuery(workflow));
    hookMocks.useWorkItems.mockReturnValue(
      makeReadyWorkItemsQuery([
        makeWorkflowStep({
          id: "step-1",
          name: "Draft release",
          parentTaskId: workflow.id,
        }),
      ]),
    );

    const unrelatedAncestor = document.createElement("div");
    const owner = document.createElement("div");
    unrelatedAncestor.appendChild(owner);
    document.body.appendChild(unrelatedAncestor);
    Object.defineProperty(owner, "scrollTop", {
      configurable: true,
      value: 40,
      writable: true,
    });
    let wrapperHeight = 220;
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    const geometrySpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === owner) {
          return { top: 0, height: 300 } as DOMRect;
        }
        if (this.dataset.testid === "workflow-inline-mention") {
          return { top: -100, height: wrapperHeight } as DOMRect;
        }
        return originalGetBoundingClientRect.call(this);
      });
    const windowScrollSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    const ownerRef: React.RefObject<HTMLElement | null> = { current: owner };
    const ownedWrapper: React.FC<{ children: React.ReactNode }> = ({
      children,
    }) => (
      <MemoryRouter>
        <ThemeProvider theme={createTheme()}>
          <ProjectContext.Provider
            value={{
              organizationId: "org-1",
              projectId: "project-1",
              navigate: vi.fn(),
            }}
          >
            <ConversationScrollPolicyContext.Provider
              value={{ mode: "owned", ownerRef }}
            >
              {children}
            </ConversationScrollPolicyContext.Provider>
          </ProjectContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    );

    try {
      const { unmount } = render(
        <WorkflowMentionInlineRenderer
          mention={{
            entityType: "workflow",
            entityId: workflow.id,
            entityName: workflow.name,
          }}
        />,
        { container: owner, wrapper: ownedWrapper },
      );

      const observer = DeferredIntersectionObserver.instances[0];
      expect(observer.options).toEqual({
        root: owner,
        rootMargin: "1500px 0px",
      });
      expect(owner.scrollTop).toBe(40);
      wrapperHeight = 420;
      act(() => observer?.trigger(true));

      await waitFor(() => {
        expect(
          screen.getByTestId("workflow-inline-diagram"),
        ).toBeInTheDocument();
      });
      // Native anchoring owns resize stability; the mention performs no scroll.
      expect(owner.scrollTop).toBe(40);
      expect(unrelatedAncestor.scrollTop).toBe(0);
      expect(windowScrollSpy).not.toHaveBeenCalled();
      unmount();
    } finally {
      geometrySpy.mockRestore();
      windowScrollSpy.mockRestore();
      unrelatedAncestor.remove();
    }
  });

  it("keeps a loaded workflow graph visible during background refreshes", async () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const step = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: workflow.id,
    });
    hookMocks.useWorkItem.mockReturnValue({
      ...makeReadyWorkItemQuery(workflow),
      isFetching: true,
    });
    hookMocks.useWorkItems.mockReturnValue({
      ...makeReadyWorkItemsQuery([step]),
      isFetching: true,
    });

    render(
      <WorkflowMentionInlineRenderer
        mention={{
          entityType: "workflow",
          entityId: workflow.id,
          entityName: workflow.name,
        }}
      />,
      { wrapper: projectWrapper },
    );

    await waitForDiagramArranged();
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Draft release",
    );
    expect(
      screen.queryByTestId("workflow-inline-diagram-loading"),
    ).not.toBeInTheDocument();
  });

  it("keeps loading until the first workflow-step query settles", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    hookMocks.useWorkItem.mockReturnValue(makeReadyWorkItemQuery(workflow));
    hookMocks.useWorkItems.mockReturnValue({
      ...makeReadyWorkItemsQuery(),
      isFetched: false,
      isReady: false,
    });

    render(
      <WorkflowMentionInlineRenderer
        mention={{
          entityType: "workflow",
          entityId: workflow.id,
          entityName: workflow.name,
        }}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-inline-diagram"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No workflow steps")).not.toBeInTheDocument();
  });

  it("renders an inline workflow diagram from loaded workflow steps and flow edges", async () => {
    const conditionalPredicate =
      "Needs revision before the launch announcement goes out";
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: "wf-123",
    });
    const secondStep = makeWorkflowStep({
      id: "step-2",
      name: "Review release",
      parentTaskId: "wf-123",
      sections: [
        {
          id: "step-2-description",
          key: "description",
          order: 0,
          materializedMarkdown:
            "Review the release plan, confirm launch risks, and decide whether the launch can proceed.",
          crdtSnapshotSeq: null,
        },
      ],
      edges: [
        makeEdge({
          id: "edge-fulfills",
          sourceNodeId: "step-2",
          targetNodeId: "task-fulfillment",
          type: AgentEdgeType.FulfilledBy,
          sourceNodeName: "Review release",
          targetNodeName: "Prepare launch checklist",
        }),
      ],
    });
    hookMocks.useWorkItem.mockImplementation(
      (
        _organizationId: string,
        _entityType: "initiative" | "task",
        workItemId: string,
      ) => {
        if (workItemId === workflow.id) {
          return makeReadyWorkItemQuery(workflow);
        }

        return makeReadyWorkItemQuery(null);
      },
    );
    hookMocks.useWorkItems.mockReturnValue({
      workItems: [
        {
          ...firstStep,
          edges: [
            makeEdge({
              id: "edge-flow",
              sourceNodeId: "step-1",
              targetNodeId: "step-2",
              type: AgentEdgeType.Standard,
              category: AgentEdgeCategory.Flow,
              direction: AgentEdgeDirection.Forward,
            }),
          ],
        },
        {
          ...secondStep,
          edges: [
            ...(secondStep.edges ?? []),
            makeEdge({
              id: "edge-conditional",
              sourceNodeId: "step-2",
              targetNodeId: "step-1",
              type: AgentEdgeType.Conditional,
              category: AgentEdgeCategory.Flow,
              direction: AgentEdgeDirection.Backward,
              predicate: conditionalPredicate,
            }),
          ],
        },
      ],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
    });
    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Launch workflow",
    );
    const workflowTitleLink = screen.getByTestId(
      "workflow-inline-diagram-title-link",
    );
    expect(workflowTitleLink).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/wf-123",
    );
    expect(workflowTitleLink).toHaveAttribute("data-entity-id", "wf-123");
    expect(workflowTitleLink).toHaveAttribute("data-entity-type", "workflow");
    expect(workflowTitleLink.tagName).toBe("A");
    expect(
      within(
        screen.getByTestId("workflow-inline-diagram-viewport"),
      ).queryByRole("link", { name: "Launch workflow" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
      "data-workflow-view-mode",
      "natural-size",
    );
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
      "data-workflow-graph-size",
      "medium",
    );
    expect(
      screen.getByTestId("workflow-inline-diagram-size-controls"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-inline-diagram-size-medium"),
    ).toHaveAttribute("aria-pressed", "true");
    const stepCards = screen.getAllByTestId("workflow-inline-step");
    const stepFrames = screen.getAllByTestId("workflow-inline-step-frame");
    expect(stepFrames).toHaveLength(2);
    expect(stepFrames[0]).toHaveStyle({
      height: "140px",
      width: "140px",
    });
    expect(stepCards).toHaveLength(2);
    expect(stepCards[0]).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/step-1",
    );
    expect(stepCards[0]).toHaveAttribute("data-step-id", "step-1");
    expect(stepCards[0]).toHaveStyle({
      boxSizing: "border-box",
      borderRadius: "4px",
      display: "block",
      height: "100%",
      width: "100%",
    });
    const interactionTargets = screen.getAllByTestId("interaction-component");
    expect(interactionTargets).toHaveLength(2);
    expect(interactionTargets[0]).toHaveAttribute("data-entity-id", "step-1");
    expect(interactionTargets[0]).toHaveAttribute("data-entity-type", "TASK");
    expect(interactionTargets[0]).toHaveAttribute(
      "data-entity-subtype",
      "workflow_step",
    );
    expect(interactionTargets[0]).toHaveAttribute(
      "data-id-scope",
      "workflow-graph",
    );
    expect(interactionTargets[0]).toHaveAttribute(
      "data-interaction-state",
      "idle",
    );
    fireEvent.mouseEnter(interactionTargets[0]);
    expect(interactionTargets[0]).toHaveAttribute(
      "data-interaction-state",
      "hovering",
    );
    fireEvent.mouseLeave(interactionTargets[0]);
    expect(interactionTargets[0]).toHaveAttribute(
      "data-interaction-state",
      "idle",
    );
    expect(
      screen.getByTestId("workflow-inline-diagram-zoom-out"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-inline-diagram-zoom-in"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-inline-diagram-fit-to-view"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft release")).toBeInTheDocument();
    expect(screen.getByText("Review release")).toBeInTheDocument();
    expect(screen.getAllByTestId("workflow-inline-step-title")[0]).toHaveStyle({
      minHeight: "2.1875rem",
      overflow: "hidden",
      whiteSpace: "normal",
    });
    expect(
      screen.getAllByTestId("workflow-inline-step-summary")[0],
    ).toHaveStyle({
      lineHeight: "1.35",
      overflow: "hidden",
      whiteSpace: "normal",
    });
    expect(
      screen.getAllByTestId("workflow-inline-step-title")[0],
    ).not.toHaveStyle({
      textOverflow: "ellipsis",
    });
    expect(
      screen.getAllByTestId("workflow-inline-step-summary")[0],
    ).not.toHaveStyle({
      textOverflow: "ellipsis",
    });
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Review the release plan, confirm launch risks, and decide whether the launch can proceed.",
    );
    expect(
      screen.getByTestId("workflow-inline-fulfilled-count"),
    ).toHaveAttribute("data-fulfilled-count", "1");
    expect(screen.getByTestId("workflow-inline-fulfilled-count")).toHaveStyle({
      left: "8px",
      bottom: "8px",
    });
    expect(
      buildWorkflowGraphModel({
        workflow,
        steps: [firstStep, secondStep],
        edges: [
          makeEdge({
            id: "edge-flow",
            sourceNodeId: "step-1",
            targetNodeId: "step-2",
            type: AgentEdgeType.Standard,
            category: AgentEdgeCategory.Flow,
            direction: AgentEdgeDirection.Forward,
          }),
        ],
      }).edges,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "edge-flow",
          source: "step-1",
          target: "step-2",
          data: expect.objectContaining({
            label: undefined,
            route: { kind: "mainline", lane: null, labelAnchor: "edge" },
            sizeMode: "medium",
          }),
          markerEnd: expect.objectContaining({ width: 16, height: 16 }),
          sourceHandle: "right",
          targetHandle: "left",
        }),
      ]),
    );
    const fulfilledOnlyModel = buildWorkflowGraphModel({
      workflow,
      steps: [secondStep],
      edges: secondStep.edges ?? [],
    });
    expect(fulfilledOnlyModel.edges).toHaveLength(0);
    expect(fulfilledOnlyModel.nodes[0]?.data).toMatchObject({
      entityId: "step-2",
      entityType: TargetEntityType.Task,
      entitySubtype: "workflow_step",
      entityTitle: "Review release",
      organizationId: "org-1",
      projectId: "project-1",
      href: "/projects/project-1/tasks/step-2",
      fulfilledByTargets: [
        {
          id: "task-fulfillment",
          title: "Prepare launch checklist",
        },
      ],
    });
    fireEvent.mouseOver(screen.getAllByTestId("workflow-inline-step")[1]);
    const fulfilledDetails = await screen.findByTestId(
      "workflow-inline-fulfilled-details",
    );
    expect(fulfilledDetails).toBeInTheDocument();
    expect(
      within(fulfilledDetails).getByText(
        "Review the release plan, confirm launch risks, and decide whether the launch can proceed.",
      ),
    ).toBeInTheDocument();
    expect(
      within(fulfilledDetails).getByText("Prepare launch checklist"),
    ).toBeInTheDocument();
    expect(
      within(fulfilledDetails).getByTestId("mention-badge"),
    ).toHaveTextContent("Prepare launch checklist");
  });

  it("applies workflow graph display size controls across inline and fullscreen views", async () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: workflow.id,
    });
    const secondStep = makeWorkflowStep({
      id: "step-2",
      name: "Review release",
      parentTaskId: workflow.id,
      sections: [
        {
          id: "step-2-description",
          key: "description",
          order: 0,
          materializedMarkdown:
            "Review the release plan, confirm risks, prepare a stakeholder-ready recommendation, and coordinate the launch handoff.",
          crdtSnapshotSeq: null,
        },
      ],
    });
    const graphData = {
      workflow,
      steps: [firstStep, secondStep],
      edges: [
        makeEdge({
          id: "edge-conditional",
          sourceNodeId: firstStep.id,
          targetNodeId: secondStep.id,
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "Only after launch risks are reviewed",
        }),
      ],
    } satisfies WorkflowGraphSurfaceData;

    render(<WorkflowGraphSurface graphData={graphData} allowFullscreen />, {
      wrapper: projectWrapper,
    });
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
      "data-workflow-graph-size",
      "medium",
    );
    expect(screen.getAllByTestId("workflow-inline-step-frame")[0]).toHaveStyle({
      height: "140px",
      width: "140px",
    });

    fireEvent.click(screen.getByTestId("workflow-inline-diagram-size-large"));
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
      "data-workflow-graph-size",
      "large",
    );
    expect(screen.getAllByTestId("workflow-inline-step-frame")[0]).toHaveStyle({
      height: "280px",
      width: "280px",
    });
    const largeModel = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      sizeMode: "large",
    });
    expect(largeModel.edges[0]?.data).toMatchObject({
      label: "Only after launch risks are reviewed",
      sizeMode: "large",
      sizeConfig: expect.objectContaining({
        edgeLabelWidth: 144,
      }),
    });

    fireEvent.click(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    );
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-fullscreen-diagram")).toHaveAttribute(
      "data-workflow-graph-size",
      "large",
    );
    expect(
      screen.getByTestId("workflow-fullscreen-diagram-size-large"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(screen.getByRole("dialog")).getAllByTestId(
        "workflow-inline-step-frame",
      )[0],
    ).toHaveStyle({
      height: "280px",
      width: "280px",
    });

    fireEvent.click(
      screen.getByTestId("workflow-fullscreen-diagram-size-small"),
    );
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
      "data-workflow-graph-size",
      "small",
    );
    expect(screen.getByTestId("workflow-fullscreen-diagram")).toHaveAttribute(
      "data-workflow-graph-size",
      "small",
    );
    expect(
      within(screen.getByRole("dialog")).getAllByTestId(
        "workflow-inline-step-frame",
      )[0],
    ).toHaveStyle({
      height: "104px",
      width: "104px",
    });
    expect(
      within(screen.getByRole("dialog")).getByText("Review release"),
    ).toHaveStyle({
      fontSize: "0.75rem",
      minHeight: "1.875rem",
      whiteSpace: "normal",
    });
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Review the release plan, confirm risks, prepare a stakeholder-ready recommendation, and coordinate the launch handoff.",
      ),
    ).toHaveStyle({
      fontSize: "0.6875rem",
      whiteSpace: "normal",
    });
  });

  it("renders workflow graph surfaces as read-only when links are disabled", async () => {
    const workflow = makeWorkflow({
      id: "wf-proposed",
      name: "Proposed workflow",
    });
    const step = makeWorkflowStep({
      id: "temp-step-review",
      name: "Review proposed step",
      parentTaskId: workflow.id,
      sections: [
        {
          id: "description-1",
          key: "description",
          order: 0,
          materializedMarkdown:
            "Check @[feature:feature-mention-nodes|Mention Nodes] before approval.",
          crdtSnapshotSeq: null,
        },
      ],
      edges: [
        makeEdge({
          id: "edge-fulfilled",
          sourceNodeId: "temp-step-review",
          targetNodeId: "task-fulfillment",
          targetNodeName: "Prepare launch checklist",
          type: AgentEdgeType.FulfilledBy,
        }),
      ],
    });
    const graphData = {
      workflow,
      steps: [step],
      edges: step.edges ?? [],
    };

    render(<WorkflowGraphSurface graphData={graphData} disableLinks />, {
      wrapper: projectWrapper,
    });
    await waitForDiagramArranged();

    const stepCard = screen.getByTestId("workflow-inline-step");
    expect(stepCard).toHaveAttribute("data-links-disabled", "true");
    expect(stepCard).not.toHaveAttribute("href");
    expect(
      screen.getByTestId("workflow-inline-diagram-title-link"),
    ).not.toHaveAttribute("href");
    expect(stepCard).toHaveStyle({ cursor: "default" });
    expect(
      screen.queryByTestId("interaction-component"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Mention Nodes" }),
    ).not.toBeInTheDocument();
    expect(stepCard).toHaveTextContent("Mention Nodes");

    const disabledModel = buildWorkflowGraphModel(graphData, {
      disableLinks: true,
    });
    expect(disabledModel.nodes[0]?.data.disableLinks).toBe(true);

    fireEvent.mouseOver(stepCard);
    const fulfilledDetails = await screen.findByTestId(
      "workflow-inline-fulfilled-details",
    );
    expect(
      within(fulfilledDetails).queryByTestId("mention-badge"),
    ).not.toBeInTheDocument();
    expect(fulfilledDetails).toHaveTextContent("Prepare launch checklist");
  });

  it("keeps Contract links as icons without synthetic nodes or layout space", async () => {
    const workflow = makeTask({
      id: "diagram-contracts",
      name: "Contract diagram",
      type: "DIAGRAM",
    });
    const step = makeTask({
      id: "element-provider",
      name: "Provider",
      parentTaskId: workflow.id,
      type: "DIAGRAM_ELEMENT",
    });
    const edges = [
      AgentEdgeType.DependsOn,
      AgentEdgeType.Guarantees,
      AgentEdgeType.Implements,
      AgentEdgeType.Consumes,
    ].map((type, index) =>
      makeEdge({
        id: `participation-${index}`,
        sourceNodeId: step.id,
        targetNodeId: `agreement-${index}`,
        targetNodeName: `Agreement ${index}`,
        targetNodeType: "CONTRACT",
        targetEntityType: AgentEdgeEndpointEntityType.Task,
        type,
        category: AgentEdgeCategory.Meta,
      }),
    );
    const graphData = {
      workflow,
      steps: [step],
      edges,
      derivedReferences: [
        {
          expansionKey: "contractLinkedWorkflows",
          projectionKind: "workItemReference",
          entityId: "other-diagram",
          entityType: "TASK",
          workItemTypeKey: "diagram",
          displayName: "Other diagram",
          viaEntityIds: ["agreement-0"],
        },
      ],
    };
    const baseline = buildWorkflowGraphModel({
      workflow,
      steps: [step],
      edges: [],
    });
    for (const sizeMode of ["small", "medium", "large"] as const) {
      const model = buildWorkflowGraphModel(graphData, { sizeMode });
      const empty = buildWorkflowGraphModel(
        { workflow, steps: [step], edges: [] },
        { sizeMode },
      );
      expect(model.nodes.map((node) => node.id)).toEqual([step.id]);
      expect(model.edges).toEqual([]);
      expect([model.width, model.canvasHeight]).toEqual([
        empty.width,
        empty.canvasHeight,
      ]);
      expect(
        model.nodes[0]?.data.directEntityLinks.map(
          (link) => link.targetEntityId,
        ),
      ).toEqual(edges.map((edge) => edge.targetNodeId));
    }
    expect(baseline.nodes).toHaveLength(1);
    render(<WorkflowGraphSurface graphData={graphData} allowFullscreen />, {
      wrapper: projectWrapper,
    });
    await waitForDiagramArranged();
    expect(
      screen.queryByTestId("workflow-contract-node"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-external-node"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diagram-element-direct-link")).toHaveLength(
      4,
    );
    fireEvent.click(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    );
    await waitForDiagramArranged();
    expect(
      within(screen.getByRole("dialog")).queryByTestId(
        "workflow-contract-node",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).queryByTestId(
        "workflow-external-node",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getAllByTestId(
        "diagram-element-direct-link",
      ),
    ).toHaveLength(4);
  });

  it("projects Contract relationship metadata without turning it into flow", () => {
    const rootIdentity = {
      refType: "existing" as const,
      id: "projected-workflow",
    };
    const stepIdentity = {
      refType: "existing" as const,
      id: "projected-step",
    };
    const contractIdentity = {
      refType: "existing" as const,
      id: "projected-contract",
    };
    const projection: WorkItemGraphProjectionData = {
      layoutSource: "authored",
      projectedRoot: {
        identity: rootIdentity,
        label: "Projected workflow",
        name: "Projected workflow",
        type: "workflow",
        sections: [],
        deleted: false,
      },
      children: [
        {
          identity: stepIdentity,
          label: "Authorize remote read",
          name: "Authorize remote read",
          type: "workflow_step",
          parent: rootIdentity,
          sections: [],
          deleted: false,
        },
      ],
      incidentRelationships: [
        {
          identity: { refType: "temporary", tempId: "contract-link" },
          label: AgentEdgeType.DependsOn,
          source: stepIdentity,
          target: contractIdentity,
          targetEntityType: "TASK",
          edgeType: AgentEdgeType.DependsOn,
          category: AgentEdgeCategory.Meta,
          metadata: {
            targetNodeName: "Remote read authorization contract",
            targetNodeType: "CONTRACT",
          },
          deleted: false,
        },
      ],
      identityLabels: {
        "existing:projected-workflow": "Projected workflow",
        "existing:projected-step": "Authorize remote read",
      },
      effectiveLayout: {
        nodes: [{ node: stepIdentity, position: { x: 80, y: 90 } }],
      },
    };

    const graphData = projectWorkItemGraphForWorkflowSurface(projection, {
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(graphData.edges).toEqual([
      expect.objectContaining({
        sourceNodeId: "projected-step",
        sourceNodeName: "Authorize remote read",
        targetNodeId: "projected-contract",
        targetNodeName: "Remote read authorization contract",
        targetNodeType: "CONTRACT",
        type: AgentEdgeType.DependsOn,
        category: AgentEdgeCategory.Meta,
      }),
    ]);
    expect(buildWorkflowGraphModel(graphData).edges).toEqual([]);
    expect(
      buildWorkflowGraphModel(graphData).nodes.map((node) => node.id),
    ).toEqual(["projected-step"]);

    render(<WorkflowGraphSurface projection={projection} />, {
      wrapper: projectWrapper,
    });
    expect(
      screen.queryByTestId("workflow-contract-node"),
    ).not.toBeInTheDocument();
  });

  it("names element links to existing targets from existing-keyed labels", () => {
    const rootIdentity = { refType: "existing" as const, id: "diagram-root" };
    const elementIdentity = {
      refType: "existing" as const,
      id: "diagram-element",
    };
    const projection: WorkItemGraphProjectionData = {
      layoutSource: "authored",
      projectedRoot: {
        identity: rootIdentity,
        label: "Checkout diagram",
        name: "Checkout diagram",
        type: "DIAGRAM",
        sections: [],
        deleted: false,
      },
      children: [
        {
          identity: elementIdentity,
          label: "Checkout controller",
          name: "Checkout controller",
          type: "DIAGRAM_ELEMENT",
          parent: rootIdentity,
          sections: [],
          deleted: false,
        },
      ],
      incidentRelationships: [
        {
          identity: { refType: "temporary", tempId: "mockup-link" },
          label: AgentEdgeType.RelatedTo,
          source: elementIdentity,
          target: { refType: "existing", id: "existing-mockup" },
          targetEntityType: "TASK",
          edgeType: AgentEdgeType.RelatedTo,
          category: AgentEdgeCategory.Meta,
          deleted: false,
        },
        {
          identity: { refType: "temporary", tempId: "contract-link" },
          label: AgentEdgeType.Guarantees,
          source: elementIdentity,
          target: { refType: "existing", id: "existing-contract" },
          targetEntityType: "TASK",
          edgeType: AgentEdgeType.Guarantees,
          category: AgentEdgeCategory.Meta,
          deleted: false,
        },
      ],
      identityLabels: {
        "existing:diagram-root": "Checkout diagram",
        "existing:diagram-element": "Checkout controller",
        "existing:existing-mockup": "Checkout mockup",
        "existing:existing-contract": "Checkout contract",
      },
    };

    const graphData = projectWorkItemGraphForWorkflowSurface(projection, {
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(graphData.workflow.projectId).toBe("project-1");
    expect(graphData.edges).toEqual([
      expect.objectContaining({
        sourceNodeName: "Checkout controller",
        targetNodeId: "existing-mockup",
        targetNodeName: "Checkout mockup",
      }),
      expect.objectContaining({
        sourceNodeName: "Checkout controller",
        targetNodeId: "existing-contract",
        targetNodeName: "Checkout contract",
      }),
    ]);
  });

  it("renders a configured non-workflow projection through the shared surface", () => {
    const rootIdentity = { refType: "existing", id: "approval-board" } as const;
    const firstIdentity = { refType: "existing", id: "approval-one" } as const;
    const secondIdentity = { refType: "existing", id: "approval-two" } as const;
    const projection: WorkItemGraphProjectionData = {
      layoutSource: "authored",
      projectedRoot: {
        identity: rootIdentity,
        label: "Approval board",
        name: "Approval board",
        type: "APPROVAL_BOARD",
        sections: [],
        deleted: false,
      },
      children: [
        {
          identity: firstIdentity,
          label: "Draft approval",
          name: "Draft approval",
          type: "APPROVAL_CARD",
          parent: rootIdentity,
          sections: [],
          deleted: false,
        },
        {
          identity: secondIdentity,
          label: "Publish approval",
          name: "Publish approval",
          type: "APPROVAL_CARD",
          parent: rootIdentity,
          sections: [],
          deleted: false,
        },
      ],
      incidentRelationships: [
        {
          identity: { refType: "existing", id: "approval-edge" },
          label: AgentEdgeType.Standard,
          source: firstIdentity,
          target: secondIdentity,
          edgeType: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          deleted: false,
        },
      ],
      effectiveLayout: {
        nodes: [
          { node: firstIdentity, position: { x: 80, y: 90 } },
          { node: secondIdentity, position: { x: 420, y: 90 } },
        ],
      },
    };

    render(
      <WorkflowGraphSurface
        projection={projection}
        createdElements={{
          children: [secondIdentity],
          relationships: [{ refType: "existing", id: "approval-edge" }],
        }}
        organizationId="org-1"
        projectId="project-1"
        allowFullscreen
      />,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toBeInTheDocument();
    expect(screen.getByText("Approval board")).toBeInTheDocument();
    expect(screen.getByText("Draft approval")).toBeInTheDocument();
    expect(screen.getByText("Publish approval")).toBeInTheDocument();
    expect(screen.getAllByTestId("workflow-inline-step")[0]).toHaveAttribute(
      "data-step-created",
      "false",
    );
    expect(screen.getAllByTestId("workflow-inline-step")[1]).toHaveAttribute(
      "data-step-created",
      "true",
    );
    const inlineFirstNode = screen
      .getAllByTestId("workflow-inline-step")[0]
      ?.closest(".react-flow__node");
    expect((inlineFirstNode as HTMLElement).style.transform).toBe(
      "translate(80px,90px)",
    );

    fireEvent.click(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    );

    const fullscreenFirstNode = within(screen.getByRole("dialog"))
      .getAllByTestId("workflow-inline-step")[0]
      ?.closest(".react-flow__node");
    expect((fullscreenFirstNode as HTMLElement).style.transform).toBe(
      "translate(80px,90px)",
    );
    expect(
      within(screen.getByRole("dialog")).getAllByTestId(
        "workflow-inline-step",
      )[1],
    ).toHaveAttribute("data-step-created", "true");
  });

  it("renders the unavailable state when a workflow destination is missing", () => {
    const workflow = makeWorkflow({
      id: "wf-missing-project",
      name: "Workflow without a destination",
      projectId: "",
    });

    render(
      <WorkflowGraphSurface graphData={{ workflow, steps: [], edges: [] }} />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-unavailable"),
    ).toHaveTextContent("Workflow graph unavailable");
    expect(
      screen.queryByRole("link", { name: "Workflow without a destination" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("wf-missing-project")).not.toBeInTheDocument();
  });

  it("carries a highlighted step id into graph model node data", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: workflow.id,
    });
    const highlightedStep = makeWorkflowStep({
      id: "step-2",
      name: "Review release",
      parentTaskId: workflow.id,
    });

    const defaultModel = buildWorkflowGraphModel({
      workflow,
      steps: [firstStep, highlightedStep],
      edges: [],
    });
    expect(getNodeData(defaultModel, "step-1")?.isHighlighted).toBe(false);
    expect(getNodeData(defaultModel, "step-2")?.isHighlighted).toBe(false);

    const highlightedModel = buildWorkflowGraphModel(
      {
        workflow,
        steps: [firstStep, highlightedStep],
        edges: [],
      },
      {
        disableLinks: false,
        highlightedStepId: highlightedStep.id,
      },
    );
    expect(getNodeData(highlightedModel, "step-1")?.isHighlighted).toBe(false);
    expect(getNodeData(highlightedModel, "step-2")?.isHighlighted).toBe(true);
  });

  it("composes active flow-edge endpoints with explicit highlights", () => {
    const workflow = makeWorkflow({
      id: "wf-active-edge",
      name: "Active edge workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-first",
      name: "First step",
      parentTaskId: workflow.id,
    });
    const secondStep = makeWorkflowStep({
      id: "step-second",
      name: "Second step",
      parentTaskId: workflow.id,
      sections: [
        {
          id: "step-second-presentation",
          key: "graphPresentation",
          order: 0,
          materializedMarkdown: JSON.stringify({
            schemaVersion: "work-item-graph-node-presentation.v1",
            color: "#123456",
          }),
          crdtSnapshotSeq: null,
        },
      ],
    });
    const thirdStep = makeWorkflowStep({
      id: "step-third",
      name: "Third step",
      parentTaskId: workflow.id,
    });
    const firstEdge = makeEdge({
      id: "edge-first-second",
      sourceNodeId: firstStep.id,
      targetNodeId: secondStep.id,
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    });
    const secondEdge = makeEdge({
      id: "edge-second-third",
      sourceNodeId: secondStep.id,
      targetNodeId: thirdStep.id,
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    });
    const graphData = {
      workflow,
      steps: [firstStep, secondStep, thirdStep],
      edges: [firstEdge, secondEdge],
    };

    const baseModel = buildWorkflowGraphModel(graphData);
    const firstEdgeModel = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      highlightedEdgeId: firstEdge.id,
      highlightedStepId: thirdStep.id,
    });
    expect(
      [firstStep, secondStep, thirdStep].map(
        (step) => getNodeData(firstEdgeModel, step.id)?.isHighlighted,
      ),
    ).toEqual([true, true, true]);
    expect(getNodeData(firstEdgeModel, secondStep.id)?.authoredColor).toBe(
      "#123456",
    );
    expect(
      firstEdgeModel.nodes.find((node) => node.id === firstStep.id)?.zIndex,
    ).toBe(2);
    expect(
      baseModel.nodes.find((node) => node.id === firstStep.id)?.zIndex,
    ).toBe(1);
    expect(firstEdgeModel.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstEdge.id,
          data: expect.objectContaining({ isHighlighted: true }),
        }),
        expect.objectContaining({
          id: secondEdge.id,
          data: expect.objectContaining({ isHighlighted: false }),
        }),
      ]),
    );

    const secondEdgeModel = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      highlightedEdgeId: secondEdge.id,
      highlightedStepId: thirdStep.id,
    });
    expect(
      [firstStep, secondStep, thirdStep].map(
        (step) => getNodeData(secondEdgeModel, step.id)?.isHighlighted,
      ),
    ).toEqual([false, true, true]);
    expect(getNodeData(secondEdgeModel, secondStep.id)?.authoredColor).toBe(
      "#123456",
    );

    const clearedModel = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      highlightedStepId: thirdStep.id,
    });
    expect(
      [firstStep, secondStep, thirdStep].map(
        (step) => getNodeData(clearedModel, step.id)?.isHighlighted,
      ),
    ).toEqual([false, false, true]);
    expect(clearedModel.edges.map((edge) => edge.data?.isHighlighted)).toEqual([
      false,
      false,
    ]);
    expect(firstEdgeModel.nodes.map((node) => node.position)).toEqual(
      baseModel.nodes.map((node) => node.position),
    );
  });

  it.each(["inline", "fullscreen"] as const)(
    "reconciles edge hover after missed leave events in the %s viewport",
    async (variant) => {
      const measure = mockFlowMeasurements();
      const graph = makeLinearWorkflowGraph(4, "hover-cleanup");
      graph.edges = graph.edges.map((edge, index) => ({
        ...edge,
        type: AgentEdgeType.Conditional,
        predicate: `Relationship ${index + 1}`,
      }));
      graph.steps[0].sections = [
        {
          id: "hover-presentation",
          key: "graphPresentation",
          order: 0,
          materializedMarkdown: JSON.stringify({
            schemaVersion: "work-item-graph-node-presentation.v1",
            color: "#123456",
          }),
          crdtSnapshotSeq: null,
        },
      ];
      render(
        <WorkflowGraphSurface
          graphData={graph}
          highlightedStepId={graph.steps[3].id}
          allowFullscreen
          disableLinks
        />,
        { wrapper: projectWrapper },
      );
      await waitForDiagramArranged();
      if (variant === "fullscreen") {
        fireEvent.click(
          screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
        );
        await waitForDiagramArranged();
      }
      measure();
      const viewport = screen.getByTestId(
        `workflow-${variant}-diagram-viewport`,
      );
      await within(viewport).findAllByTestId("workflow-inline-edge-hit-area");
      const hits = () =>
        within(viewport).getAllByTestId("workflow-inline-edge-hit-area");
      expect(
        within(viewport).getAllByTestId("workflow-inline-edge-label"),
      ).toHaveLength(3);
      await waitFor(() =>
        expect(screen.queryAllByRole("status")).toHaveLength(0),
      );
      const cards = within(viewport).getAllByTestId("workflow-inline-step");
      const positions = cards.map((card) =>
        card.closest(".react-flow__node")?.getAttribute("style"),
      );
      const expectHighlights = async (
        activeEdge: number | undefined,
        nodes: boolean[],
      ) =>
        waitFor(() => {
          hits().forEach((hit, index) =>
            expect(hit).toHaveAttribute(
              "data-edge-highlighted",
              String(index === activeEdge),
            ),
          );
          cards.forEach((card, index) =>
            expect(card).toHaveAttribute(
              "data-step-highlighted",
              String(nodes[index]),
            ),
          );
        });
      const expectTooltip = async () => {
        const tooltips = await screen.findAllByTestId(
          "workflow-inline-edge-label-tooltip",
        );
        tooltips.forEach((tooltip) =>
          expect(tooltip).toHaveTextContent("Relationship 1"),
        );
        // A tooltip above the SVG must not intercept its edge's pointer and
        // repeatedly close/reopen the shared edge and endpoint highlight.
        tooltips.forEach((tooltip) =>
          expect(tooltip.closest(".MuiTooltip-popper")).toHaveStyle({
            pointerEvents: "none",
          }),
        );
      };
      const expectDismissed = async () => {
        await waitFor(() =>
          expect(
            screen.queryAllByTestId("workflow-inline-edge-label-tooltip"),
          ).toHaveLength(0),
        );
        await expectHighlights(undefined, [false, false, false, true]);
      };

      const initialHitAreas = hits();
      fireEvent.mouseEnter(initialHitAreas[0]);
      await expectHighlights(0, [true, true, false, true]);
      // Hover changes presentation, not node geometry. React Flow must keep
      // the measured nodes and their edge hit paths mounted throughout it.
      hits().forEach((hit, index) =>
        expect(hit === initialHitAreas[index]).toBe(true),
      );
      await expectTooltip();
      // Chrome reproduced edge over/move events without an edge out event
      // before the next pointer sample reached empty canvas.
      fireEvent.pointerMove(viewport);
      await expectDismissed();

      fireEvent.mouseEnter(hits()[0]);
      await expectHighlights(0, [true, true, false, true]);
      fireEvent.pointerMove(hits()[1]);
      await expectHighlights(1, [false, true, true, true]);
      await waitFor(() => {
        const tooltips = screen.getAllByTestId(
          "workflow-inline-edge-label-tooltip",
        );
        tooltips.forEach((tooltip) =>
          expect(tooltip).toHaveTextContent("Relationship 2"),
        );
      });
      // A delayed leave for the old edge must not clear the new one.
      fireEvent.mouseLeave(hits()[0]);
      await expectHighlights(1, [false, true, true, true]);
      fireEvent.pointerLeave(viewport);
      await expectDismissed();

      const labels = within(viewport).getAllByTestId(
        "workflow-inline-edge-label",
      );
      fireEvent.mouseEnter(labels[0]);
      await expectHighlights(0, [true, true, false, true]);
      fireEvent.pointerMove(
        within(
          within(viewport).getAllByTestId("workflow-inline-edge-label")[0],
        ).getByText("Relationship 1"),
      );
      await expectHighlights(0, [true, true, false, true]);
      await expectTooltip();
      fireEvent.pointerMove(cards[0]);
      await expectHighlights(0, [true, false, false, true]);
      await waitFor(() =>
        expect(
          screen.queryAllByTestId("workflow-inline-edge-label-tooltip"),
        ).toHaveLength(0),
      );
      fireEvent.mouseEnter(cards[0]);
      await expectHighlights(0, [true, false, false, true]);

      fireEvent.mouseEnter(
        within(viewport).getAllByTestId("workflow-inline-edge-label")[0],
      );
      await expectHighlights(0, [true, true, false, true]);
      fireEvent.mouseLeave(
        within(viewport).getAllByTestId("workflow-inline-edge-label")[0],
      );
      await expectDismissed();

      fireEvent.mouseEnter(hits()[0]);
      await expectHighlights(0, [true, true, false, true]);
      fireEvent.pointerLeave(viewport);
      await expectDismissed();
      fireEvent.mouseEnter(hits()[0]);
      await expectHighlights(0, [true, true, false, true]);
      fireEvent.pointerCancel(viewport);
      await expectDismissed();
      expect(cards[0]).toHaveStyle({ border: "1px solid #123456" });
      expect(
        cards.map((card) =>
          card.closest(".react-flow__node")?.getAttribute("style"),
        ),
      ).toEqual(positions);
    },
  );

  it.each(["inline", "fullscreen"] as const)(
    "highlights incident edges on node hover in the %s viewport",
    async (variant) => {
      const measure = mockFlowMeasurements();
      const graph = makeLinearWorkflowGraph(4, "node-hover");
      graph.edges = graph.edges.map((edge, index) => ({
        ...edge,
        type: AgentEdgeType.Conditional,
        predicate: `Relationship ${index + 1}`,
      }));
      render(
        <WorkflowGraphSurface
          graphData={graph}
          highlightedStepId={graph.steps[3].id}
          allowFullscreen
          disableLinks
        />,
        { wrapper: projectWrapper },
      );
      await waitForDiagramArranged();
      if (variant === "fullscreen") {
        fireEvent.click(
          screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
        );
        await waitForDiagramArranged();
      }
      measure();
      const viewport = screen.getByTestId(
        `workflow-${variant}-diagram-viewport`,
      );
      await within(viewport).findAllByTestId("workflow-inline-edge-hit-area");
      const cards = within(viewport).getAllByTestId("workflow-inline-step");
      const expectHighlights = async (edges: boolean[], nodes: boolean[]) => {
        await waitFor(() => {
          within(viewport)
            .getAllByTestId("workflow-inline-edge-hit-area")
            .forEach((hit, index) =>
              expect(hit).toHaveAttribute(
                "data-edge-highlighted",
                String(edges[index]),
              ),
            );
          cards.forEach((card, index) =>
            expect(card).toHaveAttribute(
              "data-step-highlighted",
              String(nodes[index]),
            ),
          );
        });
      };
      fireEvent.mouseEnter(cards[1]);
      await expectHighlights([true, true, false], [false, true, false, true]);
      expect(
        screen.queryByTestId("workflow-inline-edge-label-tooltip"),
      ).not.toBeInTheDocument();
      fireEvent.pointerMove(cards[1]);
      await expectHighlights([true, true, false], [false, true, false, true]);
      fireEvent.mouseLeave(cards[1]);
      fireEvent.mouseEnter(cards[2]);
      await expectHighlights([false, true, true], [false, false, true, true]);
      fireEvent.mouseLeave(cards[2]);
      await expectHighlights(
        [false, false, false],
        [false, false, false, true],
      );
      fireEvent.mouseEnter(cards[1]);
      fireEvent.pointerLeave(viewport);
      await expectHighlights(
        [false, false, false],
        [false, false, false, true],
      );
    },
  );

  it("carries authored workflow-step color separately from highlighting", () => {
    const workflow = makeWorkflow({
      id: "wf-authored-color",
      name: "Authored color workflow",
    });
    const coloredStep = makeWorkflowStep({
      id: "step-colored",
      name: "Colored step",
      parentTaskId: workflow.id,
      sections: [
        {
          id: "step-colored-presentation",
          key: "graphPresentation",
          order: 0,
          materializedMarkdown: JSON.stringify({
            schemaVersion: "work-item-graph-node-presentation.v1",
            color: "#123456",
          }),
          crdtSnapshotSeq: null,
        },
      ],
    });

    const model = buildWorkflowGraphModel(
      { workflow, steps: [coloredStep], edges: [] },
      { highlightedStepId: coloredStep.id },
    );

    expect(getNodeData(model, coloredStep.id)).toMatchObject({
      authoredColor: "#123456",
      isHighlighted: true,
    });
  });

  it("marks proposal-created workflow nodes and edges for success styling", () => {
    const workflow = makeWorkflow({
      id: "wf-created-review",
      name: "Created-element review",
    });
    const existingStep = makeWorkflowStep({
      id: "step-existing",
      name: "Existing step",
      parentTaskId: workflow.id,
    });
    const createdStep = makeWorkflowStep({
      id: "temporary:check-prices",
      name: "Check prices",
      parentTaskId: workflow.id,
    });
    const createdEdge = makeEdge({
      id: "temporary:existing-to-check-prices",
      sourceNodeId: existingStep.id,
      targetNodeId: createdStep.id,
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    });

    const model = buildWorkflowGraphModel(
      {
        workflow,
        steps: [existingStep, createdStep],
        edges: [createdEdge],
      },
      {
        disableLinks: true,
        createdNodeIds: new Set([createdStep.id]),
        createdEdgeIds: new Set([createdEdge.id]),
        createdEdgeColor: "rgb(46, 125, 50)",
      },
    );

    expect(getNodeData(model, existingStep.id)?.isCreated).toBe(false);
    expect(getNodeData(model, createdStep.id)?.isCreated).toBe(true);
    expect(model.edges[0]).toMatchObject({
      data: { isCreated: true },
      markerEnd: { color: "rgb(46, 125, 50)" },
    });
  });

  it("keeps authored CREATE elements neutral while preserving added metadata", () => {
    const workflow = makeWorkflow({
      id: "wf-authored-create-review",
      name: "Authored CREATE review",
    });
    const authoredStep = makeWorkflowStep({
      id: "temporary:authored-step",
      name: "Authored step",
      parentTaskId: workflow.id,
    });
    const authoredEdge = makeEdge({
      id: "temporary:authored-edge",
      sourceNodeId: authoredStep.id,
      targetNodeId: authoredStep.id,
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    });
    const successColor = "rgb(46, 125, 50)";

    const model = buildWorkflowGraphModel(
      {
        workflow,
        steps: [authoredStep],
        edges: [authoredEdge],
      },
      {
        disableLinks: true,
        presentationState: "authored",
        createdNodeIds: new Set([authoredStep.id]),
        createdEdgeIds: new Set([authoredEdge.id]),
        diffStatusByNodeId: new Map([[authoredStep.id, "added"]]),
        diffStatusByEdgeId: new Map([[authoredEdge.id, "added"]]),
        createdEdgeColor: successColor,
        diffEdgeColors: {
          added: successColor,
          changed: successColor,
          deleted: "rgb(211, 47, 47)",
        },
      },
    );

    expect(getNodeData(model, authoredStep.id)).toMatchObject({
      isCreated: true,
      diffStatus: "added",
      presentationState: "authored",
    });
    expect(model.edges[0]).toMatchObject({
      data: {
        isCreated: true,
        diffStatus: "added",
        presentationState: "authored",
      },
    });
    expect(model.edges[0]?.markerEnd).not.toHaveProperty("color");
    expect(model.edges[0]?.style).not.toHaveProperty("stroke", successColor);
  });

  it("renders authored CREATE edge labels with neutral styling", () => {
    render(
      <WorkflowEdgeLabel
        label="Authored relationship"
        labelX={120}
        labelY={80}
        diffStatus="added"
        presentationState="authored"
      />,
      { wrapper },
    );

    const edgeLabel = screen.getByTestId("workflow-inline-edge-label");
    expect(edgeLabel).not.toHaveStyle({ border: "1px solid #2e7d32" });
    expect(within(edgeLabel).getByText("Authored relationship")).toHaveStyle({
      color: "rgba(0, 0, 0, 0.6)",
    });
  });

  it("renders authored CREATE node cards with neutral styling", async () => {
    const workflow = makeWorkflow({
      id: "wf-authored-card-review",
      name: "Authored card review",
    });
    const authoredStep = makeWorkflowStep({
      id: "temporary:authored-card",
      name: "Authored card",
      parentTaskId: workflow.id,
    });

    render(
      <WorkflowGraphSurface
        graphData={{ workflow, steps: [authoredStep], edges: [] }}
        presentationState="authored"
        createdElements={{
          children: [{ refType: "existing", id: authoredStep.id }],
          relationships: [],
        }}
        diffElements={{
          added: {
            children: [{ refType: "existing", id: authoredStep.id }],
            relationships: [],
          },
          changed: { children: [], relationships: [] },
          deleted: { children: [], relationships: [] },
        }}
        disableLinks
      />,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    const stepCard = screen.getByTestId("workflow-inline-step");
    expect(stepCard).toHaveAttribute("data-step-created", "true");
    expect(stepCard).toHaveAttribute("data-step-diff", "added");
    expect(stepCard).toHaveAttribute("data-step-presentation", "authored");
    expect(stepCard).toHaveStyle({
      border: "1px solid rgb(224, 224, 224)",
      backgroundColor: "rgb(255, 255, 255)",
    });
  });

  it("uses green for changed graph elements and red for deleted elements", () => {
    const workflow = makeWorkflow({
      id: "wf-diff-review",
      name: "Diff review",
    });
    const changedStep = makeWorkflowStep({
      id: "step-changed",
      name: "Changed step",
      parentTaskId: workflow.id,
    });
    const deletedStep = makeWorkflowStep({
      id: "step-deleted",
      name: "Deleted step",
      parentTaskId: workflow.id,
    });
    const changedEdge = makeEdge({
      id: "edge-changed",
      sourceNodeId: changedStep.id,
      targetNodeId: deletedStep.id,
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    });
    const deletedEdge = makeEdge({
      id: "edge-deleted",
      sourceNodeId: deletedStep.id,
      targetNodeId: changedStep.id,
      type: AgentEdgeType.Conditional,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Backward,
      predicate: "Retry",
    });

    const model = buildWorkflowGraphModel(
      {
        workflow,
        steps: [changedStep, deletedStep],
        edges: [changedEdge, deletedEdge],
      },
      {
        disableLinks: true,
        diffStatusByNodeId: new Map([
          [changedStep.id, "changed"],
          [deletedStep.id, "deleted"],
        ]),
        diffStatusByEdgeId: new Map([
          [changedEdge.id, "changed"],
          [deletedEdge.id, "deleted"],
        ]),
        diffEdgeColors: {
          added: "rgb(46, 125, 50)",
          changed: "rgb(46, 125, 50)",
          deleted: "rgb(211, 47, 47)",
        },
      },
    );

    expect(getNodeData(model, changedStep.id)?.diffStatus).toBe("changed");
    expect(getNodeData(model, deletedStep.id)?.diffStatus).toBe("deleted");
    expect(
      model.edges.find((edge) => edge.id === changedEdge.id),
    ).toMatchObject({
      data: { diffStatus: "changed" },
      markerEnd: { color: "rgb(46, 125, 50)" },
      style: { stroke: "rgb(46, 125, 50)" },
    });
    expect(
      model.edges.find((edge) => edge.id === deletedEdge.id),
    ).toMatchObject({
      data: {
        diffStatus: "deleted",
        edgeType: AgentEdgeType.Conditional,
      },
      markerEnd: undefined,
      style: { stroke: "rgb(211, 47, 47)", strokeDasharray: "6 4" },
    });
  });

  it("renders a high-contrast conditional target marker in normal and highlighted states", () => {
    const { rerender } = render(
      <svg>
        <WorkflowConditionalTargetMarker
          edgeId="edge-conditional"
          isHighlighted={false}
          strokeColor="rgba(0, 0, 0, 0.6)"
          targetPosition={Position.Left}
          targetX={100}
          targetY={50}
        />
      </svg>,
      { wrapper },
    );

    const marker = screen.getByTestId("workflow-conditional-target-marker");
    expect(marker).toHaveAttribute("data-edge-id", "edge-conditional");
    expect(marker).toHaveAttribute("data-edge-highlighted", "false");
    expect(marker).toHaveAttribute("points", "100,50 82,42 82,58");
    expect(marker).toHaveAttribute("fill", "rgba(0, 0, 0, 0.6)");
    expect(marker).toHaveAttribute("stroke", "#fff");
    expect(marker).toHaveAttribute("stroke-width", "2");

    rerender(
      <svg>
        <WorkflowConditionalTargetMarker
          edgeId="edge-conditional"
          isHighlighted
          strokeColor="#1976d2"
          targetPosition={Position.Left}
          targetX={100}
          targetY={50}
        />
      </svg>,
    );

    expect(marker).toHaveAttribute("data-edge-highlighted", "true");
    expect(marker).toHaveAttribute("fill", "#1976d2");
    expect(marker).toHaveAttribute("points", "100,50 82,42 82,58");
  });

  it("marks editable workflow graph nodes as reconnect drop targets", () => {
    const workflow = makeWorkflow({
      id: "wf-editable",
      name: "Editable workflow",
    });
    const step = makeWorkflowStep({
      id: "step-editable",
      name: "Drag me",
      parentTaskId: workflow.id,
    });

    const model = buildWorkflowGraphModel(
      { workflow, steps: [step], edges: [] },
      { editable: true },
    );

    expect(model.nodes[0]).toMatchObject({
      draggable: true,
      data: {
        isDropTarget: false,
      },
    });
  });

  it("renders highlighted workflow steps with a distinct card treatment", async () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: workflow.id,
    });
    const highlightedStep = makeWorkflowStep({
      id: "step-2",
      name: "Review release",
      parentTaskId: workflow.id,
      sections: [
        {
          id: "step-2-description",
          key: "description",
          order: 0,
          materializedMarkdown:
            "Review the release plan, confirm launch risks, and coordinate the handoff.",
          crdtSnapshotSeq: null,
        },
      ],
    });
    const graphData = {
      workflow,
      steps: [firstStep, highlightedStep],
      edges: [],
    };

    render(
      <WorkflowGraphSurface
        graphData={graphData}
        highlightedStepId={highlightedStep.id}
        allowFullscreen
      />,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    const stepCards = screen.getAllByTestId("workflow-inline-step");
    expect(stepCards[0]).toHaveAttribute("data-step-id", "step-1");
    expect(stepCards[0]).toHaveAttribute("data-step-highlighted", "false");
    expect(stepCards[1]).toHaveAttribute("data-step-id", "step-2");
    expect(stepCards[1]).toHaveAttribute("data-step-highlighted", "true");
    expect(stepCards[1]).toHaveStyle({
      border: "2px solid #1976d2",
      boxSizing: "border-box",
      backgroundColor: "rgb(255, 255, 255)",
    });
    expect(stepCards[1].closest(".react-flow__node")).toHaveStyle({
      zIndex: "2",
    });
    expect(within(stepCards[0]).getByText("Draft release")).toHaveStyle({
      color: "rgba(0, 0, 0, 0.87)",
    });
    expect(within(stepCards[1]).getByText("Review release")).toHaveStyle({
      color: "#1976d2",
    });
    expect(
      within(stepCards[1]).getByText(
        "Review the release plan, confirm launch risks, and coordinate the handoff.",
      ),
    ).toHaveStyle({
      color: "#1976d2",
    });

    const interactionTargets = screen.getAllByTestId("interaction-component");
    fireEvent.mouseEnter(interactionTargets[1]);
    expect(interactionTargets[1]).toHaveAttribute(
      "data-interaction-state",
      "hovering",
    );

    fireEvent.click(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    );
    await waitForDiagramArranged();

    const fullscreenStepCards = within(
      screen.getByRole("dialog"),
    ).getAllByTestId("workflow-inline-step");
    expect(fullscreenStepCards[1]).toHaveAttribute(
      "data-step-highlighted",
      "true",
    );
    expect(
      within(fullscreenStepCards[1]).getByText("Review release"),
    ).toHaveStyle({
      color: "#1976d2",
    });
  });

  it("leaves the visible workflow step card draggable in edit mode", async () => {
    const workflow = makeWorkflow({
      id: "wf-editable",
      name: "Editable workflow",
    });
    const step = makeWorkflowStep({
      id: "step-editable",
      name: "Move me",
      parentTaskId: workflow.id,
    });

    render(
      <WorkflowGraphSurface
        graphData={{ workflow, steps: [step], edges: [] }}
        mode="edit"
        allowNodeDragging
      />,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    const stepCard = screen.getByTestId("workflow-inline-step");
    const stepFrame = screen.getByTestId("workflow-inline-step-frame");
    expect(stepCard).not.toHaveClass("nodrag");
    expect(stepFrame).not.toHaveClass("nodrag");
    expect(stepCard).not.toHaveAttribute("href");
    expect(stepCard.closest(".react-flow__node")).toHaveClass("draggable");
  });

  it("keeps an empty editable workflow surface stable", () => {
    const workflow = makeWorkflow({
      id: "wf-empty-editable",
      name: "Empty editable workflow",
    });
    const onEmptyCanvasContextMenu = vi.fn();

    render(
      <WorkflowGraphSurface
        graphData={{ workflow, steps: [], edges: [] }}
        mode="edit"
        onEmptyCanvasContextMenu={onEmptyCanvasContextMenu}
      />,
      { wrapper: projectWrapper },
    );

    expect(screen.getByText("No workflow steps")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("workflow-inline-diagram-viewport")
        .querySelector(".react-flow"),
    ).toBeInTheDocument();
  });

  it("shows a connection handle only when relationship creation is allowed", async () => {
    const workflow = makeWorkflow({
      id: "wf-editable",
      name: "Editable workflow",
    });
    const step = makeWorkflowStep({
      id: "step-editable",
      name: "Connect me",
      parentTaskId: workflow.id,
    });
    const { rerender } = render(
      <WorkflowGraphSurface
        graphData={{ workflow, steps: [step], edges: [] }}
        mode="edit"
      />,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-step")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-step-start-connection"),
    ).not.toBeInTheDocument();

    rerender(
      <WorkflowGraphSurface
        graphData={{ workflow, steps: [step], edges: [] }}
        mode="edit"
        allowConnections
      />,
    );
    await waitForDiagramArranged();

    expect(
      screen.getByTestId("workflow-step-start-connection"),
    ).toHaveAttribute("aria-label", "Start connection from Connect me");
    expect(screen.getByTestId("workflow-step-start-connection")).toHaveStyle({
      right: "-12px",
      width: "24px",
      height: "24px",
    });
    expect(
      screen
        .getByTestId("workflow-step-start-connection")
        .querySelector(".react-flow__handle"),
    ).toHaveStyle({
      width: "24px",
      height: "24px",
      borderRadius: "25%",
    });
    expect(
      screen.queryByTestId("workflow-step-connection-target"),
    ).not.toBeInTheDocument();
  });

  it("truncates workflow edge labels and shows the full label on hover", async () => {
    const conditionalPredicate =
      "Needs revision before the launch announcement goes out with all final legal, security, and launch checks complete";
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();

    render(
      <WorkflowEdgeLabel
        label={conditionalPredicate}
        labelX={120}
        labelY={80}
        isHighlighted
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />,
      { wrapper },
    );

    const edgeLabel = screen.getByTestId("workflow-inline-edge-label");
    expect(edgeLabel).toHaveStyle({
      pointerEvents: "all",
      width: "72px",
    });
    expect(edgeLabel).toHaveAttribute("data-workflow-edge-highlighted", "true");
    expect(within(edgeLabel).getByText(conditionalPredicate)).toHaveStyle({
      color: "#1976d2",
      overflow: "hidden",
      WebkitLineClamp: "2",
    });

    fireEvent.mouseOver(edgeLabel);
    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(
      await screen.findByTestId("workflow-inline-edge-label-tooltip"),
    ).toHaveTextContent(conditionalPredicate);

    fireEvent.mouseLeave(edgeLabel);
    expect(onMouseLeave).toHaveBeenCalledOnce();
  });

  it("keeps non-highlighted workflow edge labels in the existing secondary text color", () => {
    const conditionalPredicate =
      "Needs revision before the launch announcement goes out";

    render(
      <WorkflowEdgeLabel
        label={conditionalPredicate}
        labelX={120}
        labelY={80}
      />,
      { wrapper },
    );

    const edgeLabel = screen.getByTestId("workflow-inline-edge-label");
    expect(edgeLabel).toHaveAttribute(
      "data-workflow-edge-highlighted",
      "false",
    );
    expect(within(edgeLabel).getByText(conditionalPredicate)).toHaveStyle({
      color: "rgba(0, 0, 0, 0.6)",
    });
  });

  it("shows a conditional edge tooltip while the edge is highlighted", async () => {
    const conditionalPredicate = "Continue after validation";

    render(
      <WorkflowEdgeLabel
        label={conditionalPredicate}
        labelX={120}
        labelY={80}
        isHighlighted
        isTooltipOpen
      />,
      { wrapper },
    );

    expect(
      await screen.findByTestId("workflow-inline-edge-label-tooltip"),
    ).toHaveTextContent(conditionalPredicate);
  });

  it("widens workflow edge labels and tooltip presentation by display size", async () => {
    const conditionalPredicate =
      "Needs revision before the launch announcement goes out with all final legal, security, and launch checks complete";

    render(
      <WorkflowEdgeLabel
        label={conditionalPredicate}
        labelX={120}
        labelY={80}
        sizeMode="large"
      />,
      { wrapper },
    );

    const edgeLabel = screen.getByTestId("workflow-inline-edge-label");
    expect(edgeLabel).toHaveAttribute("data-workflow-graph-size", "large");
    expect(edgeLabel).toHaveStyle({
      width: "144px",
    });

    fireEvent.mouseOver(edgeLabel);
    const tooltip = await screen.findByTestId(
      "workflow-inline-edge-label-tooltip",
    );
    expect(tooltip).toHaveTextContent(conditionalPredicate);
    expect(tooltip).toHaveStyle({
      fontSize: "0.875rem",
      lineHeight: "1.45",
    });
  });

  it("places forward branch labels in the space between nodes", () => {
    const firstLane = getWorkflowEdgeLabelPosition({
      route: {
        kind: "forward-branch",
        lane: 0,
        siblingCount: 4,
        labelAnchor: "between-nodes",
      },
      sourceX: 320,
      sourceY: 160,
      sourcePosition: Position.Right,
      targetX: 760,
      targetY: 320,
      pathLabelX: 540,
      pathLabelY: 240,
    });
    const lastLane = getWorkflowEdgeLabelPosition({
      route: {
        kind: "forward-branch",
        lane: 3,
        siblingCount: 4,
        labelAnchor: "between-nodes",
      },
      sourceX: 320,
      sourceY: 160,
      sourcePosition: Position.Right,
      targetX: 760,
      targetY: 320,
      pathLabelX: 540,
      pathLabelY: 240,
    });

    expect(firstLane[0]).toBe(496);
    expect(lastLane[0]).toBe(496);
    expect(firstLane[0]).toBeGreaterThan(320 + 72);
    expect(lastLane[1] - firstLane[1]).toBeCloseTo(75.6);
  });

  it("places adjacent-column forward branch labels near the target side", () => {
    const [labelX, labelY] = getWorkflowEdgeLabelPosition({
      route: {
        kind: "forward-branch",
        lane: 0,
        siblingCount: 1,
        labelAnchor: "between-nodes",
      },
      sourceX: 320,
      sourceY: 160,
      sourcePosition: Position.Right,
      targetX: 430,
      targetY: 160,
      pathLabelX: 375,
      pathLabelY: 160,
    });

    expect(labelX).toBe(382);
    expect(labelY).toBe(160);
  });

  it("builds workflow graph descriptions as plain compact mention text", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const mentionedStep = makeWorkflowStep({
      id: "step-mentions",
      name: "Review mentions",
      parentTaskId: "wf-123",
      sections: [
        {
          id: "step-mentions-description",
          key: "description",
          order: 0,
          materializedMarkdown: `Review @[feature:feature-mention-nodes|Mention Nodes] ${"before launch ".repeat(
            20,
          )}`,
          crdtSnapshotSeq: null,
        },
      ],
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [mentionedStep],
      edges: [],
    });
    const node = model.nodes.find(
      (candidate) => candidate.id === mentionedStep.id,
    );

    expect(node?.data.description).toContain(
      "@[feature:feature-mention-nodes|Mention Nodes]",
    );
    expect(node?.data.summary).toContain(
      "@[feature:feature-mention-nodes|Mention Nodes]",
    );
    expect(node?.data.summary.endsWith("...")).toBe(true);

    render(
      <span data-testid="compact-summary">
        {renderInlineMentions(node?.data.summary, "minimal")}
      </span>,
      {
        wrapper: projectWrapper,
      },
    );

    expect(screen.getByRole("link", { name: "Mention Nodes" })).toHaveAttribute(
      "href",
      expect.stringContaining("feature-mention-nodes"),
    );
    expect(screen.getByTestId("compact-summary")).toHaveTextContent(
      /^Review Mention Nodes/,
    );
    expect(screen.queryByText(/@\[feature:/)).not.toBeInTheDocument();
    expect(
      screen.getByTestId("compact-summary").textContent?.length,
    ).toBeLessThanOrEqual(WORKFLOW_COMPACT_DESCRIPTION_MAX_LENGTH);
  });

  it("opens the fullscreen workflow viewer without falling back to mention rendering", async () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: "wf-123",
      edges: [
        makeEdge({
          id: "edge-flow",
          sourceNodeId: "step-1",
          targetNodeId: "step-2",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
      ],
    });
    const secondStep = makeWorkflowStep({
      id: "step-2",
      name: "Review release",
      parentTaskId: "wf-123",
    });
    hookMocks.useWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    hookMocks.useWorkItems.mockReturnValue({
      workItems: [firstStep, secondStep],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
    });

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    fireEvent.click(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    );
    await waitForDiagramArranged();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-fullscreen-dialog-title"),
    ).toHaveTextContent("Launch workflow");
    expect(
      screen.getByTestId("workflow-fullscreen-dialog-title-link"),
    ).toHaveAttribute("href", "/projects/project-1/tasks/wf-123");
    expect(
      screen.getByTestId("workflow-fullscreen-diagram-title-link"),
    ).toHaveAttribute("href", "/projects/project-1/tasks/wf-123");
    expect(
      screen.getByTestId("workflow-fullscreen-dialog-close"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-fullscreen-diagram-close"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-fullscreen-diagram")).toHaveTextContent(
      "Launch workflow",
    );
    expect(screen.getByTestId("workflow-fullscreen-diagram")).toHaveAttribute(
      "data-workflow-view-mode",
      "fit-to-view",
    );
    expect(
      screen.getByTestId("workflow-fullscreen-diagram-zoom-out"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-fullscreen-diagram-zoom-in"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-fullscreen-diagram-fit-to-view"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-inline-diagram-unavailable"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();

    const inlineReactFlow = screen
      .getByTestId("workflow-inline-diagram-viewport")
      .querySelector<HTMLElement>(".react-flow");
    const fullscreenReactFlow = screen
      .getByTestId("workflow-fullscreen-diagram-viewport")
      .querySelector<HTMLElement>(".react-flow");
    expect(inlineReactFlow?.id).toMatch(/^workflow-graph-/);
    expect(fullscreenReactFlow?.id).toMatch(/^workflow-graph-/);
    expect(fullscreenReactFlow?.id).not.toBe(inlineReactFlow?.id);

    fireEvent.click(screen.getByTestId("workflow-fullscreen-dialog-close"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("uses the aggregate and registry-backed workflow definition for inline rendering", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const step = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: "wf-123",
    });
    hookMocks.useWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    hookMocks.useWorkItems.mockReturnValue({
      workItems: [step],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
    });

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Launch workflow",
    );
    expect(hookMocks.useWorkItemGraph).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "wf-123",
      { enabled: true },
    );
    expect(hookMocks.useWorkItemTypeByKey).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "workflow",
    );
    expect(hookMocks.useWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "wf-123",
      expect.objectContaining({
        includeEdges: true,
        edgeTypes: [
          AgentEdgeType.Standard,
          AgentEdgeType.Conditional,
          AgentEdgeType.Loop,
          AgentEdgeType.FulfilledBy,
          AgentEdgeType.DependsOn,
        ],
      }),
    );
    expect(hookMocks.useWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        includeSectionKeys: ["description"],
        includeEdges: true,
        edgeTypes: [
          AgentEdgeType.Standard,
          AgentEdgeType.Conditional,
          AgentEdgeType.Loop,
          AgentEdgeType.FulfilledBy,
          AgentEdgeType.DependsOn,
        ],
        parentTaskId: "wf-123",
        taskType: "workflow_step",
      }),
    );
  });

  it("does not call topology when requested workflow edges are absent", async () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: "wf-123",
      edges: [],
    });
    const secondStep = makeWorkflowStep({
      id: "step-2",
      name: "Review release",
      parentTaskId: "wf-123",
      edges: [],
    });
    hookMocks.useWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    hookMocks.useWorkItems.mockReturnValue({
      workItems: [firstStep, secondStep],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
    });

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Launch workflow",
    );
    expect(hookMocks.getTopologyEntityGraph).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("workflow-inline-diagram-unavailable"),
    ).not.toBeInTheDocument();
  });

  it("renders workflow graph from steps even when no flow edges are returned", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    hookMocks.useWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    hookMocks.useWorkItems.mockReturnValue({
      workItems: [
        makeWorkflowStep({
          id: "step-1",
          name: "Draft release",
          parentTaskId: "wf-123",
          edges: [],
        }),
        makeWorkflowStep({
          id: "step-2",
          name: "Review release",
          parentTaskId: "wf-123",
          edges: [],
        }),
      ],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
    });

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Launch workflow",
    );
    expect(
      screen.queryByTestId("workflow-inline-diagram-unavailable"),
    ).not.toBeInTheDocument();
    expect(hookMocks.getTopologyEntityGraph).not.toHaveBeenCalled();
  });

  it("renders an empty inline workflow surface when no workflow steps are loaded", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    hookMocks.useWorkItem.mockReturnValue({
      workItem: workflow,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Launch workflow",
    );
    expect(screen.getByText("No workflow steps")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("workflow-inline-diagram-viewport")
        .querySelector(".react-flow"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });

  it("renders an unavailable workflow graph state when the loaded task is not a workflow", () => {
    hookMocks.useWorkItem.mockReturnValue({
      workItem: makeTask({
        id: "task-123",
        name: "Ordinary task",
      }),
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    render(
      <MarkdownRenderer>
        {"Open @[workflow:task-123|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-unavailable"),
    ).toHaveTextContent("Launch workflow");
    expect(screen.getByText("Workflow graph unavailable")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-inline-diagram"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });

  it("renders an unavailable workflow graph state when workflow loading fails", () => {
    hookMocks.useWorkItem.mockReturnValue({
      workItem: null,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: false,
      error: new Error("missing workflow"),
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    render(
      <MarkdownRenderer>
        {"Open @[workflow:wf-missing|Launch workflow] before planning."}
      </MarkdownRenderer>,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-unavailable"),
    ).toHaveTextContent("Launch workflow");
    expect(screen.getByText("Workflow graph unavailable")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-inline-diagram"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });

  it("builds graph edge labels, styles, and handles only from hydrated flow edge data", () => {
    const conditionalPredicate =
      "Needs revision before the launch announcement goes out";
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: "wf-123",
    });
    const secondStep = makeWorkflowStep({
      id: "step-2",
      name: "Approve release",
      parentTaskId: "wf-123",
    });
    const flowEdges = [
      makeEdge({
        id: "edge-standard",
        sourceNodeId: "step-1",
        targetNodeId: "step-2",
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      }),
      makeEdge({
        id: "edge-conditional",
        sourceNodeId: "step-2",
        targetNodeId: "step-1",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Backward,
        predicate: conditionalPredicate,
      }),
      makeEdge({
        id: "edge-loop",
        sourceNodeId: "step-2",
        targetNodeId: "step-2",
        type: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
      }),
      makeEdge({
        id: "edge-meta",
        sourceNodeId: "step-1",
        targetNodeId: "task-1",
        type: AgentEdgeType.RelatedTo,
        category: AgentEdgeCategory.Meta,
      }),
    ];

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [firstStep, secondStep],
      edges: flowEdges,
    });

    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "edge-standard",
          data: expect.objectContaining({
            label: undefined,
            sizeMode: "medium",
          }),
          sourceHandle: "right",
          targetHandle: "left",
          style: expect.not.objectContaining({
            strokeDasharray: expect.any(String),
          }),
        }),
        expect.objectContaining({
          id: "edge-conditional",
          data: expect.objectContaining({
            label: conditionalPredicate,
            route: expect.objectContaining({
              kind: "return",
              lane: 0,
              labelAnchor: "gutter-lane",
              gutterY: expect.any(Number),
            }),
            sizeMode: "medium",
          }),
          sourceHandle: "return-source-0",
          targetHandle: "return-target-0",
          style: expect.objectContaining({
            strokeDasharray: "1 6",
          }),
        }),
        expect.objectContaining({
          id: "edge-loop",
          data: expect.objectContaining({
            label: undefined,
            sizeMode: "medium",
          }),
          sourceHandle: "loop-source",
          targetHandle: "loop-target",
          style: expect.objectContaining({
            strokeDasharray: "6 4",
          }),
        }),
      ]),
    );
    expect(model.edges.map((edge) => edge.id)).not.toContain("edge-meta");
  });

  it("marks required node handles for connected forward and backward workflow steps", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const draftStep = makeWorkflowStep({
      id: "step-1",
      name: "Draft release",
      parentTaskId: "wf-123",
    });
    const approveStep = makeWorkflowStep({
      id: "step-2",
      name: "Approve release",
      parentTaskId: "wf-123",
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [draftStep, approveStep],
      edges: [
        makeEdge({
          id: "edge-standard",
          sourceNodeId: "step-1",
          targetNodeId: "step-2",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
        makeEdge({
          id: "edge-conditional",
          sourceNodeId: "step-2",
          targetNodeId: "step-1",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Backward,
          predicate: "Needs revision",
        }),
      ],
    });

    expect(getNodeHandles(model, "step-1")).toEqual({
      ...emptyWorkflowStepHandles,
      hasRightSourceHandle: true,
      hasRightTargetHandle: true,
      returnTargetHandleIds: ["return-target-0"],
    });
    expect(getNodeHandles(model, "step-2")).toEqual({
      ...emptyWorkflowStepHandles,
      hasLeftSourceHandle: true,
      hasLeftTargetHandle: true,
      returnSourceHandleIds: ["return-source-0"],
    });
  });

  it("fans out multiple forward edges through distinct deterministic source handles", () => {
    const workflow = makeWorkflow({
      id: "wf-branching",
      name: "Branching workflow",
    });
    const sourceStep = makeWorkflowStep({
      id: "step-source",
      name: "Monitor work",
      parentTaskId: workflow.id,
    });
    const targetSteps = [
      makeWorkflowStep({
        id: "step-pause",
        name: "Pause work",
        parentTaskId: workflow.id,
      }),
      makeWorkflowStep({
        id: "step-guidance",
        name: "Change guidance",
        parentTaskId: workflow.id,
      }),
      makeWorkflowStep({
        id: "step-stop",
        name: "Stop work",
        parentTaskId: workflow.id,
      }),
      makeWorkflowStep({
        id: "step-evaluate",
        name: "Evaluate outcome",
        parentTaskId: workflow.id,
      }),
    ];
    const model = buildWorkflowGraphModel({
      workflow,
      steps: [sourceStep, ...targetSteps],
      edges: [
        makeEdge({
          id: "edge-stop",
          sourceNodeId: sourceStep.id,
          targetNodeId: "step-stop",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "User stops execution",
        }),
        makeEdge({
          id: "edge-pause",
          sourceNodeId: sourceStep.id,
          targetNodeId: "step-pause",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "User pauses execution",
        }),
        makeEdge({
          id: "edge-evaluate",
          sourceNodeId: sourceStep.id,
          targetNodeId: "step-evaluate",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "A linked session reaches a terminal outcome",
        }),
        makeEdge({
          id: "edge-guidance",
          sourceNodeId: sourceStep.id,
          targetNodeId: "step-guidance",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "User changes guidance",
        }),
      ],
    });

    expect(getNodeHandles(model, sourceStep.id)).toMatchObject({
      forwardSourceHandleIds: [
        "forward-0",
        "forward-1",
        "forward-2",
        "forward-3",
      ],
    });
    expect(
      model.edges
        .filter((edge) => edge.source === sourceStep.id)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((edge) => ({ id: edge.id, sourceHandle: edge.sourceHandle })),
    ).toEqual([
      { id: "edge-evaluate", sourceHandle: "forward-0" },
      { id: "edge-guidance", sourceHandle: "forward-1" },
      { id: "edge-pause", sourceHandle: "forward-2" },
      { id: "edge-stop", sourceHandle: "forward-3" },
    ]);
  });

  it("routes dense Task Monitor transitions through deterministic branch and return lanes", () => {
    const workflow = makeWorkflow({ id: "wf-monitor", name: "Task monitor" });
    const steps = [
      ["step-coordinate", "Coordinate execution"],
      ["step-live", "Run live work"],
      ["step-pause", "Pause execution"],
      ["step-guidance", "Update guidance"],
      ["step-stop", "Stop execution"],
      ["step-evaluate", "Evaluate outcome"],
      ["step-complete", "Complete execution"],
    ].map(([id, name]) =>
      makeWorkflowStep({ id, name, parentTaskId: workflow.id }),
    );
    const edgeSpecs = [
      [
        "coordinate-live",
        "step-coordinate",
        "step-live",
        AgentEdgeType.Standard,
        undefined,
      ],
      [
        "live-pause",
        "step-live",
        "step-pause",
        AgentEdgeType.Conditional,
        "User pauses execution",
      ],
      [
        "live-guidance",
        "step-live",
        "step-guidance",
        AgentEdgeType.Conditional,
        "User changes guidance",
      ],
      [
        "live-stop",
        "step-live",
        "step-stop",
        AgentEdgeType.Conditional,
        "User stops execution",
      ],
      [
        "live-evaluate",
        "step-live",
        "step-evaluate",
        AgentEdgeType.Conditional,
        "Work reaches an outcome",
      ],
      [
        "pause-coordinate",
        "step-pause",
        "step-coordinate",
        AgentEdgeType.Conditional,
        "Resume work",
      ],
      [
        "guidance-coordinate",
        "step-guidance",
        "step-coordinate",
        AgentEdgeType.Conditional,
        "Guidance is applied",
      ],
      [
        "evaluate-coordinate",
        "step-evaluate",
        "step-coordinate",
        AgentEdgeType.Conditional,
        "Needs another pass",
      ],
      [
        "evaluate-complete",
        "step-evaluate",
        "step-complete",
        AgentEdgeType.Conditional,
        "Work is complete",
      ],
    ] as const;
    const buildModel = (reverse: boolean) =>
      buildWorkflowGraphModel({
        workflow,
        steps: reverse ? [...steps].reverse() : steps,
        edges: (reverse ? [...edgeSpecs].reverse() : edgeSpecs).map(
          ([id, sourceNodeId, targetNodeId, type, predicate]) =>
            makeEdge({
              id,
              sourceNodeId,
              targetNodeId,
              type,
              category: AgentEdgeCategory.Flow,
              direction: AgentEdgeDirection.Forward,
              predicate,
            }),
        ),
      });
    const model = buildModel(false);
    const reorderedModel = buildModel(true);
    const returnEdges = model.edges.filter(
      (edge) => edge.data?.route.kind === "return",
    );
    const liveEdges = model.edges.filter((edge) => edge.source === "step-live");
    const maxNodeY = Math.max(...model.nodes.map((node) => node.position.y));
    const baseCanvasHeight = 24 * 2 + 140 + (maxNodeY - 24);

    expect(liveEdges.map((edge) => edge.data?.route.kind)).toEqual([
      "forward-branch",
      "forward-branch",
      "forward-branch",
      "forward-branch",
    ]);
    expect(new Set(liveEdges.map((edge) => edge.sourceHandle)).size).toBe(4);
    expect(new Set(returnEdges.map((edge) => edge.sourceHandle)).size).toBe(
      returnEdges.length,
    );
    expect(new Set(returnEdges.map((edge) => edge.targetHandle)).size).toBe(
      returnEdges.length,
    );
    expect(
      new Set(
        returnEdges.map((edge) =>
          edge.data?.route.kind === "return" ? edge.data.route.lane : null,
        ),
      ).size,
    ).toBe(returnEdges.length);
    expect(model.canvasHeight).toBe(baseCanvasHeight + returnEdges.length * 70);
    expect(model.width).toBe(reorderedModel.width);
    expect(model.canvasHeight).toBe(reorderedModel.canvasHeight);
    expect(
      model.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        handles: node.data.handles,
      })),
    ).toEqual(
      reorderedModel.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        handles: node.data.handles,
      })),
    );
    expect(
      model.edges.map((edge) => ({
        id: edge.id,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        route: edge.data?.route,
      })),
    ).toEqual(
      reorderedModel.edges.map((edge) => ({
        id: edge.id,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        route: edge.data?.route,
      })),
    );
  });

  it("keeps same-depth flow edges out of the graph-wide return gutter", () => {
    const workflow = makeWorkflow({ id: "wf-siblings", name: "Sibling flow" });
    const steps = [
      ["step-start", "Start"],
      ["step-a", "Branch A"],
      ["step-b", "Branch B"],
    ].map(([id, name]) =>
      makeWorkflowStep({ id, name, parentTaskId: workflow.id }),
    );
    const model = buildWorkflowGraphModel({
      workflow,
      steps,
      edges: [
        makeEdge({
          id: "start-a",
          sourceNodeId: "step-start",
          targetNodeId: "step-a",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
        makeEdge({
          id: "start-b",
          sourceNodeId: "step-start",
          targetNodeId: "step-b",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
        makeEdge({
          id: "a-b",
          sourceNodeId: "step-a",
          targetNodeId: "step-b",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "Continue to the sibling outcome",
        }),
      ],
    });
    const siblingEdge = model.edges.find((edge) => edge.id === "a-b");

    expect(siblingEdge).toMatchObject({
      sourceHandle: "right",
      targetHandle: "left",
      data: { route: { kind: "forward-branch" } },
    });
    expect(model.edges.some((edge) => edge.data?.route.kind === "return")).toBe(
      false,
    );
  });

  it("routes a vertically separated return through the shortest clear side corridor", () => {
    const workflow = makeWorkflow({
      id: "wf-local-return",
      name: "Local return workflow",
    });
    const targetStep = makeWorkflowStep({
      id: "step-target",
      name: "Classify work",
      parentTaskId: workflow.id,
    });
    const sourceStep = makeWorkflowStep({
      id: "step-source",
      name: "Record terminal state",
      parentTaskId: workflow.id,
    });
    const model = buildWorkflowGraphModel(
      {
        workflow,
        steps: [targetStep, sourceStep],
        edges: [
          makeEdge({
            id: "edge-forward",
            sourceNodeId: targetStep.id,
            targetNodeId: sourceStep.id,
            type: AgentEdgeType.Standard,
            category: AgentEdgeCategory.Flow,
            direction: AgentEdgeDirection.Forward,
          }),
          makeEdge({
            id: "edge-local-return",
            sourceNodeId: sourceStep.id,
            targetNodeId: targetStep.id,
            type: AgentEdgeType.Conditional,
            category: AgentEdgeCategory.Flow,
            direction: AgentEdgeDirection.Backward,
            predicate: "Retry classification",
          }),
        ],
      },
      {
        disableLinks: false,
        authoredPositions: new Map([
          [targetStep.id, { x: 250, y: 24 }],
          [sourceStep.id, { x: 250, y: 404 }],
        ]),
      },
    );
    const localReturnEdge = model.edges.find(
      (edge) => edge.id === "edge-local-return",
    );

    expect(localReturnEdge).toMatchObject({
      sourceHandle: "left",
      targetHandle: "left",
      data: {
        route: {
          kind: "local-return",
          side: "left",
          lane: 0,
          gutterX: expect.any(Number),
          labelAnchor: "side-lane",
        },
      },
    });
    expect(
      localReturnEdge?.data?.route.kind === "local-return"
        ? localReturnEdge.data.route.gutterX
        : Number.POSITIVE_INFINITY,
    ).toBeLessThan(250);
    expect(model.canvasHeight).toBe(568);
  });

  it("keeps a return in the bottom gutter when both side corridors are blocked", () => {
    const workflow = makeWorkflow({
      id: "wf-blocked-return",
      name: "Blocked return workflow",
    });
    const targetStep = makeWorkflowStep({
      id: "step-target",
      name: "Classify work",
      parentTaskId: workflow.id,
    });
    const sourceStep = makeWorkflowStep({
      id: "step-source",
      name: "Record terminal state",
      parentTaskId: workflow.id,
    });
    const leftBlocker = makeWorkflowStep({
      id: "step-left-blocker",
      name: "Left blocker",
      parentTaskId: workflow.id,
    });
    const rightBlocker = makeWorkflowStep({
      id: "step-right-blocker",
      name: "Right blocker",
      parentTaskId: workflow.id,
    });
    const model = buildWorkflowGraphModel(
      {
        workflow,
        steps: [targetStep, sourceStep, leftBlocker, rightBlocker],
        edges: [
          makeEdge({
            id: "edge-forward",
            sourceNodeId: targetStep.id,
            targetNodeId: sourceStep.id,
            type: AgentEdgeType.Standard,
            category: AgentEdgeCategory.Flow,
            direction: AgentEdgeDirection.Forward,
          }),
          makeEdge({
            id: "edge-blocked-return",
            sourceNodeId: sourceStep.id,
            targetNodeId: targetStep.id,
            type: AgentEdgeType.Conditional,
            category: AgentEdgeCategory.Flow,
            direction: AgentEdgeDirection.Backward,
            predicate: "Retry classification",
          }),
        ],
      },
      {
        disableLinks: false,
        authoredPositions: new Map([
          [targetStep.id, { x: 250, y: 24 }],
          [sourceStep.id, { x: 250, y: 404 }],
          [leftBlocker.id, { x: 160, y: 210 }],
          [rightBlocker.id, { x: 390, y: 210 }],
        ]),
      },
    );
    const blockedReturnEdge = model.edges.find(
      (edge) => edge.id === "edge-blocked-return",
    );

    expect(blockedReturnEdge).toMatchObject({
      sourceHandle: "return-source-0",
      targetHandle: "return-target-0",
      data: {
        route: {
          kind: "return",
          lane: 0,
          labelAnchor: "gutter-lane",
        },
      },
    });
    expect(model.canvasHeight).toBe(638);
  });

  it("marks only loop handles for looped workflow steps", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const retryStep = makeWorkflowStep({
      id: "step-1",
      name: "Retry release",
      parentTaskId: "wf-123",
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [retryStep],
      edges: [
        makeEdge({
          id: "edge-loop",
          sourceNodeId: "step-1",
          targetNodeId: "step-1",
          type: AgentEdgeType.Loop,
          category: AgentEdgeCategory.Flow,
        }),
      ],
    });

    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "edge-loop",
          sourceHandle: "loop-source",
          targetHandle: "loop-target",
        }),
      ]),
    );
    expect(getNodeHandles(model, "step-1")).toEqual({
      ...emptyWorkflowStepHandles,
      hasLoopSourceHandle: true,
      hasLoopTargetHandle: true,
    });
    expect(model.canvasHeight).toBeGreaterThan(188);
    expect(model.height).toBeGreaterThan(model.canvasHeight);
  });

  it("keeps fulfilled-by targets on the step node without creating flow edges", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const fulfilledStep = makeWorkflowStep({
      id: "step-1",
      name: "Prepare release",
      parentTaskId: "wf-123",
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [fulfilledStep],
      edges: [
        makeEdge({
          id: "edge-fulfilled",
          sourceNodeId: "step-1",
          targetNodeId: "task-1",
          type: AgentEdgeType.FulfilledBy,
          sourceNodeName: "Prepare release",
          targetNodeName: "Prepare launch checklist",
        }),
      ],
    });

    expect(model.edges).toEqual([]);
    expect(getNodeHandles(model, "step-1")).toEqual(emptyWorkflowStepHandles);
    expect(
      model.nodes.find((node) => node.id === "step-1")?.data.fulfilledByTargets,
    ).toEqual([
      {
        id: "task-1",
        title: "Prepare launch checklist",
      },
    ]);
  });

  it("does not mark node handles for disconnected workflow steps", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const disconnectedStep = makeWorkflowStep({
      id: "step-1",
      name: "Document release",
      parentTaskId: "wf-123",
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [disconnectedStep],
      edges: [
        makeEdge({
          id: "edge-meta",
          sourceNodeId: "step-1",
          targetNodeId: "task-1",
          type: AgentEdgeType.FulfilledBy,
        }),
      ],
    });

    expect(model.edges).toEqual([]);
    expect(getNodeHandles(model, "step-1")).toEqual(emptyWorkflowStepHandles);
  });

  it("builds a natural-size canvas for disconnected root workflow steps", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const steps = ["step-1", "step-2", "step-3", "step-4"].map((stepId) =>
      makeWorkflowStep({
        id: stepId,
        name: `Workflow step ${stepId}`,
        parentTaskId: "wf-123",
      }),
    );

    const model = buildWorkflowGraphModel({
      workflow,
      steps,
      edges: [],
    });

    expect(model.width).toBe(188);
    expect(model.height).toBe(760);
    expect(model.canvasHeight).toBeGreaterThan(model.height);
    expect(model.nodes[0]?.position).toEqual({ x: 24, y: 24 });
    expect(model.nodes[1]?.position.x).toBe(model.nodes[0]?.position.x);
    expect(model.nodes[1]?.position.y).toBeGreaterThan(
      model.nodes[0]?.position.y ?? 0,
    );
  });

  it("keeps linear workflow steps on one row", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const firstStep = makeWorkflowStep({
      id: "step-a",
      name: "Start",
      parentTaskId: "wf-123",
    });
    const secondStep = makeWorkflowStep({
      id: "step-b",
      name: "Continue",
      parentTaskId: "wf-123",
    });
    const thirdStep = makeWorkflowStep({
      id: "step-c",
      name: "Finish",
      parentTaskId: "wf-123",
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [firstStep, secondStep, thirdStep],
      edges: [
        makeEdge({
          id: "edge-a-b",
          sourceNodeId: "step-a",
          targetNodeId: "step-b",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
        makeEdge({
          id: "edge-b-c",
          sourceNodeId: "step-b",
          targetNodeId: "step-c",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
      ],
    });

    const firstNode = model.nodes.find((node) => node.id === "step-a");
    const secondNode = model.nodes.find((node) => node.id === "step-b");
    const thirdNode = model.nodes.find((node) => node.id === "step-c");

    expect(secondNode?.position.x).toBeGreaterThan(firstNode?.position.x ?? 0);
    expect(thirdNode?.position.x).toBeGreaterThan(secondNode?.position.x ?? 0);
    expect(secondNode?.position.y).toBe(firstNode?.position.y);
    expect(thirdNode?.position.y).toBe(firstNode?.position.y);
  });

  it("arranges canonical projections with the layout engine but preserves an authored arrangement", async () => {
    const graphData = makeLinearWorkflowGraph(10, "projected-wrapping");
    const canonical = buildWorkflowGraphModel(graphData);
    const rootIdentity = {
      refType: "existing",
      id: graphData.workflow.id,
    } as const;
    const projection = {
      projectedRoot: {
        identity: rootIdentity,
        label: graphData.workflow.name,
        name: graphData.workflow.name,
        type: "DIAGRAM",
        sections: [],
        deleted: false,
      },
      children: graphData.steps.map((step) => ({
        identity: { refType: "existing", id: step.id } as const,
        label: step.name,
        name: step.name,
        type: "DIAGRAM_ELEMENT",
        parent: rootIdentity,
        sections: [],
        deleted: false,
      })),
      incidentRelationships: graphData.edges.map((edge) => ({
        identity: { refType: "existing", id: edge.id } as const,
        label: edge.type,
        source: { refType: "existing", id: edge.sourceNodeId } as const,
        target: { refType: "existing", id: edge.targetNodeId } as const,
        edgeType: edge.type,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        deleted: false,
      })),
      effectiveLayout: {
        nodes: canonical.nodes.map((node) => ({
          node: { refType: "existing", id: node.id } as const,
          position: node.position,
        })),
      },
      layoutSource: "canonical" as const,
    };
    // Canonical (unsaved) positions are never displayed: the surface waits for
    // the layout engine. Authored positions render synchronously as saved.
    const enginePositions = new Map(
      graphData.steps.map((step, index) => [
        step.id,
        { x: 32 + (index % 3) * 300, y: 32 + Math.floor(index / 3) * 200 },
      ]),
    );
    const compute = vi
      .spyOn(diagramLayoutCandidates, "computeDiagramLayoutCandidate")
      .mockResolvedValue(enginePositions);
    onTestFinished(() => compute.mockRestore());
    const view = render(<WorkflowGraphSurface projection={projection} />, {
      wrapper,
    });
    const nodeTransform = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-id="${id}"]`)?.style
        .transform;
    const rowPositions = () =>
      new Set(
        screen
          .getAllByTestId("workflow-inline-step")
          .map(
            (card) =>
              card
                .closest<HTMLElement>(".react-flow__node")
                ?.style.transform.split(",")[1],
          ),
      );
    expect(screen.getByTestId("workflow-inline-diagram")).toHaveAttribute(
      "data-workflow-view-mode",
      "arranging",
    );
    expect(screen.queryAllByTestId("workflow-inline-step")).toHaveLength(0);
    expect(compute).toHaveBeenCalledWith(expect.anything(), "dagre", "RIGHT");
    await waitForDiagramArranged();
    expect(screen.getAllByTestId("workflow-inline-step")).toHaveLength(10);
    graphData.steps.forEach((step) => {
      const position = enginePositions.get(step.id)!;
      expect(nodeTransform(step.id)).toBe(
        `translate(${position.x}px,${position.y}px)`,
      );
    });
    expect(rowPositions().size).toBe(4);

    compute.mockClear();
    view.rerender(
      <WorkflowGraphSurface
        projection={{ ...projection, layoutSource: "authored" }}
      />,
    );
    expect(screen.getByTestId("workflow-inline-diagram")).not.toHaveAttribute(
      "data-workflow-view-mode",
      "arranging",
    );
    canonical.nodes.forEach((node) => {
      expect(nodeTransform(node.id)).toBe(
        `translate(${node.position.x}px,${node.position.y}px)`,
      );
    });
    expect(rowPositions().size).toBe(1);
    expect(compute).not.toHaveBeenCalled();
  });

  it("applies a preferred five-by-three shape beyond the automatic band limit", () => {
    const graphData = makeLinearWorkflowGraph(15, "preferred");
    const model = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      preferredLayout: { rows: 5, columns: 3 },
      viewportWidth: 480,
    });
    const positionsByRow = new Map<number, number>();

    graphData.steps.forEach((step) => {
      const position = model.nodes.find(
        (node) => node.id === step.id,
      )?.position;
      if (position) {
        positionsByRow.set(
          position.y,
          (positionsByRow.get(position.y) ?? 0) + 1,
        );
      }
    });

    expect(model.preferredLayout).toEqual({
      requested: { rows: 5, columns: 3 },
      actual: { rows: 5, columns: 3 },
      departures: [],
    });
    expect(model.layoutMode).toBe("wrapped");
    expect([...positionsByRow.values()]).toEqual([3, 3, 3, 3, 3]);
  });

  it("keeps preferred logical placement stable across density and viewport settings", () => {
    const graphData = makeLinearWorkflowGraph(15, "preferred-density");
    const compact = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      preferredLayout: { rows: 5, columns: 3 },
      sizeMode: "small",
      viewportWidth: 420,
    });
    const roomy = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      preferredLayout: { rows: 5, columns: 3 },
      sizeMode: "large",
      viewportWidth: 1800,
    });
    const rowCounts = (
      model: ReturnType<typeof buildWorkflowGraphModel>,
    ): number[] => {
      const counts = new Map<number, number>();
      model.nodes.forEach((node) => {
        counts.set(node.position.y, (counts.get(node.position.y) ?? 0) + 1);
      });
      return [...counts.values()];
    };

    expect(compact.preferredLayout?.actual).toEqual({ rows: 5, columns: 3 });
    expect(roomy.preferredLayout?.actual).toEqual({ rows: 5, columns: 3 });
    expect(rowCounts(compact)).toEqual([3, 3, 3, 3, 3]);
    expect(rowCounts(roomy)).toEqual([3, 3, 3, 3, 3]);
  });

  it("derives route metadata from the selected authored placement", () => {
    const graphData = makeLinearWorkflowGraph(3, "authored-route");
    const model = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      authoredPositions: new Map([
        ["authored-route-step-0", { x: 24, y: 24 }],
        ["authored-route-step-1", { x: 24, y: 400 }],
        ["authored-route-step-2", { x: 288, y: 400 }],
      ]),
      viewportWidth: 1000,
    });
    const firstEdge = model.edges.find(
      (edge) => edge.id === "authored-route-edge-0",
    );

    expect(firstEdge?.data?.route).toEqual(
      expect.objectContaining({ kind: "cross-band" }),
    );
  });

  it("keeps different-band side-by-side endpoints on local left-entry routes", () => {
    const model = buildWorkflowGraphModel(
      makeLinearWorkflowGraph(3, "local-band"),
      {
        disableLinks: false,
        authoredPositions: new Map([
          ["local-band-step-0", { x: 24, y: 24 }],
          ["local-band-step-1", { x: 288, y: 400 }],
          ["local-band-step-2", { x: 552, y: 400 }],
        ]),
        viewportWidth: 1800,
      },
    );
    const edge = model.edges.find((entry) => entry.id === "local-band-edge-0");
    expect(edge?.data?.route.kind).toBe("mainline");
    expect(edge?.targetHandle).not.toBe("cross-band-target");
    expect(
      getNodeHandles(model, "local-band-step-1").hasCrossBandTargetHandle,
    ).toBe(false);
  });

  it("bounds genuine wrap gutters by content regardless of unused viewport width", () => {
    const build = (viewportWidth: number) =>
      buildWorkflowGraphModel(makeLinearWorkflowGraph(3, "content-gutter"), {
        disableLinks: false,
        authoredPositions: new Map([
          ["content-gutter-step-0", { x: 24, y: 24 }],
          ["content-gutter-step-1", { x: 24, y: 400 }],
          ["content-gutter-step-2", { x: 288, y: 400 }],
        ]),
        viewportWidth,
      });
    const route = build(1000).edges[0].data?.route;
    expect(route?.kind).toBe("cross-band");
    expect(build(1800).edges[0].data?.route).toEqual(route);
    if (route?.kind !== "cross-band") throw new Error("Expected wrapped route");
    expect(route.gutterX).toBeGreaterThan(428);
    expect(route.gutterX).toBeLessThan(600);
  });

  it("wraps long linear workflows into deterministic left-to-right bands", () => {
    const graphData = makeLinearWorkflowGraph(6);
    const model = buildWorkflowGraphModel(graphData, {
      disableLinks: false,
      viewportWidth: 750,
    });
    const positions = graphData.steps.map(
      (step) => model.nodes.find((node) => node.id === step.id)?.position,
    );
    const crossBandEdges = model.edges.filter(
      (edge) => edge.data?.route.kind === "cross-band",
    );
    const firstCrossBandEdge = model.edges.find(
      (edge) => edge.id === "linear-edge-1",
    );

    expect(model.layoutMode).toBe("wrapped");
    expect(model.width).toBe(750);
    expect(positions.slice(0, 2).map((position) => position?.y)).toEqual([
      24, 24,
    ]);
    expect(positions[2]?.x).toBe(positions[0]?.x);
    expect(positions[2]?.y).toBeGreaterThan(positions[1]?.y ?? 0);
    expect(positions[4]?.x).toBe(positions[0]?.x);
    expect(positions[4]?.y).toBeGreaterThan(positions[3]?.y ?? 0);
    expect(crossBandEdges).toHaveLength(2);
    expect(crossBandEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            route: expect.objectContaining({
              kind: "cross-band",
              gutterX: 488,
              gutterY: 272,
              labelAnchor: "outer-gutter",
            }),
          }),
        }),
      ]),
    );
    expect(firstCrossBandEdge?.targetHandle).toBe("cross-band-target");
    expect(getNodeHandles(model, "linear-step-2")).toMatchObject({
      hasCrossBandTargetHandle: true,
    });
    const firstCrossBandRoute = firstCrossBandEdge?.data?.route;
    expect(firstCrossBandRoute?.kind).toBe("cross-band");
    if (firstCrossBandRoute?.kind !== "cross-band") {
      throw new Error("Expected a cross-band route");
    }
    expect(firstCrossBandRoute.gutterY).toBeGreaterThan(24 + 140);
    expect(firstCrossBandRoute.gutterY).toBeLessThan(positions[2]?.y ?? 0);
  });

  it.each([
    ["small", 600, 104],
    ["medium", 750, 140],
    ["large", 1050, 280],
  ] as const)(
    "uses %s density dimensions when calculating wrapped band capacity",
    (sizeMode, viewportWidth, nodeSize) => {
      const model = buildWorkflowGraphModel(
        makeLinearWorkflowGraph(6, sizeMode),
        {
          disableLinks: false,
          sizeMode,
          viewportWidth,
        },
      );
      const firstNode = model.nodes[0];
      const secondNode = model.nodes[1];

      expect(model.layoutMode).toBe("wrapped");
      expect(firstNode?.data.sizeConfig.nodeSize).toBe(nodeSize);
      expect(secondNode?.position.x).toBeGreaterThan(
        (firstNode?.position.x ?? 0) + nodeSize,
      );
    },
  );

  it("keeps the canonical horizontal layout below and above wrapping thresholds", () => {
    const sixStepGraph = makeLinearWorkflowGraph(6, "threshold");
    const tooNarrow = buildWorkflowGraphModel(sixStepGraph, {
      disableLinks: false,
      viewportWidth: 450,
    });
    const alreadyFits = buildWorkflowGraphModel(sixStepGraph, {
      disableLinks: false,
      viewportWidth: 1600,
    });
    const tooManyBands = buildWorkflowGraphModel(
      makeLinearWorkflowGraph(8, "too-many-bands"),
      {
        disableLinks: false,
        viewportWidth: 750,
      },
    );

    expect(tooNarrow.layoutMode).toBe("horizontal");
    expect(alreadyFits.layoutMode).toBe("horizontal");
    expect(tooManyBands.layoutMode).toBe("horizontal");
    expect(tooNarrow.nodes.map((node) => node.position.y)).toEqual(
      tooNarrow.nodes.map(() => 24),
    );
  });

  it("stacks sibling workflow branches in the same column", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Launch workflow",
    });
    const parentStep = makeWorkflowStep({
      id: "step-a",
      name: "Start",
      parentTaskId: "wf-123",
    });
    const firstBranch = makeWorkflowStep({
      id: "step-b",
      name: "Branch one",
      parentTaskId: "wf-123",
    });
    const secondBranch = makeWorkflowStep({
      id: "step-c",
      name: "Branch two",
      parentTaskId: "wf-123",
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [parentStep, firstBranch, secondBranch],
      edges: [
        makeEdge({
          id: "edge-a-b",
          sourceNodeId: "step-a",
          targetNodeId: "step-b",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
        makeEdge({
          id: "edge-a-c",
          sourceNodeId: "step-a",
          targetNodeId: "step-c",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
      ],
    });

    const parentNode = model.nodes.find((node) => node.id === "step-a");
    const firstBranchNode = model.nodes.find((node) => node.id === "step-b");
    const secondBranchNode = model.nodes.find((node) => node.id === "step-c");

    expect(firstBranchNode?.position.x).toBeGreaterThan(
      parentNode?.position.x ?? 0,
    );
    expect(secondBranchNode?.position.x).toBe(firstBranchNode?.position.x);
    expect(secondBranchNode?.position.y).toBeGreaterThan(
      firstBranchNode?.position.y ?? 0,
    );
  });

  it("keeps branch columns together when wrapping", () => {
    const workflow = makeWorkflow({
      id: "wf-wrapped-branch",
      name: "Wrapped branch workflow",
    });
    const steps = [
      ["start", "Start"],
      ["branch-a", "Branch A"],
      ["branch-b", "Branch B"],
      ["merge", "Merge"],
      ["finish", "Finish"],
    ].map(([id, name]) =>
      makeWorkflowStep({
        id,
        name,
        parentTaskId: workflow.id,
      }),
    );
    const edges = [
      ["start-branch-a", "start", "branch-a"],
      ["start-branch-b", "start", "branch-b"],
      ["branch-a-merge", "branch-a", "merge"],
      ["branch-b-merge", "branch-b", "merge"],
      ["merge-finish", "merge", "finish"],
    ].map(([id, sourceNodeId, targetNodeId]) =>
      makeEdge({
        id,
        sourceNodeId,
        targetNodeId,
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      }),
    );
    const model = buildWorkflowGraphModel(
      { workflow, steps, edges },
      { disableLinks: false, viewportWidth: 750 },
    );
    const branchAPosition = model.nodes.find(
      (node) => node.id === "branch-a",
    )?.position;
    const branchBPosition = model.nodes.find(
      (node) => node.id === "branch-b",
    )?.position;
    const mergePosition = model.nodes.find(
      (node) => node.id === "merge",
    )?.position;
    const crossBandRoutes = model.edges.flatMap((edge) =>
      edge.data?.route.kind === "cross-band" ? [edge.data.route] : [],
    );

    expect(model.layoutMode).toBe("wrapped");
    expect(branchAPosition?.x).toBe(branchBPosition?.x);
    expect(branchAPosition?.y).not.toBe(branchBPosition?.y);
    expect(mergePosition?.x).toBe(24);
    expect(mergePosition?.y).toBeGreaterThan(
      Math.max(branchAPosition?.y ?? 0, branchBPosition?.y ?? 0),
    );
    expect(crossBandRoutes).toHaveLength(2);
    expect(new Set(crossBandRoutes.map((route) => route.gutterY)).size).toBe(2);
  });

  it("lays out reordered cyclic workflow proposals as compact semantic groups", () => {
    const buildCyclicGraph = (prefix: string, reverse: boolean) => {
      const workflow = makeWorkflow({
        id: `${prefix}-workflow`,
        name: "Monitor workflow",
      });
      const names = ["Start", "Run", "Check", "Halt", "Resume", "Finish"];
      const idByName = new Map(
        names.map((name) => [name, `${prefix}-${name.toLocaleLowerCase()}`]),
      );
      const steps = names.map((name) =>
        makeWorkflowStep({
          id: idByName.get(name) ?? name,
          name,
          parentTaskId: workflow.id,
        }),
      );
      const connections = [
        ["Start", "Run"],
        ["Run", "Check"],
        ["Check", "Halt"],
        ["Halt", "Resume"],
        ["Resume", "Run"],
        ["Check", "Finish"],
      ] as const;
      const edges = connections.map(([source, target]) =>
        makeEdge({
          id: `${prefix}-${source}-${target}`,
          sourceNodeId: idByName.get(source) ?? source,
          targetNodeId: idByName.get(target) ?? target,
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        }),
      );

      return buildWorkflowGraphModel(
        {
          workflow,
          steps: reverse ? [...steps].reverse() : steps,
          edges: reverse ? [...edges].reverse() : edges,
        },
        { disableLinks: false, viewportWidth: 850 },
      );
    };
    const proposalModel = buildCyclicGraph("temporary", false);
    const materializedModel = buildCyclicGraph("persisted", true);
    const positionsByTitle = (
      model: ReturnType<typeof buildWorkflowGraphModel>,
    ) =>
      Object.fromEntries(
        model.nodes.map((node) => [node.data.title, node.position]),
      );
    const proposalPositions = positionsByTitle(proposalModel);
    const cyclePositions = ["Run", "Check", "Halt", "Resume"].map(
      (title) => proposalPositions[title],
    );

    expect(proposalModel.layoutMode).toBe("wrapped");
    expect(positionsByTitle(materializedModel)).toEqual(proposalPositions);
    expect(new Set(cyclePositions.map((position) => position.x)).size).toBe(2);
    expect(new Set(cyclePositions.map((position) => position.y)).size).toBe(2);
    expect(
      new Set(
        cyclePositions.map((position) =>
          position.y < proposalPositions.Finish.y ? "first-band" : "last-band",
        ),
      ),
    ).toEqual(new Set(["first-band"]));
    expect(proposalPositions.Finish.x).toBeLessThan(
      Math.max(...cyclePositions.map((position) => position.x)),
    );
    expect(proposalPositions.Finish.y).toBeGreaterThan(
      Math.max(...cyclePositions.map((position) => position.y)),
    );
  });

  it("routes dense supervision loops without avoidable graph-spanning detours", () => {
    const workflow = makeWorkflow({
      id: "supervision-workflow",
      name: "Task Monitor supervision loop",
    });
    const stepNames = [
      "Coordinate next work",
      "Validate the launch",
      "Launch agent sessions",
      "View progress and decisions",
      "Pause and resume execution",
      "Change coordinating guidance",
      "Stop Task Monitor",
      "Evaluate terminal outcomes",
      "Pause for user judgment",
      "Complete Task Monitor",
    ] as const;
    const stepId = (name: (typeof stepNames)[number]) =>
      name.toLocaleLowerCase().replaceAll(" ", "-");
    const steps = stepNames.map((name) =>
      makeWorkflowStep({
        id: stepId(name),
        name,
        parentTaskId: workflow.id,
      }),
    );
    const connections = [
      ["Coordinate next work", "Validate the launch", "forward"],
      ["Validate the launch", "Launch agent sessions", "forward"],
      ["Validate the launch", "Complete Task Monitor", "forward"],
      ["Launch agent sessions", "View progress and decisions", "forward"],
      ["View progress and decisions", "Pause and resume execution", "forward"],
      [
        "View progress and decisions",
        "Change coordinating guidance",
        "forward",
      ],
      ["View progress and decisions", "Stop Task Monitor", "forward"],
      ["View progress and decisions", "Evaluate terminal outcomes", "forward"],
      ["Pause and resume execution", "Coordinate next work", "backward"],
      ["Change coordinating guidance", "Coordinate next work", "backward"],
      ["Evaluate terminal outcomes", "Coordinate next work", "backward"],
      ["Evaluate terminal outcomes", "Pause for user judgment", "forward"],
      ["Evaluate terminal outcomes", "Complete Task Monitor", "forward"],
      ["Pause for user judgment", "Coordinate next work", "backward"],
    ] as const;
    const edges = connections.map(([source, target, direction], index) =>
      makeEdge({
        id: `supervision-edge-${index}`,
        sourceNodeId: stepId(source),
        targetNodeId: stepId(target),
        type:
          index === 0 || index === 3 || direction === "backward"
            ? AgentEdgeType.Standard
            : AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction:
          direction === "forward"
            ? AgentEdgeDirection.Forward
            : AgentEdgeDirection.Backward,
        predicate: direction === "forward" ? `Outcome ${index}` : undefined,
      }),
    );

    const model = buildWorkflowGraphModel(
      { workflow, steps, edges },
      { disableLinks: false, viewportWidth: 750 },
    );

    expect(model.layoutMode).toBe("horizontal");
    expect(
      model.edges.some((edge) => edge.data?.route.kind === "cross-band"),
    ).toBe(false);
    expect(
      model.edges
        .filter((edge) => edge.data?.route.kind === "return")
        .every(
          (edge) =>
            edge.sourceHandle?.startsWith("return-source-") === true &&
            edge.targetHandle?.startsWith("return-target-") === true,
        ),
    ).toBe(true);
  });

  it("gives equivalent proposal and materialized workflow graphs identical semantic positions", () => {
    const proposalWorkflow = makeWorkflow({
      id: "proposal-workflow",
      name: "Attribution workflow",
    });
    const materializedWorkflow = makeWorkflow({
      id: "materialized-workflow",
      name: "Attribution workflow",
    });
    const proposalSteps = [
      makeWorkflowStep({
        id: "tmp-publish",
        name: "Publish result",
        parentTaskId: proposalWorkflow.id,
      }),
      makeWorkflowStep({
        id: "tmp-reject",
        name: "Reject and diagnose invalid input",
        parentTaskId: proposalWorkflow.id,
      }),
      makeWorkflowStep({
        id: "tmp-validate",
        name: "Validate attribution",
        parentTaskId: proposalWorkflow.id,
      }),
      makeWorkflowStep({
        id: "tmp-audit",
        name: "Audit source",
        parentTaskId: proposalWorkflow.id,
      }),
      makeWorkflowStep({
        id: "tmp-canonicalize",
        name: "Canonicalize accepted input",
        parentTaskId: proposalWorkflow.id,
      }),
      makeWorkflowStep({
        id: "tmp-receive",
        name: "Receive request",
        parentTaskId: proposalWorkflow.id,
      }),
    ];
    const materializedSteps = [
      makeWorkflowStep({
        id: "step-canonicalize",
        name: "Canonicalize accepted input",
        parentTaskId: materializedWorkflow.id,
      }),
      makeWorkflowStep({
        id: "step-receive",
        name: "Receive request",
        parentTaskId: materializedWorkflow.id,
      }),
      makeWorkflowStep({
        id: "step-reject",
        name: "Reject and diagnose invalid input",
        parentTaskId: materializedWorkflow.id,
      }),
      makeWorkflowStep({
        id: "step-publish",
        name: "Publish result",
        parentTaskId: materializedWorkflow.id,
      }),
      makeWorkflowStep({
        id: "step-audit",
        name: "Audit source",
        parentTaskId: materializedWorkflow.id,
      }),
      makeWorkflowStep({
        id: "step-validate",
        name: "Validate attribution",
        parentTaskId: materializedWorkflow.id,
      }),
    ];
    const proposalEdges = [
      makeEdge({
        id: "proposal-meta",
        sourceNodeId: "tmp-reject",
        targetNodeId: "task-fulfilled",
        targetNodeName: "Fix invalid attribution handling",
        type: AgentEdgeType.FulfilledBy,
        category: AgentEdgeCategory.Meta,
      }),
      makeEdge({
        id: "proposal-loop",
        sourceNodeId: "tmp-canonicalize",
        targetNodeId: "tmp-canonicalize",
        type: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
      }),
      makeEdge({
        id: "proposal-receive-validate",
        sourceNodeId: "tmp-receive",
        targetNodeId: "tmp-validate",
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      }),
      makeEdge({
        id: "proposal-validate-reject",
        sourceNodeId: "tmp-validate",
        targetNodeId: "tmp-reject",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "Attribution rejected",
      }),
      makeEdge({
        id: "proposal-backward",
        sourceNodeId: "tmp-publish",
        targetNodeId: "tmp-validate",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Backward,
        predicate: "Reopen validation",
      }),
      makeEdge({
        id: "proposal-canonicalize-publish",
        sourceNodeId: "tmp-canonicalize",
        targetNodeId: "tmp-publish",
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      }),
      makeEdge({
        id: "proposal-validate-canonicalize",
        sourceNodeId: "tmp-validate",
        targetNodeId: "tmp-canonicalize",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "Attribution accepted",
      }),
      makeEdge({
        id: "proposal-canonicalize-reject",
        sourceNodeId: "tmp-canonicalize",
        targetNodeId: "tmp-reject",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "Canonicalization failed",
      }),
    ];
    const materializedEdges = [
      makeEdge({
        id: "materialized-canonicalize-reject",
        sourceNodeId: "step-canonicalize",
        targetNodeId: "step-reject",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "Canonicalization failed",
      }),
      makeEdge({
        id: "materialized-backward",
        sourceNodeId: "step-publish",
        targetNodeId: "step-validate",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Backward,
        predicate: "Reopen validation",
      }),
      makeEdge({
        id: "materialized-validate-canonicalize",
        sourceNodeId: "step-validate",
        targetNodeId: "step-canonicalize",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "Attribution accepted",
      }),
      makeEdge({
        id: "materialized-loop",
        sourceNodeId: "step-canonicalize",
        targetNodeId: "step-canonicalize",
        type: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
      }),
      makeEdge({
        id: "materialized-canonicalize-publish",
        sourceNodeId: "step-canonicalize",
        targetNodeId: "step-publish",
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      }),
      makeEdge({
        id: "materialized-receive-validate",
        sourceNodeId: "step-receive",
        targetNodeId: "step-validate",
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      }),
      makeEdge({
        id: "materialized-meta",
        sourceNodeId: "step-reject",
        targetNodeId: "task-fulfilled",
        targetNodeName: "Fix invalid attribution handling",
        type: AgentEdgeType.FulfilledBy,
        category: AgentEdgeCategory.Meta,
      }),
      makeEdge({
        id: "materialized-validate-reject",
        sourceNodeId: "step-validate",
        targetNodeId: "step-reject",
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "Attribution rejected",
      }),
    ];

    const proposalModel = buildWorkflowGraphModel({
      workflow: proposalWorkflow,
      steps: proposalSteps,
      edges: proposalEdges,
    });
    const materializedModel = buildWorkflowGraphModel({
      workflow: materializedWorkflow,
      steps: materializedSteps,
      edges: materializedEdges,
    });

    expect(getNodePositionByTitle(materializedModel)).toEqual(
      getNodePositionByTitle(proposalModel),
    );
    expect(getSortedConditionalLabels(materializedModel)).toEqual(
      getSortedConditionalLabels(proposalModel),
    );
    expect(getSortedConditionalLabels(materializedModel)).toEqual([
      "Attribution accepted",
      "Attribution rejected",
      "Canonicalization failed",
      "Reopen validation",
    ]);
    expect(
      getNodePositionByTitle(materializedModel).get(
        "Reject and diagnose invalid input",
      )?.x,
    ).toBeGreaterThan(
      getNodePositionByTitle(materializedModel).get(
        "Canonicalize accepted input",
      )?.x ?? 0,
    );
    expect(
      getNodeData(materializedModel, "step-reject")?.fulfilledByTargets,
    ).toEqual([
      {
        id: "task-fulfilled",
        title: "Fix invalid attribution handling",
      },
    ]);
  });

  it("uses semantic predicates before ids when ordering same-named branch siblings", () => {
    const workflow = makeWorkflow({
      id: "wf-123",
      name: "Review workflow",
    });
    const start = makeWorkflowStep({
      id: "start",
      name: "Start review",
      parentTaskId: workflow.id,
    });
    const manualReview = makeWorkflowStep({
      id: "zz-manual",
      name: "Review duplicate",
      parentTaskId: workflow.id,
    });
    const automaticReview = makeWorkflowStep({
      id: "aa-automatic",
      name: "Review duplicate",
      parentTaskId: workflow.id,
    });

    const model = buildWorkflowGraphModel({
      workflow,
      steps: [manualReview, automaticReview, start],
      edges: [
        makeEdge({
          id: "manual-edge",
          sourceNodeId: "start",
          targetNodeId: "zz-manual",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "Manual review",
        }),
        makeEdge({
          id: "automatic-edge",
          sourceNodeId: "start",
          targetNodeId: "aa-automatic",
          type: AgentEdgeType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "Automatic review",
        }),
      ],
    });

    const automaticNode = model.nodes.find(
      (node) => node.id === "aa-automatic",
    );
    const manualNode = model.nodes.find((node) => node.id === "zz-manual");

    expect(automaticNode?.position.x).toBe(manualNode?.position.x);
    expect(automaticNode?.position.y).toBeLessThan(manualNode?.position.y ?? 0);
  });
});

describe("projected diagram scope", () => {
  const rootIdentity = { refType: "existing" as const, id: "scoped-diagram" };
  const elementIdentity = {
    refType: "existing" as const,
    id: "scoped-element",
  };
  const projection: WorkItemGraphProjectionData = {
    layoutSource: "authored",
    projectedRoot: {
      identity: rootIdentity,
      label: "Checkout diagram",
      name: "Checkout diagram",
      type: "DIAGRAM",
      sections: [],
      deleted: false,
    },
    children: [
      {
        identity: elementIdentity,
        label: "Checkout controller",
        name: "Checkout controller",
        type: "DIAGRAM_ELEMENT",
        parent: rootIdentity,
        sections: [],
        deleted: false,
      },
    ],
    incidentRelationships: [],
    effectiveLayout: {
      nodes: [{ node: elementIdentity, position: { x: 80, y: 90 } }],
    },
  };
  const proposalLink = {
    sourceNodeId: "scoped-element",
    targetEntityId: "893e6e24-6ed5-4f67-a1a9-9e27719a7565",
    targetEntityType: "PROPOSAL",
    targetTitle: "Diagram design",
    relationshipType: AgentEdgeType.RelatedTo,
  };

  const hoverDirectLink = async () => {
    fireEvent.mouseEnter(screen.getByTestId("diagram-element-direct-link"));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
  };

  const scopeArgumentsSeen = (): unknown[] => [
    ...hookMocks.useWorkItemTypeByKey.mock.calls.flatMap((call) =>
      call.slice(0, 2),
    ),
    ...hookMocks.useWorkItem.mock.calls.flatMap((call) => [
      call[0],
      (call[3] as { projectId?: string } | undefined)?.projectId,
    ]),
  ];

  it("projects nodes with the supplied organization and project", () => {
    const graphData = projectWorkItemGraphForWorkflowSurface(projection, {
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(graphData.workflow).toMatchObject({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(graphData.steps).toEqual([
      expect.objectContaining({
        id: "scoped-element",
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ]);
  });

  it("previews linked entities with the active scope", async () => {
    render(
      <WorkflowGraphSurface
        projection={projection}
        organizationId="org-1"
        projectId="project-1"
        directEntityLinks={[proposalLink]}
      />,
      { wrapper: projectWrapper },
    );

    await hoverDirectLink();

    const preview = screen.getByTestId("entity-hover-card");
    expect(preview).toHaveAttribute("data-organization-id", "org-1");
    expect(preview).toHaveAttribute("data-project-id", "project-1");
    expect(hookMocks.useWorkItemTypeByKey).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "DIAGRAM",
    );
  });

  it("opens previews from link icons by keyboard on link-disabled surfaces", async () => {
    render(
      <WorkflowGraphSurface
        projection={projection}
        organizationId="org-1"
        projectId="project-1"
        directEntityLinks={[proposalLink]}
        disableLinks
      />,
      { wrapper: projectWrapper },
    );

    const icon = screen.getByRole("button", {
      name: "Preview Diagram design; Related to",
    });
    expect(icon).not.toHaveAttribute("aria-disabled");
    const user = userEvent.setup();
    act(() => icon.focus());
    await user.keyboard("{Enter}");

    const preview = screen.getByTestId("entity-hover-card");
    expect(preview).toHaveAttribute(
      "data-entity-id",
      proposalLink.targetEntityId,
    );
    expect(preview).toHaveAttribute("data-focus-on-open", "true");
    expect(
      within(preview).getByTestId("entity-hover-card-title-link"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(proposalLink.targetEntityId),
    );

    fireEvent.keyDown(preview, { key: "Escape" });
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    expect(icon).toHaveFocus();

    await user.keyboard(" ");
    expect(screen.getByTestId("entity-hover-card")).toBeInTheDocument();
  });

  it("renders without scope but never requests previews or types", async () => {
    render(
      <WorkflowGraphSurface
        projection={projection}
        directEntityLinks={[proposalLink]}
      />,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("workflow-inline-step")).toHaveTextContent(
      "Checkout controller",
    );

    await hoverDirectLink();

    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    expect(scopeArgumentsSeen()).not.toContain("projected");
    expect(
      scopeArgumentsSeen().filter(
        (value) => typeof value === "string" && value,
      ),
    ).toEqual([]);
  });
});
