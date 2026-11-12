import { render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  WorkflowGraphSurface,
  type WorkflowGraphDiffElements,
  type WorkflowGraphSurfaceData,
} from "../WorkflowMentionInlineRenderer";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({
    isFetched: true,
    error: null,
    workItemTypeDefinition: undefined,
  }),
}));

vi.mock("../../ProposalGroupReview/SavedJourneyScreen", () => ({
  SavedJourneyScreen: ({ name }: { name: string }) => (
    <div data-testid="saved-screen">{name}</div>
  ),
}));

const existing = (id: string) => ({ refType: "existing" as const, id });
const rel = (id: string) => ({ refType: "existing" as const, id });

const screenStep = (id: string, name: string) => ({
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
        canonicalReference: { entityType: "TASK", entityId: `m-${id}` },
      }),
    },
  ],
});

// Relationship ids carry the identity prefix; existing screen ids are bare.
const transition = (
  rawId: string,
  source: string,
  target: string,
  actionLabel: string,
) => ({
  id: `existing:${rawId}`,
  sourceNodeId: source,
  targetNodeId: target,
  actionLabel,
  transitionRole: null,
  predicate: "leads_to",
});

const graphData = {
  workflow: {
    id: "flow-1",
    name: "Checkout",
    type: "DIAGRAM",
    organizationId: ORG,
    projectId: PROJECT,
    edges: [],
    sections: [
      {
        key: "diagramMetadata",
        content: JSON.stringify({ kind: "UX_FLOW", level: "OVERVIEW" }),
      },
    ],
  },
  steps: [
    screenStep("cart", "Cart"),
    screenStep("pay", "Pay"),
    screenStep("tip", "Tip"),
    screenStep("gone", "Gone"),
  ],
  edges: [
    transition("e-keep", "cart", "pay", "Check out"),
    transition("e-new", "pay", "tip", "Add tip"),
    transition("e-edit", "tip", "cart", "Back"),
    transition("e-gone", "pay", "gone", "Cancel"),
  ],
  participation: null,
} as unknown as WorkflowGraphSurfaceData;

const group = (children: string[], relationships: string[]) => ({
  children: children.map(existing),
  relationships: relationships.map(rel),
});

const diffElements: WorkflowGraphDiffElements = {
  added: group(["tip"], ["e-new"]),
  changed: group(["pay"], ["e-edit"]),
  deleted: group(["gone"], ["e-gone"]),
};

const renderSurface = (
  props: Partial<React.ComponentProps<typeof WorkflowGraphSurface>>,
) =>
  render(
    <MemoryRouter>
      <WorkflowGraphSurface graphData={graphData} {...props} />
    </MemoryRouter>,
  );

const states = (testId: string, idAttr: string) =>
  Object.fromEntries(
    screen
      .getAllByTestId(testId)
      .map((el) => [
        el.getAttribute(idAttr),
        el.getAttribute("data-change-state"),
      ]),
  );

describe("UX-flow proposal update highlighting", () => {
  it("marks added and changed screens and transitions, keeps the rest neutral and omits removals", () => {
    renderSurface({
      diffElements,
      createdElements: group(["tip"], ["e-new"]),
      presentationState: "added",
    });

    expect(states("journey-screen", "data-step-id")).toEqual({
      cart: "unchanged",
      pay: "changed",
      tip: "added",
    });
    expect(states("journey-transition", "data-edge-id")).toEqual({
      "existing:e-keep": "unchanged",
      "existing:e-new": "added",
      "existing:e-edit": "changed",
    });
    expect(screen.queryByText("Gone")).toBeNull();
    expect(screen.queryByText("Cancel")).toBeNull();
    // Labels of the surviving transitions are kept.
    const transitions = screen.getAllByTestId("journey-transition");
    expect(within(transitions[0]).getByText("Check out")).toBeInTheDocument();
  });

  it("keeps an entirely new flow neutral", () => {
    renderSurface({
      createdElements: group(
        ["cart", "pay", "tip", "gone"],
        ["e-keep", "e-new", "e-edit", "e-gone"],
      ),
      presentationState: "authored",
    });

    const all = [
      ...screen.getAllByTestId("journey-screen"),
      ...screen.getAllByTestId("journey-transition"),
    ];
    expect(all).toHaveLength(8);
    all.forEach((el) =>
      expect(el).toHaveAttribute("data-change-state", "unchanged"),
    );
  });

  it("does not mark a saved flow viewed outside a proposal", () => {
    renderSurface({});

    screen
      .getAllByTestId("journey-screen")
      .forEach((el) =>
        expect(el).toHaveAttribute("data-change-state", "unchanged"),
      );
    expect(screen.getAllByTestId("journey-screen")).toHaveLength(4);
  });
});
