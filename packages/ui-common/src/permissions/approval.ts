import type { ProposalApprovalDto } from "../api";
import { ProposalApprovalType } from "../api";

export interface ApprovalProgress {
  requiredApprovals: number;
  approvalCount: number;
  isMultiApproval: boolean;
  isMet: boolean;
}

export function getApprovalProgress(
  requiredApprovals: number,
  approvals: readonly ProposalApprovalDto[]
): ApprovalProgress {
  const approvalCount = approvals.filter(
    (a) => a.type === ProposalApprovalType.Approval
  ).length;

  return {
    requiredApprovals,
    approvalCount,
    isMultiApproval: requiredApprovals > 1,
    isMet: approvalCount >= requiredApprovals,
  };
}

export function formatApprovalLabel(progress: ApprovalProgress): string {
  if (!progress.isMultiApproval) return "Approve";
  return "Add approval";
}

export function formatApprovalStatus(progress: ApprovalProgress): string {
  return `${progress.approvalCount} of ${progress.requiredApprovals} approvals`;
}
