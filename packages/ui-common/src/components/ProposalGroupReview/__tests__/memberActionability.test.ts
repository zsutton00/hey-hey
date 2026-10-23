import {
  ProposalGroupMemberExecutionState,
  type ProposalGroupMemberSnapshot,
} from "../../../api";
import { getMemberActionability } from "../memberActionability";

const memberWithState = (
  executionState: ProposalGroupMemberExecutionState
): ProposalGroupMemberSnapshot =>
  ({
    executionState,
    approvalProgress: {
      receivedApprovals: 1,
      requiredApprovals: 1,
      approvalSatisfied: true,
    },
  }) as ProposalGroupMemberSnapshot;

describe("getMemberActionability", () => {
  it.each([
    ProposalGroupMemberExecutionState.Ready,
    ProposalGroupMemberExecutionState.RetryableFailure,
  ])("offers rejection while the member is %s", (executionState) => {
    expect(getMemberActionability(memberWithState(executionState))).toEqual({
      canApprove: false,
      canReject: true,
    });
  });

  it.each([
    ProposalGroupMemberExecutionState.Applying,
    ProposalGroupMemberExecutionState.Applied,
    ProposalGroupMemberExecutionState.Rejected,
    ProposalGroupMemberExecutionState.Invalidated,
    ProposalGroupMemberExecutionState.Failed,
  ])("offers no decision while the member is %s", (executionState) => {
    expect(getMemberActionability(memberWithState(executionState))).toEqual({
      canApprove: false,
      canReject: false,
    });
  });
});
