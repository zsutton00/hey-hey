import { Alert, Box, Link, Paper, Stack, Typography } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ProposalAction, TargetEntityType } from "../../api";
import type {
  WorkItemChangeSetValidationRequest,
  WorkItemCreateOperation,
  ProposalResponseDto,
} from "../../api";
import { usePathService } from "../../contexts/PathServiceContext";
import { useProposal } from "../../data/hooks/useProposal";
import { useExistingPlanTasks } from "../../data/hooks/useExistingPlanTasks";
import { getApprovalProgress } from "../../permissions";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { useProposalState } from "./useProposalState";
import { RejectedProposalCard } from "./RejectedProposalCard";
import { ProposalEdges } from "./ProposalEdges";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import { ProposalTitle } from "./ProposalTitle";
import { useProposalHeaderTypeResolution } from "./proposalHeaderType";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import {
  isExistingTaskPlanProposal,
  isPlaceholderEntityId,
  type OnApplyProposal,
  type OnAppliedProposal,
  type OnRejectProposal,
} from "./types";

export function ExistingTaskPlanCreateRenderer({
  proposal: suppliedProposal,
  onApply,
  onApplied,
  onReject,
  disabled,
  siblingProposals,
  overrides,
}: {
  proposal: ProposalResponseDto & {
    updates: WorkItemChangeSetValidationRequest;
  };
  onApply: OnApplyProposal;
  onApplied?: OnAppliedProposal;
  onReject?: OnRejectProposal;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  overrides?: ProposalRenderOverrides;
}) {
  const { t } = useTranslation();
  const paths = usePathService();
  const { proposal: refreshed, refetch } = useProposal(
    suppliedProposal.organizationId,
    suppliedProposal.projectId,
    suppliedProposal.id,
  );
  const proposal =
    refreshed &&
    isExistingTaskPlanProposal(refreshed) &&
    refreshed.updatedAt >= suppliedProposal.updatedAt
      ? refreshed
      : suppliedProposal;
  const { getState, applyItem, rejectItem } = useProposalState([proposal]);
  const status = getState(proposal.id);
  const approvalProgress = getApprovalProgress(
    proposal.requiredApprovals,
    proposal.approvals,
  );
  useEffect(() => {
    if (status.state !== "applying") {
      return;
    }
    const timer = window.setInterval(() => {
      void refetch();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status.state, refetch]);
  const { updates: changeSet } = proposal;
  const plan = changeSet.operations.find(
    (op): op is WorkItemCreateOperation =>
      op.op === "workItem.create" && op.type === "PLAN",
  );
  const document = changeSet.operations.find(
    (op) => op.op === "designDoc.create",
  );
  const stageCreates = changeSet.operations.filter(
    (op): op is WorkItemCreateOperation =>
      op.op === "workItem.create" && op.type === "PLAN_STAGE",
  );
  const same = (
    a: import("../../api").WorkItemChangeSetIdentity,
    b: import("../../api").WorkItemChangeSetIdentity,
  ) =>
    a.refType === "temporary" &&
    b.refType === "temporary" &&
    a.tempId === b.tempId;
  const updates = {
    name: plan?.name,
    designDocMarkdown: document?.markdown,
    parentFeatureId:
      plan?.parent?.refType === "existing" ? plan.parent.id : undefined,
    stages: stageCreates.map((stage) => ({
      title: stage.name,
      taskIds: changeSet.operations.flatMap((op) =>
        op.op === "workItem.update" &&
        op.ref.refType === "existing" &&
        op.parent &&
        same(op.parent, stage.ref)
          ? [op.ref.id]
          : [],
      ),
    })),
    taskPrerequisites: changeSet.operations.flatMap((op) =>
      op.op === "relationship.create" &&
      op.edgeType === "DEPENDS_ON" &&
      op.source.refType === "existing" &&
      op.target.refType === "existing"
        ? [{ taskId: op.source.id, dependsOnTaskId: op.target.id }]
        : [],
    ),
  };
  const taskIds = updates.stages.flatMap((stage) => stage.taskIds);
  const prerequisites = updates.taskPrerequisites ?? [];
  const records = useExistingPlanTasks(
    proposal.organizationId,
    proposal.projectId,
    [
      ...(updates.parentFeatureId ? [updates.parentFeatureId] : []),
      ...taskIds,
      ...prerequisites.flatMap((entry) => [
        entry.taskId,
        entry.dependsOnTaskId,
      ]),
    ],
  );
  const { presentation } = useProposalHeaderTypeResolution(
    proposal.organizationId,
    proposal.projectId,
    { kind: "task", taskType: "PLAN" },
  );
  const completed =
    status.state === "applied" &&
    proposal.targetEntityType === TargetEntityType.Task &&
    !isPlaceholderEntityId(proposal.targetEntityId);

  function renderTask(id: string, existing = true) {
    const record = records.get(id);
    return (
      <Stack
        direction="row"
        spacing={1}
        alignItems="baseline"
        data-testid="existing-plan-task"
        data-task-id={id}
      >
        {existing && (
          <Typography variant="caption">
            {t("proposals.existingPlan.existingTask")}
          </Typography>
        )}
        {record?.state === "ready" ? (
          <>
            <Link
              href={paths.task({ projectId: proposal.projectId, taskId: id })}
              data-testid="existing-plan-task-link"
            >
              {record.task.name}
            </Link>
            {existing && (
              <Typography
                variant="caption"
                data-testid="existing-plan-task-status"
              >
                {record.task.status}
              </Typography>
            )}
          </>
        ) : (
          <Typography
            role={record?.state === "error" ? "alert" : "status"}
            data-testid="existing-plan-task-state"
          >
            {t(
              record?.state === "error"
                ? "proposals.existingPlan.readFailed"
                : record?.state === "unavailable"
                  ? "proposals.existingPlan.unavailable"
                  : "proposals.existingPlan.loading",
            )}
          </Typography>
        )}
      </Stack>
    );
  }

  const content = (
    <Stack spacing={1.5} data-testid="existing-task-plan-proposal">
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={updates.name}
          typePresentation={presentation}
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
          target={
            completed
              ? {
                  entityId: proposal.targetEntityId,
                  entityType: TargetEntityType.Task,
                  href: paths.plan({
                    projectId: proposal.projectId,
                    planId: proposal.targetEntityId,
                  }),
                }
              : undefined
          }
        />
      )}
      <Box data-testid="existing-plan-design">
        <MarkdownRenderer allowMentionEscapes>
          {updates.designDocMarkdown}
        </MarkdownRenderer>
      </Box>
      <Typography variant="subtitle2">
        {t("proposals.existingPlan.deliveryOrder")}
      </Typography>
      {updates.stages.map((stage, index) => (
        <Stack
          spacing={1}
          key={index}
          data-testid="existing-plan-stage"
          data-stage-index={index}
        >
          <Typography variant="subtitle2">
            {index + 1}. {stage.title}
          </Typography>
          {stage.taskIds.map((id) => (
            <Box key={id}>{renderTask(id)}</Box>
          ))}
        </Stack>
      ))}
      <Box data-testid="existing-plan-prerequisites">
        <Typography variant="subtitle2">
          {t("proposals.existingPlan.prerequisites")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("proposals.existingPlan.orderIsNotDependency")}
        </Typography>
        {prerequisites.length === 0 && (
          <Typography variant="body2">
            {t("proposals.existingPlan.noPrerequisites")}
          </Typography>
        )}
        {prerequisites.map((entry) => (
          <Stack key={`${entry.taskId}:${entry.dependsOnTaskId}`} spacing={0.5}>
            {renderTask(entry.taskId)}
            <Typography variant="caption">
              {t("proposals.existingPlan.dependsOn")}
            </Typography>
            <Box sx={{ pl: 2 }}>{renderTask(entry.dependsOnTaskId)}</Box>
          </Stack>
        ))}
      </Box>
      {siblingProposals && (
        <ProposalEdges
          edges={proposal.edges}
          siblingProposals={siblingProposals}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
          ownerApplied={completed}
        />
      )}
      <Box data-testid="existing-plan-parent">
        <Typography variant="caption">
          {t("proposals.existingPlan.parentFeature")}
        </Typography>
        {updates.parentFeatureId && renderTask(updates.parentFeatureId, false)}
      </Box>
      {status.state === "applied" && !completed && (
        <Alert severity="warning">
          {t("proposals.existingPlan.resultUnavailable")}
        </Alert>
      )}
      {!overrides?.hideStateIndicator && (
        <ProposalStateIndicator
          status={status}
          action={ProposalAction.Create}
          onApply={() => {
            void applyItem(proposal.id, onApply, onApplied);
          }}
          onReject={
            onReject
              ? (reason) => rejectItem(proposal.id, onReject, reason)
              : undefined
          }
          disabled={disabled}
          approvalProgress={approvalProgress}
          applyLabel={
            overrides?.applyLabel ?? t("proposals.existingPlan.approve")
          }
        />
      )}
    </Stack>
  );

  const card = overrides?.hideCard ? (
    content
  ) : (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        width: "100%",
        maxWidth: overrides?.maxWidth,
        border: overrides?.border,
      }}
    >
      {content}
    </Paper>
  );
  return (
    <RejectedProposalCard proposal={proposal} status={status}>
      {card}
    </RejectedProposalCard>
  );
}
