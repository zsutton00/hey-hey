import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { queryOptions } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeType,
  type WorkItemTypeSummaryDto,
  type WorkItemChangeSetIdentity,
} from "../../../api";
import type { ProjectedWorkItem } from "../../../api";
import {
  buildWorkflowGraphModel,
  projectWorkItemGraphForWorkflowSurface,
  type WorkItemGraphProjectionData,
  WorkflowGraphSurface,
} from "../WorkflowMentionInlineRenderer";
import { DIAGRAM_SCREEN_UNAVAILABLE_TEXT } from "../DiagramElementScreen";

const apiMocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  fetchType: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/serviceClients")>()),
  unifiedApiClient: { getTask: apiMocks.getTask },
}));

// Only the network read behind the real by-key hook is replaced; the hook,
// its cache and its state mapping stay real.
vi.mock("../../../data/collections/workItemTypes", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../data/collections/workItemTypes")
    >();
  return {
    ...actual,
    workItemTypeByKeyQueryOptions: (
      _queryClient: unknown,
      organizationId: string,
      projectId: string,
      typeKey: string,
    ) =>
      queryOptions({
        queryKey: ["test-type-by-key", organizationId, projectId, typeKey],
        queryFn: () => apiMocks.fetchType(typeKey),
        retry: false,
      }),
  };
});

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

const ORG = "org-1";
const PROJECT = "project-1";
const MOCKUP_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_MOCKUP_ID = "22222222-2222-4222-8222-222222222222";
const FEATURE_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOM_ID = "55555555-5555-4555-8555-555555555555";

const DESKTOP = { width: 1280, height: 800 };
const sizeProfile = (size: { width: number; height: number }) => ({
  key: "desktop",
  label: "Desktop",
  breakpoints: [{ minContainerWidth: 0, inline: size, page: size }],
});

const mockupTypeSummary = (
  sections: unknown[] = [
    { key: "purpose", label: "Purpose", kind: "markdown" },
    {
      key: "mockup",
      label: "Mockup",
      kind: "html/css",
      defaultSizeKey: "desktop",
      sizeProfiles: [sizeProfile(DESKTOP)],
    },
  ],
): WorkItemTypeSummaryDto =>
  ({
    definition: {
      key: "mockup",
      name: "Mockup",
      role: "project-info",
      sections,
      allowedStatuses: [],
    },
  }) as unknown as WorkItemTypeSummaryDto;

const screenContent = (html = "<main>Cart</main>", css = "main{color:red}") =>
  JSON.stringify({ html, css });

const mockupItem = (
  id: string,
  overrides: Record<string, unknown> = {},
  content: string = screenContent(),
) => ({
  id,
  name: "Cart screen",
  type: "mockup",
  organizationId: ORG,
  projectId: PROJECT,
  sections: [
    {
      id: "s1",
      key: "mockup",
      order: 0,
      materializedMarkdown: content,
    },
  ],
  ...overrides,
});

const respondWith = (items: Record<string, unknown>) =>
  apiMocks.getTask.mockImplementation(
    async ({ taskId }: { taskId: string }) => ({
      data: { data: items[taskId] ?? null },
    }),
  );

const rootIdentity: WorkItemChangeSetIdentity = {
  refType: "existing",
  id: "diagram-root",
};

const elementIdentity = (id: string): WorkItemChangeSetIdentity => ({
  refType: "existing",
  id,
});

const element = (
  id: string,
  name: string,
  reference?: { entityType: "TASK" | "SERVICE"; entityId: string },
  extraSections: ProjectedWorkItem["sections"] = [],
): ProjectedWorkItem => ({
  identity: elementIdentity(id),
  label: name,
  name,
  type: "DIAGRAM_ELEMENT",
  parent: rootIdentity,
  sections: [
    {
      key: "diagramElementMetadata",
      content: {
        role: "GENERIC",
        ...(reference ? { canonicalReference: reference } : {}),
      },
    },
    ...extraSections,
  ],
  deleted: false,
});

