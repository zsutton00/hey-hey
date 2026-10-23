import { useCallback, useMemo, useSyncExternalStore } from "react";
import { MessageType, ProposalStatus, TargetEntityType } from "../../../api";
import type { MessageResponseDto, ProposalResponseDto } from "../../../api";
import {
  getEntry,
  subscribe,
} from "../../ProposalDispatchers/proposalSelectedStateCache";
import {
  toProposalId,
  type MessageInteractionContext,
} from "./proposalsAcceptedTypes";

/** Collect before presentation hides CARRIER messages or relocates their attachments. */
export const collectConversationProposals = (
  messages: readonly MessageResponseDto[] = []
): ProposalResponseDto[] => {
  const proposals = new Map<string, ProposalResponseDto>();
  const visit = (message: MessageResponseDto): void => {
    if (message.type === MessageType.System) {
      for (const proposal of message.proposals ?? []) {
        const previous = proposals.get(proposal.id);
        if (
          !previous ||
          Date.parse(proposal.updatedAt) >= Date.parse(previous.updatedAt)
        ) {
          proposals.set(proposal.id, proposal);
        }
      }
    }
    for (const response of message.responses ?? []) visit(response);
  };
  messages.forEach(visit);
  return [...proposals.values()];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getTargetWorkItemType = (
  proposal: ProposalResponseDto
): string | null => {
  if (
    proposal.targetEntityType !== TargetEntityType.Task ||
    !isRecord(proposal.updates)
  ) {
    return null;
  }
  return typeof proposal.updates.type === "string"
    ? proposal.updates.type
    : null;
};

export const useConversationProposalInteraction = (
  messages: readonly MessageResponseDto[] | undefined
): MessageInteractionContext => {
  const proposals = useMemo(
    () => collectConversationProposals(messages),
    [messages]
  );
  const subscribeToProposals = useCallback(
    (onChange: () => void) => {
      const unsubscribe = proposals.map(({ id }) => subscribe(id, onChange));
      return () => unsubscribe.forEach((stop) => stop());
    },
    [proposals]
  );
  // A primitive snapshot stays stable until a subscribed proposal's cached decision changes.
  const getSnapshot = useCallback(
    () => proposals.map(({ id }) => getEntry(id)?.lifecycle ?? "").join("|"),
    [proposals]
  );
  const cachedSnapshot = useSyncExternalStore(
    subscribeToProposals,
    getSnapshot,
    getSnapshot
  );
  return useMemo(() => {
    const cachedLifecycles = cachedSnapshot.split("|");
    const interaction: MessageInteractionContext = {
      proposals: proposals.map((proposal, index) => ({
        proposalId: toProposalId(proposal.id),
        targetWorkItemType: getTargetWorkItemType(proposal),
        lifecycle:
          cachedLifecycles[index] === "applied"
            ? ProposalStatus.Approved
            : cachedLifecycles[index] === "rejected"
            ? ProposalStatus.Rejected
            : proposal.status,
      })),
    };
    // Stage readiness debug: all conversation proposals, including hidden carriers and groups.

    return interaction;
  }, [proposals, cachedSnapshot]);
};
