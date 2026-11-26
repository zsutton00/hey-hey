import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  TaskSource,
  WorkItemTypeGraphAction,
  WorkStatus,
  type DiagramGroup,
  type TaskResponseDto,
} from "../../../api";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import { ProjectContext } from "../../../contexts";
import { useWorkItemGraphDraft } from "../../../data/hooks/useWorkItemGraphDraft";
import { WorkflowGraphSurface } from "../WorkflowMentionInlineRenderer";
import { WorkItemGraphEditor } from "../WorkItemGraphEditor";

type Position = { x: number; y: number };
type SizeMode = "small" | "medium" | "large";

const NODE_SIZE: Record<SizeMode, number> = {
  small: 104,
  medium: 140,
  large: 280,
};
const MARGIN: Record<SizeMode, number> = { small: 20, medium: 24, large: 32 };
const INLINE = "workflow-inline-diagram";
const FULLSCREEN = "workflow-fullscreen-diagram";

// The saved "Authoring guidance" Diagram: its positions, connections and group.
const SAVED: Record<string, Position> = {
  tool: { x: 0, y: 0 },
  assembler: { x: 300, y: 0 },
  registry: { x: 600, y: 0 },
  standards: { x: 900, y: 0 },
  root: { x: 0, y: 220 },
  validation: { x: 300, y: 220 },
};
const CONNECTIONS = [
  ["validation", "tool", "Checks proof-of-read tokens"],
  ["validation", "registry", "Gets effective definition"],
  ["tool", "root", "Adds root guidance when proof is missing"],
  ["registry", "standards", "Reads writing standards"],
  ["assembler", "registry", "Gets effective definition"],
  ["tool", "assembler", "Builds type guidance"],
] as const;

const group = (
  id: string,
  label: string,
  members: string[],
  parentGroupId?: string,
): DiagramGroup => ({
  id,
  label,
  meaning: "STRUCTURAL_BOUNDARY",
  ...(parentGroupId ? { parentGroupId } : {}),
  members: members.map((workItemId) => ({
    kind: "persistedWorkItem",
    workItemId,
  })),
});
const API_GROUP = group("api", "API service", [
  "tool",
  "assembler",
  "registry",
  "root",
  "validation",
]);

const section = (key: string, content: string) => ({
  id: key,
  key,
  order: 0,
  materializedMarkdown: content,
  crdtSnapshotSeq: null,
});
const groupsContent = (groups: DiagramGroup[]) =>
  JSON.stringify({ schemaVersion: "diagram-groups.v1", groups });
const layoutNodes = (positions: Record<string, Position>) =>
  Object.entries(positions).map(([workItemId, position]) => ({
    node: { kind: "persistedWorkItem" as const, workItemId },
    position,
  }));

const makeItem = (
  id: string,
  type: string,
  sections: TaskResponseDto["sections"] = [],
): TaskResponseDto => ({
  id,
  name: id,
  type,
  sections,
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Backlog,
  source: TaskSource.System,
});

const diagram = ({
  positions = SAVED,
  groups = [API_GROUP],
  saved = true,
}: {
  positions?: Record<string, Position>;
  groups?: DiagramGroup[];
  saved?: boolean;
} = {}) => ({
  workflow: makeItem("diagram", "DIAGRAM", [
    section("diagramGroups", groupsContent(groups)),
  ]),
  steps: Object.keys(positions).map((id) => makeItem(id, "DIAGRAM_ELEMENT")),
  edges: CONNECTIONS.map(([source, target, actionLabel]) => ({
    id: `${source}-${target}`,
    sourceNodeId: source,
    targetNodeId: target,
    actionLabel,
    type: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
    reasoning: "",
    createdAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:00:00.000Z",
  })),
  participation: null,
  layout: saved ? { nodes: layoutNodes(positions) } : undefined,
});

