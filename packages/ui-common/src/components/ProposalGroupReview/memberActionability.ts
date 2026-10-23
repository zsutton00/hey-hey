import {
  ProposalGroupMemberExecutionState,
  type ProposalGroupMemberSnapshot,
} from "../../api";

export interface MemberActionability {
  canApprove: boolean;
  canReject: boolean;
}

export const getMemberActionability = (
  member: ProposalGroupMemberSnapshot
): MemberActionability => {
  switch (member.executionState) {
    case ProposalGroupMemberExecutionState.PendingApproval:
      return {
        canApprove: !member.approvalProgress.approvalSatisfied,
        canReject: true,
      };
    case ProposalGroupMemberExecutionState.WaitingOnDependencies:
    case ProposalGroupMemberExecutionState.Ready:
    case ProposalGroupMemberExecutionState.RetryableFailure:
      return { canApprove: false, canReject: true };
    case ProposalGroupMemberExecutionState.Applying:
    case ProposalGroupMemberExecutionState.Applied:
    case ProposalGroupMemberExecutionState.Rejected:
    case ProposalGroupMemberExecutionState.Invalidated:
    case ProposalGroupMemberExecutionState.Failed:
      return { canApprove: false, canReject: false };
  }
};
