import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  DesignDocResponseDto,
  ProposalReconciliationState,
  ProposalResponseDto,
  UpdateDesignDocDto,
} from "../../../api";
import { proposalsClient } from "../../../clients/serviceClients";
import { ProposalReconciliationReview } from "../ProposalReconciliationReview";
import { DesignDocUpdateRenderer } from "../../ProposalDispatchers/DesignDocUpdateRenderer";
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: { getProposalReconciliation: vi.fn() },
}));
vi.mock("../../ProposalDispatchers/proposalHeaderType", () => ({
  useProposalHeaderTypeResolution: () => ({ presentation: {} }),
}));
vi.mock("../../ProposalDispatchers/ProposalTitle", () => ({
  ProposalTitle: () => null,
}));
vi.mock("../../SuggestedContent", () => ({
  DiffRenderer: ({
    oldContent,
    newContent,
  }: {
    oldContent: string;
    newContent: string;
  }) => (
    <div data-testid="actual-diff">
      <pre>{oldContent}</pre>
      <pre>{newContent}</pre>
    </div>
  ),
}));
const proposal = {
  id: "proposal",
  organizationId: "org",
  projectId: "project",
  action: "UPDATE",
  targetEntityType: "DESIGN_DOC",
  targetEntityId: "doc",
  status: "DRAFT",
  updates: {
    name: "Stale title",
    sections: [{ key: "body", content: "Stale body" }],
  },
} as ProposalResponseDto & { updates: UpdateDesignDocDto };
const existing = {
  id: "doc",
  name: "Later live title",
  sections: [
    {
      id: "body",
      key: "body",
      order: 0,
      materializedMarkdown: "Later live body",
    },
  ],
} as DesignDocResponseDto;
const basis = {
  entityId: "doc",
  entityType: "DESIGN_DOC" as const,
  version: "reviewed",
  content: {
    name: "Reviewed current title",
    sections: { body: "Reviewed current body" },
    sectionOrder: { body: 0 },
  },
};
const ready: ProposalReconciliationState = {
  status: "READY_FOR_REVIEW",
  candidateRevisionId: "revision",
  currentBases: [basis],
  revisions: [
    {
      id: "revision",
      proposalId: "proposal",
      source: "MERGE",
      bases: [basis],
      proposedResult: {
        name: "Merged title",
        sections: { body: "Merged body with intervening work" },
        sectionOrder: { body: 0 },
      },
      intent: "Edit",
      createdAt: "2026-10-23T00:00:00Z",
    },
  ],
  interveningProposals: [],
  overlaps: [],
  conflictingPaths: [],
};
function mount(state: ProposalReconciliationState) {
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: { data: state },
  } as never);
  const apply = vi.fn();
  render(
    <ProposalReconciliationReview proposal={proposal} onApply={apply}>
      <DesignDocUpdateRenderer
        proposal={proposal}
        existing={existing}
        status={{ state: "pending" }}
        onApply={() => {}}
      />
    </ProposalReconciliationReview>,
  );
  return apply;
}
describe("ordinary renderer reconciliation seam", () => {
  it("renders the immutable merged result against its recorded basis and approves that revision", async () => {
    const apply = mount(ready);
    await waitFor(() =>
      expect(screen.getByTestId("proposal-approve")).toBeEnabled(),
    );
    const diff = screen.getByTestId("actual-diff");
    expect(diff).toHaveTextContent("Reviewed current body");
    expect(diff).toHaveTextContent("Merged body with intervening work");
    expect(diff).not.toHaveTextContent("Stale body");
    expect(diff).not.toHaveTextContent("Later live body");
    fireEvent.click(screen.getByTestId("proposal-approve"));
    expect(apply).toHaveBeenCalledWith({
      reviewedReconciliationRevisionId: "revision",
    });
  });
  it("does not revive an authored value when the reviewed result already matches current content", async () => {
    const revision = ready.revisions[0]!;
    mount({
      ...ready,
      revisions: [
        {
          ...revision,
          proposedResult: {
            ...revision.proposedResult,
            name: basis.content.name,
          },
        },
      ],
    });
    await waitFor(() =>
      expect(screen.getByTestId("proposal-approve")).toBeEnabled(),
    );
    expect(screen.getByTestId("actual-diff")).not.toHaveTextContent(
      "Stale title",
    );
    expect(screen.getByTestId("actual-diff")).toHaveTextContent(
      "Reviewed current title",
    );
  });
  it("hides the diff and disables approval while overlaps remain", async () => {
    mount({
      ...ready,
      status: "RECONCILIATION_REQUIRED",
      overlaps: [
        {
          path: "name",
          proposedValue: "Stale title",
          currentValue: "Current title",
          interveningProposalId: null,
        },
      ],
    });
    await screen.findByTestId("proposal-reconciliation-overlap");
    expect(screen.getByTestId("actual-diff")).not.toBeVisible();
    expect(screen.getByTestId("proposal-approve")).toBeDisabled();
  });
});
