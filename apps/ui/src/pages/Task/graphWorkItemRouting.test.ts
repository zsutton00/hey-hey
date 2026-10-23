import type { WorkItemTypeDefinitionDto } from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";

import {
  INSTALLED_GRAPH_EDITOR_KEY,
  INSTALLED_GRAPH_RENDERER_KEY,
  selectGraphWorkItemRoute,
} from "./graphWorkItemRouting";

const definition = (
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

const validGraph = {
  nodeChildType: "FLOW_STEP",
  layout: {
    sectionKey: "graphLayout",
    schemaRef: "#/components/schemas/WorkItemGraphLayoutValue",
  },
  readableRelationships: [],
  editableRelationships: [],
  rendererKey: INSTALLED_GRAPH_RENDERER_KEY,
  editorKey: INSTALLED_GRAPH_EDITOR_KEY,
  supportedActions: ["viewGraph", "replaceLayout"],
};

describe("selectGraphWorkItemRoute", () => {
  it("waits for the runtime definition instead of inferring from the type key", () => {
    expect(
      selectGraphWorkItemRoute({
        typeKey: "workflow",
        definition: undefined,
        isFetched: false,
      }),
    ).toEqual({ status: "loading" });
  });

  it("fails closed when the fetched definition is missing or mismatched", () => {
    expect(
      selectGraphWorkItemRoute({
        typeKey: "FLOW",
        definition: undefined,
        isFetched: true,
      }),
    ).toEqual({ status: "unresolved-definition" });
    expect(
      selectGraphWorkItemRoute({
        typeKey: "FLOW",
        definition: definition("OTHER"),
        isFetched: true,
      }),
    ).toEqual({ status: "unresolved-definition" });
  });

  it("keeps a resolved type without a graph capability on its normal page", () => {
    expect(
      selectGraphWorkItemRoute({
        typeKey: "STANDARD",
        definition: definition("STANDARD"),
        isFetched: true,
      }),
    ).toMatchObject({ status: "non-graph" });
  });

  it("selects the graph page from capability shape rather than type identity", () => {
    for (const typeKey of ["workflow", "APPROVAL_FLOW"]) {
      expect(
        selectGraphWorkItemRoute({
          typeKey,
          definition: definition(typeKey, validGraph),
          isFetched: true,
        }),
      ).toMatchObject({
        status: "graph",
        capability: {
          nodeChildType: "FLOW_STEP",
          rendererKey: INSTALLED_GRAPH_RENDERER_KEY,
          editorKey: INSTALLED_GRAPH_EDITOR_KEY,
        },
      });
    }
  });

  it("rejects incomplete capabilities and mismatched layout sections", () => {
    expect(
      selectGraphWorkItemRoute({
        typeKey: "FLOW",
        definition: definition("FLOW", {
          ...validGraph,
          readableRelationships: undefined,
        }),
        isFetched: true,
      }),
    ).toMatchObject({ status: "invalid-capability" });
    expect(
      selectGraphWorkItemRoute({
        typeKey: "FLOW",
        definition: definition("FLOW", {
          ...validGraph,
          layout: { ...validGraph.layout, sectionKey: "otherLayout" },
        }),
        isFetched: true,
      }),
    ).toMatchObject({ status: "invalid-capability" });
  });

  it.each([
    null,
    "graph",
    { ...validGraph, readableRelationships: [null] },
    { ...validGraph, supportedActions: [null] },
  ])("fails closed for malformed graph capability data", (graph) => {
    expect(
      selectGraphWorkItemRoute({
        typeKey: "FLOW",
        definition: definition("FLOW", graph),
        isFetched: true,
      }),
    ).toMatchObject({ status: "invalid-capability" });
  });

  it("rejects graph component keys outside the installed palette", () => {
    expect(
      selectGraphWorkItemRoute({
        typeKey: "FLOW",
        definition: definition("FLOW", {
          ...validGraph,
          rendererKey: "unknown-viewer",
        }),
        isFetched: true,
      }),
    ).toMatchObject({ status: "unsupported-renderer" });
    expect(
      selectGraphWorkItemRoute({
        typeKey: "FLOW",
        definition: definition("FLOW", {
          ...validGraph,
          editorKey: "unknown-editor",
        }),
        isFetched: true,
      }),
    ).toMatchObject({ status: "unsupported-editor" });
  });
});
