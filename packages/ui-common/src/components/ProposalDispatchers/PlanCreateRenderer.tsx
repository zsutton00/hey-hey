import { Box, Paper, Stack, Typography } from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { ProposalAction, TargetEntityType } from "../../api";
import type { ProposalResponseDto, ProposalUpdates } from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { usePathService } from "../../contexts/PathServiceContext";
import { useConversation } from "../../data/hooks/useConversation";
import type { ApprovalProgress } from "../../permissions";
import { FeaturePicker } from "../Features/FeaturePicker";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { ProposalEdges } from "./ProposalEdges";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import {
  isPlaceholderEntityId,
  type CreatePlanProposalUpdates,
  type ProposalItemStatus,
} from "./types";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { getEntry, setNewEntityId } from "./proposalSelectedStateCache";
import { ProposalTitle } from "./ProposalTitle";
import { useProposalHeaderTypeResolution } from "./proposalHeaderType";

/**
 * Renders a plan-creation proposal: a `plan-from-design-doc` workflow
 * conversation that materializes a new plan from a design-doc markdown
 * payload. The markdown is displayed read-only at its natural full height
 * via `MarkdownRenderer`; approving generates the plan from that markdown.
 */
export const PlanCreateRenderer: React.FC<{
  proposal: ProposalResponseDto & { updates: CreatePlanProposalUpdates };
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
  const { updates } = proposal;
  const pathService = usePathService();

  const planTitle = updates.planTitle?.trim() || "Untitled plan";
  const markdown = updates.designDocMarkdown ?? "";

  const [parentFeatureId, setParentFeatureId] = useState<string | null>(
    updates.parentFeatureId ?? null
  );

  const [resolvedEntityId, setResolvedEntityId] = useState(
    () => getEntry(proposal.id)?.newEntityId ?? proposal.targetEntityId
  );
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

  const conversationResolved =
    status.state === "applied" && !isPlaceholderEntityId(resolvedEntityId);

  const { data: conversation } = useConversation(
    proposal.organizationId,
    proposal.projectId,
    { conversationId: resolvedEntityId },
    {
      enabled: conversationResolved,
      enablePolling: false,
    }
  );

  const planId =
    conversationResolved &&
    conversation?.workflowAboutType === "plan" &&
    conversation.workflowAboutId
      ? conversation.workflowAboutId
      : null;
  const { presentation: typePresentation } = useProposalHeaderTypeResolution(
    proposal.organizationId,
    proposal.projectId,
    { kind: "entity", entityType: proposal.targetEntityType }
  );

  const pickerDisabled =
    disabled || status.state === "applying" || status.state === "applied";

  const handleParentFeatureChange = useCallback(
    (featureId: string | null) => {
      setParentFeatureId(featureId);
      const nextUpdates: CreatePlanProposalUpdates = {
        ...updates,
        parentFeatureId: featureId ?? undefined,
      };
      proposalsClient
        .updateProposal({
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
          proposalId: proposal.id,
          updateProposalDto: {
            updates: nextUpdates as unknown as ProposalUpdates,
          },
        })
        .catch(() => {});
    },
    [proposal.id, proposal.organizationId, proposal.projectId, updates]
  );

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={`Plan: ${planTitle}`}
          typePresentation={typePresentation}
          target={
            planId
              ? {
                  entityId: planId,
                  entityType: TargetEntityType.Task,
                  href: pathService.plan({
                    projectId: proposal.projectId,
                    planId,
                  }),
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
      {markdown ? (
        <MarkdownRenderer allowMentionEscapes>{markdown}</MarkdownRenderer>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No design doc markdown.
        </Typography>
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
      <FeaturePicker
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
        label="Parent feature"
        value={parentFeatureId}
        onChange={handleParentFeatureChange}
        disabled={pickerDisabled}
      />
      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={status}
            action={ProposalAction.Create}
            onApply={onApply}
            onReject={onReject}
            disabled={disabled}
            approvalProgress={approvalProgress}
            applyLabel="Approve plan document"
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
