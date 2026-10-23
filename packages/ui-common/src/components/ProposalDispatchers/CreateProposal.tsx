import { Box, Paper, Stack, Typography } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import { ProposalAction } from "../../api";
import type { ProposalResponseDto, WorkItemTypeDefinitionDto } from "../../api";
import type { CreateProposalProps } from "./types";
import {
  isCreatePlanProposal,
  isCreateTaskUpdates,
  isCreateWorkflowTaskUpdates,
  isCreateDesignDocUpdates,
  isCreateWorkItemTypeUpdates,
  isWorkItemGraphProposal,
  getProposalMaterializationStatus,
} from "./types";
import { useProposalState } from "./useProposalState";
import { useMarkWorkItemTypeDataStale } from "../../data/hooks/useWorkItemTypeLifecycle";
import { TaskCreateRenderer } from "./TaskCreateRenderer";
import { DesignDocCreateRenderer } from "./DesignDocCreateRenderer";
import { WorkItemTypeCreateRenderer } from "./WorkItemTypeCreateRenderer";
import { PlanCreateRenderer } from "./PlanCreateRenderer";
import { WorkflowProposalRenderer } from "./WorkflowProposalRenderer";
import { getApprovalProgress } from "../../permissions";
import { InteractionComponent } from "../InteractionComponent";
import { ProposalEdges } from "./ProposalEdges";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import type { ApprovalProgress } from "../../permissions";
import type { ProposalItemStatus } from "./types";
import { getProposalRenderOverrides } from "./proposalRenderOverrides";
import { ProposalPresentationContext } from "./ProposalPresentationContext";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { getProposalDisplayTitle } from "./getProposalDisplayTitle";
import { groupProposals } from "./proposalStepperConfig";
import { ProposalStepper } from "./ProposalStepper";
import { RejectedProposalCard } from "./RejectedProposalCard";
import { ProposalTitle } from "./ProposalTitle";
import { useProposalHeaderTypeResolution } from "./proposalHeaderType";
import { WorkItemGraphProposalRenderer } from "./WorkItemGraphProposalRenderer";
import { resolveProposalTaskType } from "./proposalHeaderType";
import { definesVisualSections } from "./isVisualProposal";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { MentionExpansionProvider } from "../shared/MentionExpansionContext";

/**
 * Dispatcher component for CREATE proposals. Inspects the targetEntityType
 * and routes to the appropriate specialized renderer.
 */
function readSummary(proposal: ProposalResponseDto): string | null {
  const updates = proposal.updates as Record<string, unknown> | null;
  if (!updates) return null;
  for (const key of ["summary", "description"]) {
    const value = updates[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

const GenericCreateProposalFallback: React.FC<{
  proposal: ProposalResponseDto;
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
  const summary = readSummary(proposal);
  const name = getProposalDisplayTitle(proposal);
  const { presentation: typePresentation } = useProposalHeaderTypeResolution(
    proposal.organizationId,
    proposal.projectId,
    { kind: "entity", entityType: proposal.targetEntityType },
  );

  const paperSx: Record<string, unknown> =
    overrides?.maxWidth !== undefined
      ? { p: 2, width: "100%", maxWidth: overrides.maxWidth }
      : { p: 2 };
  if (overrides?.border) {
    paperSx.border = overrides.border;
  }

  const titleSx = overrides?.titleFontSize
    ? { fontSize: overrides.titleFontSize }
    : undefined;

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={name}
          typePresentation={typePresentation}
          target={
            status.state === "applied"
              ? { entityId: proposal.targetEntityId }
              : undefined
          }
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={titleSx}
        />
      )}
      {summary && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: "pre-wrap" }}
        >
          {summary}
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
      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={status}
            action={ProposalAction.Create}
            onApply={onApply}
            onReject={onReject}
            disabled={disabled}
            approvalProgress={approvalProgress}
            applyLabel={overrides?.applyLabel}
          />
        </Box>
      )}
    </Stack>
  );

  return overrides?.hideCard ? (
    content
  ) : (
    <Paper variant="outlined" sx={paperSx}>
      {content}
    </Paper>
  );
};

