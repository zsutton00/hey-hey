import type { MessageResponseDto, ProposalStatus } from "../../../api";

export type ProposalId = string & { readonly __brand: "ProposalId" };

export const toProposalId = (value: string): ProposalId => value as ProposalId;

interface MessageProposalSnapshot {
  proposalId: ProposalId;
  lifecycle: ProposalStatus;
  targetWorkItemType: string | null;
}

export interface MessageInteractionContext {
  proposals: readonly MessageProposalSnapshot[];
}

interface ProposalsAcceptedPayload {
  message: MessageResponseDto;
  totalProposals: number;
  approvedCount: number;
  rejectedCount: number;
  acceptedProposalIds: string[];
  rejectedProposalIds: string[];
}

export type ProposalsAcceptedHandler = (
  payload: ProposalsAcceptedPayload,
) => void;
