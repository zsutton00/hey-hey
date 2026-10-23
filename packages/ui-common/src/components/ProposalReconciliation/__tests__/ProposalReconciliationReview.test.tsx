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
vi.mock("../AgentFixConfirmDialog", () => ({
  AgentFixConfirmDialog: ({
    proposal,
    onClose,
  }: {
    proposal: ProposalResponseDto;
    onClose: () => void;
  }) => (
    <div data-testid="proposal-agent-fix-confirm">
      Agent fix starts an agent session for {proposal.id}
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
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
  status: "DRAFT",
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
  writtenAt: "2026-09-27T00:00:00Z",
  interveningProposals: [],
  overlaps: [],
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
      screen.getByTestId("proposal-reconciliation-merged-result"),
    ).toBeVisible();
    expect(screen.queryByText(/"preserved"/)).toBeNull();
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
      expect(
        screen.getByTestId("proposal-reconciliation-agent-fix"),
      ).toBeVisible(),
    );
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("shows a clean result on load without Merge or a replacement link", async () => {
    mount(ready);
    await screen.findByTestId("proposal-reconciliation-merged-result");
    expect(screen.queryByTestId("proposal-reconciliation-merge")).toBeNull();
    expect(
      screen.queryByTestId("proposal-reconciliation-open-replacement"),
    ).toBeNull();
    expect(
      proposalsClient.createProposalReconciliationCandidate,
    ).not.toHaveBeenCalled();
  });
  it("retains grouped Merge and replacement review", async () => {
    vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
      data: { data: { ...ready, status: "RECONCILIATION_REQUIRED" } },
    } as never);
    vi.mocked(
      proposalsClient.createProposalReconciliationCandidate,
    ).mockResolvedValue({
      data: {
        data: {
          ...ready,
          replacementProposalId: "replacement",
          replacementGroupId: "group",
        },
      },
    } as never);
    const apply = vi.fn();
    render(
      <ProposalReconciliationReview grouped proposal={proposal} onApply={apply}>
        <Approve />
      </ProposalReconciliationReview>,
    );
    fireEvent.click(await screen.findByTestId("proposal-reconciliation-merge"));
    await screen.findByTestId("proposal-reconciliation-open-replacement");
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("routes unsupported changes to Agent fix without enabling approval", async () => {
    mount({ ...ready, status: "AGENT_FIX_REQUIRED" });
    await screen.findByTestId("proposal-reconciliation-agent-fix");
    expect(screen.queryByTestId("proposal-reconciliation-merge")).toBeNull();
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
  });
  it("warns that Agent fix starts a session instead of linking to the proposal page", async () => {
    const apply = mount({ ...ready, status: "AGENT_FIX_REQUIRED" });
    const button = await screen.findByTestId(
      "proposal-reconciliation-agent-fix",
    );
    expect(button).not.toHaveAttribute("href");
    expect(screen.queryByTestId("proposal-agent-fix-confirm")).toBeNull();
    fireEvent.click(button);
    expect(screen.getByTestId("proposal-agent-fix-confirm")).toHaveTextContent(
      "Agent fix starts an agent session for proposal",
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("proposal-agent-fix-confirm")).toBeNull();
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });
});

const intervening = {
  proposalId: "dessert",
  title: "Change the dessert",
  approvedById: "user",
  approvedByName: "Zac",
  approvedAt: "2026-09-27T12:00:00Z",
  changedPaths: ["sections.description"],
  overlappingPaths: [],
  changes: [{ path: "sections.description", before: "Cake", after: "Sorbet" }],
};

describe("out-of-date review", () => {
  it("lists what changed since the proposal was written and expands each change's own diff", async () => {
    mount({
      ...ready,
      status: "RECONCILIATION_REQUIRED",
      interveningProposals: [intervening],
    });
    expect(
      await screen.findByTestId("proposal-reconciliation-heads-up"),
    ).toHaveTextContent("1 change was approved on this item since");
    expect(
      screen.getByTestId("proposal-reconciliation-changed-since"),
    ).toHaveTextContent("Change the dessert");
    expect(screen.getByText(/Approved by Zac/)).toBeVisible();
    fireEvent.click(screen.getByText("Show its changes"));
    expect(
      screen.getByTestId("proposal-reconciliation-intervening-diff"),
    ).toHaveTextContent("Sorbet");
    expect(screen.queryByTestId("proposal-reconciliation-merge")).toBeNull();
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
  });

  it("says when no other changes were approved since", async () => {
    mount({ ...ready, status: "RECONCILIATION_REQUIRED" });
    expect(
      await screen.findByTestId("proposal-reconciliation-heads-up"),
    ).toHaveTextContent("No other changes were approved on this item since");
    expect(
      screen.queryByTestId("proposal-reconciliation-changed-since"),
    ).toBeNull();
  });

  it("shows overlapping values side by side and keeps Approve and Merge unavailable", async () => {
    mount({
      ...ready,
      status: "RECONCILIATION_REQUIRED",
      conflictingPaths: ["status"],
      interveningProposals: [
        {
          ...intervening,
          changedPaths: ["status"],
          overlappingPaths: ["status"],
        },
      ],
      overlaps: [
        {
          path: "status",
          currentValue: "ACTIVE",
          proposedValue: "COMPLETED",
          interveningProposalId: "dessert",
        },
      ],
    });
    const overlap = await screen.findByTestId(
      "proposal-reconciliation-overlap",
    );
    expect(overlap).toHaveTextContent("ACTIVE");
    expect(overlap).toHaveTextContent("COMPLETED");
    expect(screen.getByText("Overlaps: status")).toBeVisible();
    expect(
      screen.getByTestId("proposal-reconciliation-edit-by-hand"),
    ).toBeVisible();
    expect(screen.queryByTestId("proposal-reconciliation-merge")).toBeNull();
    expect(
      screen.queryByTestId("proposal-reconciliation-merged-result"),
    ).toBeNull();
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
  });

  it("shows no out-of-date review on an approved proposal", async () => {
    const apply = vi.fn();
    render(
      <ProposalReconciliationReview
        proposal={{ ...proposal, status: "APPROVED" } as ProposalResponseDto}
        onApply={apply}
      >
        <div>Approved content</div>
      </ProposalReconciliationReview>,
    );
    expect(screen.getByText("Approved content")).toBeVisible();
    expect(screen.queryByTestId("proposal-reconciliation-review")).toBeNull();
    expect(proposalsClient.getProposalReconciliation).not.toHaveBeenCalled();
  });
});
