import {
  act,
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
  type ChangeWalkthroughReportPayload,
  type ReportDto,
  ReportType,
} from "../../../api";
import { PreviewHostProvider } from "../../../contexts/PreviewHostContext";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import "../../../i18n";
import {
  answerWorkItemOperation,
  edgeNodeOf,
  type FakeWorkItem,
  nodeOf,
} from "../../../test/workItemGraphQLAnswers";
import { ReportViewer } from "../ReportViewer";
import { ChangeWalkthroughReport } from "./ChangeWalkthroughReport";

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: ({
    anchorEl,
    entityId,
  }: {
    anchorEl: HTMLElement | null;
    entityId: string;
  }) =>
    anchorEl ? (
      <div data-testid="entity-hover-card" data-entity-id={entityId} />
    ) : null,
}));

const ORG_ID = "org-1";
const PROJECT_ID = "project-1";
const DIAGRAM_ID = "00000000-0000-4000-8000-0000000000d1";
const ARCHIVED_DIAGRAM_ID = "00000000-0000-4000-8000-0000000000d2";
const LINKED_TASK_ID = "00000000-0000-4000-8000-00000000f100";
const report = { organizationId: ORG_ID, projectId: PROJECT_ID } as never;

const elementId = (name: string) =>
  `element-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
const ADMIT = elementId("Admit the input");
const DECIDE = elementId("Can the Run take the next input");
const PICK_UP = elementId("Pick up the input");
const CANCEL = elementId("Resolve cancellation");
const EXPIRE = elementId("Expire the input");

/** A saved flow: one branching step, one neighbour far off to the right. */
const PLACED: [name: string, x: number, y: number][] = [
  ["Admit the input", 40, 216],
  ["Can the Run take the next input", 301, 216],
  ["Pick up the input", 562, 36],
  ["Resolve cancellation", 562, 276],
  ["Expire the input", 1800, 216],
];

const element = (
  id: string,
  name: string,
  parentTaskId = DIAGRAM_ID,
): FakeWorkItem => ({
  id,
  name,
  type: "DIAGRAM_ELEMENT",
  status: "ACTIVE",
  parentTaskId,
  sections: [
    {
      id: `${id}-metadata`,
      key: "diagramElementMetadata",
      order: 0,
      materializedMarkdown: JSON.stringify({ role: "COMPONENT" }),
    },
  ],
});

const diagramItem = (id: string, name: string, status = "ACTIVE") => ({
  id,
  name,
  type: "DIAGRAM",
  status,
  sections: [],
});

const SCREEN_FLOW_ID = "00000000-0000-4000-8000-0000000000d3";
const CART = "element-cart";
const PAYMENT = "element-payment";

/** Two connected screens, each showing a linked work item. */
const screenFlowItems = (): FakeWorkItem[] => [
  {
    ...diagramItem(SCREEN_FLOW_ID, "Checkout flow"),
    sections: [
      {
        id: "flow-metadata",
        key: "diagramMetadata",
        order: 0,
        materializedMarkdown: JSON.stringify({
          kind: "UX_FLOW",
          level: "OVERVIEW",
        }),
      },
    ],
  },
  ...[CART, PAYMENT].flatMap((id) => [
    {
      ...element(id, `${id} step`, SCREEN_FLOW_ID),
      sections: [
        {
          id: `${id}-metadata`,
          key: "diagramElementMetadata",
          order: 0,
          materializedMarkdown: JSON.stringify({
            role: "UI",
            canonicalReference: { entityType: "TASK", entityId: `${id}-page` },
          }),
        },
      ],
    },
    {
      id: `${id}-page`,
      name: `${id} page`,
      type: "STANDARD",
      status: "ACTIVE",
    },
  ]),
];

const projectItems = (): FakeWorkItem[] => [
  diagramItem(DIAGRAM_ID, "Input Queue Lifecycle"),
  diagramItem(ARCHIVED_DIAGRAM_ID, "Old flow", "ARCHIVED"),
  ...PLACED.map(([name]) => element(elementId(name), name)),
  { ...element("element-retired", "Retired step"), status: "ARCHIVED" },
  element("element-old", "In an archived Diagram", ARCHIVED_DIAGRAM_ID),
  { id: "task-1", name: "Not an element", type: "STANDARD", status: "ACTIVE" },
  ...screenFlowItems(),
];

const edge = (
  sourceNodeId: string,
  targetNodeId: string,
  fields: Record<string, unknown> = {},
) => ({
  id: `${sourceNodeId}:${targetNodeId}`,
  type: AgentEdgeType.Standard,
  category: AgentEdgeCategory.Flow,
  direction: AgentEdgeDirection.Forward,
  sourceNodeId,
  targetNodeId,
  ...fields,
});

const RELATIONSHIPS = [
  edge(ADMIT, DECIDE),
  edge(DECIDE, PICK_UP, { actionLabel: "Run is free" }),
  edge(DECIDE, CANCEL, { actionLabel: "cancel arrives" }),
  edge(DECIDE, EXPIRE, { actionLabel: "waited too long" }),
  edge(DECIDE, LINKED_TASK_ID, {
    type: AgentEdgeType.FulfilledBy,
    category: AgentEdgeCategory.Meta,
    targetEntityType: "TASK",
    targetNodeType: "STANDARD",
    targetNodeName: "Admit inputs in order",
  }),
];

const answerGraphQL = (items: FakeWorkItem[]) =>
  http.post("*/graphql", async ({ request }) => {
    const { operationName, variables = {} } = (await request.json()) as {
      operationName: string;
      variables?: Record<string, unknown>;
    };
    if (operationName !== "GetWorkItemGraph") {
      const answer = answerWorkItemOperation(items, operationName, variables);
      return HttpResponse.json(answer.body as never, { status: answer.status });
    }
    const root = items.find((item) => item.id === variables.id)!;
    const children = items.filter((item) => item.parentTaskId === root.id);
    const member = { withSections: true };

    return HttpResponse.json({
      data: {
        workItem: {
          __typename: "WorkItem",
          id: root.id,
          graph: {
            __typename: "WorkItemGraph",
            root: nodeOf(root, member),
            children: children.map((child) => nodeOf(child, member)),
            relationships: (root.id === SCREEN_FLOW_ID
              ? [edge(CART, PAYMENT, { actionLabel: "Checkout" })]
              : RELATIONSHIPS
            ).map(edgeNodeOf),
            layout:
              root.id === SCREEN_FLOW_ID
                ? null
                : {
                    nodes: PLACED.map(([name, x, y]) => ({
                      node: {
                        kind: "persistedWorkItem",
                        workItemId: elementId(name),
                      },
                      position: { x, y },
                    })),
                  },
            derivedReferences: [],
            participation: { entries: [], summary: {} },
          },
        },
      },
    });
  });

/** The width of every element jsdom would otherwise report as zero. */
let pageWidth = 762;

const openPreview = vi.fn();

const renderParts = (ids: string[]) =>
  render(
    <MemoryRouter>
      <ThemeProvider theme={createHeyTheme("light")}>
        <PreviewHostProvider host={{ openPreview }}>
          <ChangeWalkthroughReport
            report={report}
            reportTestId="report"
            payload={withRefs(ids)}
          />
        </PreviewHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

/** Reports each screen's rendered height, as the browser would after layout. */
const stubScreenHeights = (initial: number) => {
  let height = initial;
  const notifiers = new Set<() => void>();
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
              contentRect: new DOMRect(0, 0, 600, height),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            })),
            this,
          );
        notifiers.add(this.notify);
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

  return (next: number) =>
    act(async () => {
      height = next;
      notifiers.forEach((notify) => notify());
    });
};

/** The font an element is set in: its own rule, or the closest ancestor's. */
const fontOf = (element: Element): string => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const fonts = declaredStyles(node, "font-family");
    if (fonts.length > 0) {
      return fonts.join(" ");
    }
  }
  return "";
};

/** Values of a property from every stylesheet rule that selects the element. */
const declaredStyles = (element: Element, property: string): string[] =>
  [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .flatMap((rule) =>
      rule instanceof CSSStyleRule &&
      !rule.selectorText.includes("::") &&
      element.matches(rule.selectorText)
        ? [rule.style.getPropertyValue(property)]
        : [],
    )
    .filter(Boolean);

const outlinedScreens = () =>
  previews().map((preview) =>
    within(preview)
      .queryAllByTestId("ux-flow-highlighted-screen")
      .map((outline) =>
        outline.closest("[data-step-id]")!.getAttribute("data-step-id"),
      ),
  );

const previews = () => screen.queryAllByTestId("walkthrough-diagram-preview");
const highlightedIn = (preview: HTMLElement) =>
  [...preview.querySelectorAll('[data-step-highlighted="true"]')].map((step) =>
    step.getAttribute("data-step-id"),
  );

const withRefs = (ids: string[]) => ({
  ...payload,
  parts: [
    {
      name: "Input queue",
      role: "Admits each session input.",
      relations: "Feeds the Run.",
      diagramElementRefs: ids.map((diagramElementId) => ({ diagramElementId })),
    },
  ],
});

const payload = {
  reportType: "CHANGE_WALKTHROUGH",
  summary:
    "The Run made session metadata reliable.\n\n- **resolveAgentSessionMetadata** (`metadata.ts`): reads session data.",
  targetRunId: "11111111-1111-4111-8111-111111111111",
  groups: [
    {
      title: "Metadata",
      changes: [
        {
          title: "Resolve metadata",
          context: "Called by **the launcher**.",
          walkthrough: [],
          behavioralConsequence: "Sessions start with metadata.",
        },
      ],
    },
  ],
} satisfies ChangeWalkthroughReportPayload;

describe("ChangeWalkthroughReport", () => {
  it("sends the summary and change prose through the Markdown renderer", () => {
    render(<ChangeWalkthroughReport payload={payload} />);

    const rendered = screen
      .getAllByTestId("markdown")
      .map((n) => n.textContent);
    expect(rendered).toContain(payload.summary);
    expect(rendered).toContain("Called by **the launcher**.");
    expect(rendered).toContain("Sessions start with metadata.");
  });

  it("shows a headed parts section before the change groups", () => {
    render(
      <ChangeWalkthroughReport
        payload={{
          ...payload,
          parts: [
            {
              name: "transition-service",
              role: "Moves a message between delivery states.",
              relations: "Called by the mail delivery service.",
            },
          ],
        }}
      />,
    );

    const parts = screen.getByTestId("walkthrough-parts");
    const group = screen.getByTestId("walkthrough-group");
    expect(parts).toHaveTextContent("Parts of the system");
    expect(screen.getByTestId("walkthrough-part")).toHaveTextContent(
      "transition-service",
    );
    expect(parts).toHaveTextContent("Moves a message between delivery states.");
    expect(parts).toHaveTextContent("Called by the mail delivery service.");
    expect(
      parts.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders older reports saved without parts and shows no parts section", () => {
    render(<ChangeWalkthroughReport payload={payload} />);

    expect(screen.getByTestId("walkthrough-group")).toBeInTheDocument();
    expect(screen.queryByTestId("walkthrough-parts")).not.toBeInTheDocument();
  });

  describe("Diagram previews on parts", () => {
    beforeEach(() => {
      pageWidth = 762;
      openPreview.mockClear();
      for (const property of ["clientWidth", "offsetWidth"] as const) {
        const prototype =
          property === "clientWidth"
            ? Element.prototype
            : HTMLElement.prototype;
        vi.spyOn(prototype as HTMLElement, property, "get").mockImplementation(
          function (this: HTMLElement) {
            return this.closest(".react-flow__node") ? 140 : pageWidth;
          },
        );
      }
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
        140,
      );
      globalThis.mswServer.use(
        answerGraphQL(projectItems()),
        http.get("*/work-item-types/:typeKey", () =>
          HttpResponse.json({ data: null }),
        ),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("regroups linked screens once their measured size is known", async () => {
      // Wide enough for both screens side by side at their assumed height.
      pageWidth = 1200;
      const resizeScreens = stubScreenHeights(800);
      renderParts([CART, PAYMENT]);

      // As tall as this they do not fit one preview, so each gets its own.
      expect(
        await screen.findByRole("button", { name: "Show 1 more" }),
      ).toBeInTheDocument();
      await waitFor(() => expect(outlinedScreens()).toEqual([[CART]]));

      await resizeScreens(300);
      await waitFor(() => expect(outlinedScreens()).toEqual([[CART, PAYMENT]]));
      expect(
        screen.queryByRole("button", { name: "Show 1 more" }),
      ).not.toBeInTheDocument();
    });

    it("keeps the Diagram's own type inside a report", async () => {
      const saved = {
        id: "report-1",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        reportType: ReportType.ChangeWalkthrough,
        title: "Walkthrough",
        schemaVersion: 1,
        createdAt: "2026-11-25T00:00:00.000Z",
        payload: withRefs([DECIDE]),
      } as unknown as ReportDto;
      render(
        <MemoryRouter>
          <ThemeProvider theme={createHeyTheme("light")}>
            <PreviewHostProvider host={{ openPreview }}>
              <ReportViewer report={saved} />
            </PreviewHostProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );

      const closeup = await screen.findByTestId("diagram-closeup");
      const drawing = [closeup, ...closeup.querySelectorAll("*")];
      expect(drawing.filter((node) => fontOf(node).includes("Mono"))).toEqual(
        [],
      );
      const title = within(closeup).getAllByTestId(
        "workflow-inline-step-title",
      )[0]!;
      // Nor do the report's text sizes and wrapping reach the element cards.
      expect(declaredStyles(title, "font-size")).not.toContain("1rem");
      expect(declaredStyles(title, "white-space")).not.toContain("pre-wrap");
      // The report around it keeps its own font.
      expect(
        fontOf(screen.getByRole("heading", { name: "Input queue" })),
      ).toContain("Mono");
    });

    it("shows a close-up of the Diagram with the element highlighted among its neighbours", async () => {
      renderParts([DECIDE]);

      const closeup = await screen.findByTestId("diagram-closeup");
      const preview = previews()[0]!;
      expect(preview).toHaveTextContent("Input Queue Lifecycle");
      expect(highlightedIn(preview)).toEqual([DECIDE]);
      expect(closeup).toHaveTextContent("Admit the input");
      expect(closeup).toHaveTextContent("Pick up the input");
      // The far neighbour runs off the edge and is counted.
      expect(
        within(closeup).getByTestId("diagram-closeup-more-connections"),
      ).toHaveTextContent("+1 more connection");
      expect(
        screen.queryByTestId("walkthrough-part-show-more-previews"),
      ).not.toBeInTheDocument();
    });

    it("opens the full Diagram with the highlight, except from a linked-item icon", async () => {
      renderParts([DECIDE]);
      const closeup = await screen.findByTestId("diagram-closeup");

      fireEvent.click(
        await within(closeup).findByRole("button", {
          name: "Preview Admit inputs in order; Fulfilled by",
        }),
      );
      expect(screen.getByTestId("entity-hover-card")).toHaveAttribute(
        "data-entity-id",
        LINKED_TASK_ID,
      );
      expect(openPreview).not.toHaveBeenCalled();

      fireEvent.click(
        within(closeup).getByText("Can the Run take the next input"),
      );
      // Keyboard selection arrives through the preview's own button.
      fireEvent.click(screen.getByTestId("walkthrough-diagram-preview-open"));
      expect(openPreview.mock.calls).toEqual(
        Array(2).fill([
          {
            entityType: "task",
            entityId: DIAGRAM_ID,
            diagramElementIds: [DECIDE],
          },
        ]),
      );
      expect(
        screen.getByTestId("walkthrough-diagram-preview-open"),
      ).toHaveAccessibleName(
        /Input Queue Lifecycle .*Can the Run take the next input highlighted, connected to .*Pick up the input/,
      );
    });

    it("shares one close-up when the elements fit, and splits them when they do not", async () => {
      renderParts([DECIDE, PICK_UP]);
      await screen.findByTestId("diagram-closeup");

      expect(previews()).toHaveLength(1);
      expect(highlightedIn(previews()[0]!).sort()).toEqual(
        [DECIDE, PICK_UP].sort(),
      );
    });

    it("shows the first close-up and keeps the rest behind Show more", async () => {
      renderParts([ADMIT, EXPIRE]);
      await screen.findByTestId("diagram-closeup");

      expect(previews()).toHaveLength(1);
      expect(highlightedIn(previews()[0]!)).toEqual([ADMIT]);
      fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
      await waitFor(() =>
        expect(previews().map(highlightedIn)).toEqual([[ADMIT], [EXPIRE]]),
      );
    });

    it("splits a shared close-up on a narrow screen", async () => {
      pageWidth = 360;
      renderParts([DECIDE, PICK_UP]);
      await screen.findByTestId("diagram-closeup");

      expect(previews()).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: "Show 1 more" }),
      ).toBeInTheDocument();
    });

    it("leaves out references that no longer resolve, without counting them, and logs why", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderParts([
        "element-retired",
        "element-deleted",
        "element-old",
        "task-1",
        CANCEL,
      ]);
      await screen.findByTestId("diagram-closeup");

      expect(previews()).toHaveLength(1);
      expect(highlightedIn(previews()[0]!)).toEqual([CANCEL]);
      expect(
        screen.queryByTestId("walkthrough-part-show-more-previews"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("walkthrough-group")).toBeInTheDocument();
      const logged = warn.mock.calls.map(([message]) => String(message));
      expect(logged).toEqual(
        expect.arrayContaining([
          expect.stringContaining("element-retired omitted: element is arch"),
          expect.stringContaining(
            "element-deleted omitted: element read failed (NOT_FOUND",
          ),
          expect.stringContaining("element-old omitted: Diagram is archived"),
          expect.stringContaining("task-1 omitted: item is a STANDARD"),
        ]),
      );
    });

    it("shows nothing for a part whose references are all stale", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      renderParts(["element-retired", "element-deleted"]);

      await waitFor(() =>
        expect(
          screen.queryByTestId("walkthrough-part-diagram-previews"),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("walkthrough-part")).toBeInTheDocument();
    });

    it("shows nothing extra for a part with an empty reference list", async () => {
      renderParts([]);
      await act(async () => {});

      expect(screen.getByTestId("walkthrough-part")).toBeInTheDocument();
      expect(
        screen.queryByTestId("walkthrough-part-diagram-previews"),
      ).not.toBeInTheDocument();
    });
  });
});
