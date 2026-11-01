import { describe, expect, it } from "vitest";
import type {
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  WorkItemChangeSetIdentity,
} from "../../../api";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
} from "../../../api";
import {
  WorkItemGraphDraftError,
  type HydratedWorkItemGraphInput,
  computeCanonicalWorkItemGraphLayout,
  createWorkItemGraphDraftState,
  hydrateValidatedWorkItemGraphProjection,
  parseWorkItemGraphLayoutPreference,
  serializeWorkItemGraphLayoutPreference,
  workItemGraphDraftReducer,
} from "../workItemGraphDraft";

type GraphInput = Extract<
  HydratedWorkItemGraphInput,
  { root: ProjectedWorkItem }
>;

const rootIdentity = { refType: "existing", id: "root" } as const;
const firstIdentity = { refType: "existing", id: "first" } as const;
const secondIdentity = { refType: "existing", id: "second" } as const;
const hydratedTemporaryIdentity = {
  refType: "temporary",
  tempId: "draft-work-item-1",
} as const;

function node(
  identity: WorkItemChangeSetIdentity,
  name: string,
  type = "GRAPH_NODE",
  parent: WorkItemChangeSetIdentity = rootIdentity,
): ProjectedWorkItem {
  return {
    identity,
    label: name,
    type,
    name,
    parent,
    sections: [],
    deleted: false,
  };
}

function relationship(
  id: string,
  source: WorkItemChangeSetIdentity,
  target: WorkItemChangeSetIdentity,
): ProjectedWorkItemRelationship {
  return {
    identity: { refType: "existing", id },
    label: AgentEdgeType.Standard,
    source,
    target,
    edgeType: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
    predicate: null,
    deleted: false,
  };
}

function graphInput(overrides: Partial<GraphInput> = {}): GraphInput {
  return {
    root: node(rootIdentity, "Graph Root", "GRAPH_ROOT", undefined),
    children: [node(firstIdentity, "First"), node(secondIdentity, "Second")],
    incidentRelationships: [
      relationship("edge-1", firstIdentity, secondIdentity),
    ],
    typeDefinition: {
      key: "GRAPH_ROOT",
      name: "Graph root",
      sections: [],
      allowedStatuses: [],
      capabilities: {
        graph: {
          nodeChildType: "GRAPH_NODE",
          layout: {
            sectionKey: "graphLayout",
            schemaRef: "#/components/schemas/WorkItemGraphLayoutValue",
          },
          layoutPreference: {
            sectionKey: "layoutPreference",
            schemaRef: "preference.v1",
          },
          readableRelationships: [],
          editableRelationships: [],
          rendererKey: "work-item-graph",
          editorKey: "work-item-graph-editor",
          supportedActions: [],
        },
      },
    },
    ...overrides,
  };
}

