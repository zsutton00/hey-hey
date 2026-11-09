import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ProposalEdgeType,
  RelationshipDecisionKind,
  type ProposalEdgeDeclaration,
  type RelationshipDecision,
} from "../../../api";
import {
  RelationshipDecisionsReview,
  supersededIds,
} from "../RelationshipDecisionsReview";

const OLD_PROVIDER = "123e4567-e89b-42d3-a456-426614174002";
const NEW_PROVIDER = "123e4567-e89b-42d3-a456-426614174003";
const CONSUMER_A = "123e4567-e89b-42d3-a456-426614174001";
const CONSUMER_B = "123e4567-e89b-42d3-a456-426614174004";

const endpoint = (id: string, name: string) => ({ id, name });
const original = (consumerId: string, consumerName: string) => ({
  edgeType: "DEPENDS_ON" as const,
  description: `${consumerName} needs the provider.`,
  source: endpoint(consumerId, consumerName),
  target: endpoint(OLD_PROVIDER, "Old provider"),
});

const decisions: RelationshipDecision[] = [
  {
    relationship: { refType: "existing", id: "edge-a" },
    decision: RelationshipDecisionKind.Replace,
    original: original(CONSUMER_A, "Consumer A"),
    replacement: {
      source: { refType: "existing", id: CONSUMER_A },
      target: { refType: "existing", id: NEW_PROVIDER },
      edgeType: "DEPENDS_ON",
    },
    replacementEndpoints: [
      endpoint(CONSUMER_A, "Consumer A"),
      endpoint(NEW_PROVIDER, "New provider"),
    ],
  },
  {
    relationship: { refType: "existing", id: "edge-b" },
    decision: RelationshipDecisionKind.Retain,
    reason: "Consumer B has not migrated yet.",
    original: original(CONSUMER_B, "Consumer B"),
  },
  {
    relationship: { refType: "existing", id: "edge-c" },
    decision: RelationshipDecisionKind.Remove,
    original: {
      ...original(CONSUMER_A, "Consumer A"),
      edgeType: "RELATED_TO" as const,
    },
  },
];

const supersedesEdge: ProposalEdgeDeclaration = {
  edgeType: ProposalEdgeType.Supersedes,
  targetEntityId: OLD_PROVIDER,
  targetEntityType: "TASK",
} as ProposalEdgeDeclaration;

const renderReview = () =>
  render(
    <RelationshipDecisionsReview
      decisions={decisions}
      supersededIds={supersededIds([supersedesEdge])}
      newItemName="New provider"
    />,
  );

describe("RelationshipDecisionsReview", () => {
  it("shows what stays, what goes and what moves, with the original wording", () => {
    renderReview();

    const items = screen.getAllByTestId("relationship-decision");
    const byDecision = (decision: string) =>
      items.find((item) => item.getAttribute("data-decision") === decision)!;

    const moved = within(byDecision("replace"));
    expect(moved.getByText("Moved")).toBeTruthy();
    expect(moved.getByText(/Consumer A depends on Old provider/)).toBeTruthy();
    expect(
      moved.getByText(/Becomes: Consumer A depends on New provider/),
    ).toBeTruthy();

    const kept = within(byDecision("retain"));
    expect(kept.getByText("Kept")).toBeTruthy();
    expect(kept.getByText(/Consumer B has not migrated yet\./)).toBeTruthy();

    expect(within(byDecision("remove")).getByText("Removed")).toBeTruthy();
  });

  it("flags a kept connection that still points at the replaced item as unfinished migration", () => {
    renderReview();

    const kept = screen
      .getAllByTestId("relationship-decision")
      .find((item) => item.getAttribute("data-decision") === "retain")!;

    expect(
      within(kept).getByText("Still points at the replaced item"),
    ).toBeTruthy();
  });

  it("does not flag a kept connection when nothing is being replaced", () => {
    render(
      <RelationshipDecisionsReview
        decisions={[decisions[1]!]}
        supersededIds={supersededIds([])}
        newItemName="New provider"
      />,
    );

    expect(screen.queryByText("Still points at the replaced item")).toBeNull();
  });

  it("renders nothing when no relationship was declared for change", () => {
    const { container } = render(
      <RelationshipDecisionsReview
        decisions={[]}
        supersededIds={supersededIds([])}
        newItemName="New provider"
      />,
    );

    expect(container.textContent).toBe("");
  });
});
