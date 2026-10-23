import BlockIcon from "@mui/icons-material/Block";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Chip,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import { ProposalApprovalType, type ProposalResponseDto } from "../../api";
import { useUsers } from "../../data/hooks/useUsers";
import type { ProposalItemStatus } from "./types";
import { ProposalTitle } from "./ProposalTitle";
import { formatProposalAction } from "./ProposalHeader";
import { staticProposalEntityTypePresentation } from "./proposalHeaderType";

export interface RejectedProposalCardProps {
  proposal: ProposalResponseDto;
  status: ProposalItemStatus;
  children: React.ReactNode;
}

const formatTargetEntityType = (value: string): string =>
  value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");

const RejectedProposalCardContent: React.FC<RejectedProposalCardProps> = ({
  proposal,
  status,
  children,
}) => {
  const [expanded, setExpanded] = useState(status.state !== "rejected");
  const { data: members } = useUsers(proposal.organizationId);

  const rejection = proposal.approvals.find(
    (approval) => approval.type === ProposalApprovalType.Rejection
  );
  const rejectingUserName = rejection
    ? members
        .find((member) => member.userId === rejection.userId)
        ?.user?.name?.trim() || null
    : null;
  const rejectionReason = rejection?.reason?.trim() || null;

  return (
    <Paper
      variant="outlined"
      data-testid="rejected-proposal-card"
      sx={{
        p: 1.5,
        borderColor: "error.main",
        backgroundColor: "action.hover",
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            icon={<BlockIcon />}
            label="Rejected"
            size="small"
            color="error"
          />
          <ProposalTitle
            proposal={proposal}
            typePresentation={staticProposalEntityTypePresentation(
              proposal.targetEntityType
            )}
            hideTypeChip
            titleTestId="rejected-proposal-target"
          />
          <IconButton
            size="small"
            onClick={() => setExpanded((previous) => !previous)}
            aria-label={
              expanded
                ? "Collapse rejected proposal"
                : "Expand rejected proposal"
            }
            aria-expanded={expanded}
            data-testid="rejected-proposal-toggle"
            sx={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack spacing={0.25} data-testid="rejected-proposal-summary">
          <Typography variant="body2" color="text.secondary">
            {formatProposalAction(proposal.action)}{" "}
            {formatTargetEntityType(proposal.targetEntityType)}
            {" rejected by "}
            <strong>{rejectingUserName ?? "User unavailable"}</strong>
          </Typography>
          {rejectionReason && (
            <Typography variant="body2" color="text.secondary">
              Reason: {rejectionReason}
            </Typography>
          )}
        </Stack>
        <Collapse in={expanded} unmountOnExit>
          <Stack spacing={1.5} data-testid="rejected-proposal-details">
            {children}
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
};

/**
 * Keeps pending and in-flight proposals on their existing full-content path.
 * Rejected proposals get a compact terminal summary, with their original
 * renderer mounted only after the reviewer explicitly expands the card.
 */
export const RejectedProposalCard: React.FC<RejectedProposalCardProps> = ({
  proposal,
  status,
  children,
}) => {
  if (status.state !== "rejected") {
    return <>{children}</>;
  }

  return (
    <RejectedProposalCardContent proposal={proposal} status={status}>
      {children}
    </RejectedProposalCardContent>
  );
};
