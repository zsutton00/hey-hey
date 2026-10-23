import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import type {
  ProjectedWorkItem,
  WorkItemTypeDefinitionDto,
  WorkItemTypeGraphAction as WorkItemTypeGraphActionType,
} from "../../../api";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  WorkItemTypeGraphAction,
  WorkItemTypeGraphEndpointRole,
} from "../../../api";
import { WorkItemGraphEditor } from "../WorkItemGraphEditor";
import {
  addDiagramGroupMembers,
  eligibleDiagramGroupParents,
  removeDiagramGroup,
} from "../diagramGroupBoundaries";
import {
  useWorkItemGraphDraft,
  type UseWorkItemGraphDraftReturn,
} from "../../../data/hooks/useWorkItemGraphDraft";

const surfaceProps = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  renderCount: 0,
}));
const metaLinkDialogProps = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const draftState = {
  current: null as UseWorkItemGraphDraftReturn | null,
};

vi.mock("../WorkflowMentionInlineRenderer", () => ({
  buildCanonicalProjectedGraphPositions: (children: ProjectedWorkItem[]) =>
    new Map(
      children.map((child, index) => [
        child.identity.refType === "existing"
          ? `existing:${child.identity.id}`
          : `temporary:${child.identity.tempId}`,
        { x: 24 + index * 264, y: 24 },
      ])
    ),
  buildPreferredProjectedGraphPositionResult: (
    children: ProjectedWorkItem[]
  ) => ({
    positions: new Map(
      children.map((child, index) => [
        child.identity.refType === "existing"
          ? `existing:${child.identity.id}`
          : `temporary:${child.identity.tempId}`,
        { x: 24 + index * 264, y: 24 },
      ])
    ),
    actual: { rows: 1, columns: children.length },
    departures: ["requested-shape-unattainable"],
  }),
  WorkflowGraphSurface: (props: Record<string, unknown>) => {
    surfaceProps.current = props;
    surfaceProps.renderCount += 1;
    return (
      <div
        data-testid="mock-work-item-graph-surface"
        data-mode={String(props.mode)}
      />
    );
  },
}));

vi.mock("../WorkItemGraphMetaLinkDialog", () => ({
  WorkItemGraphMetaLinkDialog: (props: Record<string, unknown>) => {
    metaLinkDialogProps.current = props;
    return null;
  },
}));

const rootIdentity = { refType: "existing", id: "board" } as const;
const root: ProjectedWorkItem = {
  identity: rootIdentity,
  label: "Board",
  name: "Board",
  type: "BOARD",
  sections: [],
  deleted: false,
};

const childTypeDefinition: WorkItemTypeDefinitionDto = {
  key: "CARD",
  name: "Card",
  sections: [],
  allowedStatuses: [],
  forbiddenScalars: ["dueDate", "tag"],
};

const graphNodeEndpoint = {
  role: WorkItemTypeGraphEndpointRole.GraphNode,
  entityTypes: [AgentEdgeEndpointEntityType.Task],
  workItemTypeKeys: ["CARD"],
};