const shifted = (dx: number, dy: number) =>
  Object.fromEntries(
    Object.entries(SAVED).map(([id, { x, y }]) => [
      id,
      { x: x + dx, y: y + dy },
    ]),
  );

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

/** The measurements jsdom cannot make: windows, canvases, cards and labels. */
const screenSize = { width: 1200, groupLabelWidth: 90 };
const FULLSCREEN_HEIGHT = 700;
let resizeNotifiers: Array<() => void> = [];

const windowHeightOf = (viewport: Element) =>
  viewport.getAttribute("data-testid") === `${FULLSCREEN}-viewport`
    ? FULLSCREEN_HEIGHT
    : parseFloat(getComputedStyle(viewport).height);

const measure = (element: HTMLElement, axis: "width" | "height"): number => {
  const testId = element.getAttribute("data-testid") ?? "";
  if (testId.endsWith("-viewport")) {
    return axis === "width" ? screenSize.width : windowHeightOf(element);
  }
  if (element.classList.contains("react-flow")) {
    const viewport = element.closest('[data-testid$="-viewport"]')!;
    return axis === "width" ? screenSize.width : windowHeightOf(viewport);
  }
  if (
    element.tagName === "SPAN" &&
    element.closest('[data-testid$="-boundaries"]')
  ) {
    return screenSize.groupLabelWidth;
  }
  const size = element
    .closest("[data-workflow-graph-size]")
    ?.getAttribute("data-workflow-graph-size") as SizeMode | undefined;
  return NODE_SIZE[size ?? "medium"];
};

beforeEach(() => {
  screenSize.width = 1200;
  screenSize.groupLabelWidth = 90;
  resizeNotifiers = [];
  for (const [property, axis] of [
    ["offsetWidth", "width"],
    ["offsetHeight", "height"],
    ["clientWidth", "width"],
    ["clientHeight", "height"],
  ] as const) {
    const prototype = property.startsWith("offset")
      ? HTMLElement.prototype
      : Element.prototype;
    vi.spyOn(prototype as HTMLElement, property, "get").mockImplementation(
      function (this: HTMLElement) {
        return measure(this, axis);
      },
    );
  }
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, screenSize.width, FULLSCREEN_HEIGHT),
  );
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
        resizeNotifiers.push(this.notify);
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Let the canvas measure itself and run any pending fit. */
const settle = () =>
  act(async () => {
    resizeNotifiers.forEach((notify) => notify());
    await new Promise((resolve) => setTimeout(resolve, 220));
  });

const viewportOf = (prefix: string) => screen.getByTestId(`${prefix}-viewport`);

const camera = (prefix = INLINE) => {
  const transform = viewportOf(prefix).querySelector<HTMLElement>(
    ".react-flow__viewport",
  )!.style.transform;
  const [x, y, zoom] = transform.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
  return { x: x!, y: y!, zoom: zoom! };
};

const canvas = (prefix = INLINE) => {
  const style = getComputedStyle(screen.getByTestId(`${prefix}-canvas`));
  return {
    width: parseFloat(style.minWidth),
    height: parseFloat(style.height),
  };
};

const boxRect = (id: string, prefix = INLINE) => {
  const style = getComputedStyle(
    screen.getByTestId(`${prefix}-boundary-${id}`),
  );
  return {
    left: parseFloat(style.left),
    top: parseFloat(style.top),
    width: parseFloat(style.width),
    height: parseFloat(style.height),
  };
};

