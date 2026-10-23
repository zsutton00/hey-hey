import React, { useMemo } from "react";
import { Box, ListItemButton } from "@mui/material";
import type { ProposalResponseDto } from "../../api";
import { EntityGrid } from "../Entity/EntityGrid";
import { ProposalListItem } from "./ProposalListItem";
import { getApprovalProgress } from "../../permissions";
import type { ApprovalProgress } from "../../permissions";

export interface ProposalListProps {
  proposals: ProposalResponseDto[];
  loading?: boolean;
  onClickProposal?: (
    proposal: ProposalResponseDto,
    event: React.MouseEvent<HTMLElement>
  ) => void;
  getProposalHref?: (proposal: ProposalResponseDto) => string;
}

function computeApprovalProgress(
  proposal: ProposalResponseDto
): ApprovalProgress {
  return getApprovalProgress(proposal.requiredApprovals, proposal.approvals);
}

export const ProposalList: React.FC<ProposalListProps> = ({
  proposals,
  loading = false,
  onClickProposal,
  getProposalHref,
}) => {
  const progressMap = useMemo(
    () => new Map(proposals.map((p) => [p.id, computeApprovalProgress(p)])),
    [proposals]
  );

  return (
    <Box
      sx={{
        width: "100%",
        "& > div > div:not(:last-child) > div": {
          borderBottom: 1,
          borderColor: "divider",
        },
      }}
      data-testid="proposal-list"
    >
      <EntityGrid
        items={proposals}
        loading={loading}
        renderItem={(proposal) => {
          const href = getProposalHref?.(proposal);
          const handleClick = onClickProposal
            ? (event: React.MouseEvent<HTMLElement>) =>
                onClickProposal(proposal, event)
            : undefined;
          const content = (
            <ProposalListItem
              proposal={proposal}
              approvalProgress={progressMap.get(proposal.id)}
            />
          );

          if (!handleClick && !href) {
            return <Box>{content}</Box>;
          }

          if (href) {
            return (
              <Box>
                <ListItemButton
                  component="a"
                  href={href}
                  onClick={handleClick}
                  sx={{ p: 0, color: "inherit", textDecoration: "none" }}
                >
                  {content}
                </ListItemButton>
              </Box>
            );
          }

          return (
            <Box>
              <ListItemButton onClick={handleClick} sx={{ p: 0 }}>
                {content}
              </ListItemButton>
            </Box>
          );
        }}
        keyExtractor={(proposal) => proposal.id}
        emptyMessage="No proposals found"
      />
    </Box>
  );
};
