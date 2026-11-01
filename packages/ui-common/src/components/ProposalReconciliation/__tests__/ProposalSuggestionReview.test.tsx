import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalSuggestionReview } from "../ProposalSuggestionReview";
import { proposalsClient } from "../../../clients/serviceClients";
import type {
  ProposalReconciliationState,
  ProposalReconciliationSuggestion,
} from "../../../api";

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    getProposalReconciliation: vi.fn(),
    createProposalReconciliationCandidate: vi.fn(),
  },
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({ workItemTypes: [], isLoading: false }),
}));
vi.mock("../../../data/hooks/useInvalidateProposalReview", () => ({
  useInvalidateProposalReview: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ReconciliationFieldComparison", () => ({
  ReconciliationFieldComparison: ({
    before,
    after,
  }: {
    before: string;
    after: string;
  }) => (
    <div>
      {before} → {after}
    </div>
  ),
}));
const suggestion: ProposalReconciliationSuggestion = {
  id: "suggestion",
  proposalId: "proposal",
  organizationId: "organization",
  projectId: "project",
  status: "PENDING",
  candidateRevisionId: "version-one",
  proposedResult: { name: "Suggested name" },
  createdAt: "2026-10-26T00:00:00Z",
};
const state: ProposalReconciliationState = {
  status: "RECONCILIATION_REQUIRED",
  currentBases: [],
  conflictingPaths: [],
  interveningProposals: [],
  overlaps: [],
  candidateRevisionId: "version-one",
  suggestions: [suggestion],
  revisions: [
    {
      id: "version-one",
      proposalId: "proposal",
      source: "AUTHORING",
      bases: [],
      proposedResult: { name: "Original name" },
      intent: "Rename",
      createdAt: suggestion.createdAt,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: { data: state },
  } as never);
});
describe("message-attached reconciliation suggestions", () => {
  it.each([
    ["Accept", "ACCEPT_SUGGESTION", "ACCEPTED"],
    ["Reject", "REJECT_SUGGESTION", "REJECTED"],
  ] as const)(
    "%s sends only a suggestion decision, then shows the persisted outcome",
    async (label, method, status) => {
      const saved = { ...state, suggestions: [{ ...suggestion, status }] };
      vi.mocked(
        proposalsClient.createProposalReconciliationCandidate,
      ).mockImplementation(async () => {
        vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
          data: { data: saved },
        } as never);
        return { data: { data: saved } } as never;
      });
      render(<ProposalSuggestionReview suggestion={suggestion} />);
      expect(
        await screen.findByText("Original name → Suggested name"),
      ).toBeVisible();
      expect(screen.getByText(/clears its approvals/)).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
      await waitFor(() =>
        expect(
          proposalsClient.createProposalReconciliationCandidate,
        ).toHaveBeenCalledWith({
          organizationId: "organization",
          projectId: "project",
          proposalId: "proposal",
          createProposalReconciliationCandidate: {
            method,
            suggestionId: "suggestion",
          },
        }),
      );
      expect(
        await screen.findByText(
          status === "ACCEPTED"
            ? /Fresh approvals are required/
            : /proposal is unchanged/,
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Accept", exact: true }),
      ).toBeNull();
    },
  );
  it("keeps the attempted suggestion inspectable after stale acceptance fails", async () => {
    vi.mocked(
      proposalsClient.createProposalReconciliationCandidate,
    ).mockRejectedValue(
      new Error("Proposal changed; prepare a new suggestion."),
    );
    render(<ProposalSuggestionReview suggestion={suggestion} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept", exact: true }),
    );
    expect(await screen.findByText(/Proposal changed/)).toBeVisible();
    expect(screen.getByText("Original name → Suggested name")).toBeVisible();
  });
});
