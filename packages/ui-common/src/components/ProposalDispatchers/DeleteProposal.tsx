import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import { ProposalAction, TargetEntityType } from "../../api";
import type { ProposalResponseDto, WorkItemTypeDefinitionDto } from "../../api";
import type { DeleteProposalProps, ProposalApprovalRequest } from "./types";
import { isArchiveWorkItemTypeUpdates } from "./types";
import { useProposalState } from "./useProposalState";
import { useEntityData } from "./useEntityData";
import type { EntityData } from "./useEntityData";
import { getApprovalProgress } from "../../permissions";
import { InteractionComponent } from "../InteractionComponent";
import { ProposalEdges } from "./ProposalEdges";
import {
  ProposalStateIndicator,
  ProposalOutOfDateReview,
} from "./ProposalStateIndicator";
import { getProposalRenderOverrides } from "./proposalRenderOverrides";
import { ProposalPresentationContext } from "./ProposalPresentationContext";
import { getProposalDisplayTitle } from "./getProposalDisplayTitle";
import { getEntityIcon } from "../../utils/entityIcons";
import { WorkItemTypeLifecycleRenderer } from "./WorkItemTypeLifecycleRenderer";
import { useMarkWorkItemTypeDataStale } from "../../data/hooks/useWorkItemTypeLifecycle";
import { RejectedProposalCard } from "./RejectedProposalCard";
import { definesVisualSections } from "./isVisualProposal";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { MentionExpansionProvider } from "../shared/MentionExpansionContext";
import { ProposalTitle } from "./ProposalTitle";
import {
  resolveProposalTaskType,
  useProposalHeaderTypeResolution,
} from "./proposalHeaderType";

function taskEntityLabel(entityData: EntityData | undefined): string | null {
  if (entityData?.type !== "task") {
    return null;
  }
  if (entityData.data.type === "workflow") {
    return "workflow";
  }
  if (entityData.data.type === "workflow_step") {
    return "workflow step";
  }
  return null;
}

/** Human-readable lower-case label for the deletion note, e.g. "plan step". */
function humanEntityLabel(
  targetEntityType: TargetEntityType,
  entityData: EntityData | undefined,
): string {
  const taskLabel = taskEntityLabel(entityData);
  if (taskLabel) {
    return taskLabel;
  }
  return targetEntityType.toLowerCase().replace(/_/g, " ");
}

/** Title resolved from a previously-fetched entity, when one is available. */
function entityDataTitle(entityData: EntityData | undefined): string | null {
  if (!entityData) return null;
  return entityData.data.name?.trim() ? entityData.data.name : null;
}

const DeleteProposalHeader: React.FC<{
  proposal: ProposalResponseDto;
  entityData: EntityData | undefined;
  organizationId: string;
  projectId: string;
  title: string;
  titleSx?: SxProps<Theme>;
  hideTypeChip?: boolean;
}> = ({
  proposal,
  entityData,
  organizationId,
  projectId,
  title,
  titleSx,
  hideTypeChip,
}) => {
  const isTask = proposal.targetEntityType === TargetEntityType.Task;
  const loadedTaskType =
    entityData?.type === "task" ? entityData.data.type : undefined;
  const taskType = isTask
    ? resolveProposalTaskType(proposal, loadedTaskType)
    : undefined;
  const { presentation } = useProposalHeaderTypeResolution(
    organizationId,
    projectId,
    isTask
      ? { kind: "task", taskType }
      : { kind: "entity", entityType: proposal.targetEntityType },
  );
  const resolvedPresentation =
    isTask && !loadedTaskType
      ? {
          kind: "available" as const,
          label: TargetEntityType.Task,
          Icon: getEntityIcon(TargetEntityType.Task),
        }
      : presentation;

  return (
    <ProposalTitle
      proposal={proposal}
      resolvedTargetName={title}
      typePresentation={resolvedPresentation}
      titleSx={titleSx}
      hideTypeChip={hideTypeChip}
    />
  );
};

/**
 * Dispatcher component for DELETE proposals. Every target entity type renders
 * through one shared card: the shared proposal identity header, the resolved
 * title with a struck-through "will be deleted" treatment, and the
 * Approve/Reject controls.
 * The entity fetch is best-effort — the card still renders (falling back to
 * the proposal's own title snapshot) when the lookup fails.
 */
