import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  ProposalReconciliationReview,
  ProposalReconciliationContext,
} from "../ProposalReconciliation/ProposalReconciliationReview";
import {
  Alert,
  Button,
  Chip,
  Collapse,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ProposalAction,
  ProposalApprovalType,
  ProposalGroupMemberExecutionState,
  ProposalStatus,
  TargetEntityType,
  type ProposalGroupMemberSnapshot,
  type ProposalResponseDto,
} from "../../api";
import { useAuth } from "../../contexts/AuthContext";
import { usePathService } from "../../contexts/PathServiceContext";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { getMemberActionability } from "./memberActionability";
import {
  formatApprovalProgress,
  formatExecutionStatus,
  isWaitingForApproval,
} from "./proposalGroupStatusText";
import {
  CreateProposal,
  DeleteProposal,
  getProposalDisplayTitle,
  UpdateProposal,
} from "../ProposalDispatchers";
import { ProposalTitle } from "../ProposalDispatchers/ProposalTitle";
import { updateProposalTitleLinkSx } from "../ProposalDispatchers/updateProposalTitleLinkSx";
import {
  resolveProposalTaskType,
  useProposalHeaderTypeResolution,
} from "../ProposalDispatchers/proposalHeaderType";
import { getProposalRenderOverrides } from "../ProposalDispatchers/proposalRenderOverrides";
import { ProposalFailureDiagnostic } from "../ProposalDispatchers/ProposalFailureDiagnostic";
import { FutureApplyFooter } from "../ProposalDispatchers/FutureApplyFooter";

export interface ProposalGroupMemberReviewProps {
  member: ProposalGroupMemberSnapshot;
  members: ProposalGroupMemberSnapshot[];
  decisionProposal?: ProposalResponseDto;
  decisionOverride?: Exclude<MemberDecision, null>;
  organizationId: string;
  projectId: string;
  onApprove: (proposalId: string) => Promise<unknown>;
  onReject: (proposalId: string, reason: string) => Promise<unknown>;
  isDeciding: boolean;
}

const formatTimestamp = (value: string): string =>
  new Date(value).toLocaleString();

type MemberDecision = "approved" | "rejected" | null;

const getMemberDecision = (
  proposal: ProposalResponseDto,
  currentUserId: string | undefined,
): MemberDecision => {
  if (!currentUserId) return null;

  const latestDecision = (proposal.approvals ?? [])
    .filter(({ userId }) => userId === currentUserId)
    .reduce<(typeof proposal.approvals)[number] | undefined>(
      (latest, candidate) =>
        !latest || candidate.createdAt > latest.createdAt ? candidate : latest,
      undefined,
    );

  if (latestDecision?.type === ProposalApprovalType.Approval) {
    return "approved";
  }
  if (latestDecision?.type === ProposalApprovalType.Rejection) {
    return "rejected";
  }
  return null;
};

