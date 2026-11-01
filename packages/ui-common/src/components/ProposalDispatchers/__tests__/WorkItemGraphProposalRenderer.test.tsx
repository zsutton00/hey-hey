import { cloneElement, type ReactElement, type PropsWithChildren } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render as testingLibraryRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  ProposalAction,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemChangeSetMaterializationState,
  type ProjectedWorkItemChangeSetResponse,
  type ProposalResponseDto,
  type WorkItemChangeSetOperation,
  type WorkItemChangeSetValidationRequest,
  type WorkItemChangeSetPosition,
} from "../../../api";
import type { WorkItemGraphDraftProjection } from "../../shared/workItemGraphDraft";
import type {
  WorkflowGraphCreatedElements,
  WorkflowGraphDiffElements,
  WorkflowGraphPresentationState,
} from "../../shared/WorkflowMentionInlineRenderer";
import { WorkItemGraphProposalRenderer } from "../WorkItemGraphProposalRenderer";

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return testingLibraryRender(ui, { wrapper: Wrapper });
}

vi.mock("../../Entity", () => ({
  EntityLinkWithPreview: ({ label }: { label: string }) => <span>{label}</span>,
}));

const { mockUseWorkItemGraph, registryState, featureNames } = vi.hoisted(
  () => ({
    mockUseWorkItemGraph: vi.fn(),
    featureNames: new Map<
      string,
      { id: string; name: string; parentTaskId: string | null }
    >(),
    registryState: { error: null as Error | null },
  }),
);

vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => featureLookup,
}));
const featureLookup = {
  isReady: true,
  isLoading: false,
  get: (id: string) => featureNames.get(id),
};

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: ["custom_graph", "workflow", "DIAGRAM"].map((key) => ({
      definition: {
        key,
        name: key,
        role: "project-info",
        sections: [],
        allowedStatuses: [],
        capabilities: {
          graph: {
            nodeChildType: key === "DIAGRAM" ? "DIAGRAM_ELEMENT" : "graph_node",
            layout: {
              sectionKey: "authoredPositions",
              schemaRef: "work-item-graph-layout.v1",
            },
            layoutPreference: {
              sectionKey: "layoutPreference",
              schemaRef: "work-item-graph-layout-preference.v1",
            },
            readableRelationships: [],
            editableRelationships: [],
            rendererKey: "work-item-graph",
            editorKey: "work-item-graph-editor",
            supportedActions: [],
          },
        },
      },
      status: "ACTIVE",
      projectId: null,
    })),
    isLoading: false,
    error: registryState.error,
  }),
}));

const mockValidate = vi.fn();
const mockGetTask = vi.fn();
const mockGetWorkItemGraph = vi.fn();
const stateIndicatorProps = vi.fn();
const graphSurfaceProps = vi.fn();
const buildCanonicalPositions = vi.fn(
  (children: ProjectedWorkItemChangeSetResponse["children"]) =>
    new Map(
      children.map((child, index) => [
        child.identity.refType === "existing"
          ? `existing:${child.identity.id}`
          : `temporary:${child.identity.tempId}`,
        { x: 24 + index * 264, y: 24 },
      ]),
    ),
);

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTask: (...args: unknown[]) => mockGetTask(...args),
    getWorkItemGraph: (...args: unknown[]) => mockGetWorkItemGraph(...args),
  },
  proposalsClient: {
    validateProposal: (...args: unknown[]) => mockValidate(...args),
  },
}));

vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: (...args: unknown[]) => mockUseWorkItemGraph(...args),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({
    workItem: { id: "root-id", name: "Root", type: "custom_graph" },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../shared/WorkflowMentionInlineRenderer", () => ({
  buildCanonicalProjectedGraphPositions: (
    children: ProjectedWorkItemChangeSetResponse["children"],
  ) => buildCanonicalPositions(children),
  WorkflowGraphSurface: (props: {
    projection: WorkItemGraphDraftProjection;
    createdElements?: WorkflowGraphCreatedElements;
    diffElements?: WorkflowGraphDiffElements;
    presentationState?: WorkflowGraphPresentationState;
  }) => {
    graphSurfaceProps(props);
    return <div data-testid="projected-graph" />;
  },
}));

vi.mock("../ProposalStateIndicator", () => ({
  ProposalStateIndicator: (props: { disabled?: boolean }) => {
    stateIndicatorProps(props);
    return (
      <button disabled={props.disabled} data-testid="confirm-graph">
        Confirm
      </button>
    );
  },
}));

const root = { refType: "existing" as const, id: "root-id" };
const first = { refType: "existing" as const, id: "first-id" };
const second = { refType: "existing" as const, id: "second-id" };
const checkPrices = {
  refType: "temporary" as const,
  tempId: "check-prices",
};
const projection = (
  valid: boolean,
  rootType = "custom_graph",
): ProjectedWorkItemChangeSetResponse => ({
  valid,
  projectedRoot: {
    identity: root,
    label: "Root",
    type: rootType,
    name: "Root",
    sections: [],
    deleted: false,
  },
  children: [],
  sections: [],
  incidentRelationships: [],
  identityLabels: { "existing:root-id": "Root" },
  issues: valid
    ? []
    : [
        {
          field: "operations[0]",
          code: "invalid_parent",
          reason: "The parent is outside the graph boundary.",
          layer: "structural",
          suggestion: "Choose a child of this graph.",
        },
      ],
  warnings: [],
});

const buildProposal = (
  materialization?: ProposalResponseDto["materialization"],
  operations: WorkItemChangeSetOperation[] = [],
): ProposalResponseDto & {
  updates: { root: typeof root; operations: WorkItemChangeSetOperation[] };
} =>
  ({
    id: "proposal-id",
    organizationId: "organization-id",
    projectId: "project-id",
    action: ProposalAction.Update,
    status: ProposalStatus.Draft,
    type: ProposalType.Single,
    targetEntityId: "root-id",
    targetEntityType: TargetEntityType.Task,
    title: "Root",
    updates: { root, operations },
    approvals: [],
    materialization,
    requestorId: "user-id",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  }) as ProposalResponseDto & {
    updates: { root: typeof root; operations: WorkItemChangeSetOperation[] };
  };

