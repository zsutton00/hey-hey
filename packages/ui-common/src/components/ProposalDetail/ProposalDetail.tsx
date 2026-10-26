import { useFutureOfferCheck } from "../../data/hooks/useFutureOfferCheck";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ProposalAction,
  ProposalStatus,
  EntityType,
  WorkItemChangeSetMaterializationState,
  type ProposalResponseDto,
  type UpdateProposalDto,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { useInvalidateConversation } from "../../data/hooks/useInvalidateConversation";
import { useInvalidateProposalReview } from "../../data/hooks/useInvalidateProposalReview";
import { useProposal } from "../../data/hooks/useProposal";
import logger from "../../utils/logger";
import { ConversationPanelLayout, useConversationPanel } from "../Conversation";
import { EntityLinkWithPreview } from "../Entity";
import { InteractionComponent } from "../InteractionComponent";
import {
  CreateProposal,
  DeleteProposal,
  UpdateProposal,
  isWorkItemGraphProposal,
  type OnAppliedProposal,
  type OnApplyProposal,
} from "../ProposalDispatchers";
import { getProposalDisplayTitle } from "../ProposalDispatchers/getProposalDisplayTitle";
import { RefinerChat } from "../AgentSession/RefinerChat";
import { CapsuleAction } from "../ActionsCapsule";
import { ProposalGroupReview } from "../ProposalGroupReview";
import { formatProposalAction } from "../ProposalDispatchers/ProposalHeader";

const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  [ProposalStatus.Draft]: "Needs review",
  [ProposalStatus.Approved]: "Approved",
  [ProposalStatus.Rejected]: "Rejected",
};

const formatTargetEntityType = (value: string): string =>
  value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");

const APPROVAL_TYPE_LABEL: Record<string, string> = {
  APPROVAL: "Approved",
  REJECTION: "Rejected",
};

const formatApprovalType = (value: string): string =>
  APPROVAL_TYPE_LABEL[value] ?? "Review decision";

const STATUS_COLOR: Record<
  string,
  "default" | "warning" | "success" | "error"
> = {
  [ProposalStatus.Draft]: "default",
  [ProposalStatus.Approved]: "success",
  [ProposalStatus.Rejected]: "error",
};

type ProposalMode = "read" | "edit";

const PROPOSAL_MODE_ACTION_ID = "proposal-mode-toggle";

export interface ProposalDetailProps {
  proposalId: string;
  organizationId: string;
  projectId: string;
  /**
   * @deprecated Retained for compatibility; proposal detail always opens in
   * Read mode regardless of this value.
   */
  initialEditing?: boolean;
  /** Called once after a graph change set reports complete materialization. */
  onApplied?: OnAppliedProposal;
  /** Supplies the already-loaded display title to canonical page owners. */
  onPresentationLoaded?: (label: string) => void;
}

export const ProposalDetail: React.FC<ProposalDetailProps> = ({
  proposalId,
  organizationId,
  projectId,
  onApplied,
  onPresentationLoaded,
}) => {
  const { proposal, isLoading, error, refetch } = useProposal(
    organizationId,
    projectId,
    proposalId,
  );

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !proposal) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error?.message ?? "Proposal not found"}
      </Alert>
    );
  }

  if (proposal.groupMembership) {
    return (
      <Box sx={{ p: 3 }}>
        <ProposalGroupReview
          organizationId={organizationId}
          projectId={projectId}
          groupId={proposal.groupMembership.groupId}
        />
      </Box>
    );
  }

  return (
    <ProposalDetailLoaded
      key={proposal.id}
      proposal={proposal}
      organizationId={organizationId}
      projectId={projectId}
      refetch={refetch}
      onApplied={onApplied}
      onPresentationLoaded={onPresentationLoaded}
    />
  );
};

interface ProposalDetailLoadedProps {
  proposal: ProposalResponseDto;
  organizationId: string;
  projectId: string;
  refetch: () => Promise<unknown>;
  onApplied?: OnAppliedProposal;
  onPresentationLoaded?: (label: string) => void;
}