const MemberHeader: React.FC<{
  member: ProposalGroupMemberSnapshot;
  organizationId: string;
  projectId: string;
  contentExpanded: boolean;
  onToggleContent: () => void;
  canToggleContent: boolean;
}> = ({
  member,
  organizationId,
  projectId,
  contentExpanded,
  onToggleContent,
  canToggleContent,
}) => {
  const proposal = member.proposal;
  const pathService = usePathService();
  const isTaskProposal = proposal.targetEntityType === TargetEntityType.Task;
  const isExistingTask =
    isTaskProposal && proposal.action !== ProposalAction.Create;
  const { workItem, isLoading: workItemLoading } = useWorkItem(
    organizationId,
    "task",
    proposal.targetEntityId,
    { projectId, enabled: isExistingTask },
  );
  const resolvedTaskType = isTaskProposal
    ? resolveProposalTaskType(proposal, workItem?.type)
    : undefined;
  const { presentation: typePresentation } = useProposalHeaderTypeResolution(
    organizationId,
    projectId,
    isTaskProposal
      ? { kind: "task", taskType: resolvedTaskType }
      : { kind: "entity", entityType: proposal.targetEntityType },
  );
  const resolvedTypePresentation =
    isTaskProposal && workItemLoading
      ? { kind: "loading" as const }
      : typePresentation;
  const headerTypePresentation = resolvedTypePresentation;
  const href = isTaskProposal
    ? resolvedTaskType === "FEATURE"
      ? pathService.feature({ projectId, featureId: proposal.targetEntityId })
      : pathService.task({ projectId, taskId: proposal.targetEntityId })
    : undefined;
  const existingUpdateTarget =
    (proposal.action === ProposalAction.Update ||
      proposal.action === ProposalAction.VersionedUpdate) &&
    (!isTaskProposal || Boolean(workItem));
  const materializedCreateTarget =
    proposal.action === ProposalAction.Create &&
    member.executionState === ProposalGroupMemberExecutionState.Applied;
  const targetExists = existingUpdateTarget || materializedCreateTarget;
  const headerOverrides = getProposalRenderOverrides(proposal.targetEntityType);
  const titleSx = headerOverrides.titleFontSize
    ? { fontSize: headerOverrides.titleFontSize }
    : undefined;

  return (
    <ProposalTitle
      proposal={proposal}
      resolvedTargetName={getProposalDisplayTitle(proposal)}
      typePresentation={headerTypePresentation}
      target={
        targetExists
          ? {
              entityId: proposal.targetEntityId,
              entityType: proposal.targetEntityType,
              href,
              sx: { ...updateProposalTitleLinkSx, flex: 1 },
            }
          : undefined
      }
      typeTestId="proposal-group-member-type"
      hideTypeChip={headerOverrides.hideTypeChip}
      titleSx={titleSx}
      endAdornment={
        canToggleContent ? (
          <IconButton
            size="small"
            onClick={onToggleContent}
            aria-label={
              contentExpanded
                ? "Collapse accepted proposal"
                : "Expand accepted proposal"
            }
            aria-expanded={contentExpanded}
            data-testid="proposal-group-member-content-toggle"
            sx={{
              transform: contentExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        ) : undefined
      }
    />
  );
};

const ReadOnlyProposalContent: React.FC<{
  proposal: ProposalResponseDto;
  allProposals: ProposalResponseDto[];
  organizationId: string;
  projectId: string;
}> = ({ proposal, allProposals, organizationId, projectId }) => {
  const proposals = useMemo(() => [proposal], [proposal]);
  const onApply = async (): Promise<void> => undefined;

  if (proposal.action === ProposalAction.Create) {
    return (
      <CreateProposal
        proposals={proposals}
        allProposals={allProposals}
        onApply={onApply}
        disabled
        renderMode="group-member"
      />
    );
  }

  if (
    proposal.action === ProposalAction.Update ||
    proposal.action === ProposalAction.VersionedUpdate
  ) {
    return (
      <UpdateProposal
        proposals={proposals}
        allProposals={allProposals}
        organizationId={organizationId}
        projectId={projectId}
        onApply={onApply}
        disabled
        renderMode="group-member"
      />
    );
  }

  if (proposal.action === ProposalAction.Delete) {
    return (
      <DeleteProposal
        proposals={proposals}
        allProposals={allProposals}
        organizationId={organizationId}
        projectId={projectId}
        onApply={onApply}
        disabled
        renderMode="group-member"
      />
    );
  }

  return <Alert severity="info">Unsupported proposal action.</Alert>;
};

interface MemberStatusPresentation {
  label: string;
  color: "default" | "success" | "error" | "warning" | "info";
}

const getMemberStatusPresentation = (
  executionState: ProposalGroupMemberExecutionState,
): MemberStatusPresentation => {
  switch (executionState) {
    case ProposalGroupMemberExecutionState.PendingApproval:
      return { label: "Awaiting approval", color: "default" };
    case ProposalGroupMemberExecutionState.WaitingOnDependencies:
      return { label: "Waiting for prerequisites", color: "warning" };
    case ProposalGroupMemberExecutionState.Ready:
      return { label: "Ready to apply", color: "info" };
    case ProposalGroupMemberExecutionState.Applying:
      return { label: "Applying", color: "info" };
    case ProposalGroupMemberExecutionState.Applied:
      return { label: "Applied", color: "success" };
    case ProposalGroupMemberExecutionState.RetryableFailure:
      return { label: "Retry available", color: "error" };
    case ProposalGroupMemberExecutionState.Failed:
      return { label: "Failed", color: "error" };
    case ProposalGroupMemberExecutionState.Rejected:
      return { label: "Rejected", color: "error" };
    case ProposalGroupMemberExecutionState.Invalidated:
      return { label: "Cannot apply", color: "warning" };
  }
};

const MemberState: React.FC<{
  member: ProposalGroupMemberSnapshot;
  members: ProposalGroupMemberSnapshot[];
}> = ({ member, members }) => {
  const membersById = useMemo(
    () => new Map(members.map((candidate) => [candidate.memberId, candidate])),
    [members],
  );
  const prerequisiteLabels = member.dependencies.map((dependency) => {
    const prerequisite = membersById.get(dependency.prerequisiteMemberId);
    return prerequisite
      ? getProposalDisplayTitle(prerequisite.proposal)
      : "Unavailable prerequisite";
  });
  const { approvalProgress, attempt, terminalTimestamps } = member;
  const statusPresentation = getMemberStatusPresentation(member.executionState);
  const terminalEntries = [
    ["Applied", terminalTimestamps.appliedAt],
    ["Rejected", terminalTimestamps.rejectedAt],
    ["Could not apply", terminalTimestamps.invalidatedAt],
    ["Failed", terminalTimestamps.failedAt],
  ].filter((entry): entry is [string, string] => entry[1] !== null);

  const details = (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        {formatApprovalProgress(
          approvalProgress.receivedApprovals,
          approvalProgress.requiredApprovals,
          approvalProgress.approvalSatisfied,
        )}
      </Typography>
      {!isWaitingForApproval(member) && (
        <Typography variant="body2">{formatExecutionStatus(member)}</Typography>
      )}
      <Typography variant="body2">
        Prerequisites: {prerequisiteLabels.join(", ") || "None"}
      </Typography>
      {approvalProgress.approvalSatisfiedAt && (
        <Typography variant="body2">
          Approval satisfied{" "}
          {formatTimestamp(approvalProgress.approvalSatisfiedAt)}
        </Typography>
      )}
      {attempt && (
        <Stack spacing={0.25}>
          <Typography variant="body2">
            Attempts: {attempt.attemptCount}
          </Typography>
          {attempt.startedAt && (
            <Typography variant="body2">
              Started {formatTimestamp(attempt.startedAt)}
            </Typography>
          )}
          {attempt.completedAt && (
            <Typography variant="body2">
              Completed {formatTimestamp(attempt.completedAt)}
            </Typography>
          )}
          {attempt.lastAttemptedAt && (
            <Typography variant="body2">
              Last attempted {formatTimestamp(attempt.lastAttemptedAt)}
            </Typography>
          )}
        </Stack>
      )}
      {terminalEntries.map(([label, timestamp]) => (
        <Typography key={label} variant="body2">
          {label} {formatTimestamp(timestamp)}
        </Typography>
      ))}
    </Stack>
  );

  return (
    <Stack
      spacing={0.75}
      alignItems="flex-start"
      data-testid="proposal-group-member-state"
      data-execution-state={member.executionState}
      data-blocked-reason={member.blockedReason}
    >
      <Tooltip title={details} arrow describeChild>
        <Chip
          label={statusPresentation.label}
          color={statusPresentation.color}
          size="small"
          tabIndex={0}
          data-testid="proposal-group-member-status"
        />
      </Tooltip>
      {attempt?.lastError && (
        <Stack spacing={0.75}>
          <Alert severity="error" data-testid="proposal-group-member-error">
            {attempt.lastError}
          </Alert>
          <ProposalFailureDiagnostic diagnostic={attempt.diagnostic} />
        </Stack>
      )}
    </Stack>
  );
};

const MemberDecisionControls: React.FC<{
  member: ProposalGroupMemberSnapshot;
  decision: MemberDecision;
  proposalStatus: ProposalStatus;
  onApprove: (proposalId: string) => Promise<unknown>;
  onReject: (proposalId: string, reason: string) => Promise<unknown>;
  isDeciding: boolean;
}> = ({
  member,
  decision,
  proposalStatus,
  onApprove,
  onReject,
  isDeciding,
}) => {
  const reconciliation = React.useContext(ProposalReconciliationContext);
  const [rejectDialogOpen, setRejectDialogOpen, rejectDialogOpenOwnerKey] =
    useModalState(false);
  const [rejectReason, setRejectReason] = useState("");
  const actionability = getMemberActionability(member);
  const submitRejection = useCallback(async () => {
    const reason = rejectReason.trim();
    if (!reason) return;
    setRejectDialogOpen(false);
    setRejectReason("");
    await onReject(member.proposal.id, reason);
  }, [member.proposal.id, onReject, rejectReason]);

  if (!actionability.canApprove && !actionability.canReject && !decision) {
    return null;
  }

  const proposalIsTerminal =
    proposalStatus === ProposalStatus.Approved ||
    proposalStatus === ProposalStatus.Rejected;
  const approveDisabled =
    reconciliation?.approvalDisabled ||
    isDeciding ||
    proposalIsTerminal ||
    !actionability.canApprove ||
    decision !== null;
  const rejectDisabled =
    isDeciding ||
    proposalIsTerminal ||
    !actionability.canReject ||
    decision !== null;

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        data-testid="proposal-group-member-actions"
      >
        <Button
          size="small"
          variant={decision === "approved" ? "contained" : "outlined"}
          color="success"
          disabled={approveDisabled}
          onClick={() => void onApprove(member.proposal.id).catch(() => null)}
          data-testid="proposal-group-member-approve"
          data-selected={decision === "approved"}
          aria-pressed={decision === "approved"}
        >
          Approve
        </Button>
        <Button
          size="small"
          color="error"
          variant={decision === "rejected" ? "contained" : "outlined"}
          disabled={rejectDisabled}
          onClick={() => setRejectDialogOpen(true)}
          data-testid="proposal-group-member-reject"
          data-selected={decision === "rejected"}
          aria-pressed={decision === "rejected"}
        >
          Reject
        </Button>
      </Stack>
      <Dialog
        ownerKey={rejectDialogOpenOwnerKey}
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject proposal</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Reason for rejection"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            slotProps={{
              htmlInput: {
                "data-testid": "proposal-group-member-reject-reason",
              },
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!rejectReason.trim() || isDeciding}
            onClick={() => void submitRejection().catch(() => null)}
            data-testid="proposal-group-member-reject-submit"
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

const ProposalGroupMemberReviewContent: React.FC<
  ProposalGroupMemberReviewProps
> = ({
  member,
  members,
  decisionProposal,
  decisionOverride,
  organizationId,
  projectId,
  onApprove,
  onReject,
  isDeciding,
}) => {
  const { user } = useAuth();
  const allProposals = useMemo(
    () => members.map((candidate) => candidate.proposal),
    [members],
  );
  const effectiveProposal = decisionProposal ?? member.proposal;
  const decision =
    decisionOverride ?? getMemberDecision(effectiveProposal, user?.id);
  const acceptedUpdate =
    (member.proposal.action === ProposalAction.Update ||
      member.proposal.action === ProposalAction.VersionedUpdate) &&
    (decision === "approved" ||
      effectiveProposal.status === ProposalStatus.Approved ||
      member.executionState === ProposalGroupMemberExecutionState.Applied);
  const [contentExpanded, setContentExpanded] = useState(!acceptedUpdate);

  useEffect(() => {
    if (acceptedUpdate) {
      setContentExpanded(false);
    }
  }, [acceptedUpdate]);

  return (
    <Paper
      variant="outlined"
      data-testid="proposal-group-member-review"
      data-member-id={member.memberId}
      data-member-order={member.memberOrder}
      sx={{ p: 2 }}
    >
      <Stack spacing={2}>
        <MemberHeader
          member={member}
          organizationId={organizationId}
          projectId={projectId}
          contentExpanded={contentExpanded}
          onToggleContent={() => setContentExpanded((expanded) => !expanded)}
          canToggleContent={acceptedUpdate}
        />
        <MemberState member={member} members={members} />
        <Divider />
        <Collapse in={contentExpanded} unmountOnExit>
          <ReadOnlyProposalContent
            proposal={member.proposal}
            allProposals={allProposals}
            organizationId={organizationId}
            projectId={projectId}
          />
        </Collapse>
        {member.proposal.action !==
        ProposalAction.VersionedUpdate ? null : effectiveProposal.status ===
          ProposalStatus.Approved ? (
          <FutureApplyFooter proposal={effectiveProposal} />
        ) : effectiveProposal.status !== ProposalStatus.Rejected &&
          "operation" in member.proposal.updates &&
          member.proposal.updates.operation === "REVISE" ? (
          // Members are approved with the group's controls below, so the
          // first step only names it.
          <FutureApplyFooter
            proposal={member.proposal}
            approveControl={
              <Chip size="small" variant="outlined" label="Needs approval" />
            }
          />
        ) : null}
        <MemberDecisionControls
          member={member}
          decision={decision}
          proposalStatus={effectiveProposal.status}
          onApprove={onApprove}
          onReject={onReject}
          isDeciding={isDeciding}
        />
      </Stack>
    </Paper>
  );
};

export const ProposalGroupMemberReview: React.FC<
  ProposalGroupMemberReviewProps
> = (props) => (
  <ProposalReconciliationReview
    grouped
    proposal={props.decisionProposal ?? props.member.proposal}
    onApply={() =>
      void props.onApprove(props.member.proposal.id).catch(() => null)
    }
  >
    <ProposalGroupMemberReviewContent {...props} />
  </ProposalReconciliationReview>
);