function projectionWithAuthoredLayout(
  rootType: string,
  positions: readonly [WorkItemChangeSetPosition, WorkItemChangeSetPosition],
): ProjectedWorkItemChangeSetResponse {
  const layoutContent = {
    schemaVersion: "work-item-graph-layout.v1",
    nodes: [
      {
        node: { kind: "persistedWorkItem" as const, workItemId: first.id },
        position: positions[0],
      },
      {
        node: { kind: "persistedWorkItem" as const, workItemId: second.id },
        position: positions[1],
      },
    ],
  };
  return {
    ...projection(true, rootType),
    projectedRoot: {
      ...projection(true, rootType).projectedRoot,
      sections: [{ key: "authoredPositions", content: layoutContent }],
    },
    sections: [{ key: "authoredPositions", content: layoutContent }],
    children: [
      {
        identity: first,
        label: "First",
        type: "graph_node",
        name: "First",
        parent: root,
        sections: [],
        deleted: false,
      },
      {
        identity: second,
        label: "Second",
        type: "graph_node",
        name: "Second",
        parent: root,
        sections: [],
        deleted: false,
      },
    ],
  };
}

const layoutReplace = (
  positions: readonly [WorkItemChangeSetPosition, WorkItemChangeSetPosition],
): WorkItemChangeSetOperation => ({
  op: "layout.replace",
  root,
  sectionKey: "authoredPositions",
  entries: [
    { node: first, position: positions[0] },
    { node: second, position: positions[1] },
  ],
});

const mixedWorkflowPositions = [
  { x: 40, y: 80 },
  { x: 360, y: 80 },
  { x: 680, y: 240 },
] as const;

const mixedWorkflowOperations: WorkItemChangeSetOperation[] = [
  { op: "workItem.update", ref: first, name: "Choose item" },
  {
    op: "section.replace",
    ref: first,
    key: "description",
    content: "Choose the item to buy.",
  },
  {
    op: "workItem.create",
    ref: checkPrices,
    name: "Check prices",
    type: "workflow_step",
    parent: root,
  },
  {
    op: "relationship.create",
    ref: { refType: "temporary", tempId: "standard-first-check" },
    source: first,
    target: checkPrices,
    edgeType: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
  },
  {
    op: "relationship.create",
    ref: { refType: "temporary", tempId: "standard-check-second" },
    source: checkPrices,
    target: second,
    edgeType: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
  },
  {
    op: "relationship.create",
    ref: { refType: "temporary", tempId: "conditional-check-first" },
    source: checkPrices,
    target: first,
    edgeType: AgentEdgeType.Conditional,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
    predicate: "Too high",
  },
  {
    op: "layout.replace",
    root,
    sectionKey: "authoredPositions",
    entries: [first, checkPrices, second].map((node, index) => ({
      node,
      position: mixedWorkflowPositions[index] ?? { x: 0, y: 0 },
    })),
  },
];

function mixedWorkflowProjection(): ProjectedWorkItemChangeSetResponse {
  const children = [
    {
      identity: first,
      label: "Choose item",
      type: "workflow_step",
      name: "Choose item",
      parent: root,
      sections: [{ key: "description", content: "Choose the item to buy." }],
      deleted: false,
    },
    {
      identity: checkPrices,
      label: "Check prices",
      type: "workflow_step",
      name: "Check prices",
      parent: root,
      sections: [],
      deleted: false,
    },
    {
      identity: second,
      label: "Purchase",
      type: "workflow_step",
      name: "Purchase",
      parent: root,
      sections: [],
      deleted: false,
    },
  ];
  const layoutContent = {
    schemaVersion: "work-item-graph-layout.v1",
    nodes: [
      {
        node: { kind: "persistedWorkItem" as const, workItemId: first.id },
        position: mixedWorkflowPositions[0],
      },
      {
        node: {
          kind: "temporaryWorkItem" as const,
          temporaryRef: checkPrices.tempId,
        },
        position: mixedWorkflowPositions[1],
      },
      {
        node: { kind: "persistedWorkItem" as const, workItemId: second.id },
        position: mixedWorkflowPositions[2],
      },
    ],
  };
  return {
    valid: true,
    projectedRoot: {
      identity: root,
      label: "Shopping workflow",
      type: "workflow",
      name: "Shopping workflow",
      sections: [{ key: "authoredPositions", content: layoutContent }],
      deleted: false,
    },
    children,
    sections: [{ key: "authoredPositions", content: layoutContent }],
    incidentRelationships: [
      {
        identity: { refType: "temporary", tempId: "standard-first-check" },
        label: AgentEdgeType.Standard,
        source: first,
        target: checkPrices,
        edgeType: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: null,
        deleted: false,
      },
      {
        identity: { refType: "temporary", tempId: "standard-check-second" },
        label: AgentEdgeType.Standard,
        source: checkPrices,
        target: second,
        edgeType: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: null,
        deleted: false,
      },
      {
        identity: { refType: "temporary", tempId: "conditional-check-first" },
        label: AgentEdgeType.Conditional,
        source: checkPrices,
        target: first,
        edgeType: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "Too high",
        deleted: false,
      },
    ],
    identityLabels: {
      "existing:first-id": "Choose item",
      "temporary:check-prices": "Check prices",
      "existing:second-id": "Purchase",
    },
    issues: [],
    warnings: [],
  };
}

beforeEach(() => {
  featureNames.clear();
  vi.clearAllMocks();
  registryState.error = null;
  mockUseWorkItemGraph.mockReturnValue({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: false,
    isReady: false,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  });
  mockGetTask.mockReset();
  buildCanonicalPositions.mockImplementation(
    (children) =>
      new Map(
        children.map((child, index) => [
          child.identity.refType === "existing"
            ? `existing:${child.identity.id}`
            : `temporary:${child.identity.tempId}`,
          { x: 24 + index * 264, y: 24 },
        ]),
      ),
  );
});

