import { describe, expect, it } from "vitest";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../../api";
import {
  projectThreeWayReview,
  threeWayFields,
  branchChange,
} from "../threeWayProjection";
const proposal = {
  id: "selected",
  targetEntityId: "target",
  targetEntityType: "TASK",
  action: "UPDATE",
  status: "DRAFT",
} as ProposalResponseDto;
const state: ProposalReconciliationState = {
  status: "RECONCILIATION_REQUIRED",
  overlaps: [],
  conflictingPaths: [],
  interveningProposals: [],
  candidateRevisionId: "revision",
  currentBases: [
    {
      entityId: "target",
      entityType: "TASK",
      version: "live",
      content: { name: "Live" },
    },
  ],
  revisions: [
    {
      id: "revision",
      proposalId: "selected",
      source: "AUTHORING",
      createdAt: "2026-10-25T00:00:00Z",
      intent: null,
      bases: [
        {
          entityId: "target",
          entityType: "TASK",
          version: "original",
          content: { name: "Original" },
        },
      ],
      proposedResult: {
        name: "Intended",
        sections: [
          {
            key: "description",
            order: 0,
            materializedMarkdown: "Intended text",
          },
        ],
      },
    },
  ],
};
describe("retained three-way evidence", () => {
  it("normalizes retained sections against the same original", () => {
    const result = projectThreeWayReview(proposal, state);
    expect(result.original?.name).toBe("Original");
    expect(result.live?.name).toBe("Live");
    expect(result.intended?.sections).toEqual({ description: "Intended text" });
    expect(threeWayFields(result)).toEqual(["name", "sections.description"]);
  });
  it("does not select another proposal's pending replacement", () => {
    const pending = {
      ...state.revisions[0],
      id: "pending",
      proposalId: "pending",
      proposedResult: { name: "Pending" },
    };
    expect(
      projectThreeWayReview(proposal, {
        ...state,
        revisions: [...state.revisions, pending],
        candidateRevisionId: "pending",
      }).intended?.name,
    ).toBe("Intended");
  });
  it("selects the reviewed future through historical proposal links", () => {
    const future = {
      ...proposal,
      id: "historical",
      action: "VERSIONED_UPDATE",
      status: "APPROVED",
      reviewedFuture: {
        latestProposalId: "selected",
        baseline: { content: { name: "Retained future basis" } },
        result: { name: "Reviewed" },
      },
    } as ProposalResponseDto;
    expect(projectThreeWayReview(future, state)).toMatchObject({
      original: { name: "Retained future basis" },
      intended: { name: "Reviewed" },
    });
  });
  it("uses the accepted basis after renewed drift", () => {
    const accepted = {
      ...state.revisions[0],
      id: "accepted",
      source: "MANUAL" as const,
      previousRevisionId: "revision",
      bases: [
        { ...state.currentBases[0], content: { name: "Accepted basis" } },
      ],
    };
    expect(
      projectThreeWayReview(proposal, {
        ...state,
        revisions: [...state.revisions, accepted],
        candidateRevisionId: "accepted",
      }).original?.name,
    ).toBe("Accepted basis");
  });
  it("never invents missing original evidence or selects another target", () => {
    expect(
      projectThreeWayReview(proposal, { ...state, revisions: [] }).original,
    ).toBeUndefined();
    expect(
      projectThreeWayReview(proposal, {
        ...state,
        revisions: [
          {
            ...state.revisions[0],
            bases: [{ ...state.currentBases[0], entityId: "other" }],
          },
        ],
      }).original,
    ).toBeUndefined();
  });
  it("includes additions and removals without calling them conflicts", () => {
    expect(
      threeWayFields({
        original: { sections: { removed: "text" } },
        live: { sections: { removed: "text" } },
        intended: { sections: { added: "new" } },
      }),
    ).toEqual(["sections.removed", "sections.added"]);
    expect(branchChange(undefined, "new")).toBe("Added");
    expect(branchChange("old", undefined)).toBe("Removed");
    expect(branchChange("same", "same")).toBe("Unchanged");
  });
});
