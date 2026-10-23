import { ProposalStatus, type ProposalResponseDto } from "../../../api";
import { getEntry } from "../../ProposalDispatchers/proposalSelectedStateCache";

/**
 * Emission-completeness helpers for MessageProposals.
 *
 * The onProposalsAccepted callback must fire exactly once, the moment every
 * proposal on a SystemMessage reaches a terminal state via an approval.
 * Correctness here cannot rely on a component-local running counter:
 * MessageProposals remounts during a session (ConversationTimeline swaps each
 * message's wrapper between FadeIn and Fragment), which would reset any
 * mount-scoped state and lose approvals already made. So completeness is
 * derived from the persistent proposalSelectedStateCache, and the fire-once
 * guard lives at module scope — both survive remounts and are wiped only on
 * full-page refresh.
 */

const emittedMessageIds = new Set<string>();

export const hasMessageEmitted = (messageId: string): boolean =>
  emittedMessageIds.has(messageId);

export const markMessageEmitted = (messageId: string): void => {
  emittedMessageIds.add(messageId);
};

/** Test-only: clears the module-level fire-once guard. */
export const __resetEmittedMessageIdsForTests = (): void => {
  emittedMessageIds.clear();
};

export type ProposalTerminalKind = "approved" | "rejected" | "pending";

/**
 * Classifies a proposal as terminal-approved, terminal-rejected, or still
 * pending. The persistent proposalSelectedStateCache is consulted first — it
 * records applied/rejected lifecycle the moment the user acts, survives
 * MessageProposals remounts, and stays correct even when the conversation
 * payload still reads Pending/Draft — then the proposal's server status,
 * then `justApprovedId` for the in-flight approval whose cache write the
 * caller has only just made.
 */
export const classifyProposal = (
  proposal: ProposalResponseDto,
  justApprovedId: string
): ProposalTerminalKind => {
  if (proposal.id === justApprovedId) return "approved";
  const cached = getEntry(proposal.id);
  if (cached?.lifecycle === "applied") return "approved";
  if (cached?.lifecycle === "rejected") return "rejected";
  if (proposal.status === ProposalStatus.Approved) return "approved";
  if (proposal.status === ProposalStatus.Rejected) return "rejected";
  return "pending";
};
