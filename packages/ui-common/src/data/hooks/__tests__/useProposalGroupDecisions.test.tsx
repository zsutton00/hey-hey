import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalGroupDecisionOutcome,
  ProposalGroupMemberExecutionState,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalGroupApproveAllResult,
  type ProposalResponseDto,
} from "../../../api";
import { useProposalGroupDecisions } from "../useProposalGroupDecisions";

const client = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  approveAll: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    updateProposal:
      client.approve,
    rejectProposal:
      client.reject,
    approveAllProposalGroupMembers: client.approveAll,
  },
}));

const proposal: ProposalResponseDto = {
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status: ProposalStatus.Draft,
  targetEntityId: "target-1",
  targetEntityType: TargetEntityType.Task,
  title: "Update proposal",
  updates: {},
  requestorId: "requestor-1",
  requiredApprovals: 2,
  approvals: [],
  createdAt: "2026-07-27T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
};

const approveAllResult: ProposalGroupApproveAllResult = {
  groupId: "group-1",
  revision: 4,
  results: [
    {
      memberId: "member-1",
      proposalId: "proposal-1",
      outcome: ProposalGroupDecisionOutcome.ApprovalRecorded,
      receivedApprovals: 1,
      requiredApprovals: 2,
      approvalSatisfied: false,
      dependencyReady: true,
      executionState: ProposalGroupMemberExecutionState.PendingApproval,
    },
    {
      memberId: "member-2",
      proposalId: "proposal-2",
      outcome: ProposalGroupDecisionOutcome.NotEligible,
      receivedApprovals: 0,
      requiredApprovals: 1,
      approvalSatisfied: false,
      dependencyReady: false,
      executionState: ProposalGroupMemberExecutionState.PendingApproval,
      message: "Requestor cannot self-approve",
    },
  ],
};

describe("useProposalGroupDecisions", () => {
  const refetch = vi.fn().mockResolvedValue(null);

  beforeEach(() => {
    vi.clearAllMocks();
    client.approve.mockResolvedValue({ data: { data: proposal } });
    client.reject.mockResolvedValue({
      data: { data: { proposal: { ...proposal, status: ProposalStatus.Rejected } } },
    });
    client.approveAll.mockResolvedValue({ data: { data: approveAllResult } });
  });

  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const renderDecisions = () =>
    renderHook(() =>
      useProposalGroupDecisions({
        organizationId: "org-1",
        projectId: "project-1",
        groupId: "group-1",
        refetch,
      }), { wrapper }
    );

  it("runs typed individual decisions and writes returned proposals into the query cache", async () => {
    const { result } = renderDecisions();

    await act(async () => {
      await result.current.approveMember("proposal-1");
      await result.current.rejectMember("proposal-1", "Conflicts with scope");
    });

    expect(client.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "proposal-1",
        updateProposalDto: { status: ProposalStatus.Approved },
      })
    );
    expect(client.reject).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "proposal-1",
        rejectProposalDto: { reason: "Conflicts with scope" },
      })
    );
    expect(refetch).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["proposals", "org-1", "project-1", "detail", "proposal-1"])).toMatchObject({ status: ProposalStatus.Rejected });
    expect(result.current.decisionProposals.get("proposal-1")?.status).toBe(
      ProposalStatus.Rejected
    );
  });

  it("preserves every partial approve-all member result", async () => {
    const { result } = renderDecisions();

    await act(async () => {
      await result.current.approveAll();
    });

    expect(result.current.approveAllResult).toEqual(approveAllResult);
    expect(result.current.approveAllResult?.results).toHaveLength(2);
    expect(result.current.approveAllResult?.results[1].outcome).toBe(
      ProposalGroupDecisionOutcome.NotEligible
    );
    expect(refetch).not.toHaveBeenCalled();
  });
});