/** Every element and group box, as placed on screen, lies inside the window. */
const expectWholeDrawingInWindow = (prefix: string, groupIds = ["api"]) => {
  const view = camera(prefix);
  const viewport = viewportOf(prefix);
  const nodes = [
    ...viewport.querySelectorAll<HTMLElement>(".react-flow__node"),
  ].map((node) => {
    const [left, top] = node.style.transform
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    return { left: left!, top: top!, width: 140, height: 140 };
  });
  expect(nodes.length).toBeGreaterThan(0);
  for (const rect of [...nodes, ...groupIds.map((id) => boxRect(id, prefix))]) {
    expect(view.x + rect.left * view.zoom).toBeGreaterThanOrEqual(0);
    expect(view.y + rect.top * view.zoom).toBeGreaterThanOrEqual(0);
    expect(view.x + (rect.left + rect.width) * view.zoom).toBeLessThanOrEqual(
      screenSize.width,
    );
    expect(view.y + (rect.top + rect.height) * view.zoom).toBeLessThanOrEqual(
      windowHeightOf(viewport),
    );
  }
};

const renderSurface = async (
  graphData: ReturnType<typeof diagram>,
  props: { allowFullscreen?: boolean } = {},
) => {
  const view = render(
    <WorkflowGraphSurface graphData={graphData} disableLinks {...props} />,
    { wrapper },
  );
  await screen.findByTestId(`${INLINE}-canvas`);
  await settle();
  return view;
};

describe("inline Diagram opening view", () => {
  // Drawing edges in each size's pixels: the group reaches 24 left of and 48
  // above the first element; "standards" is rightmost; the group is lowest.
  it.each([
    ["small", 900 * (104 / 140) + 104, 220 * (104 / 140) + 104 + 24],
    ["medium", 900 + 140, 220 + 140 + 24],
    ["large", 1800 + 280, 440 + 280 + 24],
  ] as const)(
    "opens at the %s size with the whole group and a margin in view",
    async (size, right, bottom) => {
      await renderSurface(diagram());
      fireEvent.click(screen.getByTestId(`${INLINE}-size-${size}`));
      await settle();

      const margin = MARGIN[size];
      expect(camera()).toEqual({ x: margin + 24, y: margin + 48, zoom: 1 });
      expect(canvas().width).toBeCloseTo(margin + 24 + right + margin, 1);
      const height = margin + 48 + bottom + margin;
      expect(canvas().height).toBeCloseTo(height, 1);
      expect(windowHeightOf(viewportOf(INLINE))).toBeCloseTo(
        Math.min(760, height + 20),
        1,
      );
      expect(getComputedStyle(viewportOf(INLINE)).overflowY).toBe(
        height + 20 > 760 ? "auto" : "hidden",
      );
    },
  );

  it("keeps nested groups at negative positions in view and follows refreshed data, not hover", async () => {
    const groups = [
      group("api", "API service", ["assembler", "registry", "validation"]),
      group("inner", "Guidance", ["tool", "root"], "api"),
    ];
    const view = await renderSurface(
      diagram({ positions: shifted(-400, -300), groups }),
    );
    // The outer box wraps the inner box, which wraps the first element.
    expect(camera()).toEqual({ x: 24 + 400 + 48, y: 24 + 300 + 96, zoom: 1 });

    fireEvent.click(screen.getByTestId(`${INLINE}-zoom-out`));
    await settle();
    const zoomedOut = camera();
    fireEvent.pointerMove(
      document.querySelector('.react-flow__node[data-id="tool"]')!,
    );
    await settle();
    expect(camera()).toEqual(zoomedOut);

    view.rerender(
      <WorkflowGraphSurface
        graphData={diagram({ positions: shifted(500, 200), groups })}
        disableLinks
      />,
    );
    await settle();
    expect(camera()).toEqual({ x: 24 - 500 + 48, y: 24 - 200 + 96, zoom: 1 });
  });

  it("widens for a long group label without moving the opening position", async () => {
    screenSize.groupLabelWidth = 1300;
    await renderSurface(diagram());

    expect(camera()).toEqual({ x: 48, y: 72, zoom: 1 });
    // Box left (-24) + label inset (10) + label, between the two margins.
    expect(canvas().width).toBe(48 + (-24 + 10 + 1300) + 24);
  });

  it("opens an automatically arranged Diagram with its group in view", async () => {
    await renderSurface(diagram({ saved: false }));

    const box = boxRect("api");
    const view = camera();
    expect(view.zoom).toBe(1);
    expect(view.x + box.left).toBeCloseTo(24, 1);
    expect(view.y + box.top).toBeCloseTo(24, 1);
    expect(canvas().height).toBeGreaterThanOrEqual(
      view.y + box.top + box.height + 24,
    );
  });
});

