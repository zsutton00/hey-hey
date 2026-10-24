import { useFutureOfferCheck } from "../../../data/hooks/useFutureOfferCheck";
import { Stack } from "@mui/material";
import React, { useCallback, useMemo, useRef } from "react";
import {
  type ProposalResponseDto,
  ProposalAction,
  ProposalStatus,
} from "../../../api";
import { proposalsClient } from "../../../clients/serviceClients";
import { useInvalidateConversation } from "../../../data/hooks/useInvalidateConversation";
import { log } from "../../../utils/logger";
import {
  CreateProposal,
  DeleteProposal,
  UpdateProposal,
} from "../../ProposalDispatchers";
import type {
  OnApplyProposal,
  OnAppliedProposal,
  OnRejectProposal,
} from "../../ProposalDispatchers";
import { ProposalGroupReview } from "../../ProposalGroupReview";
import { setLifecycle } from "../../ProposalDispatchers/proposalSelectedStateCache";
import { getProposalMaterializationStatus } from "../../ProposalDispatchers/types";
import {
  classifyProposal,
  hasMessageEmitted,
  markMessageEmitted,
} from "./messageProposalsEmission";
import { useConversationContext } from "./ConversationContext";
import type { ConversationMessage } from "../../../types/conversation";

interface MessageProposalsProps {
  conversationMessage: ConversationMessage;
  disabled?: boolean;
}

export interface MessageProposalActionHandlers {
  handleApply: OnApplyProposal;
  handleApplied: OnAppliedProposal;
  handleReject: OnRejectProposal;
  proposalDiffDefaultViewMode: ReturnType<
    typeof useConversationContext
  >["proposalDiffDefaultViewMode"];
}

/**
 * Shared proposal mutation and completion behavior for message-bound proposal
 * renderers. Specialized fields can compose this hook while keeping the
 * default MessageProposals layout as the fallback presentation.
 */
export const useMessageProposalActions = (
  conversationMessage: ConversationMessage,
  ungroupedProposals: ProposalResponseDto[],
): MessageProposalActionHandlers => {
  const { proposalDiffDefaultViewMode, onProposalsAccepted } =
    useConversationContext();
  const invalidateConversation = useInvalidateConversation();
  const checkAppliedProposal = useFutureOfferCheck();

  const onProposalsAcceptedRef = useRef(onProposalsAccepted);
  onProposalsAcceptedRef.current = onProposalsAccepted;

  const triggeringMessage = conversationMessage.message;
  const conversationId = triggeringMessage.conversationId;

  const handleApply = useCallback<OnApplyProposal>(
    async (proposalId: string, approvalRequest = {}) => {
      const proposal = ungroupedProposals.find((p) => p.id === proposalId);

      if (!proposal) {
        throw new Error(`Proposal ${proposalId} not found on message`);
      }

      log.info("conversation_viewer", "Approving proposal", {
        proposalId,
        projectId: proposal.projectId,
      });

      let approvedProposal: ProposalResponseDto | undefined;
      try {
        const response = await proposalsClient.updateProposal({
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
          proposalId,
          updateProposalDto: {
            status: ProposalStatus.Approved,
            ...approvalRequest,
          },
        });
        approvedProposal = response.data.data;
      } catch (error) {
        // The API recomputes out-of-date status while approving. Refresh the
        // message snapshot after a conflict so a proposal that became stale
        // since render can expose the acknowledgement gate before retrying.
        invalidateConversation(conversationId);
        throw error;
      }
      if (!approvedProposal) {
        throw new Error(
          "Proposal approval response omitted the proposal state.",
        );
      }

      checkAppliedProposal(approvedProposal);
      invalidateConversation(conversationId);

      const materializationStatus =
        getProposalMaterializationStatus(approvedProposal);
      if (!materializationStatus || materializationStatus.state === "applied") {
        setLifecycle(proposalId, "applied");
      } else {
        return approvedProposal;
      }

      const callback = onProposalsAcceptedRef.current;
      if (callback === undefined) {
        return approvedProposal;
      }

      const classified = ungroupedProposals.map((p) => ({
        id: p.id,
        kind: classifyProposal(p, proposalId),
      }));
      const alreadyEmitted = hasMessageEmitted(triggeringMessage.id);

      if (classified.some((c) => c.kind === "pending")) {
        return;
      }

      if (alreadyEmitted) {
        return;
      }
      markMessageEmitted(triggeringMessage.id);

      const acceptedProposalIds = classified
        .filter((c) => c.kind === "approved")
        .map((c) => c.id);
      const rejectedProposalIds = classified
        .filter((c) => c.kind === "rejected")
        .map((c) => c.id);

      callback({
        message: triggeringMessage,
        totalProposals: ungroupedProposals.length,
        approvedCount: acceptedProposalIds.length,
        rejectedCount: rejectedProposalIds.length,
        acceptedProposalIds,
        rejectedProposalIds,
      });
      return approvedProposal;
    },
    [
      checkAppliedProposal,
      conversationId,
      invalidateConversation,
      triggeringMessage,
      ungroupedProposals,
    ],
  );

  const handleReject = useCallback<OnRejectProposal>(
    async (proposalId: string, reason: string) => {
      const proposal = ungroupedProposals.find((p) => p.id === proposalId);
      if (!proposal) {
        throw new Error(`Proposal ${proposalId} not found on message`);
      }

      log.info("conversation_viewer", "Rejecting proposal", {
        proposalId,
        projectId: proposal.projectId,
        reason,
      });

      await proposalsClient.rejectProposal({
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        proposalId,
        rejectProposalDto: { reason },
      });

      setLifecycle(proposalId, "rejected");
      invalidateConversation(conversationId);
    },
    [conversationId, invalidateConversation, ungroupedProposals],
  );

  const handleApplied = useCallback<OnAppliedProposal>(
    async (proposalId: string) => {
      const proposal = ungroupedProposals.find(
        (item) => item.id === proposalId,
      );
      // Ordinary approval already refreshes in handleApply; a future's later
      // Apply is a separate operation and needs its own conversation refresh.
      if (proposal?.action === ProposalAction.VersionedUpdate) {
        invalidateConversation(conversationId);
      }
    },
    [conversationId, invalidateConversation, ungroupedProposals],
  );

  return {
    handleApply,
    handleApplied,
    handleReject,
    proposalDiffDefaultViewMode,
  };
};

