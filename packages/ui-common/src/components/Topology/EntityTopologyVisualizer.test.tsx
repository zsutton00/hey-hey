import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntityTopologyVisualizer } from "./EntityTopologyVisualizer";
import type { TopologyEntityGraphNode } from "../../data/hooks/useTopologyEntityGraph";

describe("EntityTopologyVisualizer", () => {
  const nodes: TopologyEntityGraphNode[] = [
    {
      id: "entity:TASK:task-1",
      entityId: "task-1",
      entityType: "TASK",
      label: "Task One",
      pathDepth: 0,
      isSeed: true,
    },
    {
      id: "entity:SERVICE:service-1",
      entityId: "service-1",
      entityType: "SERVICE",
      label: "Service One",
      pathDepth: 1,
      isSeed: false,
    },
  ];

  it("renders graph metadata and node cards", () => {
    render(
      <EntityTopologyVisualizer
        nodes={nodes}
        edges={[
          {
            id: "edge:1",
            source: "entity:TASK:task-1",
            target: "entity:SERVICE:service-1",
            relationshipType: "IMPLEMENTS",
            direction: "OUTGOING",
          },
        ]}
      />
    );

    expect(screen.getByText("Entity Topology Graph")).toBeInTheDocument();
    expect(screen.getByText("2 nodes")).toBeInTheDocument();
    expect(screen.getByText("1 edges")).toBeInTheDocument();
    expect(screen.getByLabelText("Task One (task-1)")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Service One (service-1)")
    ).toBeInTheDocument();
    expect(screen.getByText("IMPLEMENTS")).toBeInTheDocument();
  });

  it("calls onNodeSelect when a node card is clicked", () => {
    const onNodeSelect = vi.fn();
    render(
      <EntityTopologyVisualizer
        nodes={nodes}
        edges={[]}
        onNodeSelect={onNodeSelect}
      />
    );

    fireEvent.click(screen.getByLabelText("Task One (task-1)"));
    expect(onNodeSelect).toHaveBeenCalledWith(nodes[0]);
  });
});
