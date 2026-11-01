import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProposalResponseDto } from "../../../api";
import type { UpdateProposalProps } from "../../ProposalDispatchers/types";
import { ReconciliationRefinementReview } from "../ReconciliationRefinementReview";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  invalidate: vi.fn(),
  conversation: vi.fn(),
  proposal: {
    id: "refinement",
    status: "DRAFT",
    conversationId: "conversation",
  } as ProposalResponseDto,
}));
vi.mock("../../../data/hooks/useProposal", () => ({
  useProposal: () => ({ proposal: mocks.proposal, refetch: vi.fn() }),
}));
vi.mock("../../../data/hooks/useInvalidateProposalReview", () => ({
  useInvalidateProposalReview: () => mocks.invalidate,
}));
vi.mock("../../../data/hooks/useInvalidateConversation", () => ({
  useInvalidateConversation: () => mocks.conversation,
}));
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    updateProposal: mocks.approve,
    rejectProposal: mocks.reject,
  },
}));
vi.mock("../../ProposalDispatchers/UpdateProposal", () => ({
  UpdateProposal: ({
    proposals,
    renderMode,
    onApply,
    onReject,
  }: UpdateProposalProps) => (
    <div data-testid="shared-comparison" data-mode={renderMode}>
      {proposals[0].id}
      <button
        onClick={() =>
          void onApply(proposals[0].id, {
            reviewedReconciliationRevisionId: "reviewed-basis",
          })
        }
      >
        Approve fix
      </button>
      <button
        onClick={() =>
          void onReject?.(proposals[0].id, "Keep the approved result")
        }
      >
        Reject fix
      </button>
    </div>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.approve.mockResolvedValue({
    data: { data: { ...mocks.proposal, status: "APPROVED" } },
  });
});
it.each(["Approve fix", "Reject fix"])(
  "returns %s through persisted review then fresh reads without applying live content",
  async (action) => {
    const onReviewed = vi.fn();
    render(
      <ReconciliationRefinementReview
        organizationId="org"
        projectId="project"
        proposalId="refinement"
        onReviewed={onReviewed}
      />,
    );
    expect(screen.getByTestId("shared-comparison")).toHaveAttribute(
      "data-mode",
      "reconciliation-refinement",
    );
    fireEvent.click(screen.getByText(action));
    await waitFor(() => expect(onReviewed).toHaveBeenCalledOnce());
    if (action === "Approve fix") {
      expect(mocks.approve).toHaveBeenCalledWith({
        organizationId: "org",
        projectId: "project",
        proposalId: "refinement",
        updateProposalDto: {
          status: "APPROVED",
          reviewedReconciliationRevisionId: "reviewed-basis",
        },
      });
      expect(mocks.reject).not.toHaveBeenCalled();
    } else {
      expect(mocks.reject).toHaveBeenCalledWith({
        organizationId: "org",
        projectId: "project",
        proposalId: "refinement",
        rejectProposalDto: { reason: "Keep the approved result" },
      });
      expect(mocks.approve).not.toHaveBeenCalled();
    }
    expect(mocks.invalidate).toHaveBeenCalledWith("org", "project");
    expect(mocks.conversation).toHaveBeenCalledWith("conversation");
  },
);