/**
 * Renders CREATE and UPDATE proposal dispatchers below a conversation message.
 * Reads proposals from the message, splits by action, and provides
 * an onApply callback that PATCHes the proposal status to APPROVED.
 */
export const MessageProposals: React.FC<MessageProposalsProps> = ({
  conversationMessage,
  disabled,
}) => {
  const { project } = useConversationContext();

  const proposals: ProposalResponseDto[] = useMemo(
    () =>
      [...(conversationMessage.message.proposals ?? [])].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [conversationMessage.message],
  );

  const groupIds = useMemo(
    () =>
      Array.from(
        new Set(
          proposals.flatMap((proposal) =>
            proposal.groupMembership ? [proposal.groupMembership.groupId] : [],
          ),
        ),
      ),
    [proposals],
  );
  const ungroupedProposals = useMemo(
    () => proposals.filter((proposal) => !proposal.groupMembership),
    [proposals],
  );
  const createProposals = useMemo(
    () => ungroupedProposals.filter((p) => p.action === ProposalAction.Create),
    [ungroupedProposals],
  );
  const updateProposals = useMemo(
    () =>
      ungroupedProposals.filter(
        (p) =>
          p.action === ProposalAction.Update ||
          p.action === ProposalAction.VersionedUpdate,
      ),
    [ungroupedProposals],
  );
  const deleteProposals = useMemo(
    () => ungroupedProposals.filter((p) => p.action === ProposalAction.Delete),
    [ungroupedProposals],
  );

  const {
    handleApply,
    handleApplied,
    handleReject,
    proposalDiffDefaultViewMode,
  } = useMessageProposalActions(conversationMessage, ungroupedProposals);

  if (proposals.length === 0) {
    return null;
  }

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      {groupIds.map((groupId) => (
        <ProposalGroupReview
          key={groupId}
          organizationId={project.organizationId}
          projectId={project.id}
          groupId={groupId}
        />
      ))}
      {createProposals.length > 0 && (
        <CreateProposal
          proposals={createProposals}
          onApply={handleApply}
          onReject={handleReject}
          disabled={disabled}
          allProposals={ungroupedProposals}
        />
      )}
      {updateProposals.length > 0 && (
        <UpdateProposal
          proposals={updateProposals}
          onApply={handleApply}
          onApplied={handleApplied}
          onReject={handleReject}
          organizationId={project.organizationId}
          projectId={project.id}
          disabled={disabled}
          allProposals={ungroupedProposals}
          diffDefaultViewMode={proposalDiffDefaultViewMode}
        />
      )}
      {deleteProposals.length > 0 && (
        <DeleteProposal
          proposals={deleteProposals}
          onApply={handleApply}
          onReject={handleReject}
          organizationId={project.organizationId}
          projectId={project.id}
          disabled={disabled}
          allProposals={ungroupedProposals}
        />
      )}
    </Stack>
  );
};