const buildProjection = (
  children: ProjectedWorkItem[],
  positions?: number[],
): WorkItemGraphProjectionData => ({
  layoutSource: "authored",
  projectedRoot: {
    identity: rootIdentity,
    label: "Checkout",
    name: "Checkout",
    type: "DIAGRAM",
    sections: [],
    deleted: false,
  },
  children,
  incidentRelationships: [],
  effectiveLayout: {
    nodes: children.map((child, index) => ({
      node: child.identity,
      position: { x: positions?.[index] ?? 80 + index * 300, y: 90 },
    })),
  },
});

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
  </MemoryRouter>
);

const renderSurface = (
  projection: WorkItemGraphProjectionData,
  props: Partial<React.ComponentProps<typeof WorkflowGraphSurface>> = {},
) =>
  render(
    <WorkflowGraphSurface
      projection={projection}
      organizationId={ORG}
      projectId={PROJECT}
      {...props}
    />,
    { wrapper: Wrapper },
  );

// Lets the item read and the registry read settle, in order. `ticks` caps the
// wait; pass 1 to observe a state while a read is deliberately held pending.
const flush = async (ticks = 40) => {
  for (let tick = 0; tick < ticks; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    if (!document.querySelector('[data-screen-state="loading"]')) return;
  }
};

const px = (element: HTMLElement, property: "width" | "height"): number =>
  parseFloat(getComputedStyle(element)[property]);

const mockupTypeReads = () =>
  apiMocks.fetchType.mock.calls.filter(([key]) => key === "mockup");

const screenOf = (name: string) =>
  within(
    screen
      .getAllByTestId("workflow-inline-step")
      .find((card) => card.textContent?.includes(name)) as HTMLElement,
  );

beforeEach(() => {
  apiMocks.getTask.mockReset();
  apiMocks.fetchType.mockReset();
  apiMocks.fetchType.mockImplementation(async (typeKey: string) =>
    typeKey === "mockup" ? mockupTypeSummary() : null,
  );
});