export const DeleteProposal: React.FC<DeleteProposalProps> = ({
  proposals,
  onApply,
  onApplied,
  onReject,
  organizationId,
  projectId,
  disabled,
  allProposals,
  renderMode,
}) => {
  const isEvaluationOutput = renderMode === "evaluation-output";
  const { getState, applyItem, rejectItem } = useProposalState(proposals);
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();
  const { workItemTypes } = useWorkItemTypes(organizationId, { projectId });
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

  const { entities, loading } = useEntityData(
    proposals,
    organizationId,
    projectId,
    renderMode === "evaluation-output" ? "retained" : "live",
  );

  const handleApply = useCallback(
    (id: string, approvalRequest: ProposalApprovalRequest = {}) => {
      applyItem(id, () => onApply(id, approvalRequest), onApplied);
    },
    [applyItem, onApply, onApplied],
  );

  const handleReject = useCallback(
    async (id: string, reason: string) => {
      if (!onReject) return;
      await rejectItem(id, onReject, reason);
    },
    [onReject, rejectItem],
  );

  const handleWorkItemTypeApply = useCallback(
    (
      proposal: ProposalResponseDto,
      approvalRequest: ProposalApprovalRequest = {},
    ) => {
      applyItem(
        proposal.id,
        () => onApply(proposal.id, approvalRequest),
        async (proposalId) => {
          markWorkItemTypeDataStale(
            organizationId,
            projectId,
            proposal.targetEntityId,
          );
          await onApplied?.(proposalId);
        },
      );
    },
    [
      applyItem,
      markWorkItemTypeDataStale,
      onApply,
      onApplied,
      organizationId,
      projectId,
    ],
  );

  const hasRejectedProposal = proposals.some(
    (proposal) => getState(proposal.id).state === "rejected",
  );

  if (proposals.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No deletion proposals available.
      </Typography>
    );
  }

  // The entity fetch only sharpens the title; render a spinner while it runs,
  // but never block the card on a failed lookup.
  if (loading && !hasRejectedProposal) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const content = (
    <Stack spacing={1.5}>
      {proposals.map((proposal) => {
        const status = getState(proposal.id);
        const overrides = getProposalRenderOverrides(
          proposal.targetEntityType,
          renderMode,
        );
        const entityData = entities[proposal.targetEntityId];

        const approvalProgress = getApprovalProgress(
          proposal.requiredApprovals,
          proposal.approvals,
        );

        if (loading) {
          const loadingContent = (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          );
          if (renderMode === "group-member" || isEvaluationOutput) {
            return (
              <React.Fragment key={proposal.id}>
                {loadingContent}
              </React.Fragment>
            );
          }
          return (
            <ProposalOutOfDateReview
              key={proposal.id}
              proposal={proposal}
              onApply={(request) =>
                isArchiveWorkItemTypeUpdates(proposal)
                  ? handleWorkItemTypeApply(proposal, request)
                  : handleApply(proposal.id, request)
              }
            >
              <InteractionComponent
                entityId={proposal.id}
                entityType="PROPOSAL"
                hasProposalSupport
                entityTitle={getProposalDisplayTitle(proposal)}
                organizationId={organizationId}
                projectId={projectId}
                draggable={false}
              >
                <RejectedProposalCard proposal={proposal} status={status}>
                  {loadingContent}
                </RejectedProposalCard>
              </InteractionComponent>
            </ProposalOutOfDateReview>
          );
        }

        if (isArchiveWorkItemTypeUpdates(proposal)) {
          const lifecycle = (
            <WorkItemTypeLifecycleRenderer
              mode="archive"
              proposal={proposal}
              organizationId={organizationId}
              projectId={projectId}
              status={status}
              onApply={() => handleWorkItemTypeApply(proposal)}
              onReject={
                onReject
                  ? (reason: string) => handleReject(proposal.id, reason)
                  : undefined
              }
              disabled={disabled}
              siblingProposals={siblingProposals}
              approvalProgress={approvalProgress}
              overrides={overrides}
            />
          );
          if (renderMode === "group-member" || isEvaluationOutput) {
            return (
              <React.Fragment key={proposal.id}>{lifecycle}</React.Fragment>
            );
          }
          return (
            <ProposalOutOfDateReview
              key={proposal.id}
              proposal={proposal}
              onApply={(request) => handleWorkItemTypeApply(proposal, request)}
            >
              <InteractionComponent
                entityId={proposal.id}
                entityType="PROPOSAL"
                hasProposalSupport
                entityTitle={getProposalDisplayTitle(proposal)}
                organizationId={organizationId}
                projectId={projectId}
                draggable={false}
              >
                <RejectedProposalCard proposal={proposal} status={status}>
                  {lifecycle}
                </RejectedProposalCard>
              </InteractionComponent>
            </ProposalOutOfDateReview>
          );
        }

        const snapshotTitle =
          typeof proposal.title === "string" && proposal.title.trim().length > 0
            ? proposal.title
            : null;
        const resolvedTitle =
          snapshotTitle ??
          entityDataTitle(entityData) ??
          getProposalDisplayTitle(proposal);

        const paperSx: Record<string, unknown> =
          overrides.maxWidth !== undefined
            ? { p: 2, width: "100%", maxWidth: overrides.maxWidth }
            : { p: 2 };
        if (overrides.border) {
          paperSx.border = overrides.border;
        }

        const titleSx = overrides.titleFontSize
          ? { fontSize: overrides.titleFontSize }
          : undefined;

        const cardContent = (
          <Stack spacing={1.5}>
            {!overrides.hideHeader && (
              <DeleteProposalHeader
                proposal={proposal}
                entityData={entityData}
                organizationId={organizationId}
                projectId={projectId}
                title={resolvedTitle}
                titleSx={titleSx}
                hideTypeChip={overrides.hideTypeChip}
              />
            )}
            <Typography variant="body2" color="error">
              {`This ${humanEntityLabel(
                proposal.targetEntityType,
                entityData,
              )} will be deleted.`}
            </Typography>
            <ProposalEdges
              edges={proposal.edges}
              siblingProposals={siblingProposals}
              organizationId={proposal.organizationId}
              projectId={proposal.projectId}
              ownerApplied={status.state === "applied"}
            />
            {!overrides.hideStateIndicator && (
              <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                <ProposalStateIndicator
                  status={status}
                  action={ProposalAction.Delete}
                  onApply={() => handleApply(proposal.id)}
                  onReject={
                    onReject
                      ? (reason: string) => handleReject(proposal.id, reason)
                      : undefined
                  }
                  disabled={disabled}
                  approvalProgress={approvalProgress}
                />
              </Box>
            )}
          </Stack>
        );
        const loadedTaskType =
          entityData?.type === "task" ? entityData.data.type : undefined;
        const rendered = (
          <MentionExpansionProvider
            presentation={
              definesVisualSections(
                loadedTaskType
                  ? workItemTypeDefinitionsByKey.get(loadedTaskType)
                  : undefined,
              )
                ? "badge"
                : "card"
            }
          >
            {overrides.hideCard ? (
              cardContent
            ) : (
              <Paper variant="outlined" sx={paperSx}>
                {cardContent}
              </Paper>
            )}
          </MentionExpansionProvider>
        );
        if (renderMode === "group-member" || isEvaluationOutput) {
          return <React.Fragment key={proposal.id}>{rendered}</React.Fragment>;
        }
        return (
          <ProposalOutOfDateReview
            key={proposal.id}
            proposal={proposal}
            onApply={(request) =>
              isArchiveWorkItemTypeUpdates(proposal)
                ? handleWorkItemTypeApply(proposal, request)
                : handleApply(proposal.id, request)
            }
          >
            <InteractionComponent
              entityId={proposal.id}
              entityType="PROPOSAL"
              hasProposalSupport
              entityTitle={getProposalDisplayTitle(proposal)}
              organizationId={organizationId}
              projectId={projectId}
              draggable={false}
            >
              <RejectedProposalCard proposal={proposal} status={status}>
                {rendered}
              </RejectedProposalCard>
            </InteractionComponent>
          </ProposalOutOfDateReview>
        );
      })}
    </Stack>
  );

  return isEvaluationOutput ? (
    <ProposalPresentationContext.Provider value="evaluation-output">
      {content}
    </ProposalPresentationContext.Provider>
  ) : (
    content
  );
};
