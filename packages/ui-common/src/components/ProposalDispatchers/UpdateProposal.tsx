import { FutureGraphReview } from "./FutureGraphReview";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import type { ProposalResponseDto, WorkItemTypeDefinitionDto } from "../../api";
import {
  ProposalAction,
  ProposalStatus,
  WorkItemChangeSetMaterializationState,
} from "../../api";
import type { ProposalApprovalRequest, UpdateProposalProps } from "./types";
import {
  isUpdateTaskUpdates,
  isUpdateDesignDocUpdates,
  isUpdateWorkItemTypeUpdates,
  isUpdateWorkflowTaskUpdates,
  isWorkItemGraphProposal,
} from "./types";
import { useProposalState } from "./useProposalState";
import { useEntityData } from "./useEntityData";
import { TaskUpdateRenderer } from "./TaskUpdateRenderer";
import { DesignDocUpdateRenderer } from "./DesignDocUpdateRenderer";
import { WorkflowProposalRenderer } from "./WorkflowProposalRenderer";
import { getApprovalProgress } from "../../permissions";
import { InteractionComponent } from "../InteractionComponent";
import { getProposalRenderOverrides } from "./proposalRenderOverrides";
import { ProposalPresentationContext } from "./ProposalPresentationContext";
import { WorkItemTypeLifecycleRenderer } from "./WorkItemTypeLifecycleRenderer";
import { useMarkWorkItemTypeDataStale } from "../../data/hooks/useWorkItemTypeLifecycle";
import { WorkItemGraphProposalRenderer } from "./WorkItemGraphProposalRenderer";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { RejectedProposalCard } from "./RejectedProposalCard";
import { EdgeOnlyUpdateRenderer } from "./EdgeOnlyUpdateRenderer";
import { isEdgeOnlyUpdateProposal } from "./types";
import { getProposalDisplayTitle } from "./getProposalDisplayTitle";
import { definesVisualSections } from "./isVisualProposal";
import { MentionExpansionProvider } from "../shared/MentionExpansionContext";
import {
  ProposalOutOfDateReview,
  ProposalStateIndicator,
} from "./ProposalStateIndicator";
import {
  futureAsUpdateProposal,
  futureBaselineContent,
  isFutureProposal,
} from "./futureAsUpdate";
import { FutureApplyFooter } from "./FutureApplyFooter";
import type { EntityData } from "./useEntityData";

/**
 * Dispatcher component for UPDATE proposals. Loads existing entity data
 * on mount, then routes to the appropriate diff renderer based on
 * targetEntityType.
 */
