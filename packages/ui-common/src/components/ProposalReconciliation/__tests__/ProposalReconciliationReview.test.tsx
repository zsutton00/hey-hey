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
vi.mock("../../../data/hooks/useInvalidateProposalReview", () => ({
  useInvalidateProposalReview: () => vi.fn(),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      {
        definition: {
          key: "FEATURE",
          sections: [
            {
              key: "requirements",
              label: "Requirements",
              kind: "json",
              schemaRef: "#/components/schemas/FeatureRequirementsSection",
            },
            { key: "description", label: "Description", kind: "markdown" },
          ],
        },
      },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useMentionEntitySearch", () => ({
  useMentionEntitySearch: () => ({ searchEntities: vi.fn() }),
}));
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
vi.mock("../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({
    mention,
  }: {
    mention: { entityId: string; entityName: string };
  }) => <a href={`/items/${mention.entityId}`}>{mention.entityName}</a>,
}));
const proposal = {
  id: "proposal",
  targetEntityId: "target",
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
  content: { type: "FEATURE", name: "Current", preserved: "Intervening work" },
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
  it("approves the reviewed result on the same standalone proposal", async () => {
    const apply = mount(ready);
    await waitFor(() =>
      expect(screen.getByText("Approve displayed revision")).toBeEnabled(),
    );
    expect(
      screen.queryByTestId("proposal-reconciliation-open-replacement"),
    ).toBeNull();
    fireEvent.click(screen.getByText("Approve displayed revision"));
    expect(apply).toHaveBeenCalledWith({
      reviewedReconciliationRevisionId: "revision",
    });
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
    expect(screen.getByText("Overlaps: Status")).toBeVisible();
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

describe("approved future recovery", () => {
  it("exposes manual resolution after earlier approval and submits the displayed bases and future revision", async () => {
    const future = {
      ...proposal,
      action: "VERSIONED_UPDATE",
      status: "APPROVED",
      reviewedFuture: { outcome: "STAGED" },
    } as ProposalResponseDto;
    const stale = {
      ...ready,
      status: "RECONCILIATION_REQUIRED",
      futureRevision: 3,
      overlaps: [],
    } as ProposalReconciliationState;
    vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
      data: { data: stale },
    } as never);
    vi.mocked(
      proposalsClient.createProposalReconciliationCandidate,
    ).mockResolvedValue({
      data: { data: { ...ready, replacementProposalId: "review" } },
    } as never);
    render(
      <ProposalReconciliationReview proposal={future} onApply={vi.fn()}>
        <span>Previously approved</span>
      </ProposalReconciliationReview>,
    );
    fireEvent.click(
      await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
    );
    fireEvent.change(screen.getByLabelText("name"), {
      target: { value: "Resolved by hand" },
    });
    fireEvent.click(screen.getByTestId("proposal-reconciliation-manual-save"));
    await waitFor(() =>
      expect(
        proposalsClient.createProposalReconciliationCandidate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          createProposalReconciliationCandidate: {
            method: "MANUAL",
            expectedFutureRevision: 3,
            expectedCurrentBases: stale.currentBases,
            proposedResult: {
              name: "Resolved by hand",
              preserved: "Intervening work",
            },
          },
        }),
      ),
    );
    expect(await screen.findByText("Review revised result")).toBeVisible();
    expect(screen.getByText("Previously approved")).toBeVisible();
  });
  it("cancels manual editing without submitting", async () => {
    mount({ ...ready, status: "RECONCILIATION_REQUIRED" });
    fireEvent.click(
      await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(
      screen.queryByTestId("proposal-reconciliation-manual-editor"),
    ).toBeNull();
    expect(
      proposalsClient.createProposalReconciliationCandidate,
    ).not.toHaveBeenCalled();
  });
});

const requirement = (id: string, statement: string, group?: string) => ({
  id,
  statement,
  ...(group ? { group } : {}),
  designedBy: [],
  contracts: [],
  fulfilledBy: [
    {
      entityType: "TASK",
      entityId: "00000000-0000-4000-8000-000000000099",
      entityTitle: "Implement readable review",
    },
  ],
});
const first = requirement(
  "00000000-0000-4000-8000-000000000001",
  "Show dated history",
  "Review",
);
const unchanged = requirement(
  "00000000-0000-4000-8000-000000000002",
  "Preserve explicit Apply",
  "Application",
);
const intended = {
  ...first,
  statement: "Show readable dated history",
  group: "Recovery",
};

