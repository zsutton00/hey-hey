import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import { ProposalReconciliationContext } from "../ProposalReconciliation/ProposalReconciliationReview";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import BlockIcon from "@mui/icons-material/Block";
import React, { useCallback, useContext, useRef, useState } from "react";
import { ProposalAction } from "../../api";
import type { ProposalItemStatus } from "./types";
import type { ApprovalProgress } from "../../permissions";
import { formatApprovalLabel, formatApprovalStatus } from "../../permissions";
import { ProposalFailureDiagnostic } from "./ProposalFailureDiagnostic";
import { ProposalPresentationContext } from "./ProposalPresentationContext";
import { EvaluationOutputBadge } from "./EvaluationOutputBadge";

const ACTION_LABELS: Record<ProposalAction, string> = {
  [ProposalAction.Create]: "Create",
  [ProposalAction.Update]: "Update",
  [ProposalAction.Delete]: "Delete",
  [ProposalAction.VersionedUpdate]: "Approve revision",
};

const COMPLETED_ACTION_LABELS: Record<ProposalAction, string> = {
  [ProposalAction.Create]: "Created",
  [ProposalAction.Update]: "Updated",
  [ProposalAction.Delete]: "Deleted",
  [ProposalAction.VersionedUpdate]: "Revision approved",
};

type RejectState = "idle" | "rejecting" | "rejected" | "failed";

const isRejectReasonValid = (action: ProposalAction, reason: string): boolean =>
  action === ProposalAction.Create || reason.trim().length > 0;

export { ProposalReconciliationReview as ProposalOutOfDateReview } from "../ProposalReconciliation/ProposalReconciliationReview";

interface ProposalStateIndicatorProps {
  status: ProposalItemStatus;
  action: ProposalAction;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  approvalProgress?: ApprovalProgress;
  /**
   * Override the apply button label (e.g. "Generate plan") instead of the
   * default action-derived label ("Create" / "Update" / ...).
   */
  applyLabel?: string;
  /**
   * Whether the signed-in user's role may approve this proposal. When false
   * the approve (and retry-approve) actions are hidden; reject is unaffected.
   * Presentation only: the server enforces approval permissions.
   */
  canApprove?: boolean;
}

export const ProposalStateIndicator: React.FC<ProposalStateIndicatorProps> = (
  props,
) => {
  const presentation = useContext(ProposalPresentationContext);
  return (
    // A stable box around content that is replaced on apply, so the conversation
    // scroll controller can keep the action area where the reader clicked it.
    <Box data-testid="proposal-action-anchor">
      {presentation === "evaluation-output" ? (
        <EvaluationOutputBadge />
      ) : (
        <ProposalStateIndicatorContent {...props} />
      )}
    </Box>
  );
};