describe("Diagram Element Mockup screen cards", () => {
  it("shows the canonical Mockup screen in the card body with the name below it", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();

    const card = screenOf("Cart");
    const body = card.getByTestId("diagram-element-screen");
    expect(body).toHaveAttribute("data-screen-state", "ready");
    const frame = card.getByTitle("Cart screen screen");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("<main>Cart</main>");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    expect(frame).toHaveAttribute("tabindex", "-1");

    const name = card.getByTestId("workflow-inline-step-title");
    expect(name).toHaveTextContent("Cart");
    expect(
      body.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(card.queryByTestId("workflow-inline-step-summary")).toBeNull();
    expect(card.queryByTestId("diagram-element-screen-unavailable")).toBeNull();
  });

  it("scales the complete screen proportionally inside the density footprint", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();

    const thumbnail = screenOf("Cart").getByTestId(
      "html-css-section-thumbnail",
    );
    const width = px(thumbnail, "width");
    const height = px(thumbnail, "height");
    // Authored 1280x800 presentation, never stretched or reflowed.
    expect(width / height).toBeCloseTo(1280 / 800, 1);
    const frame = screenOf("Cart").getByTitle("Cart screen screen");
    expect(frame).toHaveStyle({ width: "1280px", height: "800px" });
    // Medium density: 140px node, 12px padding, 2-line name below.
    expect(width).toBeLessThanOrEqual(140 - 24);
    expect(screen.getByTestId("workflow-inline-step-frame")).toHaveAttribute(
      "data-workflow-graph-size",
      "medium",
    );
  });

  it("layers the role icon and link strip over the screen's own corners", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
      {
        directEntityLinks: [
          {
            sourceNodeId: "cart",
            targetEntityId: SERVICE_ID,
            targetEntityType: "SERVICE",
            targetTitle: "Checkout API",
            relationshipType: AgentEdgeType.RelatedTo,
          },
        ],
      },
    );
    await flush();

    const role = screen.getByTestId("diagram-element-role-icon");
    expect(role).toHaveAttribute("aria-label", "Generic role");
    const frame = screen.getByTestId("workflow-inline-step-frame");
    const thumbnail = within(frame).getByTestId("html-css-section-thumbnail");
    const screenWidth = px(thumbnail, "width");
    const screenHeight = px(thumbnail, "height");
    const left = (140 - screenWidth) / 2;
    // Role icon: 6px inside the screen's upper-left (card padding box is 1px
    // inside the frame).
    expect(
      parseFloat(role.style.left || getComputedStyle(role).left),
    ).toBeCloseTo(left - 1 + 6, 0);
    const strip = within(frame).getByTestId("diagram-element-link-strip");
    expect(parseFloat(getComputedStyle(strip).left)).toBeCloseTo(left + 4, 0);
    const top = 1 + 12 + (screenAreaHeight() - screenHeight) / 2;
    expect(parseFloat(getComputedStyle(strip).bottom)).toBeCloseTo(
      140 - (top + screenHeight) + 4,
      0,
    );
    // Host controls are not inside the isolated iframe or the card link.
    expect(frame.querySelector("iframe")?.contains(strip)).toBe(false);
    expect(
      within(screen.getByTestId("workflow-inline-step")).queryByTestId(
        "diagram-element-link-strip",
      ),
    ).toBeNull();
  });

  it("keeps link icons activatable over the screen without navigating", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
      {
        directEntityLinks: [
          {
            sourceNodeId: "cart",
            targetEntityId: SERVICE_ID,
            targetEntityType: "SERVICE",
            targetTitle: "Checkout API",
            relationshipType: AgentEdgeType.RelatedTo,
          },
        ],
      },
    );
    await flush();

    const icon = screen.getByRole("button", {
      name: "Preview Checkout API; Related to",
    });
    fireEvent.click(icon);
    expect(screen.getByTestId("entity-hover-card")).toHaveAttribute(
      "data-entity-id",
      SERVICE_ID,
    );
  });

  it("keeps a Mockup that is only a linked entity as a link icon on the plain card", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(buildProjection([element("cart", "Cart")]), {
      directEntityLinks: [
        {
          sourceNodeId: "cart",
          targetEntityId: MOCKUP_ID,
          targetEntityType: "TASK",
          targetWorkItemType: "mockup",
          targetTitle: "Cart screen",
          relationshipType: AgentEdgeType.RelatedTo,
        },
      ],
    });
    await flush();

    expect(screen.queryByTestId("diagram-element-screen")).toBeNull();
    expect(screen.queryByTitle("Cart screen screen")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Preview Cart screen; Related to" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workflow-inline-step-title")).toHaveTextContent(
      "Cart",
    );
  });

  it("leaves absent, service and ordinary task references on the plain card", async () => {
    respondWith({
      [FEATURE_ID]: {
        id: FEATURE_ID,
        name: "Checkout feature",
        type: "FEATURE",
        sections: [],
      },
    });
    renderSurface(
      buildProjection([
        element("none", "No reference"),
        element("svc", "Service", {
          entityType: "SERVICE",
          entityId: SERVICE_ID,
        }),
        element("feat", "Feature", {
          entityType: "TASK",
          entityId: FEATURE_ID,
        }),
      ]),
    );
    await flush();

    expect(screen.queryByTestId("diagram-element-screen")).toBeNull();
    expect(
      screen.queryByTestId("diagram-element-screen-unavailable"),
    ).toBeNull();
    // Only the task reference is read; services and absent references never are.
    expect(apiMocks.getTask).toHaveBeenCalledTimes(1);
    expect(apiMocks.getTask.mock.calls[0][0]).toMatchObject({
      taskId: FEATURE_ID,
    });
    expect(mockupTypeReads()).toHaveLength(0);
    expect(screen.queryAllByTestId("workflow-inline-step-summary").length).toBe(
      0,
    );
    expect(screen.getAllByTestId("workflow-inline-step-title")).toHaveLength(3);
  });

  it("does not treat a project-custom visual type as the canonical Mockup", async () => {
    respondWith({
      [CUSTOM_ID]: {
        ...mockupItem(CUSTOM_ID),
        type: "puck_mockup",
      },
    });
    renderSurface(
      buildProjection([
        element("custom", "Custom", {
          entityType: "TASK",
          entityId: CUSTOM_ID,
        }),
      ]),
    );
    await flush();

    expect(screen.queryByTestId("diagram-element-screen")).toBeNull();
    expect(
      screen.queryByTestId("diagram-element-screen-unavailable"),
    ).toBeNull();
    expect(mockupTypeReads()).toHaveLength(0);
  });

  it("shows a restrained loading state in the card footprint until the read resolves", async () => {
    let resolve!: (value: unknown) => void;
    apiMocks.getTask.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush(1);

    expect(screen.getByTestId("diagram-element-screen-loading")).toBeVisible();
    expect(screen.getByTestId("diagram-element-screen")).toHaveAttribute(
      "data-screen-state",
      "loading",
    );

    resolve({ data: { data: mockupItem(MOCKUP_ID) } });
    await flush();
    expect(screen.queryByTestId("diagram-element-screen-loading")).toBeNull();
    expect(
      screen.getByTestId("html-css-section-thumbnail"),
    ).toBeInTheDocument();
  });

  it("does not move node positions when the screen arrives", async () => {
    let resolve!: (value: unknown) => void;
    apiMocks.getTask.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
        element("next", "Next"),
      ]),
    );
    await flush(1);
    const transforms = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node"))
        .map((node) => node.style.transform)
        .sort();
    const before = transforms();
    expect(before.length).toBe(2);

    resolve({ data: { data: mockupItem(MOCKUP_ID) } });
    await flush();
    expect(
      screen.getByTestId("html-css-section-thumbnail"),
    ).toBeInTheDocument();
    expect(transforms()).toEqual(before);
  });

  it("falls back to the plain card with a visible notice when the read fails", async () => {
    apiMocks.getTask.mockRejectedValue(new Error("forbidden"));
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();
    await flush();

    const notice = screen.getByTestId("diagram-element-screen-unavailable");
    expect(notice).toHaveTextContent(DIAGRAM_SCREEN_UNAVAILABLE_TEXT);
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("diagram-element-screen")).toBeNull();
    expect(screen.getByTestId("workflow-inline-step-title")).toHaveTextContent(
      "Cart",
    );
  });

  it("falls back visibly when the referenced item is missing", async () => {
    respondWith({});
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();

    expect(
      screen.getByTestId("diagram-element-screen-unavailable"),
    ).toHaveTextContent(DIAGRAM_SCREEN_UNAVAILABLE_TEXT);
  });

  it.each([
    [
      "no populated screen section",
      [{ id: "p", key: "purpose", order: 0, materializedMarkdown: "Why" }],
    ],
    [
      "a malformed payload",
      [{ id: "m", key: "mockup", order: 0, materializedMarkdown: "{not json" }],
    ],
    [
      "a payload that decodes to no renderable size",
      [
        {
          id: "m",
          key: "mockup",
          order: 0,
          materializedMarkdown: JSON.stringify({
            html: "<p/>",
            css: "",
            sizeKey: "unknown-size",
          }),
        },
      ],
    ],
  ])("falls back visibly for %s", async (_label, sections) => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID, { sections }) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();

    expect(
      screen.getByTestId("diagram-element-screen-unavailable"),
    ).toHaveTextContent(DIAGRAM_SCREEN_UNAVAILABLE_TEXT);
    expect(screen.queryByTestId("diagram-element-screen")).toBeNull();
    expect(screen.queryByRole("img", { name: /Mockup screen/ })).toBeNull();
  });

  it("withholds screen rendering while the registry is unavailable", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    apiMocks.fetchType.mockRejectedValue(new Error("registry down"));
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();
    await flush();

    expect(screen.queryByTitle("Cart screen screen")).toBeNull();
    expect(screen.queryByTestId("html-css-section-thumbnail")).toBeNull();
    expect(
      screen.getByTestId("diagram-element-screen-unavailable"),
    ).toBeInTheDocument();
  });

  it("selects the screen section through the registry definition, never by key", async () => {
    apiMocks.fetchType.mockResolvedValue(
      mockupTypeSummary([
        { key: "notes", label: "Notes", kind: "markdown" },
        {
          key: "screenshotHtml",
          label: "Screen",
          kind: "html/css",
          defaultSizeKey: "desktop",
          sizeProfiles: [sizeProfile({ width: 400, height: 800 })],
        },
      ]),
    );
    respondWith({
      [MOCKUP_ID]: mockupItem(MOCKUP_ID, {
        sections: [
          {
            id: "a",
            key: "mockup",
            order: 0,
            materializedMarkdown: screenContent("<p>Ignored</p>"),
          },
          {
            id: "b",
            key: "screenshotHtml",
            order: 1,
            materializedMarkdown: screenContent("<p>Registry chosen</p>"),
          },
        ],
      }),
    });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();

    const frame = screen.getByTitle("Cart screen screen");
    expect(frame.getAttribute("srcdoc")).toContain("Registry chosen");
    expect(frame.getAttribute("srcdoc")).not.toContain("Ignored");
    // Portrait declaration keeps its aspect ratio (400x800).
    const thumbnail = screen.getByTestId("html-css-section-thumbnail");
    expect(px(thumbnail, "width") / px(thumbnail, "height")).toBeCloseTo(
      0.5,
      1,
    );
  });

  it("shares one cached read across repeated placements of the same target", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("a", "Cart A", { entityType: "TASK", entityId: MOCKUP_ID }),
        element("b", "Cart B", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();

    expect(screen.getAllByTestId("html-css-section-thumbnail")).toHaveLength(2);
    expect(apiMocks.getTask).toHaveBeenCalledTimes(1);
    expect(mockupTypeReads()).toHaveLength(1);
  });

  it("uses projected content for a target in the projection instead of its committed read", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    const mockupNode: ProjectedWorkItem = {
      identity: elementIdentity(MOCKUP_ID),
      label: "Cart screen",
      name: "Cart screen",
      type: "mockup",
      parent: rootIdentity,
      sections: [
        { key: "mockup", content: { html: "<main>Projected</main>", css: "" } },
      ],
      deleted: false,
    };
    const projection = buildProjection([
      element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      mockupNode,
    ]);
    const { rerender } = renderSurface(projection);
    await flush();

    const frame = screen.getByTitle("Cart screen screen");
    expect(frame.getAttribute("srcdoc")).toContain("Projected");
    expect(apiMocks.getTask).not.toHaveBeenCalled();

    const updated = {
      ...projection,
      children: [
        projection.children[0],
        {
          ...mockupNode,
          sections: [
            {
              key: "mockup",
              content: { html: "<main>Edited</main>", css: "" },
            },
          ],
        },
      ],
    };
    rerender(
      <WorkflowGraphSurface
        projection={updated}
        organizationId={ORG}
        projectId={PROJECT}
      />,
    );
    await flush();
    expect(
      screen.getByTitle("Cart screen screen").getAttribute("srcdoc"),
    ).toContain("Edited");
    expect(apiMocks.getTask).not.toHaveBeenCalled();
  });

  it("applies a canonical-reference edit from the projection", async () => {
    respondWith({
      [MOCKUP_ID]: mockupItem(MOCKUP_ID),
      [OTHER_MOCKUP_ID]: mockupItem(
        OTHER_MOCKUP_ID,
        { name: "Other" },
        screenContent("<main>Other screen</main>"),
      ),
    });
    const { rerender } = renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();
    expect(
      screen.getByTitle("Cart screen screen").getAttribute("srcdoc"),
    ).toContain("<main>Cart</main>");

    rerender(
      <WorkflowGraphSurface
        projection={buildProjection([
          element("cart", "Cart", {
            entityType: "TASK",
            entityId: OTHER_MOCKUP_ID,
          }),
        ])}
        organizationId={ORG}
        projectId={PROJECT}
      />,
    );
    await flush();
    expect(screen.getByTitle("Other screen").getAttribute("srcdoc")).toContain(
      "Other screen",
    );
  });

  it("never reads a temporary identity and renders one that the projection holds", async () => {
    const tempRef = "temporary:new-screen";
    const tempNode: ProjectedWorkItem = {
      identity: { refType: "temporary", tempId: "new-screen" },
      label: "Draft screen",
      name: "Draft screen",
      type: "mockup",
      parent: rootIdentity,
      sections: [
        { key: "mockup", content: screenContent("<main>Draft</main>") },
      ],
      deleted: false,
    };
    const { rerender } = renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: tempRef }),
      ]),
    );
    await flush();
    // Not in the projection: nothing to show and nothing to request.
    expect(screen.queryByTestId("diagram-element-screen")).toBeNull();
    expect(apiMocks.getTask).not.toHaveBeenCalled();

    rerender(
      <WorkflowGraphSurface
        projection={buildProjection([
          element("cart", "Cart", { entityType: "TASK", entityId: tempRef }),
          tempNode,
        ])}
        organizationId={ORG}
        projectId={PROJECT}
      />,
    );
    await flush();
    expect(
      screen.getByTitle("Draft screen screen").getAttribute("srcdoc"),
    ).toContain("Draft");
    expect(apiMocks.getTask).not.toHaveBeenCalled();
  });

  it("does not read or render screens without an organization and project", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    render(
      <WorkflowGraphSurface
        projection={buildProjection([
          element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
        ])}
      />,
      { wrapper: Wrapper },
    );
    await flush();

    expect(apiMocks.getTask).not.toHaveBeenCalled();
    expect(screen.queryByTestId("diagram-element-screen")).toBeNull();
    expect(screen.getByTestId("workflow-inline-step-title")).toHaveTextContent(
      "Cart",
    );
  });

  it("renders the same screen cards from materialized graph data", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    const graphData = projectWorkItemGraphForWorkflowSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
      { organizationId: ORG, projectId: PROJECT },
    );
    render(<WorkflowGraphSurface graphData={graphData} />, {
      wrapper: Wrapper,
    });
    await flush();

    expect(
      screen.getByTestId("html-css-section-thumbnail"),
    ).toBeInTheDocument();
  });

  it("renders screens in the fullscreen presentation with the same controls", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
      { allowFullscreen: true },
    );
    await flush();

    fireEvent.click(
      screen.getByTestId("workflow-inline-diagram-open-fullscreen"),
    );
    await flush();

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByTestId("html-css-section-thumbnail"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("diagram-element-role-icon"),
    ).toBeInTheDocument();
  });

  it("keeps element navigation and the open-reference control around the screen", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
    );
    await flush();

    const card = screen.getByTestId("workflow-inline-step");
    expect(card.tagName).toBe("A");
    expect(card).toHaveAttribute("href", expect.stringContaining("cart"));
    expect(card.querySelector("iframe")).not.toBeNull();

    const open = screen.getByTestId("diagram-reference-open");
    expect(open).toHaveAttribute("aria-label", "Open reference");
    expect(open).toHaveAttribute("href", expect.stringContaining(MOCKUP_ID));
    // The open control sits over the screen's upper-right, leaving the name
    // below the screen uncovered.
    const placement = getComputedStyle(open.parentElement as HTMLElement);
    expect(placement.top).not.toBe("");
    expect(placement.bottom).not.toBe("0px");
  });

  it.each([
    ["small", 104, 8, 30],
    ["medium", 140, 12, 35],
    ["large", 280, 16, 35],
  ])(
    "fits the whole screen inside the %s density footprint",
    async (size, nodeSize, padding, nameHeight) => {
      respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
      renderSurface(
        buildProjection([
          element("cart", "Cart", {
            entityType: "TASK",
            entityId: MOCKUP_ID,
          }),
        ]),
      );
      await flush();
      fireEvent.click(
        screen.getByTestId(`workflow-inline-diagram-size-${size}`),
      );
      await flush();

      const frame = screen.getByTestId("workflow-inline-step-frame");
      expect(frame).toHaveAttribute("data-workflow-graph-size", size);
      const thumbnail = within(frame).getByTestId("html-css-section-thumbnail");
      const inner = nodeSize - 4 - padding * 2;
      const area = inner - nameHeight - 4;
      expect(px(thumbnail, "width")).toBeLessThanOrEqual(inner);
      expect(px(thumbnail, "height")).toBeLessThanOrEqual(area);
      expect(px(thumbnail, "width") / px(thumbnail, "height")).toBeCloseTo(
        1280 / 800,
        1,
      );
      // The whole authored page is laid out and scaled, not cropped.
      expect(within(frame).getByTitle("Cart screen screen")).toHaveStyle({
        width: "1280px",
        height: "800px",
      });
      const name = within(frame).getByTestId("workflow-inline-step-title");
      expect(
        within(frame)
          .getByTestId("diagram-element-screen")
          .compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("keeps the screen static inside editable surfaces", async () => {
    respondWith({ [MOCKUP_ID]: mockupItem(MOCKUP_ID) });
    renderSurface(
      buildProjection([
        element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      ]),
      { mode: "edit", allowNodeDragging: true },
    );
    await flush();

    const frame = screen.getByTitle("Cart screen screen");
    expect(frame).toHaveStyle({ pointerEvents: "none" });
    expect(frame).toHaveAttribute("tabindex", "-1");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(
      screen.getByRole("img", { name: /Mockup screen: Cart screen/ }),
    ).toHaveStyle({ pointerEvents: "none" });
  });
});

describe("Diagram Element screen model", () => {
  it("carries the projected canonical target without issuing reads", () => {
    const projection = buildProjection([
      element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
      {
        identity: elementIdentity(MOCKUP_ID),
        label: "Cart screen",
        name: "Cart screen",
        type: "mockup",
        parent: rootIdentity,
        sections: [{ key: "mockup", content: screenContent() }],
        deleted: false,
      },
    ]);
    const graphData = projectWorkItemGraphForWorkflowSurface(projection, {
      organizationId: ORG,
      projectId: PROJECT,
    });
    const model = buildWorkflowGraphModel(graphData, { disableLinks: false });

    const cart = model.nodes.find((node) => node.id === "cart");
    expect(cart?.data.projectedReferenceTarget).toMatchObject({
      type: "mockup",
      name: "Cart screen",
    });
    expect(cart?.data.canonicalReference).toEqual({
      entityType: "TASK",
      entityId: MOCKUP_ID,
    });
    expect(apiMocks.getTask).not.toHaveBeenCalled();
  });

  it("does not change node positions or sizes with the canonical reference", () => {
    const withReference = buildWorkflowGraphModel(
      projectWorkItemGraphForWorkflowSurface(
        buildProjection([
          element("cart", "Cart", { entityType: "TASK", entityId: MOCKUP_ID }),
        ]),
        { organizationId: ORG, projectId: PROJECT },
      ),
      { disableLinks: false },
    );
    const without = buildWorkflowGraphModel(
      projectWorkItemGraphForWorkflowSurface(
        buildProjection([element("cart", "Cart")]),
        { organizationId: ORG, projectId: PROJECT },
      ),
      { disableLinks: false },
    );

    expect(withReference.nodes.map((node) => node.position)).toEqual(
      without.nodes.map((node) => node.position),
    );
    expect(withReference.nodes[0].initialWidth).toBe(
      without.nodes[0].initialWidth,
    );
  });
});

const screenAreaHeight = (): number => {
  // 140 node - 4 border allowance - 24 padding = 112 inner; 2-line 14px name
  // (35px) and a 4px gap leave 73px for the screen.
  return 112 - 35 - 4;
};
