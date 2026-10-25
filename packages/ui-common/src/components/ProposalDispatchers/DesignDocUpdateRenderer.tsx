import { useReconciledUpdate } from "../ProposalReconciliation/useReconciledUpdate";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, Collapse, IconButton, Paper, Stack } from "@mui/material";
import React, { useMemo, useState } from "react";
import { ProposalAction } from "../../api";
import type {
  ProposalResponseDto,
  UpdateDesignDocDto,
  DesignDocResponseDto,
} from "../../api";
import { usePathService } from "../../contexts/PathServiceContext";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { DiffRenderer } from "../SuggestedContent";
import type { DiffViewMode } from "../SuggestedContent";
import type { ProposalItemStatus } from "./types";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import { ProposalEdges } from "./ProposalEdges";
import { buildDesignDocDiff } from "./diffBuilders";
import type { ApprovalProgress } from "../../permissions";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { updateProposalTitleLinkSx } from "./updateProposalTitleLinkSx";
import { ProposalTitle } from "./ProposalTitle";
import { useProposalHeaderTypeResolution } from "./proposalHeaderType";

/**
 * Renders a design document update proposal with side-by-side diff.
 * When already applied, collapses by default and shows inline
 * content instead of the diff view.
 */
export const DesignDocUpdateRenderer: React.FC<{
  presentationAction?: ProposalAction;
  proposal: ProposalResponseDto & { updates: UpdateDesignDocDto };
  existing: DesignDocResponseDto;
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  diffDefaultViewMode?: DiffViewMode;
  overrides?: ProposalRenderOverrides;
  /** Shown above the content, e.g. what a future cancellation does. */
  notice?: React.ReactNode;
  /** Replaces the Approve/Reject indicator, e.g. an approved future's Apply strip. */
  footer?: React.ReactNode;
}> = ({
  proposal: inputProposal,
  presentationAction,
  existing: inputExisting,
  status,
  onApply,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  diffDefaultViewMode,
  overrides,
  notice,
  footer,
}) => {
  const { proposal, existing, hideDiff } = useReconciledUpdate(
    inputProposal,
    inputExisting,
  );
  const isApplied = status.state === "applied";
  const [expanded, setExpanded] = useState(!isApplied);

  const pathService = usePathService();
  const href = useMemo(
    () =>
      pathService.designDoc({
        projectId: proposal.projectId,
        designDocId: proposal.targetEntityId,
      }),
    [pathService, proposal.projectId, proposal.targetEntityId],
  );
  const { oldContent, newContent } = useMemo(
    () => buildDesignDocDiff(existing, proposal.updates),
    [existing, proposal.updates],
  );
  const { presentation: typePresentation } = useProposalHeaderTypeResolution(
    proposal.organizationId,
    proposal.projectId,
    { kind: "entity", entityType: proposal.targetEntityType },
  );

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          presentationAction={presentationAction}
          proposal={proposal}
          resolvedTargetName={existing.name}
          typePresentation={typePresentation}
          target={{
            entityId: proposal.targetEntityId,
            href,
            sx: updateProposalTitleLinkSx,
          }}
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
          endAdornment={
            isApplied ? (
              <IconButton
                size="small"
                onClick={() => setExpanded((prev) => !prev)}
                sx={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              >
                <ExpandMoreIcon fontSize="small" />
              </IconButton>
            ) : undefined
          }
        />
      )}
      {!hideDiff && notice}
      <Collapse in={expanded && !hideDiff}>
        <Stack spacing={1.5}>
          {isApplied ? (
            <Box sx={{ px: 1 }}>
              <MarkdownRenderer allowMentionEscapes>
                {newContent}
              </MarkdownRenderer>
            </Box>
          ) : (
            <DiffRenderer
              oldContent={oldContent}
              newContent={newContent}
              defaultViewMode={diffDefaultViewMode ?? "split"}
              showViewModeToggle
            />
          )}
          {siblingProposals && (
            <ProposalEdges
              edges={proposal.edges}
              siblingProposals={siblingProposals}
              organizationId={proposal.organizationId}
              projectId={proposal.projectId}
              ownerApplied={isApplied}
            />
          )}
        </Stack>
      </Collapse>
      {footer && !overrides?.hideStateIndicator
        ? footer
        : !overrides?.hideStateIndicator && (
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
