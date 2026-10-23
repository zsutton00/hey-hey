import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { ReactFlowProvider, type NodeProps } from "reactflow";
import { describe, expect, it } from "vitest";
import {
  ExecutionGraphNode,
  type ExecutionGraphNodeData,
} from "./ExecutionGraphNode";
import type { ExecutionGraphNodeState } from "./executionGraphViewModel";

const states: ExecutionGraphNodeState[] = [
  "idle",
  "eligible",
  "active",
  "blocked",
  "waiting_for_user",
  "completed",
  "stopped",
  "errored",
];

const nodeProps = (
  state: ExecutionGraphNodeState,
  selected: boolean,
  animateCurrentTask = true
): NodeProps<ExecutionGraphNodeData> => ({
  id: state,
  type: "executionGraphNode",
  data: {
    node: { id: state, title: state, state, metadata: [] },
    hasIncomingEdges: false,
    hasOutgoingEdges: false,
    siblingIndex: 0,
    siblingCount: 1,
    animateCurrentTask,
  },
  selected,
  isConnectable: false,
  zIndex: 0,
  xPos: 0,
  yPos: 0,
  dragging: false,
});

describe("ExecutionGraphNode", () => {
  it.each(states)("renders the %s state decoration", (state) => {
    render(
      <ReactFlowProvider>
        <ExecutionGraphNode {...nodeProps(state, false)} />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId("execution-graph-node")).toHaveAttribute(
      "data-node-state",
      state
    );
  });

  it("keeps selection independent from active execution state", () => {
    const { rerender } = render(
      <ReactFlowProvider>
        <ExecutionGraphNode {...nodeProps("active", false)} />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId("execution-graph-node")).toHaveAttribute(
      "data-selected",
      "false"
    );
    rerender(
      <ReactFlowProvider>
        <ExecutionGraphNode {...nodeProps("idle", true)} />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId("execution-graph-node")).toHaveAttribute(
      "data-node-state",
      "idle"
    );
    expect(screen.getByTestId("execution-graph-node")).toHaveAttribute(
      "data-selected",
      "true"
    );
  });

  it("uses a contrasting background for selected nodes", () => {
    const lightTheme = createTheme({ palette: { mode: "light" } });
    render(
      <ThemeProvider theme={lightTheme}>
        <ReactFlowProvider>
          <ExecutionGraphNode {...nodeProps("idle", true)} />
        </ReactFlowProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId("execution-graph-node")).toHaveStyle({
      backgroundColor: lightTheme.palette.grey[200],
      outline: "none",
    });

    const darkTheme = createTheme({ palette: { mode: "dark" } });
    render(
      <ThemeProvider theme={darkTheme}>
        <ReactFlowProvider>
          <ExecutionGraphNode {...nodeProps("idle", true)} />
        </ReactFlowProvider>
      </ThemeProvider>
    );

    expect(screen.getAllByTestId("execution-graph-node")[1]).toHaveStyle({
      backgroundColor: darkTheme.palette.common.white,
      outline: "none",
    });
  });

  it("marks the current task with an amber pulse", () => {
    const theme = createTheme({
      palette: {
        mode: "light",
        warning: { main: "#d99000" },
      },
    });
    render(
      <ThemeProvider theme={theme}>
        <ReactFlowProvider>
          <ExecutionGraphNode {...nodeProps("active", false)} />
        </ReactFlowProvider>
      </ThemeProvider>
    );

    const card = screen.getByTestId("execution-graph-node");
    expect(card).toHaveStyle({
      outline: `2px solid ${theme.palette.warning.main}`,
    });
    expect(card).toHaveAttribute("data-current-task", "true");
    expect(getComputedStyle(card).borderColor).toBe("rgb(217, 144, 0)");
  });

  it("can keep the current-task outline static", () => {
    render(
      <ReactFlowProvider>
        <ExecutionGraphNode {...nodeProps("active", false, false)} />
      </ReactFlowProvider>
    );

    expect(screen.getByTestId("execution-graph-node")).toHaveStyle({
      animation: "none",
    });
  });

  it("renders the shared base card chrome for adapter-provided content", () => {
    const props = nodeProps("eligible", false);
    render(
      <ReactFlowProvider>
        <ExecutionGraphNode
          {...props}
          data={{
            ...props.data,
            siblingIndex: 1,
            siblingCount: 2,
            node: {
              ...props.data.node,
              title: "Plan step",
              summary: "Plan rationale",
              entityType: "TASK",
              metadata: [{ id: "type", label: "TASK" }],
            },
          }}
        />
      </ReactFlowProvider>
    );

    const card = screen.getByTestId("execution-graph-node");
    expect(card).toHaveAttribute("data-primary-emphasis", "true");
    expect(screen.queryByText("Eligible")).not.toBeInTheDocument();
    expect(screen.getByText("NOT STARTED")).toBeInTheDocument();
    expect(screen.getByText("TASK")).toBeInTheDocument();
    expect(screen.getByText("Plan rationale")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
