import { render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramThumbnail } from "../DiagramThumbnail";

const { graphState, mockupState } = vi.hoisted(() => ({
  graphState: { kind: "UX_FLOW" as string },
  mockupState: {} as Record<
    string,
    { type: string; status: string; name: string } | undefined
  >,
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const element = (id: string, name: string, mockupId: string | null) => ({
  id,
  name,
  type: "DIAGRAM_ELEMENT",
  organizationId: ORG,
  projectId: PROJECT,
  edges: [],
  sections: [
    {
      key: "diagramElementMetadata",
      content: JSON.stringify({
        role: "screen",
        ...(mockupId
          ? { canonicalReference: { entityType: "TASK", entityId: mockupId } }
          : {}),
      }),
    },
  ],
});

const edge = (
  id: string,
  source: string,
  target: string,
  actionLabel: string | null,
  transitionRole: string | null,
) => ({
  id,
  sourceNodeId: source,
  targetNodeId: target,
  actionLabel,
  transitionRole,
  predicate: "leads_to",
});

vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: () => ({
    isFetched: true,
    error: null,
    data: {
      root: {
        id: "flow-1",
        name: "Checkout",
        type: "DIAGRAM",
        organizationId: ORG,
        projectId: PROJECT,
        edges: [],
        sections: [
          {
            key: "diagramMetadata",
            content: JSON.stringify({
              kind: graphState.kind,
              level: "OVERVIEW",
            }),
          },
        ],
      },
      children: [
        element("s1", "Cart", "m-cart"),
        element("s2", "Pay", "m-pay"),
        element("s3", "Receipt", "m-gone"),
        element("s4", "Orphan", null),
        ...[5, 6, 7].map((n) => element(`s${n}`, `Extra ${n}`, "m-cart")),
      ],
      relationships: [
        edge("e1", "s1", "s2", "Check out", "PRIMARY_PROGRESSION"),
        edge("e2", "s2", "s3", "Confirm", null),
        edge("e3", "s3", "s4", null, null),
        edge("e4", "s4", "s5", "Hidden step", null),
        edge("e5", "s5", "s6", "Beyond", null),
      ],
      participation: null,
      layout: null,
    },
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({
    isFetched: true,
    error: null,
    workItemTypeDefinition: {
      sections: [{ key: "screen", kind: "html/css" }],
    },
  }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (_org: string, _kind: string, id: string) => ({
    isLoading: false,
    workItem: mockupState[id]
      ? {
          ...mockupState[id],
          sections: [{ key: "screen", materializedMarkdown: "<main />" }],
        }
      : undefined,
  }),
}));

vi.mock("../HtmlCssSectionThumbnail", () => ({
  HtmlCssSectionThumbnail: () => <div data-testid="html-css-thumbnail" />,
}));

describe("DiagramThumbnail for a UX flow", () => {
  beforeEach(() => {
    graphState.kind = "UX_FLOW";
    mockupState["m-cart"] = { type: "mockup", status: "ACTIVE", name: "Cart" };
    mockupState["m-pay"] = { type: "mockup", status: "ACTIVE", name: "Pay" };
    mockupState["m-gone"] = {
      type: "mockup",
      status: "ARCHIVED",
      name: "Receipt",
    };
  });

  const renderThumbnail = () =>
    render(
      <DiagramThumbnail
        organizationId={ORG}
        projectId={PROJECT}
        diagramId="flow-1"
      />,
    );

  it("shows the screens joined by action-labelled arrows instead of the graph outline", () => {
    renderThumbnail();

    expect(screen.getByTestId("ux-flow-thumbnail")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-graph-thumbnail"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId("journey-screen")).toHaveLength(5);
    expect(screen.getAllByTestId("html-css-thumbnail")).toHaveLength(3);

    const transitions = screen.getAllByTestId("journey-transition");
    expect(transitions).toHaveLength(4);
    expect(within(transitions[0]).getByText("Check out")).toBeInTheDocument();
    expect(within(transitions[1]).getByText("Confirm")).toBeInTheDocument();
  });

  it("previews only the first five screens and counts the rest", () => {
    renderThumbnail();

    expect(screen.getAllByTestId("journey-screen")).toHaveLength(5);
    expect(screen.getByTestId("ux-flow-thumbnail-more")).toHaveTextContent(
      "+2",
    );
    expect(screen.queryByText("Beyond")).toBeNull();
    expect(screen.queryByText("Extra 6")).toBeNull();
  });

  it("names the screen when its Mockup cannot be shown", () => {
    renderThumbnail();

    const placeholders = screen.getAllByTestId("journey-screen-placeholder");
    expect(placeholders.map((node) => node.textContent)).toEqual([
      expect.stringContaining("Receipt"),
      expect.stringContaining("Orphan"),
    ]);
    expect(
      screen.getAllByText("Mockup preview unavailable").length,
    ).toBeGreaterThan(0);
  });

  it("is a static miniature: no scrolling, opener or controls", () => {
    renderThumbnail();

    expect(screen.queryByTestId("journey-screen-preview")).toBeNull();
    expect(screen.getByTestId("ux-flow-thumbnail")).toHaveStyle({
      overflow: "hidden",
      pointerEvents: "none",
    });
    expect(screen.getByTestId("journey-canvas")).not.toHaveStyle({
      overflow: "auto",
    });
  });

  it("keeps the fitted outline for other Diagram kinds", () => {
    graphState.kind = "GENERAL";
    renderThumbnail();

    expect(screen.getByTestId("workflow-graph-thumbnail")).toBeInTheDocument();
    expect(screen.queryByTestId("ux-flow-thumbnail")).toBeNull();
  });
});
