import type {
  TopologyEntityGraphEdge,
  TopologyEntityGraphNode,
} from "@hey-hey/ui-common/data";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityRelationshipsTab } from "./EntityRelationshipsTab";

const mockUseTopologyEntityGraph = vi.fn();
const mockEntityTopologyGraph = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useTopologyEntityGraph: (...args: unknown[]) =>
    mockUseTopologyEntityGraph(...args),
}));

vi.mock("./EntityTopologyGraph", () => ({
  EntityTopologyGraph: (props: unknown) => {
    mockEntityTopologyGraph(props);
    return <div>graph</div>;
  },
}));

const createNode = (
  overrides: Partial<TopologyEntityGraphNode>,
): TopologyEntityGraphNode => ({
  id: "entity:PLAN:plan-1",
  entityId: "plan-1",
  entityType: "PLAN",
  label: "Plan",
  pathDepth: 0,
  isSeed: true,
  ...overrides,
});

const createEdge = (
  overrides: Partial<TopologyEntityGraphEdge>,
): TopologyEntityGraphEdge => ({
  id: "edge-1",
  source: "entity:PLAN:plan-1",
  target: "entity:TASK:task-1",
  relationshipType: "HAS_TASK",
  direction: "OUTGOING",
  ...overrides,
});

const latestGraphProps = (): {
  nodes: TopologyEntityGraphNode[];
  edges: TopologyEntityGraphEdge[];
} =>
  mockEntityTopologyGraph.mock.calls.at(-1)?.[0] as {
    nodes: TopologyEntityGraphNode[];
    edges: TopologyEntityGraphEdge[];
  };

describe("EntityRelationshipsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTopologyEntityGraph.mockReturnValue({
      nodes: [
        createNode(),
        createNode({
          id: "entity:TASK:task-1",
          entityId: "task-1",
          entityType: "TASK",
          label: "Task",
          pathDepth: 1,
          isSeed: false,
        }),
        createNode({
          id: "entity:DESIGN_DOC:doc-1",
          entityId: "doc-1",
          entityType: "DESIGN_DOC",
          label: "Design Doc",
          pathDepth: 2,
          isSeed: false,
        }),
      ],
      edges: [
        createEdge(),
        createEdge({
          id: "edge-2",
          source: "entity:TASK:task-1",
          target: "entity:DESIGN_DOC:doc-1",
          relationshipType: "HAS_DOC",
        }),
      ],
      isLoading: false,
      error: null,
    });
  });

  it("filters by hop count while keeping the full filter option list", async () => {
    render(
      <EntityRelationshipsTab
        organizationId="org-1"
        projectId="project-1"
        entityId="plan-1"
      />,
    );

    await waitFor(() => {
      expect(latestGraphProps().nodes).toHaveLength(3);
      expect(latestGraphProps().edges).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "1 hop" }));

    await waitFor(() => {
      expect(latestGraphProps().nodes).toHaveLength(2);
      expect(latestGraphProps().edges).toHaveLength(1);
    });

    expect(screen.getByLabelText("Design Doc")).toBeInTheDocument();
  });

  it("filters node types and edge types client side", async () => {
    render(
      <EntityRelationshipsTab
        organizationId="org-1"
        projectId="project-1"
        entityId="plan-1"
      />,
    );

    await waitFor(() => {
      expect(latestGraphProps().nodes).toHaveLength(3);
      expect(latestGraphProps().edges).toHaveLength(2);
    });

    fireEvent.click(screen.getByLabelText("Has Doc"));

    await waitFor(() => {
      expect(latestGraphProps().nodes).toHaveLength(3);
      expect(latestGraphProps().edges).toHaveLength(1);
    });

    fireEvent.click(screen.getByLabelText("Design Doc"));

    await waitFor(() => {
      expect(latestGraphProps().nodes).toHaveLength(2);
      expect(latestGraphProps().edges).toHaveLength(1);
    });
  });
});