describe("Fit to view and fullscreen", () => {
  const spread = Object.fromEntries(
    Object.keys(SAVED).map((id, index) => [
      id,
      { x: index * 900, y: (index % 2) * 220 },
    ]),
  );

  it("shows a very large Diagram in full inline, from an unscrolled window", async () => {
    screenSize.width = 600;
    await renderSurface(diagram({ positions: spread }));
    viewportOf(INLINE).scrollLeft = 200;
    viewportOf(INLINE).scrollTop = 40;

    fireEvent.click(screen.getByTestId(`${INLINE}-fit-to-view`));
    await settle();

    const fitted = camera();
    expect(fitted.zoom).toBeLessThan(0.3);
    expect(viewportOf(INLINE).scrollLeft).toBe(0);
    expect(viewportOf(INLINE).scrollTop).toBe(0);
    expectWholeDrawingInWindow(INLINE);

    // Zooming out again must not jump back up to the usual 30% limit.
    fireEvent.click(screen.getByTestId(`${INLINE}-zoom-out`));
    await settle();
    expect(camera().zoom).toBeCloseTo(fitted.zoom, 4);
  });

  it("opens fullscreen fitted, keeps the user's zoom through hover and fits again on request", async () => {
    await renderSurface(diagram(), { allowFullscreen: true });
    fireEvent.click(screen.getByTestId(`${INLINE}-open-fullscreen`));
    await screen.findByTestId(`${FULLSCREEN}-canvas`);
    await settle();
    const fitted = camera(FULLSCREEN);
    expectWholeDrawingInWindow(FULLSCREEN);

    fireEvent.click(screen.getByTestId(`${FULLSCREEN}-zoom-in`));
    await settle();
    const zoomed = camera(FULLSCREEN);
    expect(zoomed.zoom).toBeGreaterThan(fitted.zoom);

    const dialog = within(screen.getByRole("dialog"));
    fireEvent.pointerMove(
      screen
        .getByRole("dialog")
        .querySelector('.react-flow__node[data-id="tool"]')!,
    );
    await settle();
    fireEvent.pointerMove(
      dialog.getAllByTestId("workflow-inline-edge-label")[0]!,
    );
    await settle();
    expect(camera(FULLSCREEN)).toEqual(zoomed);

    fireEvent.click(screen.getByTestId(`${FULLSCREEN}-fit-to-view`));
    await settle();
    expect(camera(FULLSCREEN)).toEqual(fitted);
  });
});