function input(supportedActions: WorkItemTypeGraphActionType[]) {
  return {
    root,
    children: [],
    incidentRelationships: [],
    typeDefinition: {
      key: "BOARD",
      name: "Board",
      allowedStatuses: [],
      sections: [
        { key: "positions", kind: "json" as const, schemaRef: "layout.v1" },
      ],
      capabilities: {
        graph: {
          nodeChildType: "CARD",
          layout: { sectionKey: "positions", schemaRef: "layout.v1" },
          layoutPreference: {
            sectionKey: "layoutPreference",
            schemaRef: "preference.v1",
          },
          supportedActions,
          readableRelationships: [],
          editableRelationships: [],
          rendererKey: "work-item-graph",
          editorKey: "work-item-graph-editor",
        },
      },
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>;
}

const EditorHarness = ({
  graphInput,
  disabled = false,
}: {
  graphInput: ReturnType<typeof input>;
  disabled?: boolean;
}) => {
  const draft = useWorkItemGraphDraft(graphInput);
  draftState.current = draft;
  return (
    <WorkItemGraphEditor
      draft={draft}
      childTypeDefinition={childTypeDefinition}
      organizationId="org"
      projectId="project"
      participation={null}
      disabled={disabled}
    />
  );
};

function relationshipInput() {
  const first = {
    ...root,
    identity: { refType: "existing", id: "first" } as const,
    label: "First",
    name: "First",
    type: "CARD",
  };
  const second = {
    ...first,
    identity: { refType: "existing", id: "second" } as const,
    label: "Second",
    name: "Second",
  };
  return {
    ...input([
      WorkItemTypeGraphAction.ViewGraph,
      WorkItemTypeGraphAction.CreateRelationship,
      WorkItemTypeGraphAction.UpdateRelationship,
      WorkItemTypeGraphAction.DeleteRelationship,
    ]),
    children: [first, second],
    incidentRelationships: [
      {
        identity: { refType: "existing", id: "relationship" } as const,
        label: AgentEdgeType.Conditional,
        source: first.identity,
        target: second.identity,
        edgeType: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "approved",
        deleted: false,
      },
    ],
    typeDefinition: {
      ...input([]).typeDefinition,
      capabilities: {
        graph: {
          ...input([]).typeDefinition.capabilities.graph,
          supportedActions: [
            WorkItemTypeGraphAction.ViewGraph,
            WorkItemTypeGraphAction.CreateRelationship,
            WorkItemTypeGraphAction.UpdateRelationship,
            WorkItemTypeGraphAction.DeleteRelationship,
          ],
          editableRelationships: [
            {
              edgeType: AgentEdgeType.Standard,
              category: AgentEdgeCategory.Flow,
              sourceEndpoint: graphNodeEndpoint,
              targetEndpoint: graphNodeEndpoint,
              direction: {
                required: true,
                allowedDirections: [AgentEdgeDirection.Forward],
              },
            },
            {
              edgeType: AgentEdgeType.Conditional,
              category: AgentEdgeCategory.Flow,
              sourceEndpoint: graphNodeEndpoint,
              targetEndpoint: graphNodeEndpoint,
              direction: {
                required: true,
                allowedDirections: [AgentEdgeDirection.Forward],
                predicateRequired: true,
              },
            },
            {
              edgeType: AgentEdgeType.Loop,
              category: AgentEdgeCategory.Flow,
              sourceEndpoint: graphNodeEndpoint,
              targetEndpoint: graphNodeEndpoint,
            },
          ],
        },
      },
    },
  };
}

function preferredLayoutInput(
  preference: { rows: number; columns: number } | null = null
) {
  const base = relationshipInput();
  return {
    ...base,
    root: {
      ...base.root,
      sections: preference
        ? [
            {
              key: "layoutPreference",
              content: {
                schemaVersion: "work-item-graph-layout-preference.v1",
                ...preference,
              },
            },
          ]
        : [],
    },
    typeDefinition: {
      ...base.typeDefinition,
      sections: [
        ...base.typeDefinition.sections,
        {
          key: "layoutPreference",
          kind: "json" as const,
          schemaRef: "preference.v1",
        },
      ],
      capabilities: {
        graph: {
          ...base.typeDefinition.capabilities.graph,
          supportedActions: [
            ...base.typeDefinition.capabilities.graph.supportedActions,
            WorkItemTypeGraphAction.ReplaceLayout,
          ],
        },
      },
    },
  };
}

describe("WorkItemGraphEditor", () => {
  it("keeps preferred shape inputs empty until a value is authored", () => {
    render(<EditorHarness graphInput={preferredLayoutInput()} />, { wrapper });

    const rows = within(
      screen.getByTestId("work-item-graph-preferred-rows")
    ).getByRole("spinbutton");
    const columns = within(
      screen.getByTestId("work-item-graph-preferred-columns")
    ).getByRole("spinbutton");
    const apply = screen.getByTestId("work-item-graph-apply-preferred-layout");

    expect(rows).not.toHaveValue(1);
    expect(columns).not.toHaveValue(1);
    expect(apply).toBeDisabled();

    fireEvent.change(rows, { target: { value: "5" } });
    fireEvent.change(columns, { target: { value: "3" } });

    expect(draftState.current?.operations).toEqual([
      expect.objectContaining({
        op: "section.replace",
        key: "layoutPreference",
      }),
    ]);
    expect(draftState.current?.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "layout.replace" }),
      ])
    );
    expect(apply).not.toBeDisabled();

    fireEvent.click(apply);
    expect(draftState.current?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "layout.replace",
          sectionKey: "positions",
          entries: expect.any(Array),
        }),
      ])
    );
    expect(draftState.current?.projected.layoutSource).toBe("authored");
    expect(
      screen.getByTestId("work-item-graph-layout-departures")
    ).toHaveTextContent("Requested 5 rows × 3 columns");
  });

  it("rejects zero or partial preferred shape input without persisting it", () => {
    render(<EditorHarness graphInput={preferredLayoutInput()} />, { wrapper });

    const rows = within(
      screen.getByTestId("work-item-graph-preferred-rows")
    ).getByRole("spinbutton");
    const columns = within(
      screen.getByTestId("work-item-graph-preferred-columns")
    ).getByRole("spinbutton");
    const apply = screen.getByTestId("work-item-graph-apply-preferred-layout");

    fireEvent.change(rows, { target: { value: "0" } });
    fireEvent.change(columns, { target: { value: "3" } });

    expect(rows).toHaveAttribute("aria-invalid", "true");
    expect(apply).toBeDisabled();
    expect(draftState.current?.operations).toEqual([]);
  });

  it("hides preferred controls when the declared preference section is not registered", () => {
    render(
      <EditorHarness
        graphInput={input([
          WorkItemTypeGraphAction.ViewGraph,
          WorkItemTypeGraphAction.ReplaceLayout,
        ])}
      />,
      { wrapper }
    );

    expect(
      screen.queryByTestId("work-item-graph-preferred-rows")
    ).not.toBeInTheDocument();
  });

  it("opens the editor without an optional layout preference capability", () => {
    const graphInput = input([
      WorkItemTypeGraphAction.ViewGraph,
      WorkItemTypeGraphAction.ReplaceLayout,
    ]);
    const graph = graphInput.typeDefinition.capabilities?.graph;
    if (!graph) throw new Error("Expected a graph-capable fixture");
    delete graph.layoutPreference;
    render(<EditorHarness graphInput={graphInput} />, { wrapper });

    expect(draftState.current?.projected.children).toHaveLength(graphInput.children.length);
    expect(screen.queryByTestId("work-item-graph-preferred-rows")).not.toBeInTheDocument();
    expect(screen.queryByTestId("work-item-graph-apply-preferred-layout")).not.toBeInTheDocument();
  });

  it("reuses the configured editor for a non-workflow type and emits generic operations", async () => {
    render(
      <EditorHarness
        graphInput={input([
          WorkItemTypeGraphAction.ViewGraph,
          WorkItemTypeGraphAction.CreateNode,
          WorkItemTypeGraphAction.ClearLayout,
        ])}
      />,
      { wrapper }
    );

    expect(screen.getByTestId("mock-work-item-graph-surface")).toHaveAttribute(
      "data-mode",
      "edit"
    );
    fireEvent.click(screen.getByTestId("work-item-graph-add-child"));
    fireEvent.change(screen.getByTestId("work-item-graph-node-name"), {
      target: { value: "A configured card" },
    });
    fireEvent.click(screen.getByTestId("work-item-graph-node-commit"));

    await waitFor(() =>
      expect(draftState.current?.operations).toEqual([
        expect.objectContaining({ op: "workItem.create", type: "CARD" }),
      ])
    );

    fireEvent.click(screen.getByTestId("work-item-graph-reflow"));
    await waitFor(() =>
      expect(draftState.current?.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: "layout.clear",
            sectionKey: "positions",
          }),
        ])
      )
    );
  });

  it("does not expose controls for actions absent from the runtime capability", () => {
    render(<EditorHarness graphInput={input([])} />, { wrapper });

    expect(
      screen.queryByTestId("work-item-graph-add-child")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-graph-reflow")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-graph-add-meta-link")
    ).not.toBeInTheDocument();
  });

  it("passes pending edits and authored positions intact through selection changes", () => {
    render(<EditorHarness graphInput={relationshipInput()} />, { wrapper });
    act(() => draftState.current?.move({ refType: "existing", id: "first" }, { x: 145, y: 215 }));
    const operations = structuredClone(draftState.current?.operations);
    const projected = surfaceProps.current.projection;
    const select = surfaceProps.current.onSelectionChange as (selection: { children: { refType: "existing"; id: string }[]; relationships: [] }) => void;
    act(() => select({ children: [{ refType: "existing", id: "first" }], relationships: [] }));
    expect(surfaceProps.current.mode).toBe("edit");
    expect(surfaceProps.current.projection).toEqual(projected);
    expect(draftState.current?.operations).toEqual(operations);
    expect(draftState.current?.projected.effectiveLayout.nodes).toContainEqual({ node: { refType: "existing", id: "first" }, position: { x: 145, y: 215 } });
  });

  it("ignores repeated equivalent graph selections", () => {
    render(<EditorHarness graphInput={relationshipInput()} />, { wrapper });

    const onSelectionChange = surfaceProps.current
      .onSelectionChange as (selection: {
      children: [{ refType: "existing"; id: string }];
      relationships: [];
    }) => void;
    const selectedFirstChild = {
      children: [{ refType: "existing", id: "first" }],
      relationships: [],
    } as const;

    act(() => {
      onSelectionChange(selectedFirstChild);
    });
    const renderCountAfterChange = surfaceProps.renderCount;

    act(() => {
      onSelectionChange({
        children: [{ refType: "existing", id: "first" }],
        relationships: [],
      });
    });

    expect(surfaceProps.renderCount).toBe(renderCountAfterChange);
  });

  it("creates toolbar nodes at the latest visible logical position", async () => {
    render(
      <EditorHarness
        graphInput={input([
          WorkItemTypeGraphAction.ViewGraph,
          WorkItemTypeGraphAction.CreateNode,
          WorkItemTypeGraphAction.ReplaceLayout,
        ])}
      />,
      { wrapper }
    );

    act(() => {
      const onVisibleCanvasPositionChange = surfaceProps.current
        .onVisibleCanvasPositionChange as (position: {
        x: number;
        y: number;
      }) => void;
      onVisibleCanvasPositionChange({ x: 640, y: 360 });
    });
    fireEvent.click(screen.getByTestId("work-item-graph-add-child"));
    fireEvent.change(screen.getByTestId("work-item-graph-node-name"), {
      target: { value: "Visible card" },
    });
    fireEvent.click(screen.getByTestId("work-item-graph-node-commit"));

    await waitFor(() =>
      expect(draftState.current?.operations).toEqual([
        expect.objectContaining({
          op: "workItem.create",
          name: "Visible card",
        }),
        expect.objectContaining({
          op: "layout.replace",
          entries: [
            expect.objectContaining({
              position: { x: 640, y: 360 },
            }),
          ],
        }),
      ])
    );
  });

  it("deletes a context-selected child and its incident topology", async () => {
    const graphInput = relationshipInput();
    graphInput.typeDefinition.capabilities.graph.supportedActions = [
      WorkItemTypeGraphAction.ViewGraph,
      WorkItemTypeGraphAction.DeleteNode,
    ];
    render(<EditorHarness graphInput={graphInput} />, { wrapper });

    act(() => {
      const onNodeContextMenu = surfaceProps.current
        .onNodeContextMenu as (menu: {
        child: { refType: "existing"; id: string };
        position: { x: number; y: number };
        menuPosition: { x: number; y: number };
      }) => void;
      onNodeContextMenu({
        child: { refType: "existing", id: "first" },
        position: { x: 320, y: 180 },
        menuPosition: { x: 80, y: 120 },
      });
    });

    fireEvent.click(screen.getByTestId("work-item-graph-context-delete"));

    await waitFor(() => {
      expect(draftState.current?.operations).toEqual(
        expect.arrayContaining([
          { op: "workItem.delete", ref: { refType: "existing", id: "first" } },
          {
            op: "relationship.delete",
            ref: { refType: "existing", id: "relationship" },
          },
        ])
      );
    });
    expect(
      draftState.current?.projected.incidentRelationships[0]?.deleted
    ).toBe(true);
  });

  it("creates a context-selected child at the pane logical position", async () => {
    render(
      <EditorHarness
        graphInput={input([
          WorkItemTypeGraphAction.ViewGraph,
          WorkItemTypeGraphAction.CreateNode,
          WorkItemTypeGraphAction.ReplaceLayout,
        ])}
      />,
      { wrapper }
    );

    act(() => {
      const onEmptyCanvasContextMenu = surfaceProps.current
        .onEmptyCanvasContextMenu as (menu: {
        position: { x: number; y: number };
        menuPosition: { x: number; y: number };
      }) => void;
      onEmptyCanvasContextMenu({
        position: { x: 910, y: 640 },
        menuPosition: { x: 140, y: 220 },
      });
    });
    fireEvent.click(screen.getByTestId("work-item-graph-context-create"));
    fireEvent.change(screen.getByTestId("work-item-graph-node-name"), {
      target: { value: "Context card" },
    });
    fireEvent.click(screen.getByTestId("work-item-graph-node-commit"));

    await waitFor(() =>
      expect(draftState.current?.operations).toEqual([
        expect.objectContaining({
          op: "workItem.create",
          name: "Context card",
        }),
        expect.objectContaining({
          op: "layout.replace",
          entries: [expect.objectContaining({ position: { x: 910, y: 640 } })],
        }),
      ])
    );
  });

  it("preserves the displayed arrangement when moving a child without changing relationships", async () => {
    const graphInput = relationshipInput();
    graphInput.typeDefinition.capabilities.graph.supportedActions = [
      ...graphInput.typeDefinition.capabilities.graph.supportedActions,
      WorkItemTypeGraphAction.ReplaceLayout,
    ];
    render(<EditorHarness graphInput={graphInput} />, { wrapper });

    const relationshipsBeforeMove =
      draftState.current?.projected.incidentRelationships;
    act(() => {
      const onNodeDragStop = surfaceProps.current.onNodeDragStop as (
        child: { refType: "existing"; id: string },
        position: { x: number; y: number },
        displayedLayout: Array<{
          node: { refType: "existing"; id: string };
          position: { x: number; y: number };
        }>
      ) => void;
      onNodeDragStop({ refType: "existing", id: "first" }, { x: 640, y: 360 }, [
        { node: { refType: "existing", id: "first" }, position: { x: 24, y: 24 } },
        { node: { refType: "existing", id: "second" }, position: { x: 24, y: 450 } },
      ]);
    });

    await waitFor(() => {
      expect(draftState.current?.operations).toEqual([
        expect.objectContaining({
          op: "layout.replace",
          sectionKey: "positions",
          entries: expect.arrayContaining([
            expect.objectContaining({
              node: { refType: "existing", id: "first" },
              position: { x: 640, y: 360 },
            }),
            expect.objectContaining({
              node: { refType: "existing", id: "second" },
              position: { x: 24, y: 450 },
            }),
          ]),
        }),
      ]);
    });
    expect(draftState.current?.projected.incidentRelationships).toEqual(
      relationshipsBeforeMove
    );
    expect(
      draftState.current?.operations.some((operation) =>
        operation.op.startsWith("relationship.")
      )
    ).toBe(false);

    act(() => {
      const onVisibleCanvasPositionChange = surfaceProps.current
        .onVisibleCanvasPositionChange as (position: {
        x: number;
        y: number;
      }) => void;
      onVisibleCanvasPositionChange({ x: 900, y: 700 });
    });
    expect(
      draftState.current?.projected.effectiveLayout.nodes.find(
        (entry) =>
          entry.node.refType === "existing" && entry.node.id === "first"
      )?.position
    ).toEqual({ x: 640, y: 360 });
  });

  it("delegates STANDARD, CONDITIONAL, and LOOP connection fields to the relationship dialog", async () => {
    render(<EditorHarness graphInput={relationshipInput()} />, { wrapper });

    const connect = () => {
      const onConnect = surfaceProps.current.onConnect as (gesture: {
        source: { refType: "existing"; id: string };
        target: { refType: "existing"; id: string };
      }) => void;
      act(() => {
        onConnect({
          source: { refType: "existing", id: "first" },
          target: { refType: "existing", id: "second" },
        });
      });
    };

    connect();
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));
    await waitFor(() =>
      expect(draftState.current?.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: "relationship.create",
            edgeType: AgentEdgeType.Standard,
            direction: AgentEdgeDirection.Forward,
          }),
        ])
      )
    );

    connect();
    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(
      screen.getByRole("option", { name: AgentEdgeType.Conditional })
    );
    fireEvent.change(
      screen.getByTestId("work-item-graph-relationship-predicate"),
      { target: { value: "approved" } }
    );
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));
    await waitFor(() =>
      expect(draftState.current?.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: "relationship.create",
            edgeType: AgentEdgeType.Conditional,
            direction: AgentEdgeDirection.Forward,
            predicate: "approved",
          }),
        ])
      )
    );

    connect();
    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(screen.getByRole("option", { name: AgentEdgeType.Loop }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));
    await waitFor(() =>
      expect(draftState.current?.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: "relationship.create",
            edgeType: AgentEdgeType.Loop,
          }),
        ])
      )
    );
    expect(draftState.current?.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeType: AgentEdgeType.Loop,
          direction: expect.anything(),
        }),
      ])
    );
  });

  it("leaves the draft unchanged when a new relationship dialog is cancelled", () => {
    render(<EditorHarness graphInput={relationshipInput()} />, { wrapper });

    act(() => {
      const onConnect = surfaceProps.current.onConnect as (gesture: {
        source: { refType: "existing"; id: string };
        target: { refType: "existing"; id: string };
      }) => void;
      onConnect({
        source: { refType: "existing", id: "first" },
        target: { refType: "existing", id: "second" },
      });
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(draftState.current?.operations).toEqual([]);
  });

  it("maps node and relationship controls to their individual generated actions", () => {
    const graphInput = relationshipInput();
    graphInput.typeDefinition.capabilities.graph.supportedActions = [
      WorkItemTypeGraphAction.ViewGraph,
      WorkItemTypeGraphAction.UpdateNode,
      WorkItemTypeGraphAction.DeleteRelationship,
    ];
    render(<EditorHarness graphInput={graphInput} />, { wrapper });

    act(() => {
      const onSelectionChange = surfaceProps.current
        .onSelectionChange as (selection: {
        children: [{ refType: "existing"; id: string }];
        relationships: [];
      }) => void;
      onSelectionChange({
        children: [{ refType: "existing", id: "first" }],
        relationships: [],
      });
    });

    expect(
      screen.getByTestId("work-item-graph-edit-child")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-graph-delete-child")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-graph-add-child")
    ).not.toBeInTheDocument();
    expect(surfaceProps.current.allowConnections).toBe(false);
    expect(surfaceProps.current.allowReconnection).toBe(false);
  });

  it("uses endpoint eligibility and the dedicated searchable target declaration for meta links", () => {
    const graphInput = relationshipInput();
    const externalContractEndpoint = {
      role: WorkItemTypeGraphEndpointRole.ExternalEntity,
      entityTypes: [AgentEdgeEndpointEntityType.Task],
      workItemTypeKeys: ["CONTRACT"],
    };
    graphInput.typeDefinition.capabilities.graph.supportedActions = [
      WorkItemTypeGraphAction.ViewGraph,
      WorkItemTypeGraphAction.CreateRelationship,
    ];
    graphInput.typeDefinition.capabilities.graph.editableRelationships = [
      {
        edgeType: AgentEdgeType.DependsOn,
        category: AgentEdgeCategory.Meta,
        sourceEndpoint: graphNodeEndpoint,
        targetEndpoint: externalContractEndpoint,
      },
    ];
    graphInput.typeDefinition.capabilities.graph.searchableMetaLinkTargets = [
      {
        edgeType: AgentEdgeType.DependsOn,
        targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
      },
    ];
    render(<EditorHarness graphInput={graphInput} />, { wrapper });

    act(() => {
      const onSelectionChange = surfaceProps.current
        .onSelectionChange as (selection: {
        children: [{ refType: "existing"; id: string }];
        relationships: [];
      }) => void;
      onSelectionChange({
        children: [{ refType: "existing", id: "first" }],
        relationships: [],
      });
    });

    expect(screen.getByTestId("work-item-graph-add-meta-link")).toHaveAttribute(
      "data-edge-type",
      AgentEdgeType.DependsOn
    );
    fireEvent.click(screen.getByTestId("work-item-graph-add-meta-link"));
    expect(metaLinkDialogProps.current.searchTarget).toEqual({
      edgeType: AgentEdgeType.DependsOn,
      targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
      targetWorkItemTypeKeys: ["CONTRACT"],
    });
  });

  it("opens Contract attachment from a node context menu as a meta action", () => {
    const graphInput = relationshipInput();
    const externalContractEndpoint = {
      role: WorkItemTypeGraphEndpointRole.ExternalEntity,
      entityTypes: [AgentEdgeEndpointEntityType.Task],
      workItemTypeKeys: ["CONTRACT"],
    };
    graphInput.typeDefinition.capabilities.graph.supportedActions = [
      WorkItemTypeGraphAction.ViewGraph,
      WorkItemTypeGraphAction.CreateRelationship,
    ];
    graphInput.typeDefinition.capabilities.graph.editableRelationships = [
      {
        edgeType: AgentEdgeType.DependsOn,
        category: AgentEdgeCategory.Meta,
        sourceEndpoint: graphNodeEndpoint,
        targetEndpoint: externalContractEndpoint,
      },
    ];
    graphInput.typeDefinition.capabilities.graph.searchableMetaLinkTargets = [
      {
        edgeType: AgentEdgeType.DependsOn,
        targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
      },
    ];
    render(<EditorHarness graphInput={graphInput} />, { wrapper });

    act(() => {
      const onNodeContextMenu = surfaceProps.current
        .onNodeContextMenu as (menu: {
        child: { refType: "existing"; id: string };
        position: { x: number; y: number };
        menuPosition: { x: number; y: number };
      }) => void;
      onNodeContextMenu({
        child: { refType: "existing", id: "first" },
        position: { x: 320, y: 180 },
        menuPosition: { x: 80, y: 120 },
      });
    });

    fireEvent.click(
      screen.getByTestId("work-item-graph-context-add-meta-link")
    );

    expect(metaLinkDialogProps.current.sourceChild).toEqual({
      refType: "existing",
      id: "first",
    });
    expect(metaLinkDialogProps.current.searchTarget).toEqual({
      edgeType: AgentEdgeType.DependsOn,
      targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
      targetWorkItemTypeKeys: ["CONTRACT"],
    });
  });

  it("does not expose context authoring callbacks when disabled", () => {
    const graphInput = relationshipInput();
    graphInput.typeDefinition.capabilities.graph.supportedActions = [
      WorkItemTypeGraphAction.ViewGraph,
      WorkItemTypeGraphAction.CreateNode,
      WorkItemTypeGraphAction.DeleteNode,
    ];
    render(<EditorHarness graphInput={graphInput} disabled />, { wrapper });

    expect(surfaceProps.current.onNodeContextMenu).toBeUndefined();
    expect(surfaceProps.current.onEmptyCanvasContextMenu).toBeUndefined();
  });

  it("replaces a relationship when its type changes so stale edge fields cannot survive", async () => {
    render(<EditorHarness graphInput={relationshipInput()} />, { wrapper });

    act(() => {
      const onSelectionChange = surfaceProps.current
        .onSelectionChange as (selection: {
        children: [];
        relationships: [{ refType: "existing"; id: string }];
      }) => void;
      onSelectionChange({
        children: [],
        relationships: [{ refType: "existing", id: "relationship" }],
      });
    });
    fireEvent.click(screen.getByTestId("work-item-graph-edit-relationship"));
    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(screen.getByRole("option", { name: AgentEdgeType.Loop }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    await waitFor(() => {
      const operations = draftState.current?.operations;
      expect(operations).toEqual([
        {
          op: "relationship.delete",
          ref: { refType: "existing", id: "relationship" },
        },
        expect.objectContaining({
          op: "relationship.create",
          edgeType: AgentEdgeType.Loop,
          category: AgentEdgeCategory.Flow,
        }),
      ]);
      expect(operations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: "relationship.update" }),
        ])
      );
    });
  });

  describe("groups and boundaries", () => {
    const savedPositions = {
      schemaVersion: "work-item-graph-layout.v1",
      nodes: [
        {
          node: { kind: "persistedWorkItem", workItemId: "first" },
          position: { x: 10, y: 20 },
        },
        {
          node: { kind: "persistedWorkItem", workItemId: "second" },
          position: { x: 400, y: 20 },
        },
      ],
    };
    function groupsInput() {
      const base = relationshipInput();
      const graph = base.typeDefinition.capabilities.graph;
      return {
        ...base,
        root: {
          ...base.root,
          sections: [{ key: "positions", content: savedPositions }],
        },
        typeDefinition: {
          ...base.typeDefinition,
          sections: [
            ...base.typeDefinition.sections,
            {
              key: "diagramGroups",
              kind: "json" as const,
              schemaRef: "#/components/schemas/DiagramGroupsValue",
            },
          ],
          capabilities: {
            graph: {
              ...graph,
              groups: {
                sectionKey: "diagramGroups",
                schemaRef: "#/components/schemas/DiagramGroupsValue",
              },
              supportedActions: [
                ...graph.supportedActions,
                WorkItemTypeGraphAction.UpdateNode,
                WorkItemTypeGraphAction.DeleteNode,
              ],
            },
          },
        },
      };
    }
    const selectBoth = () =>
      act(() =>
        (
          surfaceProps.current.onSelectionChange as (selection: {
            children: { refType: "existing"; id: string }[];
            relationships: [];
          }) => void
        )({
          children: [
            { refType: "existing", id: "first" },
            { refType: "existing", id: "second" },
          ],
          relationships: [],
        })
      );

    it("only offers groups when the type declares a groups section", () => {
      render(<EditorHarness graphInput={relationshipInput()} />, { wrapper });
      expect(screen.queryByTestId("diagram-groups-panel")).toBeNull();
    });

    it("adds a group as one section replacement without touching saved positions", () => {
      render(<EditorHarness graphInput={groupsInput()} />, { wrapper });
      const layoutBefore = structuredClone(
        draftState.current?.projected.effectiveLayout
      );
      selectBoth();
      fireEvent.click(screen.getByTestId("diagram-group-add"));

      const operations = draftState.current?.operations ?? [];
      expect(operations.map((operation) => operation.op)).toEqual([
        "section.replace",
      ]);
      expect(operations[0]).toMatchObject({
        key: "diagramGroups",
        ref: rootIdentity,
        content: {
          schemaVersion: "diagram-groups.v1",
          groups: [
            {
              id: "g-group-1",
              label: "Group 1",
              meaning: "VISUAL_ASSOCIATION",
              members: [
                { kind: "persistedWorkItem", workItemId: "first" },
                { kind: "persistedWorkItem", workItemId: "second" },
              ],
            },
          ],
        },
      });
      expect(draftState.current?.projected.effectiveLayout).toEqual(
        layoutBefore
      );
    });

    it("renames by label without changing the stable group id", () => {
      render(<EditorHarness graphInput={groupsInput()} />, { wrapper });
      fireEvent.click(screen.getByTestId("diagram-group-add"));
      const field = screen.getByTestId("diagram-group-label-g-group-1");
      fireEvent.change(field, { target: { value: "us-east-1" } });
      fireEvent.blur(field);
      const content = (draftState.current?.operations.at(-1) as {
        content: { groups: { id: string; label: string }[] };
      }).content;
      expect(content.groups).toEqual([
        expect.objectContaining({ id: "g-group-1", label: "us-east-1" }),
      ]);
    });

    it("sets and clears authored group color without changing positions or membership", () => {
      render(<EditorHarness graphInput={groupsInput()} />, { wrapper });
      selectBoth();
      fireEvent.click(screen.getByTestId("diagram-group-add"));
      const layout = structuredClone(
        draftState.current?.projected.effectiveLayout
      );
      fireEvent.mouseDown(
        screen
          .getByTestId("diagram-group-color")
          .parentElement!.querySelector('[role="combobox"]')!
      );
      fireEvent.click(screen.getByRole("option", { name: "Purple" }));
      const colored = draftState.current?.operations.at(-1);
      expect(colored).toMatchObject({
        content: {
          groups: [
            {
              id: "g-group-1",
              color: "purple",
              members: [
                { kind: "persistedWorkItem", workItemId: "first" },
                { kind: "persistedWorkItem", workItemId: "second" },
              ],
            },
          ],
        },
      });
      fireEvent.mouseDown(
        screen
          .getByTestId("diagram-group-color")
          .parentElement!.querySelector('[role="combobox"]')!
      );
      fireEvent.click(screen.getByRole("option", { name: "Auto" }));
      const cleared = draftState.current?.operations.at(-1) as {
        content: { groups: object[] };
      };
      expect(cleared.content.groups[0]).not.toHaveProperty("color");
      expect(draftState.current?.projected.effectiveLayout).toEqual(layout);
    });

    it("disables group editing while a layout preview is shown", () => {
      render(<EditorHarness graphInput={groupsInput()} />, { wrapper });
      expect(screen.getByTestId("diagram-group-add")).not.toBeDisabled();
      act(() =>
        (surfaceProps.current.onLayoutPreviewChange as (value: boolean) => void)(
          true
        )
      );
      expect(screen.getByTestId("diagram-group-add")).toBeDisabled();
    });

    it("drops a deleted element from pending group membership", () => {
      render(<EditorHarness graphInput={groupsInput()} />, { wrapper });
      selectBoth();
      fireEvent.click(screen.getByTestId("diagram-group-add"));
      act(() => draftState.current?.delete({ refType: "existing", id: "first" }));
      const replace = draftState.current?.operations.find(
        (operation) =>
          operation.op === "section.replace" && operation.key === "diagramGroups"
      ) as { content: { groups: { members: unknown[] }[] } };
      expect(replace.content.groups[0]!.members).toEqual([
        { kind: "persistedWorkItem", workItemId: "second" },
      ]);
    });

    it("keeps factual membership exclusive, nesting acyclic and children on removal", () => {
      const member = (id: string) => ({
        kind: "persistedWorkItem" as const,
        workItemId: id,
      });
      const groups = [
        { id: "aws", label: "AWS", meaning: "DEPLOYMENT_BOUNDARY" as const, members: [] },
        {
          id: "east",
          label: "us-east-1",
          meaning: "DEPLOYMENT_BOUNDARY" as const,
          parentGroupId: "aws",
          members: [member("first")],
        },
        {
          id: "west",
          label: "us-west-2",
          meaning: "DEPLOYMENT_BOUNDARY" as const,
          parentGroupId: "aws",
          members: [],
        },
        {
          id: "path",
          label: "Path",
          meaning: "VISUAL_ASSOCIATION" as const,
          members: [member("first")],
        },
      ];
      const moved = addDiagramGroupMembers(groups, "west", [member("first")]);
      expect(moved.find((group) => group.id === "east")?.members).toEqual([]);
      expect(moved.find((group) => group.id === "path")?.members).toEqual([
        member("first"),
      ]);
      // Descendants and visual groups cannot enclose a factual boundary.
      expect(eligibleDiagramGroupParents(groups, groups[0]!)).toEqual([]);
      expect(
        eligibleDiagramGroupParents(groups, groups[1]!).map((group) => group.id)
      ).toEqual(["aws", "west"]);
      expect(
        removeDiagramGroup(groups, "aws").find((group) => group.id === "east")
          ?.parentGroupId
      ).toBeUndefined();
    });
  });
});
