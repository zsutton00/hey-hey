import React from "react";
import { Box, Chip, ListItem, Stack, Tooltip, Typography } from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import { ProposalOutOfDateStatus, type ProposalResponseDto } from "../../api";
import type { ApprovalProgress } from "../../permissions";
import { InteractionComponent } from "../InteractionComponent";
import { getProposalDisplayTitle } from "../ProposalDispatchers/getProposalDisplayTitle";
import { formatProposalAction } from "../ProposalDispatchers/ProposalHeader";

const statusColorMap: Record<
  string,
  "default" | "warning" | "success" | "error" | "info"
> = {
  DRAFT: "default",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
};

const actionColorMap: Record<string, "primary" | "secondary" | "error"> = {
  CREATE: "primary",
  UPDATE: "secondary",
  DELETE: "error",
};

function formatLabel(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

const proposalStatusLabel: Record<string, string> = {
  DRAFT: "Needs review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const proposalTypeLabel: Record<string, string> = {
  SINGLE: "Single change",
  BATCH: "Multiple changes",
};

export interface ProposalListItemProps {
  proposal: ProposalResponseDto;
  approvalProgress?: ApprovalProgress;
}

export const ProposalListItem: React.FC<ProposalListItemProps> = ({
  proposal,
  approvalProgress,
}) => {
  const proposalTitle = getProposalDisplayTitle(proposal);
  const row = (
    <ListItem
      sx={{
        px: 2,
        py: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 2,
      }}
      disablePadding
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ minWidth: 180 }}
      >
        <Chip
          label={formatProposalAction(proposal.action)}
          color={actionColorMap[proposal.action] ?? "default"}
          size="small"
          variant="outlined"
        />
        <Chip
          label={proposalTypeLabel[proposal.type] ?? "Change"}
          size="small"
          variant="outlined"
        />
      </Stack>

      <Chip
        label={
          proposalStatusLabel[proposal.status] ?? "Review status unavailable"
        }
        color={statusColorMap[proposal.status] ?? "default"}
        size="small"
      />

      {approvalProgress?.isMultiApproval && !approvalProgress.isMet && (
        <Tooltip title="Multiple approvals are required for this proposal">
          <Chip
            label={`${approvalProgress.approvalCount} of ${approvalProgress.requiredApprovals}`}
            size="small"
            variant="outlined"
            color="info"
          />
        </Tooltip>
      )}

      {proposal.outOfDateStatus === ProposalOutOfDateStatus.OutOfDate ? (
        <Tooltip title="This proposal was written against an older applied version of this work item">
          <Chip
            data-testid="proposal-list-out-of-date-warning"
            label="Out of date"
            size="small"
            color="warning"
          />
        </Tooltip>
      ) : null}

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          noWrap
          sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {proposalTitle}
        </Typography>
        {proposal.eli5 !== undefined && (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="proposal-eli5"
          >
            {proposal.eli5}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" noWrap>
          {formatLabel(proposal.targetEntityType)}
        </Typography>
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ whiteSpace: "nowrap" }}
      >
        {formatDistanceToNow(new Date(proposal.createdAt), {
          addSuffix: true,
        })}
      </Typography>
    </ListItem>
  );

  return (
    <InteractionComponent
      entityId={proposal.id}
      entityType="PROPOSAL"
      hasProposalSupport
      entityTitle={proposalTitle}
      organizationId={proposal.organizationId}
      projectId={proposal.projectId}
      draggable={false}
    >
      {row}
    </InteractionComponent>
  );
};