const ProposalDetailLoaded: React.FC<ProposalDetailLoadedProps> = ({
  proposal,
  organizationId,
  projectId,
  refetch,
  onApplied,
  onPresentationLoaded,
}) => {
  const invalidateConversation = useInvalidateConversation();
  const invalidateReview = useInvalidateProposalReview();
  const appliedNotificationIdsRef = useRef(new Set<string>());

  useEffect(() => {
    onPresentationLoaded?.(getProposalDisplayTitle(proposal));
  }, [onPresentationLoaded, proposal]);

  const notifyApplied = useCallback(
    async (proposalId: string): Promise<void> => {
      if (!onApplied || appliedNotificationIdsRef.current.has(proposalId))
        return;
      appliedNotificationIdsRef.current.add(proposalId);
      await onApplied(proposalId);
    },
    [onApplied],
  );

  const [mode, setMode] = useState<ProposalMode>("read");

  const { isExpanded } = useConversationPanel();

  const checkAppliedProposal = useFutureOfferCheck();

  const handleApply = useCallback(
    async (
      id: string,
      approvalRequest: Pick<
        UpdateProposalDto,
        "reviewedReconciliationRevisionId"
      > = {},
    ) => {
      if (proposal.id !== id) throw new Error(`Proposal ${id} not found`);

      logger.info("ui", "Approving proposal", {
        proposalId: id,
        projectId: proposal.projectId,
      });

      let approvedProposal: ProposalResponseDto;
      try {
        const response = await proposalsClient.updateProposal({
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
          proposalId: id,
          updateProposalDto: {
            status: ProposalStatus.Approved,
            ...approvalRequest,
          },
        });
        if (!response.data.data) {
          throw new Error(
            "Proposal approval response omitted the proposal state.",
          );
        }
        approvedProposal = response.data.data;
        checkAppliedProposal(approvedProposal);
      } finally {
        invalidateReview(proposal.organizationId, proposal.projectId);
        await refetch().catch(() => null);
      }

      if (proposal.conversationId) {
        invalidateConversation(proposal.conversationId);
      }
      return approvedProposal;
    },
    [
      proposal,
      refetch,
      invalidateConversation,
      invalidateReview,
      checkAppliedProposal,
    ],
  );

  useEffect(() => {
    if (
      isWorkItemGraphProposal(proposal) &&
      proposal.status === ProposalStatus.Approved &&
      proposal.materialization?.state ===
        WorkItemChangeSetMaterializationState.Published
    ) {
      void notifyApplied(proposal.id).catch(() => undefined);
    }
  }, [notifyApplied, proposal]);

  useEffect(() => {
    if (
      !isWorkItemGraphProposal(proposal) ||
      proposal.materialization?.state !==
        WorkItemChangeSetMaterializationState.Applying
    ) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      void refetch();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [proposal, refetch]);

  const handleReject = useCallback(
    async (id: string, reason: string) => {
      if (proposal.id !== id) throw new Error(`Proposal ${id} not found`);

      logger.info("ui", "Rejecting proposal", {
        proposalId: id,
        projectId: proposal.projectId,
        reason,
      });

      try {
        await proposalsClient.rejectProposal({
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
          proposalId: id,
          rejectProposalDto: { reason },
        });
      } finally {
        invalidateReview(proposal.organizationId, proposal.projectId);
        await refetch().catch(() => null);
      }

      if (proposal.conversationId) {
        invalidateConversation(proposal.conversationId);
      }
    },
    [proposal, refetch, invalidateConversation, invalidateReview],
  );

  const handleSwitchToEdit = useCallback(() => setMode("edit"), []);
  const handleSwitchToRead = useCallback(() => setMode("read"), []);

  const leftContent = (
    <Stack spacing={3} sx={{ p: 3 }}>
      <InteractionComponent
        entityId={proposal.id}
        entityType="PROPOSAL"
        hasProposalSupport
        entityTitle={getProposalDisplayTitle(proposal)}
        organizationId={organizationId}
        projectId={projectId}
        draggable={false}
        size="medium"
      >
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
          >
            <Chip
              label={
                PROPOSAL_STATUS_LABEL[proposal.status] ??
                "Review status unavailable"
              }
              size="small"
              color={STATUS_COLOR[proposal.status] ?? "default"}
            />
            <Chip
              label={formatProposalAction(proposal.action)}
              size="small"
              variant="outlined"
            />
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Target:
            </Typography>
            <EntityLinkWithPreview
              label={formatTargetEntityType(proposal.targetEntityType)}
              entityId={proposal.targetEntityId}
              entityType={proposal.targetEntityType}
              projectId={projectId}
              organizationId={organizationId}
            />
          </Stack>
        </Stack>
      </InteractionComponent>

      <ProposalContent
        proposal={proposal}
        organizationId={organizationId}
        projectId={projectId}
        onApply={handleApply}
        onApplied={notifyApplied}
        onReject={handleReject}
      />

      <ProposalApprovals proposal={proposal} />
    </Stack>
  );

  const rightContent =
    mode === "edit" ? (
      <RefinerChat
        organizationId={organizationId}
        projectId={projectId}
        entityType={EntityType.Proposal}
        entityId={proposal.id}
        entityName={getProposalDisplayTitle(proposal)}
      />
    ) : null;

  return (
    <>
      {mode === "read" ? (
        <CapsuleAction
          id={PROPOSAL_MODE_ACTION_ID}
          label="Edit"
          icon={EditIcon}
          actionGroup="page"
          tier="page"
          order={100}
          behavior="click"
          onClick={handleSwitchToEdit}
          iconStyle={{ backgroundColor: "#2563EB", color: "#fff" }}
        />
      ) : (
        <CapsuleAction
          id={PROPOSAL_MODE_ACTION_ID}
          label="Done"
          icon={VisibilityIcon}
          actionGroup="page"
          tier="page"
          order={100}
          behavior="click"
          onClick={handleSwitchToRead}
        />
      )}
      <ConversationPanelLayout
        isExpanded={isExpanded}
        leftContent={leftContent}
        rightContent={rightContent}
      />
    </>
  );
};

const ProposalContent: React.FC<{
  proposal: ProposalResponseDto;
  organizationId: string;
  projectId: string;
  onApply: OnApplyProposal;
  onApplied: OnAppliedProposal;
  onReject: (id: string, reason: string) => Promise<void>;
}> = ({
  proposal,
  organizationId,
  projectId,
  onApply,
  onApplied,
  onReject,
}) => {
  const proposals = useMemo(() => [proposal], [proposal]);
  // Eval output is never application-eligible: show it read-only from its
  // retained content. The server refuses approval regardless.
  const renderMode =
    proposal.applicationEligible === false ? "evaluation-output" : undefined;

  if (proposal.action === ProposalAction.Create) {
    return (
      <CreateProposal
        proposals={proposals}
        onApply={onApply}
        onApplied={isWorkItemGraphProposal(proposal) ? onApplied : undefined}
        onReject={onReject}
        allProposals={proposals}
        renderMode={renderMode}
      />
    );
  }

  if (
    proposal.action === ProposalAction.Update ||
    proposal.action === ProposalAction.VersionedUpdate
  ) {
    return (
      <UpdateProposal
        proposals={proposals}
        onApply={onApply}
        onApplied={
          isWorkItemGraphProposal(proposal) ||
          proposal.action === ProposalAction.VersionedUpdate
            ? onApplied
            : undefined
        }
        onReject={onReject}
        organizationId={organizationId}
        projectId={projectId}
        allProposals={proposals}
        renderMode={renderMode}
      />
    );
  }

  if (proposal.action === ProposalAction.Delete) {
    return (
      <DeleteProposal
        proposals={proposals}
        onApply={onApply}
        onApplied={isWorkItemGraphProposal(proposal) ? onApplied : undefined}
        onReject={onReject}
        organizationId={organizationId}
        projectId={projectId}
        allProposals={proposals}
        renderMode={renderMode}
      />
    );
  }

  return (
    <Alert severity="info">This proposal uses an unsupported action.</Alert>
  );
};

const ProposalApprovals: React.FC<{
  proposal: ProposalResponseDto;
}> = ({ proposal }) => {
  const approvals = proposal.approvals ?? [];
  if (approvals.length === 0) return null;

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Approval History</Typography>
      {approvals.map((approval) => (
        <Stack
          key={`${approval.userId}-${approval.createdAt}`}
          direction="row"
          spacing={1}
          alignItems="center"
        >
          <Chip
            label={formatApprovalType(approval.type)}
            size="small"
            color={approval.type === "APPROVAL" ? "success" : "error"}
            variant="outlined"
          />
          <Typography variant="body2" color="text.secondary">
            Recorded by a reviewer
          </Typography>
          {approval.reason && (
            <Typography variant="body2" color="text.secondary">
              — {approval.reason}
            </Typography>
          )}
          <Typography variant="caption" color="text.disabled">
            {new Date(approval.createdAt).toLocaleString()}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
};