export const UpdateProposal: React.FC<UpdateProposalProps> = ({
  proposals,
  onApply,
  onApplied,
  onReject,
  organizationId,
  projectId,
  disabled,
  allProposals,
  diffDefaultViewMode,
  renderMode,
}) => {
  const isEvaluationOutput = renderMode === "evaluation-output";
  const { getState, applyItem, rejectItem } = useProposalState(proposals);
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();
  const {
    workItemTypes,
    isLoading: workItemTypesLoading,
    error: workItemTypesError,
  } = useWorkItemTypes(organizationId, { projectId });
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

  const entityProposals = useMemo(
    () =>
      proposals.filter(
        (proposal) =>
          !isWorkItemGraphProposal(proposal) &&
          !isEdgeOnlyUpdateProposal(proposal),
      ),
    [proposals],
  );

  const { entities, loading, error } = useEntityData(
    entityProposals,
    organizationId,
    projectId,
    renderMode === "evaluation-output" ? "retained" : "live",
  );

  const handleApply = useCallback(
    (id: string, approvalRequest: ProposalApprovalRequest = {}) => {
      // Approving a future only retains it; onApplied fires from its Apply.
      const isFuture = proposals.some(
        (proposal) => proposal.id === id && isFutureProposal(proposal),
      );
      applyItem(
        id,
        () => onApply(id, approvalRequest),
        isFuture ? undefined : onApplied,
      );
    },
    [applyItem, onApply, onApplied, proposals],
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
  const hasEdgeOnlyProposal = proposals.some(isEdgeOnlyUpdateProposal);
  const hasWorkItemGraphProposal = proposals.some(isWorkItemGraphProposal);

  if (proposals.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No update proposals available.
      </Typography>
    );
  }

  if (
    loading &&
    !hasRejectedProposal &&
    !hasEdgeOnlyProposal &&
    !hasWorkItemGraphProposal
  ) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (
    error &&
    !hasRejectedProposal &&
    !hasEdgeOnlyProposal &&
    !hasWorkItemGraphProposal
  ) {
    return <Alert severity="error">{error}</Alert>;
  }

  const content = (
    <Stack spacing={1.5}>
      {proposals.map((original) => {
        const status = getState(original.id);
        const liveEntity = entities[original.targetEntityId];
        // A future revision renders as an ordinary update against the content
        // it replaces; only its footer differs once approved.
        const future = isFutureProposal(original) ? original : undefined;
        const futureBaseline =
          future && liveEntity
            ? futureBaselineContent(future, liveEntity.data)
            : undefined;
        const entityData = (
          future && futureBaseline && liveEntity
            ? { type: liveEntity.type, data: futureBaseline }
            : liveEntity
        ) as EntityData | undefined;
        const proposal = future
          ? futureAsUpdateProposal(future, futureBaseline)
          : original;
        const futureNotice =
          future?.updates.operation === "CANCEL" ? (
            <Typography variant="body2" data-testid="future-cancel-notice">
              Cancels this approved change.
            </Typography>
          ) : future?.updates.operation === "REVISE" ? (
            <FutureGraphReview
              mutation={future.updates}
              organizationId={organizationId}
              projectId={projectId}
            />
          ) : undefined;
        // Approve → linked work → Apply is shown from the start; before
        // approval the ordinary Approve/Reject fills the first step.
        const futureFooter = !future ? undefined : original.status ===
          ProposalStatus.Approved ? (
          <FutureApplyFooter proposal={original} onApplied={onApplied} />
        ) : future.updates.operation === "REVISE" &&
          status.state !== "rejected" ? (
          <FutureApplyFooter
            proposal={original}
            approveControl={
              <ProposalStateIndicator
                status={status}
                action={ProposalAction.Update}
                onApply={() => handleApply(original.id)}
                onReject={
                  onReject
                    ? (reason: string) => handleReject(original.id, reason)
                    : undefined
                }
                disabled={disabled}
                approvalProgress={getApprovalProgress(
                  original.requiredApprovals,
                  original.approvals,
                )}
              />
            }
          />
        ) : undefined;
        const overrides = getProposalRenderOverrides(
          proposal.targetEntityType,
          renderMode,
        );
        const taskTypeKey =
          entityData?.type === "task" && isUpdateTaskUpdates(proposal)
            ? (proposal.updates.type ?? entityData.data.type)
            : entityData?.type === "task"
              ? entityData.data.type
              : undefined;
        const taskTypeDefinition = taskTypeKey
          ? workItemTypeDefinitionsByKey.get(taskTypeKey)
          : undefined;
        const interactionTitle = taskTypeDefinition
          ? `Update ${taskTypeDefinition.name}`
          : getProposalDisplayTitle(proposal);

        let rendered: React.ReactNode;
        if (isEdgeOnlyUpdateProposal(proposal)) {
          const approvalProgress = getApprovalProgress(
            proposal.requiredApprovals,
            proposal.approvals,
          );
          rendered = (
            <EdgeOnlyUpdateRenderer
              proposal={proposal}
              status={status}
              onApply={() => handleApply(proposal.id)}
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
        } else if (isWorkItemGraphProposal(proposal)) {
          const graphStatus =
            proposal.materialization?.state ===
            WorkItemChangeSetMaterializationState.Published
              ? { state: "applied" as const }
              : proposal.materialization?.state ===
                  WorkItemChangeSetMaterializationState.Applying
                ? { state: "applying" as const }
                : proposal.materialization?.lastError
                  ? {
                      state: "failed" as const,
                      error: proposal.materialization.lastError,
                      diagnostic: proposal.materialization.diagnostic,
                    }
                  : status;
          const approvalProgress = getApprovalProgress(
            proposal.requiredApprovals,
            proposal.approvals,
          );
          rendered = (
            <WorkItemGraphProposalRenderer
              proposal={proposal}
              organizationId={organizationId}
              projectId={projectId}
              status={graphStatus}
              onApply={() => handleApply(proposal.id)}
              onReject={
                onReject
                  ? (reason: string) => handleReject(proposal.id, reason)
                  : undefined
              }
              disabled={disabled}
              siblingProposals={siblingProposals}
              approvalProgress={approvalProgress}
              overrides={overrides}
              diffDefaultViewMode={diffDefaultViewMode}
            />
          );
        } else if (loading) {
          rendered = (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          );
        } else if (error) {
          rendered = <Alert severity="error">{error}</Alert>;
        } else if (isUpdateWorkItemTypeUpdates(proposal)) {
          const approvalProgress = getApprovalProgress(
            proposal.requiredApprovals,
            proposal.approvals,
          );
          rendered = (
            <WorkItemTypeLifecycleRenderer
              mode="edit"
              diffDefaultViewMode={diffDefaultViewMode}
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
        } else if (!entityData) {
          rendered = (
            <Alert severity="warning">
              {isEvaluationOutput
                ? "The original content was not saved with this evaluation output."
                : "Could not load the existing item for this update."}
            </Alert>
          );
        } else if (entityData.type === "task" && workItemTypesLoading) {
          rendered = (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          );
        } else if (entityData.type === "task" && workItemTypesError) {
          rendered = (
            <Alert severity="error">
              Failed to load the work-item type registry:{" "}
              {workItemTypesError.message}
            </Alert>
          );
        } else if (entityData.type === "task" && !taskTypeDefinition) {
          rendered = (
            <Alert severity="warning">
              The work-item type details are unavailable for this update.
            </Alert>
          );
        } else {
          const approvalProgress = getApprovalProgress(
            proposal.requiredApprovals,
            proposal.approvals,
          );

          if (
            isUpdateWorkflowTaskUpdates(proposal) &&
            entityData.type === "task" &&
            taskTypeDefinition
          ) {
            rendered = (
              <WorkflowProposalRenderer
                mode="update"
                proposal={proposal}
                existing={entityData.data}
                status={status}
                onApply={() => handleApply(proposal.id)}
                onReject={
                  onReject
                    ? (reason: string) => handleReject(proposal.id, reason)
                    : undefined
                }
                disabled={disabled}
                siblingProposals={siblingProposals}
                approvalProgress={approvalProgress}
                overrides={overrides}
                workItemTypeDefinition={taskTypeDefinition}
              />
            );
          } else if (
            isUpdateTaskUpdates(proposal) &&
            entityData.type === "task" &&
            taskTypeDefinition
          ) {
            rendered = (
              <TaskUpdateRenderer
                presentationAction={
                  future?.updates.operation === "REVISE"
                    ? ProposalAction.VersionedUpdate
                    : undefined
                }
                proposal={proposal}
                existing={entityData.data}
                status={status}
                onApply={() => handleApply(proposal.id)}
                onReject={
                  onReject
                    ? (reason: string) => handleReject(proposal.id, reason)
                    : undefined
                }
                disabled={disabled}
                siblingProposals={siblingProposals}
                approvalProgress={approvalProgress}
                diffDefaultViewMode={diffDefaultViewMode}
                overrides={overrides}
                workItemTypeDefinition={taskTypeDefinition}
                notice={futureNotice}
                footer={futureFooter}
              />
            );
          } else if (
            isUpdateDesignDocUpdates(proposal) &&
            entityData.type === "designDoc"
          ) {
            rendered = (
              <DesignDocUpdateRenderer
                presentationAction={
                  future?.updates.operation === "REVISE"
                    ? ProposalAction.VersionedUpdate
                    : undefined
                }
                proposal={proposal}
                existing={entityData.data}
                status={status}
                onApply={() => handleApply(proposal.id)}
                onReject={
                  onReject
                    ? (reason: string) => handleReject(proposal.id, reason)
                    : undefined
                }
                disabled={disabled}
                siblingProposals={siblingProposals}
                approvalProgress={approvalProgress}
                diffDefaultViewMode={diffDefaultViewMode}
                overrides={overrides}
                notice={futureNotice}
                footer={futureFooter}
              />
            );
          } else {
            rendered = (
              <Alert severity="warning">
                This proposal targets an unsupported item type.
              </Alert>
            );
          }
        }

        rendered = (
          <MentionExpansionProvider
            presentation={
              isWorkItemGraphProposal(proposal) ||
              isUpdateWorkflowTaskUpdates(proposal) ||
              definesVisualSections(taskTypeDefinition)
                ? "badge"
                : "card"
            }
          >
            {rendered}
          </MentionExpansionProvider>
        );

        if (renderMode === "group-member" || isEvaluationOutput) {
          return <React.Fragment key={proposal.id}>{rendered}</React.Fragment>;
        }

        return (
          <ProposalOutOfDateReview
            key={proposal.id}
            proposal={original}
            onApply={(request) =>
              isUpdateWorkItemTypeUpdates(proposal)
                ? handleWorkItemTypeApply(proposal, request)
                : handleApply(proposal.id, request)
            }
          >
            <InteractionComponent
              entityId={proposal.id}
              entityType="PROPOSAL"
              hasProposalSupport
              entityTitle={interactionTitle}
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
