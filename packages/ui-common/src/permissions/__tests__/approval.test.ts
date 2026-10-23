import { describe, it, expect } from "vitest";
import {
  getApprovalProgress,
  formatApprovalLabel,
  formatApprovalStatus,
} from "../approval";
import { ProposalApprovalType } from "../../api";
import type { ProposalApprovalDto } from "../../api";

function makeApproval(
  type: ProposalApprovalDto["type"] = ProposalApprovalType.Approval
): ProposalApprovalDto {
  return {
    userId: "user-1",
    type,
    createdAt: new Date().toISOString(),
  };
}

describe("getApprovalProgress", () => {
  it("returns isMultiApproval false for threshold 1", () => {
    const result = getApprovalProgress(1, []);
    expect(result).toEqual({
      requiredApprovals: 1,
      approvalCount: 0,
      isMultiApproval: false,
      isMet: false,
    });
  });

  it("returns isMet true when single approval meets threshold 1", () => {
    const result = getApprovalProgress(1, [makeApproval()]);
    expect(result.isMet).toBe(true);
    expect(result.isMultiApproval).toBe(false);
  });

  it("returns isMultiApproval true for threshold > 1", () => {
    const result = getApprovalProgress(2, [makeApproval()]);
    expect(result).toEqual({
      requiredApprovals: 2,
      approvalCount: 1,
      isMultiApproval: true,
      isMet: false,
    });
  });

  it("returns isMet true when approval count meets threshold", () => {
    const result = getApprovalProgress(2, [makeApproval(), makeApproval()]);
    expect(result.isMet).toBe(true);
    expect(result.approvalCount).toBe(2);
  });

  it("ignores rejections when counting approvals", () => {
    const result = getApprovalProgress(2, [
      makeApproval(ProposalApprovalType.Approval),
      makeApproval(ProposalApprovalType.Rejection),
    ]);
    expect(result.approvalCount).toBe(1);
    expect(result.isMet).toBe(false);
  });

  it("handles empty approvals array", () => {
    const result = getApprovalProgress(2, []);
    expect(result.approvalCount).toBe(0);
    expect(result.isMet).toBe(false);
  });
});

describe("formatApprovalLabel", () => {
  it("returns simple Approve for single-approval", () => {
    const progress = getApprovalProgress(1, []);
    expect(formatApprovalLabel(progress)).toBe("Approve");
  });

  it("returns Add approval for multi-approval", () => {
    const progress = getApprovalProgress(2, [makeApproval()]);
    expect(formatApprovalLabel(progress)).toBe("Add approval");
  });

  it("returns Add approval with no approvals", () => {
    const progress = getApprovalProgress(3, []);
    expect(formatApprovalLabel(progress)).toBe("Add approval");
  });
});

describe("formatApprovalStatus", () => {
  it("returns progress for single-approval", () => {
    const progress = getApprovalProgress(1, []);
    expect(formatApprovalStatus(progress)).toBe("0 of 1 approvals");
  });

  it("returns progress for multi-approval", () => {
    const progress = getApprovalProgress(2, [makeApproval()]);
    expect(formatApprovalStatus(progress)).toBe("1 of 2 approvals");
  });
});
