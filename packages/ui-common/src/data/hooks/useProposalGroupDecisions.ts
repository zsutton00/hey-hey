import { useQueryClient } from "@tanstack/react-query";
import { proposalKeys } from "../collections/proposals";
import { invalidateProposalReconciliation } from "../../components/ProposalReconciliation/reconciliationInvalidation";
import { useCallback, useState } from "react";
import { useInvalidateProposalReview } from "./useInvalidateProposalReview";
import {
  ProposalStatus,
  type ProposalGroupApproveAllResult,
  type ProposalResponseDto,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { toProposalApprovalFailureError } from "../../components/ProposalDispatchers/ProposalFailureDiagnostic";

export type ProposalGroupApprovalResult = ProposalResponseDto;
export type ProposalGroupRejectionResult = ProposalResponseDto;

export interface UseProposalGroupDecisionsOptions {
  organizationId: string;
  projectId: string;
  groupId: string;
  refetch: () => Promise<unknown>;
}

export interface UseProposalGroupDecisionsReturn {
  approveMember: (proposalId: string) => Promise<ProposalGroupApprovalResult>;
  rejectMember: (
    proposalId: string,
    reason: string,
  ) => Promise<ProposalGroupRejectionResult>;
  approveAll: () => Promise<ProposalGroupApproveAllResult>;
  decidingProposalIds: ReadonlySet<string>;
  isApprovingAll: boolean;
  approveAllResult: ProposalGroupApproveAllResult | null;
  decisionProposals: ReadonlyMap<string, ProposalResponseDto>;
  error: Error | null;
  clearApproveAllResult: () => void;
}

const requireResult = <T>(value: T | undefined, operation: string): T => {
  if (value === undefined) {
    throw new Error(`${operation} completed without a result`);
  }
  return value;
};

export const useProposalGroupDecisions = ({
  organizationId,
  projectId,
  groupId,
}: UseProposalGroupDecisionsOptions): UseProposalGroupDecisionsReturn => {
  const queryClient = useQueryClient();
  const invalidateReview = useInvalidateProposalReview();
  const [decidingProposalIds, setDecidingProposalIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  const [approveAllResult, setApproveAllResult] =
    useState<ProposalGroupApproveAllResult | null>(null);
  const [decisionProposals, setDecisionProposals] = useState<
    Map<string, ProposalResponseDto>
  >(() => new Map());
  const [error, setError] = useState<Error | null>(null);

  const runMemberDecision = useCallback(
    async (
      proposalId: string,
      decision: () => Promise<ProposalResponseDto>,
    ): Promise<ProposalResponseDto> => {
      setError(null);
      setDecidingProposalIds((current) => new Set(current).add(proposalId));
      try {
        const proposal = await decision();
        queryClient.setQueryData(
          proposalKeys.detail(organizationId, projectId, proposal.id),
          proposal,
        );
        return proposal;
      } catch (caught) {
        const decisionError = toProposalApprovalFailureError(
          caught,
          "Proposal decision failed",
        );
        setError(decisionError);
        throw decisionError;
      } finally {
        await invalidateReview(organizationId, projectId).catch(() => null);
        invalidateProposalReconciliation(proposalId);
        setDecidingProposalIds((current) => {
          const next = new Set(current);
          next.delete(proposalId);
          return next;
        });
      }
    },
    [queryClient, invalidateReview, organizationId, projectId],
  );

  const approveMember = useCallback(
    async (proposalId: string) => {
      const proposal = await runMemberDecision(proposalId, async () => {
        const response = await proposalsClient.updateProposal({
          organizationId,
          projectId,
          proposalId,
          updateProposalDto: { status: ProposalStatus.Approved },
        });
        return requireResult(response.data.data, "Proposal approval");
      });
      setDecisionProposals((current) =>
        new Map(current).set(proposalId, proposal),
      );
      return proposal;
    },
    [organizationId, projectId, runMemberDecision],
  );

  const rejectMember = useCallback(
    async (proposalId: string, reason: string) => {
      const proposal = await runMemberDecision(proposalId, async () => {
        const response = await proposalsClient.rejectProposal({
          organizationId,
          projectId,
          proposalId,
          rejectProposalDto: { reason },
        });
        return requireResult(response.data.data, "Proposal rejection").proposal;
      });
      setDecisionProposals((current) =>
        new Map(current).set(proposalId, proposal),
      );
      return proposal;
    },
    [organizationId, projectId, runMemberDecision],
  );

  const approveAll = useCallback(async () => {
    setError(null);
    setIsApprovingAll(true);
    try {
      const response = await proposalsClient.approveAllProposalGroupMembers({
        organizationId,
        projectId,
        groupId,
      });
      const result = requireResult(response.data.data, "Approve all");
      setApproveAllResult(result);
      return result;
    } catch (caught) {
      const decisionError = toProposalApprovalFailureError(
        caught,
        "Approve all failed",
      );
      setError(decisionError);
      throw decisionError;
    } finally {
      await invalidateReview(organizationId, projectId).catch(() => null);
      setIsApprovingAll(false);
    }
  }, [groupId, organizationId, projectId, invalidateReview]);

  const clearApproveAllResult = useCallback(
    () => setApproveAllResult(null),
    [],
  );

  return {
    approveMember,
    rejectMember,
    approveAll,
    decidingProposalIds,
    isApprovingAll,
    approveAllResult,
    decisionProposals,
    error,
    clearApproveAllResult,
  };
};
