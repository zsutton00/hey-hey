import { Box, Paper, Stack } from "@mui/material";
import React from "react";
import { ProposalAction, TargetEntityType } from "../../api";
import type { ProposalResponseDto } from "../../api";
import type { ApprovalProgress } from "../../permissions";
import { ProposalEdges } from "./ProposalEdges";
import { getProposalDisplayTitle } from "./getProposalDisplayTitle";
import { ProposalTitle } from "./ProposalTitle";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { staticProposalEntityTypePresentation } from "./proposalHeaderType";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import type { ProposalItemStatus } from "./types";
import { ModeAvailabilitySummary } from "./ModeAvailabilitySummary";
import { useModeAvailability } from "./modeAvailability";

export interface EdgeOnlyUpdateRendererProps {
  proposal: ProposalResponseDto;
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  overrides?: ProposalRenderOverrides;
}

/**
 * Renders an UPDATE proposal whose only reviewable content is its declared
 * relationship set. These declarations live on the proposal envelope rather
 * than in `updates`, so they must not depend on an entity diff or hydration.
 */
export const EdgeOnlyUpdateRenderer: React.FC<EdgeOnlyUpdateRendererProps> = ({
  proposal,
  status,
  onApply,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  overrides,
}) => {
  const modeAvailability = useModeAvailability({
    organizationId: proposal.organizationId,
    projectId: proposal.projectId,
    targetEntityId: proposal.targetEntityId,
    action: ProposalAction.Update,
    modeTypeKey:
      proposal.targetEntityType === TargetEntityType.Task
        ? undefined
        : "STANDARD",
    proposalEdges: proposal.edges,
  });

  const content = (
    <Stack spacing={1.5} data-testid="edge-only-update-proposal">
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={getProposalDisplayTitle(proposal)}
          typePresentation={staticProposalEntityTypePresentation(
            proposal.targetEntityType
          )}
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
        />
      )}
      <ModeAvailabilitySummary
        availability={modeAvailability}
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
      />
      <ProposalEdges
        edges={proposal.edges}
        siblingProposals={siblingProposals}
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
        ownerApplied={status.state === "applied"}
      />
      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={status}
            action={ProposalAction.Update}
            onApply={onApply}
            onReject={onReject}
            disabled={disabled}
            approvalProgress={approvalProgress}
          />
        </Box>
      )}
    </Stack>
  );

  return overrides?.hideCard ? (
    content
  ) : (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {content}
    </Paper>
  );
};