describe("WorkItemGraphProposalRenderer", () => {
  it.each([
    [ProposalAction.Create, "DIAGRAM"],
    [ProposalAction.Update, "DIAGRAM"],
    [ProposalAction.Update, "custom_graph"],
  ])("shows the named %s %s root", async (action, rootType) => {
    const namedProjection = projection(true, rootType);
    namedProjection.projectedRoot.name = "Service architecture";
    namedProjection.projectedRoot.label = "Service architecture";
    const createdRoot = {
      refType: "temporary" as const,
      tempId: "new-diagram",
    };
    const updates: WorkItemChangeSetValidationRequest =
      action === ProposalAction.Create
        ? {
            root: createdRoot,
            operations: [
              {
                op: "workItem.create",
                ref: createdRoot,
                type: rootType,
                name: "Service architecture",
              },
            ],
          }
        : buildProposal().updates;
    namedProjection.projectedRoot.identity = updates.root;
    mockValidate.mockResolvedValue({ data: { data: namedProjection } });

    render(
      <WorkItemGraphProposalRenderer
        proposal={{
          ...buildProposal(),
          action,
          updates,
          title: "Revise graph relationships",
        }}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(await screen.findByText("Service architecture")).toBeInTheDocument();
    expect(screen.queryByText("Graph change set")).not.toBeInTheDocument();
  });

  it("describes the same mixed metadata, reference, relationship, removal, and layout result as validation", async () => {
    const oldReferenceId = "old-reference-id";
    const newReferenceId = "new-reference-id";
    const updatedRelationship = {
      refType: "existing" as const,
      id: "updated-relationship-id",
    };
    const removedRelationship = {
      refType: "existing" as const,
      id: "removed-relationship-id",
    };
    const operations: WorkItemChangeSetOperation[] = [
      {
        op: "section.replace",
        ref: root,
        key: "diagramMetadata",
        content: { kind: "C4", level: "CONTAINER" },
      },
      {
        op: "section.replace",
        ref: first,
        key: "diagramElementMetadata",
        content: {
          role: "SERVICE",
          canonicalReference: {
            entityType: "SERVICE",
            entityId: newReferenceId,
          },
        },
      },
      { op: "section.clear", ref: first, key: "description" },
      {
        op: "relationship.update",
        ref: updatedRelationship,
        target: second,
        direction: AgentEdgeDirection.Backward,
        predicate: null,
        reasoning: null,
      },
      { op: "relationship.delete", ref: removedRelationship },
      layoutReplace([
        { x: 120, y: 240 },
        { x: 520, y: 240 },
      ]),
    ];
    const resultingProjection = projectionWithAuthoredLayout("DIAGRAM", [
      { x: 120, y: 240 },
      { x: 520, y: 240 },
    ]);
    const resultingDiagramMetadata = { kind: "C4", level: "CONTAINER" };
    resultingProjection.projectedRoot.sections = [
      { key: "diagramMetadata", content: resultingDiagramMetadata },
      ...resultingProjection.projectedRoot.sections,
    ];
    resultingProjection.sections = resultingProjection.projectedRoot.sections;
    resultingProjection.children[0] = {
      ...resultingProjection.children[0],
      sections: [
        {
          key: "diagramElementMetadata",
          content: {
            role: "SERVICE",
            canonicalReference: {
              entityType: "SERVICE",
              entityId: newReferenceId,
            },
          },
        },
      ],
    };
    resultingProjection.incidentRelationships = [
      {
        identity: updatedRelationship,
        label: AgentEdgeType.Conditional,
        source: first,
        target: second,
        edgeType: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Backward,
        predicate: null,
        reasoning: null,
        deleted: false,
      },
      {
        identity: removedRelationship,
        label: AgentEdgeType.RelatedTo,
        source: first,
        target: second,
        edgeType: AgentEdgeType.RelatedTo,
        category: AgentEdgeCategory.Meta,
        reasoning: "Obsolete context",
        deleted: true,
      },
    ];
    resultingProjection.identityLabels = {
      ...resultingProjection.identityLabels,
      [`existing:${newReferenceId}`]: "Billing API",
    };
    mockUseWorkItemGraph.mockReturnValue({
      data: {
        root: {
          id: root.id,
          name: "Architecture",
          sections: [
            {
              id: "diagram-metadata-section-id",
              key: "diagramMetadata",
              materializedMarkdown: JSON.stringify({
                kind: "GENERAL",
                level: "NONE",
              }),
              materializedProposalId: "prior-proposal-id",
              order: 0,
            },
          ],
        },
        children: [
          {
            id: first.id,
            name: "First",
            sections: [
              {
                id: "diagram-element-metadata-section-id",
                key: "diagramElementMetadata",
                materializedMarkdown: JSON.stringify({
                  role: "DIAGRAM_REFERENCE",
                  canonicalReference: {
                    entityType: "TASK",
                    entityId: oldReferenceId,
                  },
                }),
                materializedProposalId: "prior-proposal-id",
                order: 0,
              },
              {
                id: "description-section-id",
                key: "description",
                materializedMarkdown: "Clear this explanation",
                materializedProposalId: "prior-proposal-id",
                order: 1,
              },
            ],
          },
        ],
        relationships: [
          {
            id: updatedRelationship.id,
            sourceNodeId: first.id,
            targetNodeId: first.id,
            type: AgentEdgeType.Conditional,
            category: AgentEdgeCategory.Flow,
            direction: AgentEdgeDirection.Forward,
            predicate: "Retry",
            reasoning: "Old reason",
            metadata: null,
          },
          {
            id: removedRelationship.id,
            sourceNodeId: first.id,
            targetNodeId: second.id,
            type: AgentEdgeType.RelatedTo,
            category: AgentEdgeCategory.Meta,
            reasoning: "Obsolete context",
            metadata: null,
          },
        ],
        layout: {
          schemaVersion: "work-item-graph-layout.v1",
          nodes: [
            {
              node: { kind: "persistedWorkItem", workItemId: first.id },
              position: { x: 24, y: 24 },
            },
            {
              node: { kind: "persistedWorkItem", workItemId: second.id },
              position: { x: 288, y: 24 },
            },
          ],
        },
        derivedReferences: [
          {
            entityType: "TASK",
            entityId: oldReferenceId,
            displayName: "Legacy diagram",
          },
        ],
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
    mockValidate.mockResolvedValue({ data: { data: resultingProjection } });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal(undefined, operations)}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    const summary = await screen.findByTestId("work-item-graph-change-summary");
    const summaryToggle = screen.getByTestId(
      "work-item-graph-change-summary-toggle",
    );
    expect(summaryToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("projected-graph").nextElementSibling).toBe(
      summary,
    );
    fireEvent.click(summaryToggle);
    expect(summaryToggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(summary).toHaveTextContent("Kind: General"));
    expect(summary).toHaveTextContent("Kind: General");
    expect(summary).toHaveTextContent("Level: Container");
    expect(summary).toHaveTextContent("Legacy diagram");
    expect(summary).toHaveTextContent("Billing API");
    expect(summary).toHaveTextContent("Explicitly cleared");
    expect(summary).not.toHaveTextContent("Before:");
    expect(summary).not.toHaveTextContent("After:");
    expect(
      within(summary).getAllByTestId("diff-renderer-split-view").length,
    ).toBeGreaterThan(0);
    expect(summary).toHaveTextContent("Direction: Forward");
    expect(summary).toHaveTextContent("Direction: Backward");
    expect(summary).toHaveTextContent("First → First");
    expect(summary).toHaveTextContent("First → Second");
    expect(summary).toHaveTextContent("Removed");
    expect(summary).toHaveTextContent("First: (120, 240)");
    expect(summary).toHaveTextContent("Second: (520, 240)");
    expect(summary).toHaveTextContent("First: (24, 24)");

    const reviewedResult = graphSurfaceProps.mock.lastCall?.[0]
      .projection as WorkItemGraphDraftProjection;
    const materializedAggregateMeaning = {
      diagramMetadata: resultingDiagramMetadata,
      elementMetadata: {
        role: "SERVICE",
        canonicalReference: {
          entityType: "SERVICE",
          entityId: newReferenceId,
        },
      },
      relationships: [
        {
          source: first,
          target: second,
          direction: AgentEdgeDirection.Backward,
          predicate: null,
          reasoning: null,
        },
      ],
      layout: [
        { node: first, position: { x: 120, y: 240 } },
        { node: second, position: { x: 520, y: 240 } },
      ],
    };
    expect({
      diagramMetadata: reviewedResult.projectedRoot.sections.find(
        (section) => section.key === "diagramMetadata",
      )?.content,
      elementMetadata: reviewedResult.children[0]?.sections.find(
        (section) => section.key === "diagramElementMetadata",
      )?.content,
      relationships: reviewedResult.incidentRelationships
        .filter((relationship) => !relationship.deleted)
        .map((relationship) => ({
          source: relationship.source,
          target: relationship.target,
          direction: relationship.direction,
          predicate: relationship.predicate,
          reasoning: relationship.reasoning,
        })),
      layout: reviewedResult.effectiveLayout.nodes,
    }).toEqual(materializedAggregateMeaning);
  });

  it("renders the authoritative workflow as soon as approval reaches the applied UI state", () => {
    const proposal = buildProposal(undefined, [
      {
        op: "relationship.delete",
        ref: { refType: "existing", id: "historical-relationship-id" },
      },
    ]);
    const publishedProjection = mixedWorkflowProjection();
    mockValidate.mockResolvedValue({ data: { data: projection(false) } });
    mockUseWorkItemGraph.mockReturnValue({
      data: {
        root: {
          id: "root-id",
          name: "Shopping workflow",
          type: "workflow",
        },
        children: publishedProjection.children.map((child) => ({
          id:
            child.identity.refType === "existing"
              ? child.identity.id
              : child.identity.tempId,
          name: child.name,
          type: child.type,
        })),
        relationships: [],
        layout: null,
        derivedReferences: [],
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

    render(
      <WorkItemGraphProposalRenderer
        proposal={proposal}
        status={{ state: "applied" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(mockValidate).not.toHaveBeenCalled();
    expect(screen.getByTestId("projected-graph")).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-graph-validation-issues"),
    ).not.toBeInTheDocument();
    expect(mockUseWorkItemGraph).toHaveBeenCalledWith(
      "organization-id",
      "project-id",
      "root-id",
      { enabled: true, refetchOnMount: true },
    );
  });

  it.each([null, 404, 503])(
    "waits and retries for an unavailable published graph (%s)",
    async (responseStatus) => {
      const refetch = vi.fn().mockResolvedValue(null);
      mockUseWorkItemGraph.mockReturnValue({
        data: null,
        isFetched: true,
        isFetching: false,
        refetch,
        error:
          responseStatus === null
            ? null
            : new AxiosError("Unavailable", undefined, undefined, undefined, {
                status: responseStatus,
                statusText: "Unavailable",
                data: null,
                headers: {},
                config: { headers: new AxiosHeaders() },
              }),
      });
      const ui = (
        <WorkItemGraphProposalRenderer
          proposal={buildProposal()}
          status={{ state: "applied" }}
          onApply={vi.fn()}
          organizationId="organization-id"
          projectId="project-id"
        />
      );
      const view = render(ui);
      expect(
        screen.getByTestId("published-work-item-graph-loading"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("published-work-item-graph-error"),
      ).not.toBeInTheDocument();
      await waitFor(() => expect(refetch).toHaveBeenCalledOnce(), {
        timeout: 2500,
      });
      mockUseWorkItemGraph.mockReturnValue({
        data: {
          root: { id: "root-id", name: "Published graph", type: "workflow" },
          children: [],
          relationships: [],
          layout: null,
          derivedReferences: [],
        },
        isFetched: true,
        isFetching: false,
        error: null,
        refetch,
      });
      view.rerender(cloneElement(ui));
      expect(screen.getByTestId("projected-graph")).toBeInTheDocument();
      expect(
        screen.queryByTestId("published-work-item-graph-loading"),
      ).not.toBeInTheDocument();
      expect(mockValidate).not.toHaveBeenCalled();
    },
  );

  it("keeps waiting beyond eight reads and renders a late publication", async () => {
    vi.useFakeTimers();
    try {
      const refetch = vi.fn().mockResolvedValue(null);
      mockUseWorkItemGraph.mockReturnValue({
        data: null,
        isFetched: true,
        isFetching: false,
        error: null,
        refetch,
      });
      const ui = (
        <WorkItemGraphProposalRenderer
          proposal={buildProposal()}
          status={{ state: "applied" }}
          onApply={vi.fn()}
          organizationId="organization-id"
          projectId="project-id"
        />
      );
      const view = render(ui);
      for (let read = 0; read < 10; read += 1) {
        await act(() => vi.advanceTimersByTimeAsync(30_000));
        expect(
          screen.queryByTestId("published-work-item-graph-error"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByTestId("published-work-item-graph-loading"),
        ).toBeInTheDocument();
      }
      expect(refetch.mock.calls.length).toBeGreaterThan(8);
      mockUseWorkItemGraph.mockReturnValue({
        data: {
          root: { id: "root-id", name: "Published graph", type: "workflow" },
          children: [],
          relationships: [],
          layout: null,
          derivedReferences: [],
        },
        isFetched: true,
        isFetching: false,
        error: null,
        refetch,
      });
      view.rerender(cloneElement(ui));
      expect(screen.getByTestId("projected-graph")).toBeInTheDocument();
      const reads = refetch.mock.calls.length;
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(refetch).toHaveBeenCalledTimes(reads);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient read through the real graph hook until publication", async () => {
    const { useWorkItemGraph } = await vi.importActual<
      typeof import("../../../data/hooks/useWorkItemGraph")
    >("../../../data/hooks/useWorkItemGraph");
    mockUseWorkItemGraph.mockImplementation(useWorkItemGraph);
    mockGetWorkItemGraph
      .mockReset()
      .mockRejectedValueOnce(
        Object.assign(new Error("Not published yet"), { status: 404 }),
      )
      .mockResolvedValue({
        data: {
          data: {
            root: { id: "root-id", name: "Published graph", type: "workflow" },
            children: [],
            relationships: [],
            layout: null,
            derivedReferences: [],
          },
        },
      });
    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "applied" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );
    await waitFor(() => expect(mockGetWorkItemGraph).toHaveBeenCalledOnce());
    expect(
      screen.queryByTestId("published-work-item-graph-error"),
    ).not.toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByTestId("projected-graph")).toBeInTheDocument(),
      { timeout: 2500 },
    );
    expect(mockGetWorkItemGraph).toHaveBeenCalledTimes(2);
  });

  it.each([
    WorkItemChangeSetMaterializationState.Queued,
    WorkItemChangeSetMaterializationState.Applying,
    WorkItemChangeSetMaterializationState.RecoverableFailure,
  ])("waits while applied proposal materialization is %s", (state) => {
    mockUseWorkItemGraph.mockReturnValue({
      data: {
        root: { id: "root-id", name: "Published graph", type: "workflow" },
        children: [],
        relationships: [],
        layout: null,
        derivedReferences: [],
      },
      isFetched: true,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    const view = render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal({ state, attemptCount: 1, operations: [] })}
        status={{ state: "applied" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );
    expect(
      screen.getByTestId("published-work-item-graph-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("published-work-item-graph-error"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("projected-graph")).not.toBeInTheDocument();
    view.rerender(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal({
          state: WorkItemChangeSetMaterializationState.Published,
          attemptCount: 1,
          operations: [],
        })}
        status={{ state: "applied" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );
    expect(screen.getByTestId("projected-graph")).toBeInTheDocument();
  });

  it("preserves an available graph when a refresh fails transiently", () => {
    mockUseWorkItemGraph.mockReturnValue({
      data: {
        root: { id: "root-id", name: "Published graph", type: "workflow" },
        children: [],
        relationships: [],
        layout: null,
        derivedReferences: [],
      },
      isFetched: true,
      isFetching: false,
      error: new Error("Network unavailable"),
      refetch: vi.fn(),
    });
    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "applied" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );
    expect(screen.getByTestId("projected-graph")).toBeInTheDocument();
    expect(
      screen.queryByTestId("published-work-item-graph-error"),
    ).not.toBeInTheDocument();
  });

  it("shows an authoritative terminal graph read failure", () => {
    const refetch = vi.fn();
    mockUseWorkItemGraph.mockReturnValue({
      data: null,
      isFetched: true,
      isFetching: false,
      refetch,
      error: new AxiosError("Forbidden", undefined, undefined, undefined, {
        status: 403,
        statusText: "Forbidden",
        data: null,
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    });
    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "applied" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );
    expect(
      screen.getByTestId("published-work-item-graph-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("published-work-item-graph-loading"),
    ).not.toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("uses authored presentation for a single Diagram CREATE preview", async () => {
    mockValidate.mockResolvedValue({
      data: { data: projection(true, "DIAGRAM") },
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={{
          ...buildProposal(),
          action: ProposalAction.Create,
        }}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    await screen.findByTestId("projected-graph");
    expect(graphSurfaceProps.mock.lastCall?.[0].presentationState).toBe(
      "authored",
    );
  });

  it.each(["GENERIC", "START", "END"])(
    "preserves %s and element links in the pre-approval graph",
    async (role) => {
      const edge = {
        sourceRef: first,
        targetEntityId: "linked-proposal-id",
        targetEntityType: ProposalEdgeTargetType.Proposal,
        edgeType: ProposalEdgeType.RelatedTo,
        targetEntityTitle: null,
      };
      const proposal = {
        ...buildProposal(),
        edges: [edge],
      };
      const targetProposal = (status: ProposalStatus): ProposalResponseDto =>
        ({
          ...buildProposal(),
          id: "linked-proposal-id",
          action: ProposalAction.Create,
          status,
          targetEntityId:
            status === ProposalStatus.Approved
              ? "materialized-design-doc-id"
              : "00000000-0000-0000-0000-000000000000",
          targetEntityType: TargetEntityType.DesignDoc,
          title: "Diagram design",
        }) as ProposalResponseDto;
      const reviewedProjection = {
        ...projection(true, "DIAGRAM"),
        children: [
          {
            identity: first,
            label: "Generic Element",
            name: "Generic Element",
            type: "DIAGRAM_ELEMENT",
            parent: root,
            sections: [
              {
                key: "diagramElementMetadata",
                content: { role },
              },
            ],
            deleted: false,
          },
        ],
        identityLabels: { "existing:first-id": "Generic Element" },
      };
      mockValidate.mockResolvedValue({ data: { data: reviewedProjection } });

      const view = render(
        <WorkItemGraphProposalRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={vi.fn()}
          organizationId="organization-id"
          projectId="project-id"
          siblingProposals={
            new Map([
              ["linked-proposal-id", targetProposal(ProposalStatus.Draft)],
            ])
          }
        />,
      );

      await screen.findByTestId("projected-graph");
      expect(
        graphSurfaceProps.mock.lastCall?.[0].projection.children[0].sections,
      ).toEqual([{ key: "diagramElementMetadata", content: { role } }]);
      expect(graphSurfaceProps.mock.lastCall?.[0].directEntityLinks).toEqual([
        {
          sourceNodeId: "first-id",
          targetEntityId: "linked-proposal-id",
          targetEntityType: ProposalEdgeTargetType.Proposal,
          targetTitle: "Diagram design",
          relationshipType: ProposalEdgeType.RelatedTo,
        },
      ]);
      expect(screen.getByText("Relationships")).toBeInTheDocument();
      expect(screen.getByText("Generic Element")).toBeInTheDocument();
      expect(screen.getByText("Diagram design")).toBeInTheDocument();

      view.rerender(
        <WorkItemGraphProposalRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={vi.fn()}
          organizationId="organization-id"
          projectId="project-id"
          siblingProposals={
            new Map([
              ["linked-proposal-id", targetProposal(ProposalStatus.Approved)],
            ])
          }
        />,
      );

      await waitFor(() => {
        expect(graphSurfaceProps.mock.lastCall?.[0].directEntityLinks).toEqual([
          {
            sourceNodeId: "first-id",
            targetEntityId: "materialized-design-doc-id",
            targetEntityType: TargetEntityType.DesignDoc,
            targetTitle: "Diagram design",
            relationshipType: ProposalEdgeType.RelatedTo,
          },
        ]);
      });
      expect(screen.getByText("Relationships")).toBeInTheDocument();
    },
  );

  it("renders the complete mixed workflow update before enabling confirmation", async () => {
    mockValidate.mockResolvedValue({
      data: { data: mixedWorkflowProjection() },
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal(undefined, mixedWorkflowOperations)}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    await screen.findByTestId("projected-graph");
    const renderedProjection = graphSurfaceProps.mock.lastCall?.[0]
      .projection as WorkItemGraphDraftProjection;
    expect(renderedProjection.children.map((child) => child.name)).toEqual([
      "Choose item",
      "Check prices",
      "Purchase",
    ]);
    expect(
      renderedProjection.incidentRelationships.map((relationship) => ({
        type: relationship.edgeType,
        source: relationship.source,
        target: relationship.target,
        predicate: relationship.predicate,
      })),
    ).toEqual([
      {
        type: AgentEdgeType.Standard,
        source: first,
        target: checkPrices,
        predicate: null,
      },
      {
        type: AgentEdgeType.Standard,
        source: checkPrices,
        target: second,
        predicate: null,
      },
      {
        type: AgentEdgeType.Conditional,
        source: checkPrices,
        target: first,
        predicate: "Too high",
      },
    ]);
    expect(
      renderedProjection.effectiveLayout.nodes.map((entry) => ({
        node: entry.node,
        position: entry.position,
      })),
    ).toEqual([
      { node: first, position: mixedWorkflowPositions[0] },
      { node: second, position: mixedWorkflowPositions[2] },
      { node: checkPrices, position: mixedWorkflowPositions[1] },
    ]);
    expect(graphSurfaceProps.mock.lastCall?.[0].createdElements).toEqual({
      children: [checkPrices],
      relationships: [
        { refType: "temporary", tempId: "standard-first-check" },
        { refType: "temporary", tempId: "standard-check-second" },
        { refType: "temporary", tempId: "conditional-check-first" },
      ],
    });
    expect(graphSurfaceProps.mock.lastCall?.[0].diffElements).toEqual({
      added: {
        children: [checkPrices],
        relationships: [
          { refType: "temporary", tempId: "standard-first-check" },
          { refType: "temporary", tempId: "standard-check-second" },
          { refType: "temporary", tempId: "conditional-check-first" },
        ],
      },
      changed: { children: [first], relationships: [] },
      deleted: { children: [], relationships: [] },
    });
    expect(graphSurfaceProps.mock.lastCall?.[0].presentationState).toBe(
      "added",
    );
    expect(screen.getByTestId("confirm-graph")).not.toBeDisabled();
  });

  it("keeps mixed section and fulfillment changes visible when the projected graph looks unchanged", async () => {
    const fulfillmentTarget = {
      refType: "existing" as const,
      id: "fulfillment-target",
    };
    const deletedFulfillment = {
      refType: "existing" as const,
      id: "deleted-fulfillment",
    };
    const createdFulfillment = {
      refType: "temporary" as const,
      tempId: "created-fulfillment",
    };
    const operations: WorkItemChangeSetOperation[] = [
      {
        op: "section.replace",
        ref: first,
        key: "description",
        content: "Persist the report without consumer-routing guidance.",
      },
      { op: "relationship.delete", ref: deletedFulfillment },
      {
        op: "relationship.create",
        ref: createdFulfillment,
        source: first,
        target: fulfillmentTarget,
        edgeType: AgentEdgeType.FulfilledBy,
        category: AgentEdgeCategory.Meta,
      },
    ];
    mockValidate.mockResolvedValue({
      data: {
        data: {
          ...projection(true, "workflow"),
          children: [
            {
              identity: first,
              label: "Persist the canonical report",
              type: "workflow_step",
              name: "Persist the canonical report",
              parent: root,
              sections: [
                {
                  key: "description",
                  content:
                    "Persist the report without consumer-routing guidance.",
                },
              ],
              deleted: false,
            },
          ],
          incidentRelationships: [
            {
              identity: deletedFulfillment,
              label: AgentEdgeType.FulfilledBy,
              source: first,
              target: second,
              edgeType: AgentEdgeType.FulfilledBy,
              category: AgentEdgeCategory.Meta,
              deleted: true,
            },
            {
              identity: createdFulfillment,
              label: AgentEdgeType.FulfilledBy,
              source: first,
              target: fulfillmentTarget,
              edgeType: AgentEdgeType.FulfilledBy,
              category: AgentEdgeCategory.Meta,
              deleted: false,
            },
          ],
          identityLabels: {
            "existing:root-id": "Report evaluation workflow",
            "existing:first-id": "Persist the canonical report",
            "existing:second-id": "Old implementation",
            "existing:fulfillment-target": "Remove persisted routing guidance",
          },
        },
      },
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal(undefined, operations)}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    const summary = await screen.findByTestId("work-item-graph-change-summary");
    const summaryToggle = screen.getByTestId(
      "work-item-graph-change-summary-toggle",
    );
    expect(summaryToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(summaryToggle);
    expect(summaryToggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(summary).toHaveTextContent("Updated Description"),
    );
    expect(summary).toHaveTextContent("Updated Description");
    expect(summary).toHaveTextContent("Persist the canonical report");
    expect(summary).toHaveTextContent(
      "Persist the report without consumer-routing guidance.",
    );
    expect(summary).toHaveTextContent("Removed FULFILLED BY");
    expect(summary).toHaveTextContent("Old implementation");
    expect(summary).toHaveTextContent("Added FULFILLED BY");
    expect(summary).toHaveTextContent("Remove persisted routing guidance");
    const changeCards = screen.getAllByTestId("work-item-graph-change");
    expect(changeCards.map((card) => card.dataset.changeKind)).toEqual([
      "changed",
      "deleted",
      "added",
    ]);
    expect(graphSurfaceProps.mock.lastCall?.[0].diffElements).toEqual({
      added: { children: [], relationships: [createdFulfillment] },
      changed: { children: [first], relationships: [] },
      deleted: { children: [], relationships: [deletedFulfillment] },
    });
  });

  it("resolves external Contract targets before exposing the complete graph review", async () => {
    const contractIdentity = {
      refType: "existing" as const,
      id: "contract-target",
    };
    const contractOperation: WorkItemChangeSetOperation = {
      op: "relationship.create",
      ref: {
        refType: "temporary",
        tempId: "contract-dependency",
      },
      source: first,
      target: contractIdentity,
      edgeType: AgentEdgeType.DependsOn,
      category: AgentEdgeCategory.Meta,
    };
    mockGetTask.mockResolvedValue({
      data: {
        data: {
          id: contractIdentity.id,
          name: "Remote read authorization contract",
          type: "CONTRACT",
        },
      },
    });
    mockValidate.mockResolvedValue({
      data: {
        data: {
          ...mixedWorkflowProjection(),
          incidentRelationships: [
            ...mixedWorkflowProjection().incidentRelationships,
            {
              identity: {
                refType: "temporary" as const,
                tempId: "contract-dependency",
              },
              label: AgentEdgeType.DependsOn,
              source: first,
              target: contractIdentity,
              edgeType: AgentEdgeType.DependsOn,
              category: AgentEdgeCategory.Meta,
              deleted: false,
            },
          ],
        },
      },
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal(undefined, [
          ...mixedWorkflowOperations,
          contractOperation,
        ])}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    await waitFor(() =>
      expect(
        graphSurfaceProps.mock.lastCall?.[0].projection.externalEntities,
      ).toEqual([
        {
          identity: contractIdentity,
          name: "Remote read authorization contract",
          type: "CONTRACT",
        },
      ]),
    );
    expect(mockGetTask).toHaveBeenCalledWith({
      organizationId: "organization-id",
      projectId: "project-id",
      taskId: "contract-target",
    });
    expect(screen.getByTestId("confirm-graph")).not.toBeDisabled();
  });
  it("resolves external feature targets from the hierarchy without fetching task names", async () => {
    const contractIdentity = {
      refType: "existing" as const,
      id: "contract-target",
    };
    const contractOperation: WorkItemChangeSetOperation = {
      op: "relationship.create",
      ref: {
        refType: "temporary",
        tempId: "contract-dependency",
      },
      source: first,
      target: contractIdentity,
      edgeType: AgentEdgeType.DependsOn,
      category: AgentEdgeCategory.Meta,
    };
    featureNames.set(contractIdentity.id, {
      id: contractIdentity.id,
      name: "Cached feature",
      parentTaskId: null,
    });
    mockValidate.mockResolvedValue({
      data: {
        data: {
          ...mixedWorkflowProjection(),
          incidentRelationships: [
            ...mixedWorkflowProjection().incidentRelationships,
            {
              identity: {
                refType: "temporary" as const,
                tempId: "contract-dependency",
              },
              label: AgentEdgeType.DependsOn,
              source: first,
              target: contractIdentity,
              edgeType: AgentEdgeType.DependsOn,
              category: AgentEdgeCategory.Meta,
              deleted: false,
            },
          ],
        },
      },
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal(undefined, [
          ...mixedWorkflowOperations,
          contractOperation,
        ])}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    await waitFor(() =>
      expect(
        graphSurfaceProps.mock.lastCall?.[0].projection.externalEntities,
      ).toEqual([
        {
          identity: contractIdentity,
          name: "Cached feature",
          type: "FEATURE",
        },
      ]),
    );
    expect(mockGetTask).not.toHaveBeenCalled();
    expect(screen.getByTestId("confirm-graph")).not.toBeDisabled();
  });

  it.each([
    [
      "arrange",
      "workflow",
      [
        { x: 24, y: 24 },
        { x: 304, y: 24 },
      ],
    ],
    [
      "drag",
      "workflow",
      [
        { x: 137, y: 219 },
        { x: 650, y: 91 },
      ],
    ],
    [
      "child creation",
      "custom_graph",
      [
        { x: 400, y: 500 },
        { x: 680, y: 500 },
      ],
    ],
    [
      "topology edit",
      "custom_graph",
      [
        { x: 15, y: 600 },
        { x: 295, y: 760 },
      ],
    ],
  ] as const)(
    "preserves authored coordinates after %s for the %s type",
    async (_scenario, rootType, positions) => {
      mockValidate.mockResolvedValue({
        data: { data: projectionWithAuthoredLayout(rootType, positions) },
      });

      render(
        <WorkItemGraphProposalRenderer
          proposal={buildProposal(undefined, [layoutReplace(positions)])}
          status={{ state: "pending" }}
          onApply={vi.fn()}
          organizationId="organization-id"
          projectId="project-id"
        />,
      );

      await screen.findByTestId("projected-graph");
      const renderedProjection = graphSurfaceProps.mock.lastCall?.[0]
        .projection as WorkItemGraphDraftProjection;
      expect(renderedProjection.layoutSource).toBe("authored");
      expect(renderedProjection.layoutSectionKey).toBe("authoredPositions");
      expect(
        renderedProjection.effectiveLayout.nodes.map((entry) => entry.position),
      ).toEqual(positions);
    },
  );

  it("preserves authored coordinates for a preference-only proposal", async () => {
    const positions = [
      { x: 137, y: 219 },
      { x: 650, y: 91 },
    ] as const;
    mockValidate.mockResolvedValue({
      data: { data: projectionWithAuthoredLayout("custom_graph", positions) },
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal(undefined, [
          {
            op: "section.replace",
            ref: root,
            key: "layoutPreference",
            content: {
              schemaVersion: "work-item-graph-layout-preference.v1",
              rows: 5,
              columns: 3,
            },
          },
        ])}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    await screen.findByTestId("projected-graph");
    const renderedProjection = graphSurfaceProps.mock.lastCall?.[0]
      .projection as WorkItemGraphDraftProjection;
    expect(renderedProjection.layoutSource).toBe("authored");
    expect(
      renderedProjection.effectiveLayout.nodes.map((entry) => entry.position),
    ).toEqual(positions);
  });

  it("reviews a groups-only proposal as labeled boundaries without moving saved positions", async () => {
    const positions = [
      { x: 137, y: 219 },
      { x: 650, y: 91 },
    ] as const;
    const groups = {
      schemaVersion: "diagram-groups.v1",
      groups: [
        {
          id: "aws",
          label: "AWS",
          meaning: "DEPLOYMENT_BOUNDARY",
          members: [],
        },
        {
          id: "aws-us-east-1",
          label: "us-east-1",
          meaning: "DEPLOYMENT_BOUNDARY",
          color: "orange",
          parentGroupId: "aws",
          members: [{ kind: "persistedWorkItem", workItemId: first.id }],
        },
      ],
    };
    const resulting = projectionWithAuthoredLayout("custom_graph", positions);
    resulting.projectedRoot.sections = [
      ...resulting.projectedRoot.sections,
      { key: "diagramGroups", content: groups },
    ];
    resulting.sections = resulting.projectedRoot.sections;
    mockValidate.mockResolvedValue({ data: { data: resulting } });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal(undefined, [
          {
            op: "section.replace",
            ref: root,
            key: "diagramGroups",
            content: groups,
          },
        ])}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    await screen.findByTestId("projected-graph");
    const renderedProjection = graphSurfaceProps.mock.lastCall?.[0]
      .projection as WorkItemGraphDraftProjection;
    expect(renderedProjection.layoutSource).toBe("authored");
    expect(
      renderedProjection.effectiveLayout.nodes.map((entry) => entry.position),
    ).toEqual(positions);
    expect(
      renderedProjection.projectedRoot.sections.find(
        (section) => section.key === "diagramGroups",
      )?.content,
    ).toEqual(groups);

    const summary = await screen.findByTestId("work-item-graph-change-summary");
    fireEvent.click(
      screen.getByTestId("work-item-graph-change-summary-toggle"),
    );
    await waitFor(() =>
      expect(summary).toHaveTextContent("AWS (Deployment boundary)"),
    );
    expect(summary).toHaveTextContent("us-east-1 (Deployment boundary): First");
    expect(summary).not.toHaveTextContent("persistedWorkItem");
  });

  it.each(["custom_graph", "workflow"])(
    "uses the same confirmation path for %s graph fixtures",
    async (rootType) => {
      mockValidate.mockResolvedValue({
        data: { data: projection(true, rootType) },
      });

      render(
        <WorkItemGraphProposalRenderer
          proposal={buildProposal()}
          status={{ state: "pending" }}
          onApply={vi.fn()}
          organizationId="organization-id"
          projectId="project-id"
        />,
      );

      await waitFor(() =>
        expect(screen.getByTestId("confirm-graph")).not.toBeDisabled(),
      );
      expect(screen.getByTestId("projected-graph")).toBeInTheDocument();
    },
  );

  it("shows warnings with their suggestion and keeps confirmation available", async () => {
    mockValidate.mockResolvedValue({
      data: {
        data: {
          ...projection(true),
          warnings: [
            {
              field: "operations[0].name",
              code: "work_item_name_collision",
              reason: "A DIAGRAM_ELEMENT named Checkout already exists.",
              layer: "referential",
              suggestion: "Rename the new item or reuse the existing one.",
            },
          ],
        },
      },
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    const warnings = await screen.findByTestId(
      "work-item-graph-validation-warnings",
    );
    expect(warnings).toHaveTextContent("Checkout already exists");
    expect(warnings).toHaveTextContent("Rename the new item");
    expect(
      screen.queryByTestId("work-item-graph-validation-issues"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("confirm-graph")).not.toBeDisabled(),
    );
  });

  it("blocks invalid projections without rendering a partial graph", async () => {
    mockValidate.mockResolvedValue({ data: { data: projection(false) } });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(
      await screen.findByTestId("work-item-graph-validation-issues"),
    ).toHaveTextContent("invalid_parent");
    expect(screen.queryByTestId("projected-graph")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-graph")).toBeDisabled();
  });

  it("keeps validating a recoverable materialization failure", async () => {
    mockValidate.mockResolvedValue({ data: { data: projection(false) } });
    const proposal = buildProposal({
      state: WorkItemChangeSetMaterializationState.RecoverableFailure,
      attemptCount: 1,
      lastError: "A relationship was not materialized.",
      operations: [],
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={proposal}
        status={{
          state: "failed",
          error: "A relationship was not materialized.",
        }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(
      await screen.findByTestId("work-item-graph-validation-issues"),
    ).toHaveTextContent("invalid_parent");
    expect(mockValidate).toHaveBeenCalledOnce();
    expect(mockUseWorkItemGraph).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("work-item-graph-materialization-progress"),
    ).toHaveAttribute("data-materialization-state", "RECOVERABLE_FAILURE");
  });

  it("shows validation loading and explicit canonical-read failures", async () => {
    let rejectValidation: ((error: Error) => void) | undefined;
    mockValidate.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectValidation = reject;
      }),
    );

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(screen.getByText("Validating projected graph…")).toBeVisible();
    expect(screen.getByTestId("confirm-graph")).toBeDisabled();
    rejectValidation?.(new Error("Canonical graph read failed"));
    expect(
      await screen.findByText("Canonical graph read failed"),
    ).toBeVisible();
    expect(screen.queryByTestId("projected-graph")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-graph")).toBeDisabled();
  });

  it("clears a successful graph immediately while retrying a failed revalidation", async () => {
    mockValidate.mockResolvedValueOnce({ data: { data: projection(true) } });

    const { rerender } = render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );
    expect(await screen.findByTestId("projected-graph")).toBeInTheDocument();

    const changedProposal = buildProposal(undefined, [
      { op: "workItem.update", ref: root, name: "Changed root" },
    ]);
    mockValidate.mockRejectedValueOnce(new Error("Revalidation failed"));
    rerender(
      <WorkItemGraphProposalRenderer
        proposal={changedProposal}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(await screen.findByText("Revalidation failed")).toBeVisible();
    expect(screen.queryByTestId("projected-graph")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-graph")).toBeDisabled();
  });

  it("supports retry without retaining the failed review", async () => {
    mockValidate
      .mockRejectedValueOnce(new Error("Validation unavailable"))
      .mockResolvedValueOnce({ data: { data: projection(true) } });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Retry validation" }),
    );
    expect(screen.getByText("Validating projected graph…")).toBeVisible();
    expect(await screen.findByTestId("projected-graph")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-graph")).not.toBeDisabled();
  });

  it("reports graph hydration failures and keeps confirmation blocked", async () => {
    buildCanonicalPositions.mockImplementationOnce(() => {
      throw new Error("Projected layout could not be hydrated");
    });
    mockValidate.mockResolvedValue({ data: { data: projection(true) } });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(
      await screen.findByText("Projected layout could not be hydrated"),
    ).toBeVisible();
    expect(screen.queryByTestId("projected-graph")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-graph")).toBeDisabled();
  });

  it("blocks a second confirmation while the server reports an active attempt", async () => {
    mockValidate.mockResolvedValue({ data: { data: projection(true) } });
    const proposal = buildProposal({
      state: WorkItemChangeSetMaterializationState.Applying,
      attemptCount: 1,
      operations: [],
    });

    render(
      <WorkItemGraphProposalRenderer
        proposal={proposal}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("confirm-graph")).toBeDisabled(),
    );
    expect(
      screen.getByTestId("work-item-graph-materialization-progress"),
    ).toHaveAttribute("data-materialization-state", "APPLYING");
  });

  it("fails closed when project-effective registry authority is unavailable", async () => {
    registryState.error = new Error("registry unavailable");
    mockValidate.mockResolvedValue({ data: { data: projection(true) } });

    render(
      <WorkItemGraphProposalRenderer
        proposal={buildProposal()}
        status={{ state: "pending" }}
        onApply={vi.fn()}
        organizationId="organization-id"
        projectId="project-id"
      />,
    );

    expect(
      await screen.findByTestId("work-item-graph-unavailable"),
    ).toHaveTextContent("The work-item type registry is unavailable.");
    expect(screen.queryByTestId("projected-graph")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-graph")).toBeDisabled();
  });
});
