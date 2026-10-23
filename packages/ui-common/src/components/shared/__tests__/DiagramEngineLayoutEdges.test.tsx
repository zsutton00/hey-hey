import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { createHeyTheme } from "../../../contexts/ThemeContext";
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
import { ProjectContext } from "../../../contexts";
import { WorkflowGraphSurface } from "../WorkflowMentionInlineRenderer";
import {
  DIAGRAM_GROUP_FIXTURE_PAIRS,
  diagramGroupFixtureSection,
} from "../__fixtures__/diagramGroupFixtures";

const projectWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
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

// Supply only the browser geometry React Flow needs to mount its real edges.
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
            this
          );
        observers.push(this.notify);
      }
      observe(target: Element) {
        this.targets.add(target);
        queueMicrotask(() => {
          if (this.targets.size) this.notify();
        });
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    }
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
  parentTaskId?: string
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

const makeFlowEdge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string
): AgentEdgeResponseDto => ({
  id,
  sourceNodeId,
  targetNodeId,
  type: AgentEdgeType.Standard,
  category: AgentEdgeCategory.Flow,
  direction: AgentEdgeDirection.Forward,
  reasoning: "",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
});

// Fan-in topology of an unpositioned data-source Diagram: the engine routes
// the four inputs of "owner" through a handle the first measurement lacked.
const makeFanInDiagram = () => {
  const workflow = makeItem("diagram", "Data sources", "DIAGRAM");
  const steps = [
    ["actions", "Actions"],
    ["runs", "Runs"],
    ["entities", "Entities"],
    ["titles", "Titles"],
    ["activity", "Activity"],
    ["logs", "Logs"],
    ["owner", "Owner"],
    ["view", "View"],
  ].map(([id, name]) => makeItem(id, name, "DIAGRAM_ELEMENT", workflow.id));
  const edges = [
    makeFlowEdge("e-entities-runs", "entities", "runs"),
    makeFlowEdge("e-titles-runs", "titles", "runs"),
    makeFlowEdge("e-runs-owner", "runs", "owner"),
    makeFlowEdge("e-actions-owner", "actions", "owner"),
    makeFlowEdge("e-activity-owner", "activity", "owner"),
    makeFlowEdge("e-logs-owner", "logs", "owner"),
    makeFlowEdge("e-owner-view", "owner", "view"),
  ];
  return { workflow, steps, edges };
};

describe("unpositioned Diagram engine layout", () => {
  it("renders nothing until the engine arranges, then every flow edge", async () => {
    const measure = mockFlowMeasurements();
    render(
      <WorkflowGraphSurface graphData={makeFanInDiagram()} disableLinks />,
      {
        wrapper: projectWrapper,
      }
    );

    const surface = screen.getByTestId("workflow-inline-diagram");
    expect(surface).toHaveAttribute("data-workflow-view-mode", "arranging");
    expect(screen.queryAllByTestId("workflow-inline-step")).toHaveLength(0);

    await waitFor(() =>
      expect(surface).not.toHaveAttribute(
        "data-workflow-view-mode",
        "arranging"
      )
    );
    measure();
    const viewport = screen.getByTestId("workflow-inline-diagram-viewport");
    await waitFor(() =>
      expect(
        within(viewport).getAllByTestId("workflow-inline-edge-hit-area")
      ).toHaveLength(7)
    );
    expect(
      within(viewport).getAllByTestId("workflow-inline-step")
    ).toHaveLength(8);
  });
});