describe("editing view", () => {
  const editorInput = {
    root: {
      identity: { refType: "existing" as const, id: "diagram" },
      label: "Authoring guidance",
      name: "Authoring guidance",
      type: "DIAGRAM",
      deleted: false,
      sections: [
        {
          key: "graphLayout",
          content: JSON.stringify({
            schemaVersion: "work-item-graph-layout.v1",
            nodes: layoutNodes(SAVED),
          }),
        },
        { key: "diagramGroups", content: groupsContent([API_GROUP]) },
      ],
    },
    children: Object.keys(SAVED).map((id) => ({
      identity: { refType: "existing" as const, id },
      label: id,
      name: id,
      type: "DIAGRAM_ELEMENT",
      deleted: false,
      sections: [],
    })),
    incidentRelationships: [],
    typeDefinition: {
      key: "DIAGRAM",
      name: "Diagram",
      statuses: [],
      sections: [
        {
          key: "graphLayout",
          kind: "json" as const,
          schemaRef: "work-item-graph-layout.v1",
        },
        {
          key: "diagramGroups",
          kind: "json" as const,
          schemaRef: "diagram-groups.v1",
        },
      ],
      capabilities: {
        graph: {
          nodeChildType: "DIAGRAM_ELEMENT",
          layout: {
            sectionKey: "graphLayout",
            schemaRef: "work-item-graph-layout.v1",
          },
          groups: {
            sectionKey: "diagramGroups",
            schemaRef: "diagram-groups.v1",
          },
          supportedActions: [
            WorkItemTypeGraphAction.ViewGraph,
            WorkItemTypeGraphAction.ReplaceLayout,
            WorkItemTypeGraphAction.ClearLayout,
          ],
          readableRelationships: [],
          editableRelationships: [],
          rendererKey: "work-item-graph",
          editorKey: "work-item-graph-editor",
        },
      },
    },
  };

  const Editor = () => {
    const draft = useWorkItemGraphDraft(editorInput);
    return (
      <WorkItemGraphEditor
        draft={draft}
        childTypeDefinition={{
          key: "DIAGRAM_ELEMENT",
          name: "Diagram Element",
          sections: [],
          statuses: [],
          forbiddenScalars: [],
        }}
        organizationId="org-1"
        projectId="project-1"
        participation={null}
      />
    );
  };

  const node = (id: string) =>
    document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;

  /** d3-drag follows the pointer on `event.view`, which jsdom cannot set. */
  const mouse = async (target: EventTarget, type: string, at: Position) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: at.x,
      clientY: at.y,
    });
    Object.defineProperty(event, "view", { value: window });
    await act(async () => {
      target.dispatchEvent(event);
    });
  };

  const drag = async (id: string, dx: number, dy: number) => {
    const from = { x: 400, y: 300 };
    const to = { x: from.x + dx, y: from.y + dy };
    await mouse(node(id), "mousedown", from);
    await mouse(window, "mousemove", {
      x: from.x + dx / 2,
      y: from.y + dy / 2,
    });
    await mouse(window, "mousemove", to);
    await mouse(window, "mouseup", to);
    await settle();
  };

  const expectTopLeft = () => {
    const box = boxRect("api");
    const view = camera();
    expect(view.zoom).toBe(1);
    expect(view.x + box.left).toBeCloseTo(24, 1);
    expect(view.y + box.top).toBeCloseTo(24, 1);
  };

  it("holds still while elements are dragged and returns to the top-left on every Reflow", async () => {
    render(<Editor />, { wrapper });
    await screen.findByTestId(`${INLINE}-canvas`);
    await settle();
    const opened = camera();
    expect(opened).toEqual({ x: 48, y: 72, zoom: 1 });
    const openedHeight = canvas().height;
    const startTransform = node("standards").style.transform;

    // Move the first element up and left, and another one far down.
    await drag("tool", -60, -50);
    await drag("standards", 0, 900);
    expect(node("standards").style.transform).not.toBe(startTransform);
    expect(camera()).toEqual(opened);
    expect(canvas().height).toBeGreaterThan(openedHeight);

    fireEvent.click(screen.getByTestId("work-item-graph-reflow"));
    await screen.findByTestId(`${INLINE}-canvas`);
    await settle();
    expectTopLeft();

    // The second Reflow reuses the arrangement without remounting the canvas.
    await drag("registry", 80, 40);
    const arrangedCanvas = screen.getByTestId(`${INLINE}-canvas`);
    fireEvent.click(screen.getByTestId(`${INLINE}-zoom-out`));
    await settle();
    viewportOf(INLINE).scrollTop = 120;

    fireEvent.click(screen.getByTestId("work-item-graph-reflow"));
    await settle();
    await waitFor(expectTopLeft);
    expect(screen.getByTestId(`${INLINE}-canvas`)).toBe(arrangedCanvas);
    expect(viewportOf(INLINE).scrollTop).toBe(0);
  });
});
