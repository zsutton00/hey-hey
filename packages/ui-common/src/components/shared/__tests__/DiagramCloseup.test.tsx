import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { http, HttpResponse } from "msw";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  TaskSource,
  WorkStatus,
  type DiagramGroup,
  type TaskResponseDto,
} from "../../../api";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import "../../../i18n";
import { workItemHandlers } from "../../../test/workItemGraphQLHandlers";
import {
  DiagramCloseup,
  WorkflowGraphSurface,
} from "../WorkflowMentionInlineRenderer";

type Position = { x: number; y: number };

/** A branching step with a neighbour on every side and one far away. */
const SAVED: Record<string, Position> = {
  admit: { x: 40, y: 216 },
  decide: { x: 301, y: 216 },
  pickup: { x: 562, y: 36 },
  cancel: { x: 562, y: 276 },
  expire: { x: 1800, y: 216 },
};
const CONNECTIONS = [
  ["admit", "decide", "admitted"],
  ["decide", "pickup", "Run is free"],
  ["decide", "cancel", "cancel arrives"],
  ["decide", "expire", "waited too long"],
] as const;

const section = (key: string, content: string) => ({
  id: key,
  key,
  order: 0,
  materializedMarkdown: content,
  crdtSnapshotSeq: null,
});

const item = (
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

const QUEUE_GROUP: DiagramGroup = {
  id: "queue",
  label: "Input queue",
  meaning: "STRUCTURAL_BOUNDARY",
  members: [{ kind: "persistedWorkItem", workItemId: "decide" }],
};

const graph = ({
  saved = true,
  kind,
  elementSections = {},
}: {
  saved?: boolean;
  kind?: "UX_FLOW";
  elementSections?: Record<string, TaskResponseDto["sections"]>;
} = {}) => ({
  workflow: item("diagram", "DIAGRAM", [
    section(
      "diagramGroups",
      JSON.stringify({
        schemaVersion: "diagram-groups.v1",
        groups: [QUEUE_GROUP],
      }),
    ),
    ...(kind
      ? [
          section(
            "diagramMetadata",
            JSON.stringify({ kind, level: "OVERVIEW" }),
          ),
        ]
      : []),
  ]),
  steps: Object.keys(SAVED).map((id) =>
    item(id, "DIAGRAM_ELEMENT", elementSections[id]),
  ),
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
  layout: saved
    ? {
        nodes: Object.entries(SAVED).map(([workItemId, position]) => ({
          node: { kind: "persistedWorkItem" as const, workItemId },
          position,
        })),
      }
    : undefined,
});

let pageWidth = 762;
let notifyResize: Array<() => void> = [];

beforeEach(() => {
  pageWidth = 762;
  notifyResize = [];
  for (const property of [
    "clientWidth",
    "offsetWidth",
    "offsetHeight",
  ] as const) {
    const prototype =
      property === "clientWidth" ? Element.prototype : HTMLElement.prototype;
    vi.spyOn(prototype as HTMLElement, property, "get").mockImplementation(
      function (this: HTMLElement) {
        return this.closest(".react-flow__node") ? 140 : pageWidth;
      },
    );
  }
  // React Flow draws connections once it has measured the elements.
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
              contentRect: new DOMRect(0, 0, 600, 450),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            })),
            this,
          );
        notifyResize.push(this.notify);
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
  globalThis.mswServer.use(
    ...workItemHandlers([]),
    http.get("*/work-item-types/:typeKey", () =>
      HttpResponse.json({ data: null }),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    notifyResize.forEach((notify) => notify());
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const renderCloseup = async (
  graphData: ReturnType<typeof graph>,
  highlighted = ["decide"],
) => {
  render(
    <MemoryRouter>
      <ThemeProvider theme={createHeyTheme("dark")}>
        <DiagramCloseup
          graphData={graphData}
          highlightedStepIds={highlighted}
        />
      </ThemeProvider>
    </MemoryRouter>,
  );
  const closeup = await screen.findByTestId("diagram-closeup");
  await settle();
  return closeup;
};

const camera = (closeup: HTMLElement) => {
  const transform = closeup.querySelector<HTMLElement>(".react-flow__viewport")!
    .style.transform;
  const [x, y, zoom] = transform.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return { x: x!, y: y!, zoom: zoom! };
};

/** Whether an element's saved square shows whole within the close-up. */
const isWhollyShown = (closeup: HTMLElement, id: string) => {
  const { x, y, zoom } = camera(closeup);
  const position = SAVED[id]!;
  const height = parseFloat(getComputedStyle(closeup).height);
  return (
    x + position.x * zoom >= 0 &&
    y + position.y * zoom >= 0 &&
    x + (position.x + 140) * zoom <= pageWidth &&
    y + (position.y + 140) * zoom <= height
  );
};

const moreConnections = (closeup: HTMLElement) =>
  within(closeup).queryByTestId("diagram-closeup-more-connections")
    ?.textContent;

describe("DiagramCloseup", () => {
  it("zooms to the element and its neighbours and counts what runs off", async () => {
    const closeup = await renderCloseup(graph());

    // The far neighbour keeps the focus from fitting at a readable zoom.
    expect(camera(closeup).zoom).toBe(0.8);
    expect(
      ["admit", "decide", "pickup", "cancel", "expire"].map((id) =>
        isWhollyShown(closeup, id),
      ),
    ).toEqual([true, true, true, true, false]);
    expect(moreConnections(closeup)).toBe("+1 more connection");
    expect(closeup.querySelector('[data-step-id="decide"]')).toHaveAttribute(
      "data-step-highlighted",
      "true",
    );
    expect(
      closeup.querySelectorAll('[data-step-highlighted="true"]'),
    ).toHaveLength(1);
    expect(closeup).toHaveTextContent("Input queue");
    await waitFor(() => expect(closeup).toHaveTextContent("Run is free"));
  });

  it("keeps names readable on a narrow screen, centred on the element", async () => {
    pageWidth = 320;
    const closeup = await renderCloseup(graph());

    const { x, zoom } = camera(closeup);
    expect(zoom).toBe(0.8);
    expect(x + (SAVED.decide!.x + 70) * zoom).toBeCloseTo(160, 0);
    expect(moreConnections(closeup)).toBe("+4 more connections");
  });

  it("never enlarges a Diagram and hides the count when everything fits", async () => {
    const closeup = await renderCloseup(graph(), ["admit"]);

    expect(camera(closeup).zoom).toBe(1);
    expect(moreConnections(closeup)).toBeUndefined();
  });

  it("leaves wheel scrolling to the page and does not move", async () => {
    const closeup = await renderCloseup(graph());
    const before = camera(closeup);

    const scrolled = fireEvent.wheel(
      closeup.querySelector(".react-flow__pane")!,
      { deltaY: 240 },
    );
    await settle();

    expect(scrolled).toBe(true);
    expect(camera(closeup)).toEqual(before);
  });

  it("arranges a Diagram without saved positions", async () => {
    const closeup = await renderCloseup(graph({ saved: false }));

    await waitFor(() =>
      expect(closeup.querySelector('[data-step-id="decide"]')).toHaveAttribute(
        "data-step-highlighted",
        "true",
      ),
    );
  });

  it("shows a screen flow's screens with the linked screen outlined", async () => {
    const screenOf = (id: string) => [
      section(
        "diagramElementMetadata",
        JSON.stringify({
          role: "UI",
          canonicalReference: { entityType: "TASK", entityId: `${id}-screen` },
        }),
      ),
    ];
    globalThis.mswServer.use(
      ...workItemHandlers(
        Object.keys(SAVED).map((id) => ({
          id: `${id}-screen`,
          name: `${id} page`,
          type: "STANDARD",
          status: "ACTIVE",
        })),
      ),
    );

    const screenFlow = graph({
      kind: "UX_FLOW",
      elementSections: Object.fromEntries(
        Object.keys(SAVED).map((id) => [id, screenOf(id)]),
      ),
    });
    const closeup = await renderCloseup(screenFlow);

    // Each screen is the live linked item, as the full flow draws it.
    expect(await within(closeup).findByText("decide page")).toBeInTheDocument();
    expect(within(closeup).getAllByTestId("journey-screen")).toHaveLength(5);
    const outlined = within(closeup).getByTestId("ux-flow-highlighted-screen");
    expect(outlined).toHaveTextContent("decide page");
    expect(closeup).not.toHaveTextContent("You are here");
    expect(closeup.querySelector(".react-flow")).toBeNull();
    expect(moreConnections(closeup)).toMatch(/more connection/);

    // The full flow, as Preview opens it, keeps the same screen outlined.
    cleanup();
    render(
      <MemoryRouter>
        <WorkflowGraphSurface
          graphData={screenFlow}
          highlightedStepId={["decide"]}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("ux-flow-highlighted-screen"),
      ).toHaveTextContent("decide page"),
    );
  });
});