describe("work item graph draft", () => {
  it.each([undefined, "", "  \n\t"])(
    "hydrates absent or cleared saved layout %j with canonical placement",
    (content) => {
      const input = graphInput();
      input.root.sections = [
        { key: "layoutPreference", content: "" },
        ...(content === undefined ? [] : [{ key: "graphLayout", content }]),
      ];
      const draft = createWorkItemGraphDraftState(input);
      expect(draft.projection.layoutSource).toBe("canonical");
      expect(draft.projection.effectiveLayout).toEqual(
        computeCanonicalWorkItemGraphLayout({
          children: input.children,
          relationships: input.incidentRelationships,
        }),
      );
      expect(draft.projection.children).toEqual(input.children);
      expect(draft.projection.incidentRelationships).toEqual(
        input.incidentRelationships,
      );
      expect(
        createWorkItemGraphDraftState(input).projection.effectiveLayout,
      ).toEqual(draft.projection.effectiveLayout);
      expect(parseWorkItemGraphLayoutPreference("")).toBeNull();
      expect(draft.operations).toEqual([]);
    },
  );

  it("rejects malformed populated saved layout during hydration", () => {
    const input = graphInput();
    input.root.sections = [{ key: "graphLayout", content: " {broken" }];
    expect(() => createWorkItemGraphDraftState(input)).toThrow(
      "The authored graph layout section is not valid JSON.",
    );
  });

  it.each([
    AgentEdgeType.Guarantees,
    AgentEdgeType.Implements,
    AgentEdgeType.Consumes,
  ])("preserves %s in the generated change-set transport", (edgeType) => {
    const draft = createWorkItemGraphDraftState(graphInput());
    const connected = workItemGraphDraftReducer(draft, {
      type: "connect",
      input: {
        source: firstIdentity,
        target: secondIdentity,
        edgeType,
        category: AgentEdgeCategory.Meta,
      },
    });
    expect(JSON.parse(JSON.stringify(connected.operations))).toContainEqual(
      expect.objectContaining({
        op: "relationship.create",
        edgeType,
        category: "meta",
        source: firstIdentity,
        target: secondIdentity,
      }),
    );
  });
  it("hydrates complete mixed workflow topology with temporary identities and authored positions", () => {
    const checkPrices = {
      refType: "temporary" as const,
      tempId: "check-prices",
    };
    const positions = [
      { x: 40, y: 80 },
      { x: 360, y: 80 },
      { x: 680, y: 240 },
    ];
    const children = [
      node(firstIdentity, "Choose item", "workflow_step"),
      node(checkPrices, "Check prices", "workflow_step"),
      node(secondIdentity, "Purchase", "workflow_step"),
    ];
    const relationships: ProjectedWorkItemRelationship[] = [
      relationship("standard-first-check", firstIdentity, checkPrices),
      relationship("standard-check-second", checkPrices, secondIdentity),
      {
        ...relationship("conditional-check-first", checkPrices, firstIdentity),
        label: AgentEdgeType.Conditional,
        edgeType: AgentEdgeType.Conditional,
        predicate: "Too high",
      },
    ];
    const layoutContent = {
      schemaVersion: "work-item-graph-layout.v1",
      nodes: [
        {
          node: { kind: "persistedWorkItem" as const, workItemId: "first" },
          position: positions[0],
        },
        {
          node: {
            kind: "temporaryWorkItem" as const,
            temporaryRef: "check-prices",
          },
          position: positions[1],
        },
        {
          node: { kind: "persistedWorkItem" as const, workItemId: "second" },
          position: positions[2],
        },
      ],
    };
    const projectedRoot = {
      ...node(rootIdentity, "Shopping workflow", "workflow", undefined),
      sections: [{ key: "graphLayout", content: layoutContent }],
    };

    const hydrated = hydrateValidatedWorkItemGraphProjection(
      {
        valid: true,
        projectedRoot,
        children,
        sections: projectedRoot.sections,
        incidentRelationships: relationships,
        identityLabels: {
          "existing:first": "Choose item",
          "temporary:check-prices": "Check prices",
          "existing:second": "Purchase",
        },
        issues: [],
        warnings: [],
      },
      [
        {
          op: "layout.replace",
          root: rootIdentity,
          sectionKey: "graphLayout",
          entries: children.map((child, index) => ({
            node: child.identity,
            position: positions[index] ?? { x: 0, y: 0 },
          })),
        },
      ],
    );

    expect(hydrated.children[1]?.identity).toEqual(checkPrices);
    expect(hydrated.incidentRelationships).toEqual(relationships);
    expect(hydrated.incidentRelationships[2]?.predicate).toBe("Too high");
    expect(hydrated.layoutSource).toBe("authored");
    expect(
      new Map(
        hydrated.effectiveLayout.nodes.map((entry) => [
          entry.node.refType === "existing" ? entry.node.id : entry.node.tempId,
          entry.position,
        ]),
      ),
    ).toEqual(
      new Map([
        ["first", positions[0]],
        ["check-prices", positions[1]],
        ["second", positions[2]],
      ]),
    );
  });

  it("hydrates only a complete projected-root authored layout", () => {
    const input = graphInput();
    const authoredPositions = [
      { x: 91, y: 37 },
      { x: 451, y: 203 },
    ];
    const projectedRoot = {
      ...input.root,
      sections: [
        {
          key: "graphLayout",
          content: {
            schemaVersion: "work-item-graph-layout.v1",
            nodes: [
              {
                node: { kind: "persistedWorkItem", workItemId: "first" },
                position: authoredPositions[0],
              },
              {
                node: { kind: "persistedWorkItem", workItemId: "second" },
                position: authoredPositions[1],
              },
            ],
          },
        },
      ],
    };
    const hydrated = hydrateValidatedWorkItemGraphProjection(
      {
        valid: true,
        projectedRoot,
        children: input.children,
        sections: projectedRoot.sections,
        incidentRelationships: input.incidentRelationships,
        identityLabels: {},
        issues: [],
        warnings: [],
      },
      [
        {
          op: "layout.replace",
          root: rootIdentity,
          sectionKey: "graphLayout",
          entries: input.children.map((child, index) => ({
            node: child.identity,
            position: authoredPositions[index] ?? { x: 0, y: 0 },
          })),
        },
      ],
    );

    expect(hydrated.layoutSource).toBe("authored");
    expect(
      hydrated.effectiveLayout.nodes.map((entry) => entry.position),
    ).toEqual(authoredPositions);
    expect(hydrated.children).toBe(input.children);
    expect(hydrated.incidentRelationships).toBe(input.incidentRelationships);
  });

  it.each(["clear", "missing", "incomplete"] as const)(
    "uses canonical review layout when authored layout is %s",
    (authoredState) => {
      const input = graphInput();
      const projectedRoot = {
        ...input.root,
        sections:
          authoredState === "missing"
            ? []
            : [
                {
                  key: "graphLayout",
                  content: {
                    schemaVersion: "work-item-graph-layout.v1",
                    nodes:
                      authoredState === "incomplete"
                        ? [
                            {
                              node: {
                                kind: "persistedWorkItem",
                                workItemId: "first",
                              },
                              position: { x: 999, y: 999 },
                            },
                          ]
                        : [],
                  },
                },
              ],
      };
      const operation =
        authoredState === "clear"
          ? {
              op: "layout.clear" as const,
              root: rootIdentity,
              sectionKey: "graphLayout",
            }
          : {
              op: "layout.replace" as const,
              root: rootIdentity,
              sectionKey: "graphLayout",
              entries: [],
            };
      const hydrated = hydrateValidatedWorkItemGraphProjection(
        {
          valid: true,
          projectedRoot,
          children: input.children,
          sections: projectedRoot.sections,
          incidentRelationships: input.incidentRelationships,
          identityLabels: {},
          issues: [],
          warnings: [],
        },
        [operation],
      );

      expect(hydrated.layoutSource).toBe("canonical");
      expect(hydrated.effectiveLayout).toEqual(
        computeCanonicalWorkItemGraphLayout({
          children: input.children,
          relationships: input.incidentRelationships,
        }),
      );
    },
  );

  it("projects hydrated state without materialized writes", () => {
    const input = graphInput();
    const draft = createWorkItemGraphDraftState(input);

    expect(draft.operations).toEqual([]);
    expect(draft.projection.projectedRoot).toEqual(input.root);
    expect(draft.projection.children).toEqual(input.children);
    expect(draft.projection.incidentRelationships).toEqual(
      input.incidentRelationships,
    );
    expect(draft.isDirty).toBe(false);
  });

  it("projects authored section replacement and clearing through revise", () => {
    const draft = createWorkItemGraphDraftState(
      graphInput({
        children: [
          {
            ...node(firstIdentity, "First"),
            sections: [
              {
                key: "graphPresentation",
                content: {
                  schemaVersion: "work-item-graph-node-presentation.v1",
                  color: "#123456",
                },
              },
            ],
          },
        ],
      }),
    );

    const replaced = workItemGraphDraftReducer(draft, {
      type: "revise",
      input: {
        ref: firstIdentity,
        sections: {
          graphPresentation: {
            schemaVersion: "work-item-graph-node-presentation.v1",
            color: "#abcdef",
          },
        },
      },
    });
    expect(replaced.projection.children[0]?.sections).toEqual([
      {
        key: "graphPresentation",
        content: {
          schemaVersion: "work-item-graph-node-presentation.v1",
          color: "#abcdef",
        },
      },
    ]);

    const cleared = workItemGraphDraftReducer(replaced, {
      type: "revise",
      input: { ref: firstIdentity, clearSections: ["graphPresentation"] },
    });
    expect(cleared.operations).toContainEqual({
      op: "section.clear",
      ref: firstIdentity,
      key: "graphPresentation",
    });
    expect(cleared.projection.children[0]?.sections).toEqual([]);
  });

  it("fails explicitly when the runtime definition has no graph capability", () => {
    expect(() =>
      createWorkItemGraphDraftState(
        graphInput({
          typeDefinition: {
            key: "GRAPH_ROOT",
            name: "Graph root",
            sections: [],
            allowedStatuses: [],
          },
        }),
      ),
    ).toThrow(WorkItemGraphDraftError);
  });

  it("reuses a temporary child reference in child, relationship, and layout operations", () => {
    const input = graphInput();
    const draft = createWorkItemGraphDraftState(input);
    const created = workItemGraphDraftReducer(draft, {
      type: "create",
      input: {
        name: "Temporary",
        type: "GRAPH_NODE",
        position: { x: 9, y: 11 },
      },
    });
    const childCreate = created.operations.find(
      (operation) => operation.op === "workItem.create",
    );
    expect(childCreate?.op).toBe("workItem.create");
    if (!childCreate || childCreate.op !== "workItem.create") return;

    const connected = workItemGraphDraftReducer(created, {
      type: "connect",
      input: {
        source: childCreate.ref,
        target: firstIdentity,
        edgeType: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      },
    });
    const relationshipCreate = connected.operations.find(
      (operation) => operation.op === "relationship.create",
    );
    expect(relationshipCreate?.op).toBe("relationship.create");
    if (!relationshipCreate || relationshipCreate.op !== "relationship.create")
      return;

    expect(relationshipCreate.source).toEqual(childCreate.ref);
    const layoutReplace = connected.operations.find(
      (operation) => operation.op === "layout.replace",
    );
    expect(layoutReplace?.op).toBe("layout.replace");
    if (layoutReplace?.op !== "layout.replace") return;
    expect(
      layoutReplace.entries.some((entry) => entry.node === childCreate.ref),
    ).toBe(true);
  });

  it("preserves an optional LOOP predicate and omits predicates from STANDARD creates", () => {
    const draft = createWorkItemGraphDraftState(graphInput());
    const loop = workItemGraphDraftReducer(draft, {
      type: "connect",
      input: {
        source: firstIdentity,
        target: firstIdentity,
        edgeType: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
        predicate: "retryCount < 3",
      },
    });
    const loopCreate = loop.operations.find(
      (operation) => operation.op === "relationship.create",
    );
    expect(loopCreate).toMatchObject({
      edgeType: AgentEdgeType.Loop,
      predicate: "retryCount < 3",
    });
    expect(loopCreate).not.toHaveProperty("direction");

    const standard = workItemGraphDraftReducer(draft, {
      type: "connect",
      input: {
        source: firstIdentity,
        target: secondIdentity,
        edgeType: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        actionLabel: "tap Continue",
      },
    });
    const standardCreate = standard.operations.find(
      (operation) => operation.op === "relationship.create",
    );
    expect(standardCreate).not.toHaveProperty("predicate");
    expect(standardCreate).toHaveProperty("actionLabel", "tap Continue");

    expect(() =>
      workItemGraphDraftReducer(draft, {
        type: "connect",
        input: {
          source: firstIdentity,
          target: secondIdentity,
          edgeType: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: "not allowed",
        },
      }),
    ).toThrow("must not declare a predicate");
  });

  it("does not reuse a hydrated temporary child reference", () => {
    const input = graphInput({
      children: [node(hydratedTemporaryIdentity, "Hydrated temporary")],
    });
    const created = workItemGraphDraftReducer(
      createWorkItemGraphDraftState(input),
      { type: "create", input: { name: "New temporary" } },
    );

    const operation = created.operations.find(
      (candidate) => candidate.op === "workItem.create",
    );
    expect(operation?.op).toBe("workItem.create");
    if (operation?.op !== "workItem.create") return;
    expect(operation.ref).toEqual({
      refType: "temporary",
      tempId: "draft-work-item-2",
    });
  });

  it("preserves a transition action through flow type edits and serializes explicit clearing", () => {
    const input = graphInput();
    input.incidentRelationships[0]!.actionLabel = "tap Continue";
    const draft = createWorkItemGraphDraftState(input);
    const changed = workItemGraphDraftReducer(draft, {
      type: "reconnect",
      input: {
        ref: { refType: "existing", id: "edge-1" },
        edgeType: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: "profile incomplete",
      },
    });
    expect(changed.projection.incidentRelationships[0]?.actionLabel).toBe(
      "tap Continue",
    );
    const cleared = workItemGraphDraftReducer(changed, {
      type: "reconnect",
      input: { ref: { refType: "existing", id: "edge-1" }, actionLabel: null },
    });
    expect(cleared.projection.incidentRelationships[0]?.actionLabel).toBeNull();
    expect(cleared.operations).toContainEqual(
      expect.objectContaining({ op: "relationship.update", actionLabel: null }),
    );
  });

  it("reconnects one relationship identity with an update", () => {
    const draft = createWorkItemGraphDraftState(graphInput());
    const reconnected = workItemGraphDraftReducer(draft, {
      type: "reconnect",
      input: {
        ref: { refType: "existing", id: "edge-1" },
        source: secondIdentity,
        target: firstIdentity,
        direction: AgentEdgeDirection.Backward,
      },
    });

    expect(reconnected.operations).toEqual([
      {
        op: "relationship.update",
        ref: { refType: "existing", id: "edge-1" },
        source: secondIdentity,
        target: firstIdentity,
        direction: AgentEdgeDirection.Backward,
      },
    ]);
    expect(reconnected.projection.incidentRelationships[0]?.identity).toEqual({
      refType: "existing",
      id: "edge-1",
    });
  });

  it("deletes incident relationships and layout entries with a child", () => {
    const input = graphInput({
      root: {
        ...node(rootIdentity, "Graph Root", "GRAPH_ROOT", undefined),
        sections: [
          {
            key: "graphLayout",
            content: {
              schemaVersion: "work-item-graph-layout.v1",
              nodes: [
                {
                  node: { kind: "persistedWorkItem", workItemId: "first" },
                  position: { x: 1, y: 2 },
                },
                {
                  node: { kind: "persistedWorkItem", workItemId: "second" },
                  position: { x: 3, y: 4 },
                },
              ],
            },
          },
        ],
      },
    });
    const deleted = workItemGraphDraftReducer(
      createWorkItemGraphDraftState(input),
      { type: "delete", child: firstIdentity },
    );

    expect(
      deleted.operations.some(
        (operation) =>
          operation.op === "relationship.delete" &&
          operation.ref.refType === "existing" &&
          operation.ref.id === "edge-1",
      ),
    ).toBe(true);
    expect(
      deleted.projection.incidentRelationships.find(
        (entry) =>
          entry.identity.refType === "existing" &&
          entry.identity.id === "edge-1",
      )?.deleted,
    ).toBe(true);
    const layout = deleted.operations.find(
      (operation) => operation.op === "layout.replace",
    );
    expect(layout?.op).toBe("layout.replace");
    if (layout?.op !== "layout.replace") return;
    expect(layout.entries.map((entry) => entry.node)).toEqual([secondIdentity]);
  });

  it("reflows to canonical positions without changing topology and converges", () => {
    const input = graphInput({
      root: {
        ...node(rootIdentity, "Graph Root", "GRAPH_ROOT", undefined),
        sections: [
          {
            key: "graphLayout",
            content: {
              schemaVersion: "work-item-graph-layout.v1",
              nodes: [
                {
                  node: { kind: "persistedWorkItem", workItemId: "first" },
                  position: { x: 400, y: 300 },
                },
                {
                  node: { kind: "persistedWorkItem", workItemId: "second" },
                  position: { x: 500, y: 300 },
                },
              ],
            },
          },
        ],
      },
    });
    const initial = createWorkItemGraphDraftState(input);
    const reflowed = workItemGraphDraftReducer(initial, { type: "reflow" });
    const repeated = workItemGraphDraftReducer(reflowed, { type: "reflow" });

    expect(reflowed.operations).toHaveLength(1);
    expect(reflowed.operations[0]?.op).toBe("layout.clear");
    expect(reflowed.projection.incidentRelationships).toEqual(
      initial.projection.incidentRelationships,
    );
    expect(reflowed.projection.children).toEqual(initial.projection.children);
    expect(reflowed.projection.effectiveLayout).not.toEqual(
      initial.projection.effectiveLayout,
    );
    expect(repeated.operations).toEqual(reflowed.operations);
    expect(repeated.projection.effectiveLayout).toEqual(
      reflowed.projection.effectiveLayout,
    );
  });

  it("does not let backward or loop edges change forward layout depth", () => {
    const backward = {
      ...relationship("backward", firstIdentity, secondIdentity),
      direction: AgentEdgeDirection.Backward,
    };
    const loop = {
      ...relationship("loop", secondIdentity, secondIdentity),
      edgeType: AgentEdgeType.Loop,
      label: AgentEdgeType.Loop,
    };
    const layout = computeCanonicalWorkItemGraphLayout({
      children: [node(firstIdentity, "First"), node(secondIdentity, "Second")],
      relationships: [backward, loop],
    });

    expect(layout.nodes.every((entry) => entry.position.x === 24)).toBe(true);
  });

  it("keeps cyclic canonical placement independent of persisted identity order", () => {
    const firstCycleChildren = [
      node({ refType: "existing", id: "z" }, "First"),
      node({ refType: "existing", id: "a" }, "Second"),
    ];
    const secondCycleChildren = [
      node({ refType: "existing", id: "a" }, "First"),
      node({ refType: "existing", id: "z" }, "Second"),
    ];
    const firstCycleLayout = computeCanonicalWorkItemGraphLayout({
      children: firstCycleChildren,
      relationships: [
        relationship(
          "first-to-second",
          firstCycleChildren[0].identity,
          firstCycleChildren[1].identity,
        ),
        relationship(
          "second-to-first",
          firstCycleChildren[1].identity,
          firstCycleChildren[0].identity,
        ),
      ],
    });
    const secondCycleLayout = computeCanonicalWorkItemGraphLayout({
      children: secondCycleChildren,
      relationships: [
        relationship(
          "first-to-second",
          secondCycleChildren[0].identity,
          secondCycleChildren[1].identity,
        ),
        relationship(
          "second-to-first",
          secondCycleChildren[1].identity,
          secondCycleChildren[0].identity,
        ),
      ],
    });
    const identityKey = (identity: WorkItemChangeSetIdentity): string =>
      identity.refType === "existing" ? identity.id : identity.tempId;
    const positionsByName = (
      children: readonly ProjectedWorkItem[],
      layout: ReturnType<typeof computeCanonicalWorkItemGraphLayout>,
    ): Map<string, { x: number; y: number }> =>
      new Map(
        layout.nodes.map((entry) => [
          children.find(
            (child) => identityKey(child.identity) === identityKey(entry.node),
          )?.name ?? "",
          entry.position,
        ]),
      );

    expect(positionsByName(firstCycleChildren, firstCycleLayout)).toEqual(
      positionsByName(secondCycleChildren, secondCycleLayout),
    );
  });

  it("replaces reflow clear with a complete map on the next move", () => {
    const initial = createWorkItemGraphDraftState(graphInput());
    const reflowed = workItemGraphDraftReducer(initial, { type: "reflow" });
    const moved = workItemGraphDraftReducer(reflowed, {
      type: "move",
      child: firstIdentity,
      position: { x: 777, y: 888 },
    });

    expect(
      moved.operations.filter((operation) => operation.op === "layout.clear"),
    ).toEqual([]);
    const layout = moved.operations.find(
      (operation) => operation.op === "layout.replace",
    );
    expect(layout?.op).toBe("layout.replace");
    if (layout?.op !== "layout.replace") return;
    expect(layout.entries).toHaveLength(2);
    expect(
      layout.entries.find((entry) => entry.node === firstIdentity)?.position,
    ).toEqual({ x: 777, y: 888 });
    expect(
      layout.entries.every((entry) => Number.isFinite(entry.position.x)),
    ).toBe(true);
  });

  it("restores committed placement when a moved draft is reset or rehydrated", () => {
    const committedInput = graphInput({
      root: {
        ...node(rootIdentity, "Graph Root", "GRAPH_ROOT", undefined),
        sections: [
          {
            key: "graphLayout",
            content: {
              schemaVersion: "work-item-graph-layout.v1",
              nodes: [
                {
                  node: {
                    kind: "persistedWorkItem",
                    workItemId: "first",
                  },
                  position: { x: 100, y: 200 },
                },
                {
                  node: {
                    kind: "persistedWorkItem",
                    workItemId: "second",
                  },
                  position: { x: 300, y: 400 },
                },
              ],
            },
          },
        ],
      },
    });
    const initial = createWorkItemGraphDraftState(committedInput);
    const moved = workItemGraphDraftReducer(initial, {
      type: "move",
      child: firstIdentity,
      position: { x: 777, y: 888 },
    });
    const reset = workItemGraphDraftReducer(moved, { type: "reset" });
    const rehydrated = workItemGraphDraftReducer(moved, {
      type: "hydrate",
      input: committedInput,
    });
    const firstPosition = (
      state: typeof initial,
    ): { x: number; y: number } | undefined =>
      state.projection.effectiveLayout.nodes.find(
        (entry) => entry.node === firstIdentity,
      )?.position;

    expect(firstPosition(moved)).toEqual({ x: 777, y: 888 });
    expect(firstPosition(reset)).toEqual({ x: 100, y: 200 });
    expect(firstPosition(rehydrated)).toEqual({ x: 100, y: 200 });
    expect(reset.operations).toEqual([]);
    expect(rehydrated.operations).toEqual([]);
  });

  it("supports movement and canonical reset without an optional preference declaration", () => {
    const input = graphInput({
      root: node(rootIdentity, "Board", "BOARD"),
      children: [node(firstIdentity, "Card", "CARD")],
      incidentRelationships: [],
      typeDefinition: {
        key: "BOARD",
        name: "Board",
        sections: [],
        allowedStatuses: [],
        capabilities: {
          graph: {
            nodeChildType: "CARD",
            layout: { sectionKey: "boardPositions", schemaRef: "layout.v1" },
            readableRelationships: [],
            editableRelationships: [],
            rendererKey: "work-item-graph",
            editorKey: "work-item-graph-editor",
            supportedActions: [],
          },
        },
      },
    });
    const draft = createWorkItemGraphDraftState(input);
    const moved = workItemGraphDraftReducer(draft, {
      type: "move",
      child: firstIdentity,
      position: { x: 10, y: 20 },
    });

    expect(moved.projection.layoutSectionKey).toBe("boardPositions");
    expect(moved.operations[0]?.op).toBe("layout.replace");
    expect(() =>
      workItemGraphDraftReducer(draft, { type: "applyPreferredLayout" }),
    ).toThrow("A valid preferred row and column shape is required");
    const reset = workItemGraphDraftReducer(moved, { type: "reflow" });
    expect(reset.projection.layoutSource).toBe("canonical");
  });

  it("defaults created children to the configured graph node type", () => {
    const input = graphInput({
      root: node(rootIdentity, "Board", "BOARD"),
      children: [],
      incidentRelationships: [],
      typeDefinition: {
        key: "BOARD",
        name: "Board",
        sections: [],
        allowedStatuses: [],
        capabilities: {
          graph: {
            nodeChildType: "CARD",
            layout: { sectionKey: "boardPositions", schemaRef: "layout.v1" },
            layoutPreference: {
              sectionKey: "layoutPreference",
              schemaRef: "preference.v1",
            },
            readableRelationships: [],
            editableRelationships: [],
            rendererKey: "work-item-graph",
            editorKey: "work-item-graph-editor",
            supportedActions: [],
          },
        },
      },
    });
    const created = workItemGraphDraftReducer(
      createWorkItemGraphDraftState(input),
      { type: "create", input: { name: "New card" } },
    );

    const operation = created.operations[0];
    expect(operation?.op).toBe("workItem.create");
    if (operation?.op !== "workItem.create") return;
    expect(operation.type).toBe("CARD");
    expect(created.projection.children[0]?.type).toBe("CARD");
  });

  it("keeps preference edits inert until explicitly applying a complete layout", () => {
    const input = graphInput({
      root: {
        ...node(rootIdentity, "Graph Root", "GRAPH_ROOT", undefined),
        sections: [
          {
            key: "layoutPreference",
            content: {
              schemaVersion: "work-item-graph-layout-preference.v1",
              rows: 1,
              columns: 1,
            },
          },
        ],
      },
    });
    const draft = createWorkItemGraphDraftState(input);
    const edited = workItemGraphDraftReducer(draft, {
      type: "replaceSection",
      input: {
        op: "section.replace",
        ref: rootIdentity,
        key: "layoutPreference",
        content: {
          schemaVersion: "work-item-graph-layout-preference.v1",
          rows: 1,
          columns: 2,
        },
      },
    });

    expect(edited.projection.layoutSource).toBe("canonical");
    expect(edited.operations).not.toContainEqual(
      expect.objectContaining({ op: "layout.replace" }),
    );

    const applied = workItemGraphDraftReducer(edited, {
      type: "applyPreferredLayout",
    });
    const layoutOperation = applied.operations.find(
      (operation) => operation.op === "layout.replace",
    );
    expect(layoutOperation).toEqual(
      expect.objectContaining({
        op: "layout.replace",
        entries: expect.arrayContaining([
          expect.objectContaining({ node: firstIdentity }),
          expect.objectContaining({ node: secondIdentity }),
        ]),
      }),
    );
    expect(applied.projection.layoutSource).toBe("authored");
  });

  it("round-trips the optional preference with its generated schema shape", () => {
    const preference = { rows: 5, columns: 3 } as const;

    expect(
      parseWorkItemGraphLayoutPreference(
        JSON.stringify({
          schemaVersion: "work-item-graph-layout-preference.v1",
          ...preference,
        }),
      ),
    ).toEqual(preference);
    expect(serializeWorkItemGraphLayoutPreference(preference)).toEqual({
      schemaVersion: "work-item-graph-layout-preference.v1",
      ...preference,
    });
    expect(
      parseWorkItemGraphLayoutPreference({
        schemaVersion: "work-item-graph-layout-preference.v1",
        rows: 0,
        columns: 3,
      }),
    ).toBeNull();
  });

  it("creates the newly declared layout section when an old root applies a preference", () => {
    const input = graphInput({
      root: {
        ...node(rootIdentity, "Graph Root", "GRAPH_ROOT", undefined),
        sections: [
          {
            key: "layoutPreference",
            content: {
              schemaVersion: "work-item-graph-layout-preference.v1",
              rows: 1,
              columns: 2,
            },
          },
        ],
      },
    });
    const applied = workItemGraphDraftReducer(
      createWorkItemGraphDraftState(input),
      { type: "applyPreferredLayout" },
    );
    const layoutOperation = applied.operations.find(
      (operation) => operation.op === "layout.replace",
    );

    expect(layoutOperation?.op).toBe("layout.replace");
    if (layoutOperation?.op !== "layout.replace") return;
    expect(layoutOperation.sectionKey).toBe("graphLayout");
    expect(layoutOperation.entries).toHaveLength(input.children.length);
    expect(applied.projection.projectedRoot.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "graphLayout",
          content: expect.objectContaining({
            schemaVersion: "work-item-graph-layout.v1",
          }),
        }),
      ]),
    );
    expect(applied.projection.layoutSource).toBe("authored");
  });

  it("keeps existing authored coordinates during a preference-only review", () => {
    const authoredPositions = [
      { x: 80, y: 120 },
      { x: 420, y: 360 },
    ] as const;
    const input = graphInput({
      root: {
        ...node(rootIdentity, "Graph Root", "GRAPH_ROOT", undefined),
        sections: [
          {
            key: "graphLayout",
            content: {
              schemaVersion: "work-item-graph-layout.v1",
              nodes: inputChildrenLayout(authoredPositions),
            },
          },
          {
            key: "layoutPreference",
            content: {
              schemaVersion: "work-item-graph-layout-preference.v1",
              rows: 1,
              columns: 2,
            },
          },
        ],
      },
    });
    const projection = {
      valid: true,
      projectedRoot: input.root,
      children: input.children,
      sections: input.root.sections,
      incidentRelationships: input.incidentRelationships,
      identityLabels: {},
      issues: [],
      warnings: [],
    };

    const hydrated = hydrateValidatedWorkItemGraphProjection(projection, [
      {
        op: "section.replace",
        ref: rootIdentity,
        key: "layoutPreference",
        content: {
          schemaVersion: "work-item-graph-layout-preference.v1",
          rows: 5,
          columns: 3,
        },
      },
    ]);

    expect(hydrated.layoutSource).toBe("authored");
    expect(
      hydrated.effectiveLayout.nodes.map((entry) => entry.position),
    ).toEqual(authoredPositions);
  });
});

function inputChildrenLayout(
  positions: readonly [{ x: number; y: number }, { x: number; y: number }],
) {
  return [
    {
      node: { kind: "persistedWorkItem" as const, workItemId: "first" },
      position: positions[0],
    },
    {
      node: { kind: "persistedWorkItem" as const, workItemId: "second" },
      position: positions[1],
    },
  ];
}