export const CreateProposal: React.FC<CreateProposalProps> = ({
  proposals,
  onApply,
  onApplied,
  onReject,
  disabled,
  allProposals,
  renderMode,
}) => {
  const { getState, applyItem, rejectItem } = useProposalState(proposals);
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();
  const { workItemTypes } = useWorkItemTypes(proposals[0]?.organizationId, {
    projectId: proposals[0]?.projectId,
  });
  const workItemTypeDefinitionsByKey = useMemo(
    () =>
      new Map<string, WorkItemTypeDefinitionDto>(
        workItemTypes.map(({ definition }) => [definition.key, definition]),
      ),
    [workItemTypes],
  );

  const siblingProposals = useMemo(
    () =>
      new Map<string, ProposalResponseDto>(
        (allProposals ?? proposals).map((p) => [p.id, p]),
      ),
    [allProposals, proposals],
  );

  const handleApply = useCallback(
    (id: string) => {
      applyItem(id, onApply, async (proposalId) => {
        const proposal = proposals.find((item) => item.id === proposalId);
        if (proposal && isCreateWorkItemTypeUpdates(proposal)) {
          markWorkItemTypeDataStale(
            proposal.organizationId,
            proposal.projectId,
            proposal.updates.key,
          );
        }
        await onApplied?.(proposalId);
      });
    },
    [applyItem, onApply, onApplied, proposals, markWorkItemTypeDataStale],
  );

  const handleReject = useCallback(
    async (id: string, reason: string) => {
      if (!onReject) return;
      await rejectItem(id, onReject, reason);
    },
    [onReject, rejectItem],
  );

  const getStepperItemState = useCallback(
    (id: string) => {
      const proposal = proposals.find((item) => item.id === id);
      if (proposal && isWorkItemGraphProposal(proposal)) {
        return getProposalMaterializationStatus(proposal) ?? getState(id);
      }
      return getState(id);
    },
    [getState, proposals],
  );

  const renderProposalCard = useCallback(
    (proposal: ProposalResponseDto): React.ReactNode => {
      const status = getState(proposal.id);
      const approvalProgress = getApprovalProgress(
        proposal.requiredApprovals,
        proposal.approvals,
      );
      const overrides = getProposalRenderOverrides(
        proposal.targetEntityType,
        renderMode,
      );
      const rejectHandler = onReject
        ? (reason: string) => handleReject(proposal.id, reason)
        : undefined;

      let rendered: React.ReactNode;
      if (isWorkItemGraphProposal(proposal)) {
        const graphStatus =
          getProposalMaterializationStatus(proposal) ?? status;
        rendered = (
          <WorkItemGraphProposalRenderer
            proposal={proposal}
            organizationId={proposal.organizationId}
            projectId={proposal.projectId}
            status={graphStatus}
            onApply={() => handleApply(proposal.id)}
            onReject={rejectHandler}
            disabled={disabled}
            siblingProposals={siblingProposals}
            approvalProgress={approvalProgress}
            overrides={overrides}
          />
        );
      } else if (isCreatePlanProposal(proposal)) {
        rendered = (
          <PlanCreateRenderer
            proposal={proposal}
            status={status}
            onApply={() => handleApply(proposal.id)}
            onReject={rejectHandler}
            disabled={disabled}
            siblingProposals={siblingProposals}
            approvalProgress={approvalProgress}
            overrides={overrides}
          />
        );
      } else if (isCreateWorkflowTaskUpdates(proposal)) {
        rendered = (
          <WorkflowProposalRenderer
            mode="create"
            proposal={proposal}
            status={status}
            onApply={() => handleApply(proposal.id)}
            onReject={rejectHandler}
            disabled={disabled}
            siblingProposals={siblingProposals}
            approvalProgress={approvalProgress}
            overrides={overrides}
          />
        );
      } else if (isCreateTaskUpdates(proposal)) {
        rendered = (
          <TaskCreateRenderer
            proposal={proposal}
            status={status}
            onApply={() => handleApply(proposal.id)}
            onReject={rejectHandler}
            disabled={disabled}
            siblingProposals={siblingProposals}
            approvalProgress={approvalProgress}
            overrides={overrides}
          />
        );
      } else if (isCreateWorkItemTypeUpdates(proposal)) {
        rendered = (
          <WorkItemTypeCreateRenderer
            proposal={proposal}
            status={status}
            onApply={() => handleApply(proposal.id)}
            onReject={rejectHandler}
            disabled={disabled}
            siblingProposals={siblingProposals}
            approvalProgress={approvalProgress}
            overrides={overrides}
          />
        );
      } else if (isCreateDesignDocUpdates(proposal)) {
        rendered = (
          <DesignDocCreateRenderer
            proposal={proposal}
            status={status}
            onApply={() => handleApply(proposal.id)}
            onReject={rejectHandler}
            disabled={disabled}
            siblingProposals={siblingProposals}
            approvalProgress={approvalProgress}
            overrides={overrides}
          />
        );
      } else {
        rendered = (
          <GenericCreateProposalFallback
            proposal={proposal}
            status={status}
            onApply={() => handleApply(proposal.id)}
            onReject={rejectHandler}
            disabled={disabled}
            siblingProposals={siblingProposals}
            approvalProgress={approvalProgress}
            overrides={overrides}
          />
        );
      }

      const taskTypeKey = isCreateTaskUpdates(proposal)
        ? resolveProposalTaskType(proposal)
        : undefined;
      rendered = (
        <MentionExpansionProvider
          presentation={
            isWorkItemGraphProposal(proposal) ||
            isCreateWorkflowTaskUpdates(proposal) ||
            definesVisualSections(
              taskTypeKey
                ? workItemTypeDefinitionsByKey.get(taskTypeKey)
                : undefined,
            )
              ? "badge"
              : "card"
          }
        >
          {rendered}
        </MentionExpansionProvider>
      );

      return renderMode === "group-member" ? (
        rendered
      ) : (
        <RejectedProposalCard proposal={proposal} status={status}>
          {rendered}
        </RejectedProposalCard>
      );
    },
    [
      disabled,
      getState,
      handleApply,
      handleReject,
      onReject,
      renderMode,
      siblingProposals,
      workItemTypeDefinitionsByKey,
    ],
  );

  if (proposals.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No creation proposals available.
      </Typography>
    );
  }

  if (renderMode === "group-member") {
    return (
      <>
        {proposals.map((proposal) => (
          <React.Fragment key={proposal.id}>
            {renderProposalCard(proposal)}
          </React.Fragment>
        ))}
      </>
    );
  }

  if (renderMode === "evaluation-output") {
    // Saved eval output: each proposal on its own, with no stepper or
    // interaction shell that could offer approval.
    return (
      <ProposalPresentationContext.Provider value="evaluation-output">
        <Stack spacing={1.5}>
          {proposals.map((proposal) => (
            <React.Fragment key={proposal.id}>
              {renderProposalCard(proposal)}
            </React.Fragment>
          ))}
        </Stack>
      </ProposalPresentationContext.Provider>
    );
  }

  // Single-proposal payloads (e.g. ProposalDetail) intentionally fall through
  // to the standalone-card path below: groupProposals returns a `single` unit
  // for them regardless of any minGroupSize entry, so the stepper never wraps
  // a length-1 array.
  const units = groupProposals(proposals);

  return (
    <Stack spacing={1.5}>
      {units.map((unit) => {
        if (unit.kind === "group") {
          const key = `group-${unit.proposals.map((p) => p.id).join("-")}`;
          return (
            <ProposalStepper
              key={key}
              proposals={unit.proposals}
              getItemState={getStepperItemState}
              onApply={handleApply}
              disabled={disabled}
              renderProposal={(proposal) => (
                <InteractionComponent
                  key={proposal.id}
                  entityId={proposal.id}
                  entityType="PROPOSAL"
                  hasProposalSupport
                  entityTitle={getProposalDisplayTitle(proposal)}
                  organizationId={proposal.organizationId}
                  projectId={proposal.projectId}
                  draggable={false}
                >
                  {renderProposalCard(proposal)}
                </InteractionComponent>
              )}
            />
          );
        }

        const proposal = unit.proposal;
        return (
          <InteractionComponent
            key={proposal.id}
            entityId={proposal.id}
            entityType="PROPOSAL"
            hasProposalSupport
            entityTitle={getProposalDisplayTitle(proposal)}
            organizationId={proposal.organizationId}
            projectId={proposal.projectId}
            draggable={false}
          >
            {renderProposalCard(proposal)}
          </InteractionComponent>
        );
      })}
    </Stack>
  );
};
