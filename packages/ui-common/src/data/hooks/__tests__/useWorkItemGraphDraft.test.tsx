import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
} from "../../../api";
import type {
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  WorkItemChangeSetIdentity,
} from "../../../api";
import { useWorkItemGraphDraft } from "../useWorkItemGraphDraft";
import { computeCanonicalWorkItemGraphLayout } from "../../../components/shared/workItemGraphDraft";

const root = { refType: "existing", id: "root" } as const;
const first = { refType: "existing", id: "first" } as const;
const hydratedTemporary = {
  refType: "temporary",
  tempId: "draft-work-item-1",
} as const;

function makeNode(
  identity: WorkItemChangeSetIdentity,
  name: string,
  type: string,
  parent?: WorkItemChangeSetIdentity
): ProjectedWorkItem {
  return {
    identity,
    label: name,
    type,
    name,
    ...(parent ? { parent } : {}),
    sections: [],
    deleted: false,
  };
}

function makeInput() {
  const edge: ProjectedWorkItemRelationship = {
    identity: { refType: "existing", id: "edge" },
    label: AgentEdgeType.Standard,
    source: first,
    target: root,
    edgeType: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
    deleted: false,
  };
  return {
    root: makeNode(root, "Root", "GRAPH_ROOT"),
    children: [makeNode(first, "First", "GRAPH_NODE", root)],
    incidentRelationships: [edge],
    typeDefinition: {
      key: "GRAPH_ROOT",
      name: "Graph root",
      sections: [],
      allowedStatuses: [],
      capabilities: {
        graph: {
          nodeChildType: "GRAPH_NODE",
          layout: { sectionKey: "layout", schemaRef: "layout.v1" },
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
  };
}

describe("useWorkItemGraphDraft", () => {
  it.each([undefined, "", "  \n\t"])(
    "opens a custom graph with absent or cleared layout %j and empty preference",
    (content) => {
      const input = makeInput();
      input.root.sections = [
        { key: "layoutPreference", content: "" },
        ...(content === undefined ? [] : [{ key: "layout", content }]),
      ];
      const { result } = renderHook(() => useWorkItemGraphDraft(input));
      const canonical = computeCanonicalWorkItemGraphLayout({
        children: input.children,
        relationships: input.incidentRelationships,
      });
      expect(result.current.projected.layoutSource).toBe("canonical");
      expect(result.current.projected.effectiveLayout).toEqual(canonical);
      expect(result.current.projected.children).toEqual(input.children);
      expect(result.current.projected.incidentRelationships).toEqual(
        input.incidentRelationships,
      );
      expect(result.current.isDirty).toBe(false);
      act(() => result.current.move(first, { x: 73, y: 91 }));
      expect(result.current.operations[0]).toMatchObject({
        op: "layout.replace",
        sectionKey: "layout",
      });
      act(() => result.current.reset());
      expect(result.current.projected.effectiveLayout).toEqual(canonical);
      expect(result.current.operations).toEqual([]);
    },
  );

  it("preserves saved authored coordinates through the hook", () => {
    const input = makeInput();
    input.root.sections = [
      {
        key: "layout",
        content: JSON.stringify({
          schemaVersion: "work-item-graph-layout.v1",
          nodes: [
            {
              node: { kind: "persistedWorkItem", workItemId: "first" },
              position: { x: 73, y: 91 },
            },
          ],
        }),
      },
    ];
    const { result } = renderHook(() => useWorkItemGraphDraft(input));
    expect(result.current.projected.layoutSource).toBe("authored");
    expect(result.current.projected.effectiveLayout.nodes[0]?.position).toEqual(
      { x: 73, y: 91 },
    );
  });

  it("keeps domain actions local and exposes typed lifecycle controls", () => {
    const input = makeInput();
    const { result } = renderHook(() => useWorkItemGraphDraft(input));

    expect(result.current.operations).toEqual([]);
    act(() => result.current.move(first, { x: 100, y: 200 }));
    expect(result.current.operations).toHaveLength(1);
    expect(result.current.operations[0]?.op).toBe("layout.replace");

    act(() => result.current.reflow());
    expect(result.current.operations).toHaveLength(1);
    expect(result.current.operations[0]?.op).toBe("layout.clear");

    act(() => result.current.reset());
    expect(result.current.operations).toEqual([]);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.projected.projectedRoot).toEqual(input.root);
  });

  it("wires explicit preferred layout application through the hook", () => {
    const input = makeInput();
    input.root = {
      ...input.root,
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
    };
    const { result } = renderHook(() => useWorkItemGraphDraft(input));

    act(() => result.current.applyPreferredLayout());

    const layoutOperation = result.current.operations.find(
      (operation) => operation.op === "layout.replace"
    );
    expect(layoutOperation?.op).toBe("layout.replace");
    if (layoutOperation?.op !== "layout.replace") return;
    expect(layoutOperation.entries).toHaveLength(1);
    expect(result.current.draft.preferredLayoutResult?.requested).toEqual({
      rows: 1,
      columns: 1,
    });
  });

  it("covers temporary children after reflow without a mutation client", () => {
    const input = makeInput();
    const { result } = renderHook(() => useWorkItemGraphDraft(input));

    act(() =>
      result.current.create({
        name: "Temporary",
        type: "GRAPH_NODE",
      })
    );
    act(() => result.current.reflow());

    expect(result.current.operations).toHaveLength(2);
    expect(result.current.operations[0]?.op).toBe("workItem.create");
    expect(result.current.operations[1]?.op).toBe("layout.clear");
    expect(result.current.projected.effectiveLayout.nodes).toHaveLength(2);
    expect(
      result.current.projected.effectiveLayout.nodes.every(
        (entry) =>
          Number.isFinite(entry.position.x) && Number.isFinite(entry.position.y)
      )
    ).toBe(true);
  });

  it("allocates a hook-created child around hydrated temporary references", () => {
    const input = makeInput();
    input.children = [
      ...input.children,
      makeNode(hydratedTemporary, "Hydrated temporary", "GRAPH_NODE", root),
    ];
    const { result } = renderHook(() => useWorkItemGraphDraft(input));

    let createdRef: ReturnType<typeof result.current.create> | undefined;
    act(() => {
      createdRef = result.current.create({
        name: "New temporary",
        type: "GRAPH_NODE",
      });
    });

    expect(createdRef).toEqual({
      refType: "temporary",
      tempId: "draft-work-item-2",
    });
  });

  it("creates an empty-canvas child, position, and relationship in one reducer action", () => {
    const graphInput = makeInput();
    const { result } = renderHook(() => useWorkItemGraphDraft(graphInput));

    let created: ReturnType<typeof result.current.createConnected> | undefined;
    act(() => {
      created = result.current.createConnected({
        child: {
          name: "Connected child",
          type: "GRAPH_NODE",
          position: { x: 320, y: 180 },
        },
        relationship: {
          childEndpoint: "target",
          otherEndpoint: first,
          edgeType: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        },
      });
    });

    expect(created).toEqual({
      child: { refType: "temporary", tempId: "draft-work-item-1" },
      relationship: {
        refType: "temporary",
        tempId: "draft-relationship-1",
      },
    });
    expect(result.current.operations.map((operation) => operation.op)).toEqual([
      "workItem.create",
      "layout.replace",
      "relationship.create",
    ]);
    expect(result.current.projected.children.at(-1)?.identity).toEqual(
      created?.child
    );
    expect(result.current.projected.incidentRelationships.at(-1)).toMatchObject(
      {
        source: first,
        target: created?.child,
        edgeType: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
      }
    );
  });
});
