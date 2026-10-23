import {
  ProposalGroupBlockedReason,
  ProposalGroupLifecycle,
  ProposalGroupMemberExecutionState,
} from "../../../api";
import {
  formatApprovalProgress,
  formatProposalGroupLifecycle,
  formatExecutionStatus,
  isWaitingForApproval,
} from "../proposalGroupStatusText";

describe("proposal group status text", () => {
  it("translates group lifecycle into reviewer-facing language", () => {
    expect(formatProposalGroupLifecycle(ProposalGroupLifecycle.Building)).toBe(
      "Preparing review",
    );
    expect(
      formatProposalGroupLifecycle(ProposalGroupLifecycle.Reviewable),
    ).toBe("Ready for review");
    expect(formatProposalGroupLifecycle(ProposalGroupLifecycle.Settled)).toBe(
      "Review complete",
    );
  });

  it("explains approval progress without repeating pending labels", () => {
    expect(formatApprovalProgress(1, 2, false)).toBe(
      "1 of 2 required approvals received; 1 more approval is required.",
    );
    expect(formatApprovalProgress(2, 2, true)).toBe(
      "Approval requirement met: 2 of 2 required approvals received.",
    );
    expect(formatApprovalProgress(0, 0, true)).toBe(
      "No approvals are required.",
    );
  });

  it.each([
    [
      ProposalGroupBlockedReason.ApprovalsPending,
      "Waiting for the required approvals before this member can run.",
    ],
    [
      ProposalGroupBlockedReason.DependenciesPending,
      "Waiting for its prerequisites to apply before this member can run.",
    ],
    [
      ProposalGroupBlockedReason.PrerequisiteRejected,
      "Cannot run because a prerequisite was rejected.",
    ],
    [
      ProposalGroupBlockedReason.PrerequisiteInvalidated,
      "Cannot run because a prerequisite cannot apply.",
    ],
    [
      ProposalGroupBlockedReason.PrerequisiteFailed,
      "Cannot run because a prerequisite failed.",
    ],
    [
      ProposalGroupBlockedReason.RetryableFailure,
      "A previous attempt failed; retry is available.",
    ],
  ])("translates %s into a reason", (blockedReason, expected) => {
    expect(
      formatExecutionStatus({
        executionState: ProposalGroupMemberExecutionState.WaitingOnDependencies,
        blockedReason,
      }),
    ).toBe(expected);
  });

  it("translates execution states when no blocked reason is present", () => {
    expect(
      formatExecutionStatus({
        executionState: ProposalGroupMemberExecutionState.Ready,
      }),
    ).toBe("Ready to apply.");
    expect(
      formatExecutionStatus({
        executionState: ProposalGroupMemberExecutionState.Applied,
      }),
    ).toBe("Applied.");
    expect(
      formatExecutionStatus({
        executionState: ProposalGroupMemberExecutionState.Invalidated,
      }),
    ).toBe("Cannot apply because a prerequisite cannot apply.");
  });

  it("identifies approval waiting states that do not need an execution sentence", () => {
    expect(
      isWaitingForApproval({
        executionState: ProposalGroupMemberExecutionState.PendingApproval,
      }),
    ).toBe(true);
    expect(
      isWaitingForApproval({
        executionState: ProposalGroupMemberExecutionState.WaitingOnDependencies,
        blockedReason: ProposalGroupBlockedReason.DependenciesPending,
      }),
    ).toBe(false);
  });
});