const ProposalStateIndicatorContent: React.FC<ProposalStateIndicatorProps> = ({
  status,
  action,
  onApply,
  onReject,
  disabled,
  loading,
  approvalProgress,
  applyLabel,
  canApprove = true,
}) => {
  const readOnly = useContext(ProposalPresentationContext) === "read-only";
  const [rejectDialogOpen, setRejectDialogOpen, rejectDialogOpenOwnerKey] =
    useModalState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectState, setRejectState] = useState<RejectState>("idle");
  const rejectPendingRef = useRef(false);
  const outOfDateReview = useContext(ProposalReconciliationContext);
  const submitApply = outOfDateReview?.submit ?? onApply;
  const approvalDisabled = disabled || outOfDateReview?.approvalDisabled;

  const handleOpenRejectDialog = useCallback(() => {
    setRejectState("idle");
    setRejectDialogOpen(true);
  }, []);

  const handleCloseRejectDialog = useCallback(() => {
    if (rejectPendingRef.current) return;
    setRejectDialogOpen(false);
    setRejectReason("");
  }, []);

  const handleSubmitReject = useCallback(async () => {
    if (
      !onReject ||
      readOnly ||
      disabled ||
      rejectPendingRef.current ||
      !isRejectReasonValid(action, rejectReason)
    ) {
      return;
    }

    const trimmedReason = rejectReason.trim();
    rejectPendingRef.current = true;
    setRejectState("rejecting");
    setRejectDialogOpen(false);
    setRejectReason("");

    try {
      await onReject(trimmedReason);
      setRejectState("rejected");
    } catch {
      setRejectState("failed");
    } finally {
      rejectPendingRef.current = false;
    }
  }, [action, onReject, rejectReason, readOnly, disabled]);

  const handleRejectKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        !event.metaKey ||
        event.key !== "Enter" ||
        event.repeat ||
        event.nativeEvent.isComposing
      ) {
        return;
      }

      event.preventDefault();
      void handleSubmitReject();
    },
    [handleSubmitReject],
  );

  const label =
    (outOfDateReview?.staged && !outOfDateReview.future
      ? "Apply"
      : applyLabel) ?? ACTION_LABELS[action];
  const canSubmitReject = isRejectReasonValid(action, rejectReason);

  if (rejectState === "rejecting") {
    return <CircularProgress size={20} />;
  }

  if (rejectState === "rejected") {
    return (
      <Chip
        icon={<BlockIcon />}
        label="Rejected"
        size="small"
        color="error"
        sx={{ height: 28 }}
      />
    );
  }

  if (rejectState === "failed") {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          icon={<ErrorOutlineIcon />}
          label="Rejection failed"
          size="small"
          color="error"
          sx={{ height: 28 }}
        />
        {!readOnly && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={handleOpenRejectDialog}
            disabled={disabled}
          >
            Retry Reject
          </Button>
        )}
      </Stack>
    );
  }

  if (status.state === "applying") {
    return <CircularProgress size={20} />;
  }

  if (status.state === "rejected") {
    return (
      <Chip
        icon={<BlockIcon />}
        label="Rejected"
        size="small"
        color="error"
        sx={{ height: 28 }}
      />
    );
  }

  if (status.state === "applied") {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          icon={<CheckCircleOutlineIcon />}
          label={COMPLETED_ACTION_LABELS[action]}
          size="small"
          color="success"
          sx={{ height: 28 }}
        />
        {loading ? <CircularProgress size={16} /> : null}
      </Stack>
    );
  }

  if (status.state === "failed") {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            icon={<ErrorOutlineIcon />}
            label="Failed"
            size="small"
            color="error"
            sx={{ height: 28 }}
          />
          {!readOnly && canApprove && (
            <Button
              size="small"
              variant="outlined"
              onClick={submitApply}
              disabled={approvalDisabled}
            >
              Retry {label}
            </Button>
          )}
        </Stack>
        {status.error ? (
          <Typography variant="body2" color="error.main">
            {status.error}
          </Typography>
        ) : null}
        <ProposalFailureDiagnostic diagnostic={status.diagnostic} />
      </Stack>
    );
  }

  const approveLabel =
    outOfDateReview?.staged && !outOfDateReview.future
      ? "Apply"
      : action === ProposalAction.VersionedUpdate &&
          !approvalProgress?.isMultiApproval
        ? "Approve revision"
        : approvalProgress
          ? formatApprovalLabel(approvalProgress)
          : (applyLabel ?? label);

  const approveButton = (
    <Button
      data-testid="proposal-approve"
      size="small"
      variant="contained"
      color="success"
      onClick={submitApply}
      disabled={approvalDisabled}
    >
      {approveLabel}
    </Button>
  );

  const wrappedApproveButton = approvalProgress?.isMultiApproval ? (
    <Tooltip
      title="Multiple approvals are required for this proposal"
      describeChild
    >
      {approveButton}
    </Tooltip>
  ) : (
    approveButton
  );

  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center">
        {!readOnly && canApprove && wrappedApproveButton}
        {!readOnly && onReject && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={handleOpenRejectDialog}
            disabled={disabled}
          >
            Reject
          </Button>
        )}
        {approvalProgress ? (
          <Typography
            data-testid="proposal-approval-progress"
            variant="body2"
            color="text.secondary"
          >
            {formatApprovalStatus(approvalProgress)}
          </Typography>
        ) : readOnly ? (
          <Chip label="Pending" size="small" />
        ) : null}
      </Stack>
      {!readOnly && onReject && (
        <Dialog
          ownerKey={rejectDialogOpenOwnerKey}
          open={rejectDialogOpen}
          onClose={handleCloseRejectDialog}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Reject Proposal</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={2}
              maxRows={6}
              label="Reason for rejection"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              onKeyDown={handleRejectKeyDown}
              slotProps={{
                htmlInput: {
                  "data-testid": "proposal-reject-reason-input",
                },
              }}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseRejectDialog}>Cancel</Button>
            <Button
              color="error"
              variant="contained"
              disabled={!canSubmitReject}
              onClick={handleSubmitReject}
              data-testid="proposal-reject-submit"
            >
              Reject
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
};
