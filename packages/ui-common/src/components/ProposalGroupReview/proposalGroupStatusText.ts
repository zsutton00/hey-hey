import {
  ProposalGroupBlockedReason,
  ProposalGroupLifecycle,
  ProposalGroupMemberExecutionState,
} from "../../api";

const proposalGroupLifecycleText: Record<ProposalGroupLifecycle, string> = {
  [ProposalGroupLifecycle.Building]: "Preparing review",
  [ProposalGroupLifecycle.Reviewable]: "Ready for review",
  [ProposalGroupLifecycle.Settled]: "Review complete",
};

export const formatProposalGroupLifecycle = (
  lifecycle: ProposalGroupLifecycle,
): string => proposalGroupLifecycleText[lifecycle];

export interface ProposalGroupExecutionStatusInput {
  executionState: ProposalGroupMemberExecutionState;
  blockedReason?: ProposalGroupBlockedReason | null;
}

const blockedReasonText: Record<ProposalGroupBlockedReason, string> = {
  [ProposalGroupBlockedReason.ApprovalsPending]:
    "Waiting for the required approvals before this member can run.",
  [ProposalGroupBlockedReason.DependenciesPending]:
    "Waiting for its prerequisites to apply before this member can run.",
  [ProposalGroupBlockedReason.PrerequisiteRejected]:
    "Cannot run because a prerequisite was rejected.",
  [ProposalGroupBlockedReason.PrerequisiteInvalidated]:
    "Cannot run because a prerequisite cannot apply.",
  [ProposalGroupBlockedReason.PrerequisiteFailed]:
    "Cannot run because a prerequisite failed.",
  [ProposalGroupBlockedReason.RetryableFailure]:
    "A previous attempt failed; retry is available.",
};

const executionStateText: Record<ProposalGroupMemberExecutionState, string> = {
  [ProposalGroupMemberExecutionState.PendingApproval]:
    "Waiting for the required approvals.",
  [ProposalGroupMemberExecutionState.WaitingOnDependencies]:
    "Waiting for prerequisites to apply.",
  [ProposalGroupMemberExecutionState.Ready]: "Ready to apply.",
  [ProposalGroupMemberExecutionState.Applying]: "Applying.",
  [ProposalGroupMemberExecutionState.RetryableFailure]:
    "A previous attempt failed; retry is available.",
  [ProposalGroupMemberExecutionState.Applied]: "Applied.",
  [ProposalGroupMemberExecutionState.Rejected]: "Rejected.",
  [ProposalGroupMemberExecutionState.Invalidated]:
    "Cannot apply because a prerequisite cannot apply.",
  [ProposalGroupMemberExecutionState.Failed]: "Application failed.",
};

export const formatApprovalProgress = (
  receivedApprovals: number,
  requiredApprovals: number,
  approvalSatisfied: boolean,
): string => {
  if (requiredApprovals === 0) return "No approvals are required.";

  const progress = `${receivedApprovals} of ${requiredApprovals} required approvals received`;
  if (approvalSatisfied) return `Approval requirement met: ${progress}.`;

  const remainingApprovals = Math.max(requiredApprovals - receivedApprovals, 0);
  const approvalNoun =
    remainingApprovals === 1 ? "approval is" : "approvals are";
  return `${progress}; ${remainingApprovals} more ${approvalNoun} required.`;
};

export const formatExecutionStatus = ({
  executionState,
  blockedReason,
}: ProposalGroupExecutionStatusInput): string =>
  blockedReason
    ? blockedReasonText[blockedReason]
    : executionStateText[executionState];

export const isWaitingForApproval = ({
  executionState,
  blockedReason,
}: ProposalGroupExecutionStatusInput): boolean =>
  executionState === ProposalGroupMemberExecutionState.PendingApproval ||
  blockedReason === ProposalGroupBlockedReason.ApprovalsPending;