describe("authored Diagram boundaries", () => {
  const pair = DIAGRAM_GROUP_FIXTURE_PAIRS.find(
    (candidate) => candidate.key === "aws-gcp-deployment"
  )!;
  const graphData = (grouped: boolean) => {
    const fixture = grouped ? pair.grouped : pair.original;
    const workflow = {
      ...makeItem("deployment", fixture.title, "DIAGRAM"),
      sections: grouped
        ? [
            {
              id: "groups",
              key: "diagramGroups",
              order: 0,
              materializedMarkdown: JSON.stringify(
                diagramGroupFixtureSection(fixture)
              ),
            },
          ]
        : [],
    } as TaskResponseDto;
    return {
      workflow,
      steps: fixture.elements.map((element) =>
        makeItem(element.id, element.title, "DIAGRAM_ELEMENT", workflow.id)
      ),
      edges: fixture.flows.map((flow, index) =>
        makeFlowEdge(`flow-${index}`, flow.source, flow.target)
      ),
      participation: null,
      layout: {
        schemaVersion: "work-item-graph-layout.v1" as const,
        nodes: fixture.elements.map((element, index) => ({
          node: {
            kind: "persistedWorkItem" as const,
            workItemId: element.id,
          },
          position: { x: index * 300, y: (index % 2) * 300 },
        })),
      },
    };
  };

  it("draws labeled nested boundaries around saved positions", async () => {
    const measure = mockFlowMeasurements();
    render(<WorkflowGraphSurface graphData={graphData(true)} disableLinks />, {
      wrapper: projectWrapper,
    });
    measure();
    const region = await screen.findByTestId(
      "workflow-inline-diagram-boundary-aws-us-east-1"
    );
    expect(region).toHaveAttribute("data-meaning", "DEPLOYMENT_BOUNDARY");
    expect(region).toHaveAttribute("data-depth", "1");
    expect(region).toHaveAttribute("data-color", "orange");
    expect(region).toHaveStyle({ borderStyle: "solid" });
    expect(screen.getByText("us-east-1")).toHaveStyle({
      fontStyle: "normal",
      fontWeight: "600",
    });
    expect(region).toHaveTextContent("us-east-1");
    expect(
      screen.getByTestId("workflow-inline-diagram-boundary-aws")
    ).toHaveAttribute("data-depth", "0");
    expect(
      screen.getByTestId("workflow-inline-diagram-boundary-checkout-path")
    ).toHaveAttribute("data-meaning", "VISUAL_ASSOCIATION");
    expect(
      screen.getByTestId("workflow-inline-diagram-boundary-checkout-path")
    ).toHaveStyle({ borderStyle: "dashed" });
    expect(screen.getAllByTestId("workflow-inline-step")).toHaveLength(
      pair.grouped.elements.length
    );
  });

  it("renders the ungrouped original without boundaries", async () => {
    const measure = mockFlowMeasurements();
    render(<WorkflowGraphSurface graphData={graphData(false)} disableLinks />, {
      wrapper: projectWrapper,
    });
    measure();
    await waitFor(() =>
      expect(screen.getAllByTestId("workflow-inline-step")).toHaveLength(
        pair.original.elements.length
      )
    );
    expect(
      screen.queryByTestId("workflow-inline-diagram-boundaries")
    ).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "uses identity tokens and stronger nested tints in %s",
    async (mode) => {
      const theme = createHeyTheme(mode);
      const measure = mockFlowMeasurements();
      render(
        <ThemeProvider theme={theme}>
          <WorkflowGraphSurface graphData={graphData(true)} disableLinks />
        </ThemeProvider>,
        { wrapper: projectWrapper }
      );
      measure();
      const outer = await screen.findByTestId(
        "workflow-inline-diagram-boundary-aws"
      );
      const inner = screen.getByTestId(
        "workflow-inline-diagram-boundary-aws-us-east-1"
      );
      expect(outer).toHaveAttribute("data-color", "orange");
      expect(inner).toHaveAttribute("data-color", "orange");
      expect(getComputedStyle(outer).backgroundColor).not.toBe(
        getComputedStyle(inner).backgroundColor
      );
      expect(screen.getByText("us-east-1")).toHaveStyle({
        color: theme.palette.diagramGroups.orange,
        fontStyle: "normal",
      });
      expect(
        screen.getByTestId("workflow-inline-diagram-boundary-gcp")
      ).toHaveAttribute("data-color", "blue");
    }
  );
});
