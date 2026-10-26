import React, { useContext } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
// Modal tests exercise the adapter; shared editor mention parsing is covered by its own suite.
vi.mock("../../SmarterTextAreaCard/SmarterTextAreaEditor", () => ({
  SmarterTextAreaEditor: ({
    initialValue,
    onChange,
    presentation,
  }: {
    initialValue: string;
    onChange: (value: string) => void;
    presentation: { contentEditableAriaLabel: string };
  }) => (
    <textarea
      aria-label={presentation.contentEditableAriaLabel}
      defaultValue={initialValue}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
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
            { key: "settings", label: "Settings", kind: "json" },
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
vi.mock("../../ProposalDispatchers/FutureApplyFooter", () => ({
  FutureApplyFooter: () => <button disabled>Apply</button>,
}));
vi.mock("../AgentFixConfirmDialog", () => ({
  AgentFixConfirmDialog: ({
    proposal,
    onClose,
    onStarted,
  }: {
    proposal: ProposalResponseDto;
    onClose: () => void;
    onStarted: (request: object) => void;
  }) => (
    <div data-testid="proposal-agent-fix-confirm">
      Agent fix starts an agent session for {proposal.id}
      <button onClick={onClose}>Cancel</button>
      <button
        onClick={() => {
          onStarted({
            organizationId: "org",
            projectId: "project",
            agentSessionId: "session",
            conversationId: "conversation",
          });
          onClose();
        }}
      >
        Launch recorded session
      </button>
    </div>
  ),
}));
vi.mock("../../AgentSession/AgentConversationView", () => ({
  AgentConversationView: ({
    agentSessionId,
    conversationId,
    onProposalsAccepted,
  }: {
    agentSessionId: string;
    conversationId: string;
    onProposalsAccepted: () => void;
  }) => (
    <div>
      Conversation {conversationId} for {agentSessionId}
      <button onClick={onProposalsAccepted}>Accept proposed fix</button>
      <button onClick={onProposalsAccepted}>Reject proposed fix</button>
    </div>
  ),
}));
vi.mock("../ReconciliationRefinementReview", () => ({
  ReconciliationRefinementReview: ({
    onReviewed,
  }: {
    onReviewed: () => void;
  }) => <button onClick={onReviewed}>Review saved refinement</button>,
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
  targetEntityType: "TASK",
  action: "UPDATE",
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
    expect(screen.getByText(/Approved by Zac/)).toBeInTheDocument();
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
      currentBases: [
        { ...basis, content: { ...basis.content, status: "ACTIVE" } },
      ],
      revisions: [
        { ...ready.revisions[0], proposedResult: { status: "COMPLETED" } },
      ],
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
    const overlap = await screen.findByTestId("proposal-three-way-review");
    expect(overlap).toHaveTextContent("ACTIVE");
    expect(overlap).toHaveTextContent("COMPLETED");
    expect(screen.queryByText("Approval history")).toBeNull();
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
  it("does not nest a pending correction inside the current future review", async () => {
    vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
      data: {
        data: {
          ...ready,
          status: "RECONCILIATION_REQUIRED",
          replacementProposalId: "pending-correction",
        },
      },
    } as never);
    render(
      <ProposalReconciliationReview
        proposal={
          {
            ...proposal,
            action: "VERSIONED_UPDATE",
            status: "APPROVED",
            reviewedFuture: { outcome: "STAGED" },
          } as ProposalResponseDto
        }
        onApply={vi.fn()}
      >
        <span>Previously approved</span>
      </ProposalReconciliationReview>,
    );
    await screen.findByTestId("proposal-three-way-review");
    expect(
      screen.getAllByTestId("proposal-reconciliation-stages"),
    ).toHaveLength(1);
    expect(screen.queryByText("Review saved refinement")).toBeNull();
    expect(screen.queryByText("Review the fix")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.queryByText("Approval history")).toBeNull();
    expect(
      screen.getByTestId("proposal-reconciliation-edit-by-hand"),
    ).toBeVisible();
  });
  it("exposes manual resolution after earlier approval and submits the displayed bases and future revision", async () => {
    const future = {
      ...proposal,
      action: "VERSIONED_UPDATE",
      status: "APPROVED",
      reviewedFuture: {
        outcome: "STAGED",
        latestProposalId: proposal.id,
        baseline: { content: basis.content },
        result: ready.revisions[0].proposedResult,
      },
    } as unknown as ProposalResponseDto;
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
      data: { data: ready },
    } as never);
    render(
      <ProposalReconciliationReview proposal={future} onApply={vi.fn()}>
        <span>Saved comparison</span>
      </ProposalReconciliationReview>,
    );
    fireEvent.click(
      await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    fireEvent.change(screen.getByLabelText("Proposed content"), {
      target: { value: "Resolved by hand" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    fireEvent.click(screen.getByTestId("proposal-reconciliation-manual-save"));
    await waitFor(() =>
      expect(
        proposalsClient.createProposalReconciliationCandidate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          createProposalReconciliationCandidate: {
            method: "MANUAL",
            expectedFutureRevision: 3,
            expectedCandidateRevisionId: stale.candidateRevisionId,
            expectedCurrentBases: stale.currentBases,
            proposedResult: {
              name: "Resolved by hand",
              preserved: "Intervening work",
            },
          },
        }),
      ),
    );
    expect(
      await screen.findByTestId("proposal-reconciliation-stages"),
    ).toHaveTextContent("Resolve conflict");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByTestId("proposal-reconciliation-open-replacement"),
    ).toBeNull();
    expect(screen.getByText("Saved comparison")).toBeVisible();
    expect(screen.queryByTestId("proposal-three-way-review")).toBeNull();
    expect(
      screen.getByText(/Proposal updated; reconciliation resolved/),
    ).toBeVisible();
  });
  it("discards modal edits on Cancel before preparing the result", async () => {
    mount({ ...ready, status: "RECONCILIATION_REQUIRED" });
    fireEvent.click(
      await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    fireEvent.change(screen.getByLabelText("Proposed content"), {
      target: { value: "Discard this" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Discard this")).toBeNull();
    expect(
      proposalsClient.createProposalReconciliationCandidate,
    ).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    expect(screen.getByLabelText("Proposed content")).toHaveValue("Candidate");
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

it("aligns original, live and intended requirements including additions and group changes", async () => {
  const added = requirement(
    "00000000-0000-4000-8000-000000000003",
    "Show import progress",
  );
  const original = { ...first, statement: "Original history" };
  const content = (records: ReturnType<typeof requirement>[]) => ({
    type: "FEATURE",
    sections: { requirements: { records } },
  });
  const stale: ProposalReconciliationState = {
    ...ready,
    status: "RECONCILIATION_REQUIRED",
    currentBases: [{ ...basis, content: content([first, unchanged]) }],
    revisions: [
      {
        ...ready.revisions[0],
        bases: [{ ...basis, content: content([original, unchanged]) }],
        proposedResult: content([intended, unchanged, added]),
      },
    ],
    overlaps: [
      {
        path: "sections.requirements.records",
        currentValue: [first, unchanged],
        proposedValue: [intended, unchanged, added],
        interveningProposalId: null,
      },
    ],
  };
  const apply = mount(stale);
  const comparison = await screen.findByTestId("proposal-three-way-review");
  expect(comparison).toHaveTextContent("When this was proposed");
  expect(comparison).toHaveTextContent("Current");
  expect(screen.queryByTestId("proposal-reconciliation-heads-up")).toBeNull();
  expect(comparison).toHaveTextContent("been applied since this was proposed");
  expect(comparison).toHaveTextContent(
    "prevent applying it without confirmation",
  );
  expect(comparison).toHaveTextContent("Proposal");
  expect(comparison).toHaveTextContent("Original history");
  expect(comparison).toHaveTextContent("1 unchanged requirements hidden");
  expect(comparison).toHaveTextContent("Added · Check it still belongs");
  expect(comparison).toHaveTextContent("Show import progress");
  const cells = comparison.querySelectorAll(
    `[data-testid="three-way-requirement-cell"][data-requirement-id="${first.id}"]`,
  );
  expect(cells).toHaveLength(3);
  expect(cells[1]).toHaveTextContent("Review");
  expect(cells[2]).toHaveTextContent("Recovery");
  expect(comparison.querySelector("a")).toHaveAttribute(
    "href",
    "/items/00000000-0000-4000-8000-000000000099",
  );
  expect(screen.queryByText("Future under review")).toBeNull();
  expect(screen.queryByText("What’s changed since the baseline")).toBeNull();
  fireEvent.click(screen.getByTestId("three-way-show-all"));
  expect(
    comparison.querySelectorAll(
      `[data-testid="three-way-requirement-cell"][data-requirement-id="${unchanged.id}"]`,
    ),
  ).toHaveLength(3);
  expect(screen.getByText("Approve displayed revision")).toBeDisabled();
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

describe("same-page staged recovery", () => {
  const conflict = {
    ...ready,
    status: "AGENT_FIX_REQUIRED" as const,
    currentBases: [
      { ...basis, content: { ...basis.content, name: "Current name" } },
    ],
    revisions: [
      { ...ready.revisions[0], proposedResult: { name: "Future name" } },
    ],
    overlaps: [
      {
        path: "name",
        currentValue: "Current name",
        proposedValue: "Future name",
        interveningProposalId: null,
      },
    ],
  };
  it.each(["Accept proposed fix", "Reject proposed fix"])(
    "keeps the conflict beside the agent until a persisted review outcome: %s",
    async (action) => {
      const apply = mount(conflict);
      fireEvent.click(
        await screen.findByTestId("proposal-reconciliation-agent-fix"),
      );
      fireEvent.click(screen.getByText("Launch recorded session"));
      const panel = await screen.findByTestId(
        "proposal-reconciliation-agent-panel",
      );
      await waitFor(() =>
        expect(panel).toHaveTextContent(
          "Conversation conversation for session",
        ),
      );
      expect(screen.getByTestId("proposal-three-way-review")).toHaveTextContent(
        "Current name",
      );
      expect(screen.getByText("Approve displayed revision")).toBeDisabled();
      expect(
        within(screen.getByTestId("proposal-reconciliation-stages")).getByText(
          "Resolve conflict",
        ),
      ).toBeVisible();
      const result = action === "Accept proposed fix" ? ready : conflict;
      vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
        data: { data: result },
      } as never);
      const readsBefore = vi.mocked(proposalsClient.getProposalReconciliation)
        .mock.calls.length;
      fireEvent.click(within(panel).getByText(action));
      await waitFor(() =>
        expect(proposalsClient.getProposalReconciliation).toHaveBeenCalledTimes(
          readsBefore + 1,
        ),
      );
      if (action === "Accept proposed fix") {
        await waitFor(() =>
          expect(screen.getByText("Approve displayed revision")).toBeEnabled(),
        );
        expect(screen.queryByTestId("proposal-three-way-review")).toBeNull();
        expect(
          screen.getByTestId("proposal-reconciliation-stages"),
        ).toHaveTextContent("Apply");
        // Another writer can still send the same page back to Resolve.
        vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
          data: { data: conflict },
        } as never);
        act(() => invalidateProposalReconciliation(proposal.id));
        await screen.findByTestId("proposal-three-way-review");
      }
      expect(screen.getByText("Approve displayed revision")).toBeDisabled();
      expect(apply).not.toHaveBeenCalled();
    },
  );
  it("renders manual previews through registered section presentation", async () => {
    const sections = (
      settings: object,
      unknown: object,
      description: string,
    ) => ({
      sections: { settings, unregistered: unknown, description },
    });
    const live = sections({ mode: "live" }, { a: 1 }, "Live text");
    const intended = sections({ mode: "proposed" }, { a: 2 }, "Proposed text");
    mount({
      ...conflict,
      currentBases: [{ ...basis, content: { ...basis.content, ...live } }],
      revisions: [{ ...ready.revisions[0], proposedResult: intended }],
      overlaps: ["settings", "unregistered", "description"].map((key) => ({
        path: `sections.${key}`,
        currentValue: live.sections[key as keyof typeof live.sections],
        proposedValue: intended.sections[key as keyof typeof intended.sections],
        interveningProposalId: null,
      })),
    });
    fireEvent.click(
      await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
    );
    const editor = screen.getByTestId("proposal-reconciliation-manual-editor");
    const items = within(editor).getAllByTestId("resolution-item");
    const item = (label: string) =>
      items.find((entry) => within(entry).queryByText(label))!;
    const settings = within(item("Settings"));
    expect(settings.getAllByTestId("json-section-renderer")).toHaveLength(2);
    expect(settings.queryByText(/specialized presentation/)).toBeNull();
    const description = within(item("Description"));
    expect(description.getByText("Live text")).toBeVisible();
    expect(description.getByText("Proposed text")).toBeVisible();
    expect(
      within(item("Section change")).getAllByText(
        "This content requires its specialized presentation.",
      ),
    ).toHaveLength(2);
  });
  it("keeps the current and proposed conflict visible during manual editing", async () => {
    mount(conflict);
    fireEvent.click(
      await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByTestId("proposal-reconciliation-manual-editor"),
    ).toBeVisible();
    expect(screen.getByTestId("proposal-three-way-review")).toHaveTextContent(
      "Future name",
    );
    expect(screen.getByText("Approve displayed revision")).toBeDisabled();
  });
});
