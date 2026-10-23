import React, { useContext } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalReconciliationContext,
  ProposalReconciliationReview,
} from "../ProposalReconciliationReview";
import { invalidateProposalReconciliation } from "../reconciliationInvalidation";
import { proposalsClient } from "../../../clients/serviceClients";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../../api";
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    getProposalReconciliation: vi.fn(),
    createProposalReconciliationCandidate: vi.fn(),
  },
}));
vi.mock("../../SuggestedContent/DiffRenderer", () => ({
  DiffRenderer: ({
    oldContent,
    newContent,
  }: {
    oldContent: string;
    newContent: string;
  }) => (
    <div>
      <pre>{oldContent}</pre>
      <pre>{newContent}</pre>
    </div>
  ),
}));
const proposal = {
  id: "proposal",
  organizationId: "org",
  projectId: "project",
  updates: {},
  updatedAt: "2026-09-28T00:00:00Z",
} as ProposalResponseDto;
const basis = {
  entityType: "TASK" as const,
  entityId: "target",
  version: "current",
  content: { name: "Current", preserved: "Intervening work" },
};
const ready: ProposalReconciliationState = {
  status: "READY_FOR_REVIEW",
  currentBases: [basis],
  candidateRevisionId: "revision",
  conflictingPaths: [],
  revisions: [
    {
      id: "revision",
      proposalId: "proposal",
      source: "MERGE",
      bases: [basis],
      proposedResult: { name: "Candidate", preserved: "Intervening work" },
      intent: "Rename",
      createdAt: "2026-09-28T00:00:00Z",
    },
  ],
};
function Approve() {
  const review = useContext(ProposalReconciliationContext)!;
  return (
    <button disabled={review.approvalDisabled} onClick={review.submit}>
      Approve displayed revision
    </button>
  );
}
function mount(state: ProposalReconciliationState) {
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: { data: state },
  } as never);
  const apply = vi.fn();
  render(
    <ProposalReconciliationReview proposal={proposal} onApply={apply}>
      <Approve />
    </ProposalReconciliationReview>,
  );
  return apply;
}
beforeEach(() => vi.clearAllMocks());
describe("complete reconciliation review", () => {
  it("shows complete content and binds approval to the displayed immutable revision", async () => {
    const apply = mount(ready);
    await waitFor(() =>
      expect(screen.getByText("Approve displayed revision")).toBeEnabled(),
    );
    expect(
      screen.getByTestId("proposal-reconciliation-comparison"),
    ).toHaveTextContent("Intervening work");
    fireEvent.click(screen.getByText("Approve displayed revision"));
    expect(apply).toHaveBeenCalledWith({
      reviewedReconciliationRevisionId: "revision",
    });
  });
  it("withdraws approval immediately when refreshed content has drifted", async () => {
    const apply = mount(ready);
    await waitFor(() =>
      expect(screen.getByText("Approve displayed revision")).toBeEnabled(),
    );
    vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
      data: { data: { ...ready, status: "RECONCILIATION_REQUIRED" } },
    } as never);
    act(() => invalidateProposalReconciliation(proposal.id));
    await waitFor(() =>
      expect(screen.getByTestId("proposal-reconciliation-merge")).toBeVisible(),
    );
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("opens fresh replacement review after Merge without applying either proposal", async () => {
    const apply = mount({ ...ready, status: "RECONCILIATION_REQUIRED" });
    vi.mocked(
      proposalsClient.createProposalReconciliationCandidate,
    ).mockResolvedValue({
      data: { data: { ...ready, replacementProposalId: "replacement" } },
    } as never);
    fireEvent.click(await screen.findByTestId("proposal-reconciliation-merge"));
    await screen.findByTestId("proposal-reconciliation-open-replacement");
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("routes overlapping changes to Agent fix without enabling approval", async () => {
    mount({ ...ready, status: "RECONCILIATION_REQUIRED" });
    vi.mocked(
      proposalsClient.createProposalReconciliationCandidate,
    ).mockResolvedValue({
      data: {
        data: {
          ...ready,
          status: "AGENT_FIX_REQUIRED",
          conflictingPaths: ["/name"],
        },
      },
    } as never);
    fireEvent.click(await screen.findByTestId("proposal-reconciliation-merge"));
    await waitFor(() =>
      expect(
        screen.getByTestId("proposal-reconciliation-merge"),
      ).toBeDisabled(),
    );
    expect(
      screen.getByTestId("proposal-reconciliation-agent-fix"),
    ).toBeVisible();
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
  });
});
