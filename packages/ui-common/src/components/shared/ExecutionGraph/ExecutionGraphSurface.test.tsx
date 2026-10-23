import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ExecutionGraphSurface } from "./ExecutionGraphSurface";

describe("ExecutionGraphSurface", () => {
  it("renders nodes, dependency edges, controls, and typed selection", () => {
    const onNodeSelect = vi.fn<(nodeId: string) => void>();
    const { container } = render(
      <ExecutionGraphSurface
        viewModel={{
          nodes: [
            { id: "first", title: "First", state: "active", metadata: [] },
            { id: "second", title: "Second", state: "blocked", metadata: [] },
          ],
          dependencyEdges: [
            {
              id: "first-second",
              sourceNodeId: "first",
              targetNodeId: "second",
            },
          ],
        }}
        selectedNodeId="second"
        onNodeSelect={onNodeSelect}
      />
    );
    expect(screen.getByTestId("execution-graph-surface")).toBeInTheDocument();
    expect(screen.getAllByTestId("execution-graph-node")).toHaveLength(2);
    expect(container.querySelectorAll(".react-flow__handle")).toHaveLength(2);
    expect(
      container.querySelector(".react-flow__controls")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("First"));
    expect(onNodeSelect).toHaveBeenCalledWith("first");
    expect(
      screen
        .getAllByTestId("execution-graph-node")
        .find((node) => node.dataset.nodeState === "blocked")
    ).toHaveAttribute("data-selected", "true");
    expect(
      screen
        .getAllByTestId("execution-graph-node")
        .find((node) => node.dataset.nodeState === "active")
    ).toHaveAttribute("data-selected", "false");
  });

  it("can keep click handling without rendering selection styling", () => {
    const onNodeSelect = vi.fn<(nodeId: string) => void>();
    render(
      <ExecutionGraphSurface
        viewModel={{
          nodes: [
            { id: "first", title: "First", state: "idle", metadata: [] },
            { id: "second", title: "Second", state: "idle", metadata: [] },
          ],
          dependencyEdges: [],
        }}
        selectedNodeId="second"
        onNodeSelect={onNodeSelect}
        selectable={false}
      />
    );

    const nodes = screen.getAllByTestId("execution-graph-node");
    expect(nodes[1]).toHaveAttribute("data-selected", "false");
    fireEvent.click(screen.getByText("Second"));
    expect(onNodeSelect).toHaveBeenCalledWith("second");
  });

  it("renders mentions in titles and summaries without triggering card selection", () => {
    const onNodeSelect = vi.fn<(nodeId: string) => void>();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ExecutionGraphSurface
            viewModel={{
              nodes: [
                {
                  id: "first",
                  title: "Wire @[feature:feature-1|Billing] updates",
                  summary:
                    "Uses @[custom_kind:custom-1|Custom Thing] and plain text",
                  state: "idle",
                  metadata: [],
                },
              ],
              dependencyEdges: [],
            }}
            selectedNodeId={null}
            onNodeSelect={onNodeSelect}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const mentions = screen.getAllByTestId("mention-badge");
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toHaveAttribute("data-entity-id", "feature-1");
    expect(mentions[1]).toHaveAttribute("data-entity-type", "custom_kind");
    expect(screen.getByText(/and plain text/)).toBeInTheDocument();
    expect(screen.getByTitle("Wire @Billing updates")).toBeInTheDocument();
    expect(screen.queryByText(/@\[/)).not.toBeInTheDocument();

    fireEvent.click(mentions[0]);
    fireEvent.click(mentions[1]);
    expect(onNodeSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/and plain text/));
    expect(onNodeSelect).toHaveBeenCalledWith("first");
  });

  it("can keep current-task styling static", () => {
    render(
      <ExecutionGraphSurface
        viewModel={{
          nodes: [
            { id: "active", title: "Active", state: "active", metadata: [] },
          ],
          dependencyEdges: [],
        }}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        animateCurrentTask={false}
      />
    );

    expect(screen.getByTestId("execution-graph-node")).toHaveStyle({
      animation: "none",
    });
  });

  it("keeps Task nodes visible when the controlled graph is rebuilt", () => {
    const viewModel = {
      nodes: [{ id: "task", title: "Task", state: "idle" as const, metadata: [] }],
      dependencyEdges: [],
    };
    const { container, rerender } = render(
      <ExecutionGraphSurface
        viewModel={viewModel}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
      />
    );

    rerender(
      <ExecutionGraphSurface
        viewModel={{ ...viewModel }}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
      />
    );

    expect(container.querySelector(".react-flow__node")).toHaveStyle({
      visibility: "visible",
    });
  });
});
