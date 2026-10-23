import { Box, Paper, Stack, Typography } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { ProposalAction } from "../../api";
import type {
  ProposalResponseDto,
  CreateDesignDocDto,
  DesignDocDraftSection,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { usePathService } from "../../contexts/PathServiceContext";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type { ProposalItemStatus } from "./types";
import { isPlaceholderEntityId } from "./types";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import { ProposalEdges } from "./ProposalEdges";
import type { ApprovalProgress } from "../../permissions";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { getEntry, setNewEntityId } from "./proposalSelectedStateCache";
import { ProposalTitle } from "./ProposalTitle";
import { useProposalHeaderTypeResolution } from "./proposalHeaderType";

/**
 * Renders a design document creation proposal showing name and sections
 * summary.
 */
export const DesignDocCreateRenderer: React.FC<{
  proposal: ProposalResponseDto & { updates: CreateDesignDocDto };
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  overrides?: ProposalRenderOverrides;
}> = ({
  proposal,
  status,
  onApply,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  overrides,
}) => {
  const pathService = usePathService();

  const [resolvedEntityId, setResolvedEntityId] = useState(
    () => getEntry(proposal.id)?.newEntityId ?? proposal.targetEntityId
  );

  // When applied but entityId is still a placeholder, poll every 5s (up to 5 attempts).
  const [pollAttempt, setPollAttempt] = useState(0);
  useEffect(() => {
    if (status.state !== "applied" || !isPlaceholderEntityId(resolvedEntityId))
      return;
    if (pollAttempt >= 5) return;

    const timer = setTimeout(async () => {
      try {
        const response = await proposalsClient.getProposal({
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
          proposalId: proposal.id,
        });
        const updated = response.data.data;
        if (
          updated?.targetEntityId &&
          !isPlaceholderEntityId(updated.targetEntityId)
        ) {
          setResolvedEntityId(updated.targetEntityId);
          setNewEntityId(proposal.id, updated.targetEntityId);
          return;
        }
      } catch {
        // Fall through to schedule next attempt.
      }
      setPollAttempt((n) => n + 1);
    }, 3000);

    return () => clearTimeout(timer);
  }, [
    status.state,
    resolvedEntityId,
    pollAttempt,
    proposal.organizationId,
    proposal.projectId,
    proposal.id,
  ]);

  const canView =
    status.state === "applied" && !isPlaceholderEntityId(resolvedEntityId);

  const href = useMemo(
    () =>
      pathService.designDoc({
        projectId: proposal.projectId,
        designDocId: resolvedEntityId,
      }),
    [pathService, proposal.projectId, resolvedEntityId]
  );

  const { updates } = proposal;
  const { presentation: typePresentation } = useProposalHeaderTypeResolution(
    proposal.organizationId,
    proposal.projectId,
    { kind: "entity", entityType: proposal.targetEntityType }
  );

  const orderedSections = useMemo<DesignDocDraftSection[]>(() => {
    const sections = updates.sections ?? [];
    return [...sections].sort((a, b) => {
      const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
  }, [updates.sections]);

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={updates.name}
          typePresentation={typePresentation}
          target={
            canView
              ? {
                  entityId: resolvedEntityId,
                  entityType: proposal.targetEntityType,
                  href,
                  sx: {
                    textDecoration: "none",
                    color: "primary.main",
                    "&:hover": { textDecoration: "underline" },
                  },
                }
              : undefined
          }
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
        />
      )}
      {updates.summary && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: "pre-wrap" }}
        >
          {updates.summary}
        </Typography>
      )}
      {orderedSections.length > 0 && (
        <Stack spacing={1.5}>
          {orderedSections.map((section, index) => (
            <Box key={section.id ?? `${section.key}-${index}`}>
              <Typography variant="subtitle2" gutterBottom>
                {section.key}
              </Typography>
              {section.content && (
                <MarkdownRenderer allowMentionEscapes>
                  {section.content}
                </MarkdownRenderer>
              )}
            </Box>
          ))}
        </Stack>
      )}
      {siblingProposals && (
        <ProposalEdges
          edges={proposal.edges}
          siblingProposals={siblingProposals}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
          ownerApplied={status.state === "applied"}
        />
      )}
      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={status}
            action={ProposalAction.Create}
            onApply={onApply}
            onReject={onReject}
            disabled={disabled}
            loading={
              status.state === "applied" &&
              isPlaceholderEntityId(resolvedEntityId) &&
              pollAttempt < 5
            }
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