it("keeps structured future overlaps legible while expanding and collapsing historical changes", async () => {
  const records = [first, unchanged];
  const futureRecords = [intended, unchanged];
  const future = {
    ...proposal,
    targetEntityId: "target",
    action: "VERSIONED_UPDATE",
    status: "APPROVED",
    reviewedFuture: { outcome: "STAGED" },
  } as ProposalResponseDto;
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: {
      data: {
        ...ready,
        status: "RECONCILIATION_REQUIRED",
        interveningProposals: [
          {
            ...intervening,
            changedPaths: ["sections.requirements"],
            overlappingPaths: ["sections.requirements.records"],
            changes: [
              {
                path: "sections.requirements",
                before: { records: [unchanged] },
                after: { records },
              },
            ],
          },
        ],
        overlaps: [
          {
            path: "sections.requirements.records",
            currentValue: records,
            proposedValue: futureRecords,
            interveningProposalId: intervening.proposalId,
          },
        ],
      },
    },
  } as never);
  const apply = vi.fn();
  render(
    <ProposalReconciliationReview proposal={future} onApply={apply}>
      <span>Previously approved</span>
      <button disabled>Apply</button>
    </ProposalReconciliationReview>,
  );
  const overlap = await screen.findByTestId("proposal-reconciliation-overlap");
  expect(overlap).toHaveTextContent("Show readable dated history");
  expect(overlap).toHaveTextContent("Previously approved future");
  expect(overlap).toHaveTextContent("1 unchanged requirement hidden");
  expect(
    overlap.querySelector(`[data-requirement-id="${first.id}"]`),
  ).toHaveAttribute("data-requirement-change", "group-changed");
  expect(overlap.querySelector("a")).toHaveAttribute(
    "href",
    "/items/00000000-0000-4000-8000-000000000099",
  );
  expect(screen.getByText("Overlaps: Requirements")).toBeVisible();
  expect(screen.getByText(/What’s changed since the baseline/)).toBeVisible();
  expect(screen.getByText(/Sep 27, 2026/)).toBeVisible();
  expect(screen.getByText("Future under review")).toBeVisible();
  expect(
    screen.queryByText(
      /entity Id:|sections.requirements.records|fulfilled By:/,
    ),
  ).toBeNull();
  expect(
    screen.queryByTestId("proposal-reconciliation-intervening-diff"),
  ).toBeNull();
  fireEvent.click(screen.getByTestId("proposal-reconciliation-history-toggle"));
  const historical = screen.getByTestId(
    "proposal-reconciliation-intervening-diff",
  );
  expect(
    historical.querySelector('[data-testid="structured-requirements-diff"]'),
  ).toBeInTheDocument();
  expect(historical).toHaveTextContent("Show dated history");
  fireEvent.click(screen.getByTestId("proposal-reconciliation-history-toggle"));
  expect(
    screen.queryByTestId("proposal-reconciliation-intervening-diff"),
  ).toBeNull();
  expect(overlap).toBeVisible();
  fireEvent.click(
    overlap.querySelector(
      '[data-testid="structured-requirements-diff-show-all"]',
    )!,
  );
  expect(overlap).toHaveTextContent("Preserve explicit Apply");
  fireEvent.click(
    overlap.querySelector('[data-testid="diff-renderer-view-mode-inline"]')!,
  );
  expect(
    overlap.querySelector('[data-testid="structured-requirements-inline"]'),
  ).toBeVisible();
  expect(screen.getByText("Apply")).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});

it("keeps Design Doc history readable without treating it as a registered work item", async () => {
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: {
      data: {
        ...ready,
        status: "RECONCILIATION_REQUIRED",
        interveningProposals: [intervening],
      },
    },
  } as never);
  render(
    <ProposalReconciliationReview
      proposal={
        { ...proposal, targetEntityType: "DESIGN_DOC" } as ProposalResponseDto
      }
      onApply={vi.fn()}
    >
      <Approve />
    </ProposalReconciliationReview>,
  );
  fireEvent.click(
    await screen.findByTestId("proposal-reconciliation-history-toggle"),
  );
  const history = screen.getByTestId(
    "proposal-reconciliation-intervening-diff",
  );
  expect(history).toHaveTextContent("Description");
  expect(history).toHaveTextContent("Cake");
  expect(history).toHaveTextContent("Sorbet");
  expect(history).not.toHaveTextContent("sections.description");
  expect(
    history.querySelector('[data-testid="diff-renderer-split-view"]'),
  ).toBeVisible();
});
