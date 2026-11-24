import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  TaskSource,
  WorkStatus,
  type AgentEdgeResponseDto,
  type TaskResponseDto,
} from "../../../api";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import { ProjectContext } from "../../../contexts";
import { WorkflowGraphSurface } from "../WorkflowMentionInlineRenderer";
import {
  SAVED_POSITION_SCALE,
  displayToSavedPosition,
  savedToDisplayPosition,
  type SavedPositionSizeMode,
} from "../workflowGraphSavedPositions";

const SIZES: SavedPositionSizeMode[] = ["small", "medium", "large"];
const NODE_SIZE = { small: 104, medium: 140, large: 280 };

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createHeyTheme("light")}>
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

const mockFlowMeasurements = () => {
  const width = vi
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockReturnValue(140);
  const height = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(140);
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
        queueMicrotask(() => this.notify());
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

const makeItem = (
  id: string,
  name: string,
  type: string,
  parentTaskId?: string,
): TaskResponseDto => ({
  id,
  name,
  type,
  parentTaskId,
  sections: [],
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Backlog,
  source: TaskSource.System,
});

const flowEdge = (
  id: string,
  source: string,
  target: string,
): AgentEdgeResponseDto => ({
  id,
  sourceNodeId: source,
  targetNodeId: target,
  type: AgentEdgeType.Standard,
  category: AgentEdgeCategory.Flow,
  direction: AgentEdgeDirection.Forward,
  reasoning: "",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
});

// Saved in medium pixels: "a" and "b" touch edge to edge, "c" sits far below.
const SAVED = { a: { x: 0, y: 0 }, b: { x: 140, y: 0 }, c: { x: 264, y: 216 } };

const diagram = (withLayout: boolean) => {
  const workflow = makeItem("diagram", "Layout", "DIAGRAM");
  const steps = Object.keys(SAVED).map((id) =>
    makeItem(id, `Step ${id}`, "DIAGRAM_ELEMENT", workflow.id),
  );
  return {
    workflow,
    steps,
    edges: [flowEdge("e1", "a", "b"), flowEdge("e2", "b", "c")],
    participation: null,
    layout: withLayout
      ? {
          nodes: Object.entries(SAVED).map(([id, position]) => ({
            node: { kind: "persistedWorkItem" as const, workItemId: id },
            position,
          })),
        }
      : undefined,
  };
};

const nodePosition = (id: string) => {
  const element = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${id}"]`,
  );
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
    element?.style.transform ?? "",
  );
  return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
};

describe("saved position conversion", () => {
  it("leaves medium untouched and round-trips every size", () => {
    expect(savedToDisplayPosition({ x: 264, y: 216 }, "medium")).toEqual({
      x: 264,
      y: 216,
    });
    for (const size of SIZES) {
      const back = displayToSavedPosition(
        savedToDisplayPosition({ x: 123, y: -45 }, size),
        size,
      );
      expect(back.x).toBeCloseTo(123);
      expect(back.y).toBeCloseTo(-45);
    }
  });
});

describe("saved Diagram layout across display sizes", () => {
  it("keeps one arrangement at small, medium and large", async () => {
    const measure = mockFlowMeasurements();
    render(<WorkflowGraphSurface graphData={diagram(true)} disableLinks />, {
      wrapper,
    });
    measure();
    await waitFor(() => expect(nodePosition("a")).toBeDefined());

    for (const size of SIZES) {
      fireEvent.click(
        screen.getByTestId(`workflow-inline-diagram-size-${size}`),
      );
      measure();
      const scale = SAVED_POSITION_SCALE[size];
      await waitFor(() =>
        expect(nodePosition("c")).toEqual({
          x: SAVED.c.x * scale,
          y: SAVED.c.y * scale,
        }),
      );
      expect(nodePosition("a")).toEqual({ x: 0, y: 0 });
      // The edge-to-edge pair still touches without overlapping.
      expect(
        nodePosition("b")!.x - nodePosition("a")!.x,
      ).toBeGreaterThanOrEqual(NODE_SIZE[size] - 0.001);
    }
  });

  it("does not scale the automatic arrangement of an unpositioned Diagram", async () => {
    const measure = mockFlowMeasurements();
    render(<WorkflowGraphSurface graphData={diagram(false)} disableLinks />, {
      wrapper,
    });
    measure();
    await waitFor(() => expect(nodePosition("c")).toBeDefined());
    const medium = nodePosition("c")!;
    fireEvent.click(screen.getByTestId("workflow-inline-diagram-size-large"));
    measure();
    // Automatic placement already uses the large gaps (504 vs 264, under 2x),
    // so a further scale on top would push it past 2x medium.
    await waitFor(() => {
      const large = nodePosition("c");
      expect(large).toBeDefined();
      expect(large!.x).not.toEqual(medium.x);
      expect(large!.x).toBeLessThan(medium.x * 2);
    });
  });
});
