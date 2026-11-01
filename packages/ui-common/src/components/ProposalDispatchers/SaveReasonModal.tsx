import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * An optional second contained action rendered beside the Submit button.
 * `onAction` receives the same trimmed reason the primary submit receives.
 */
export interface SaveReasonModalSecondaryAction {
  label: string;
  onAction: (reason: string) => void | Promise<void>;
  disabled?: boolean;
  configuration?: ReactNode;
}

export interface SaveReasonModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void | Promise<void>;
  title?: string;
  submitLabel?: string;
  cancelLabel?: string;
  helperText?: string;
  /**
   * When provided, renders a second contained button beside Submit. Both
   * buttons share the modal's submitting state, so triggering either disables
   * both while work is in flight. Omit it to render the modal exactly as a
   * single-action save dialog.
   */
  secondaryAction?: SaveReasonModalSecondaryAction;
}

export const SaveReasonModal: React.FC<SaveReasonModalProps> = ({
  open,
  onClose,
  onSubmit,
  title = "Save changes",
  submitLabel = "Submit",
  cancelLabel = "Cancel",
  helperText,
  secondaryAction,
}) => {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason("");
      setSubmitting(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setSubmitting(false);
    }
  }, [onSubmit, reason, submitting]);

  const handleSecondaryAction = useCallback(async () => {
    if (submitting || !secondaryAction) return;
    setSubmitting(true);
    try {
      await secondaryAction.onAction(reason.trim());
    } finally {
      setSubmitting(false);
    }
  }, [reason, secondaryAction, submitting]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="save-reason-modal"
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          label="Reason (optional)"
          helperText={helperText}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={submitting}
          inputProps={{ "data-testid": "save-reason-input" }}
          sx={{ mt: 1 }}
        />
        {secondaryAction?.configuration}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleClose}
          disabled={submitting}
          data-testid="save-reason-cancel"
        >
          {cancelLabel}
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSubmit}
          disabled={submitting}
          data-testid="save-reason-submit"
          startIcon={
            submitting ? <CircularProgress size={16} color="inherit" /> : null
          }
        >
          {submitLabel}
        </Button>
        {secondaryAction && (
          <Button
            variant="contained"
            color="primary"
            onClick={handleSecondaryAction}
            disabled={submitting || secondaryAction.disabled}
            data-testid="save-reason-secondary"
            startIcon={
              submitting ? <CircularProgress size={16} color="inherit" /> : null
            }
          >
            {secondaryAction.label}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
