import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import React from "react";

export interface ResetPlanDialogProps {
  open: boolean;
  planName: string;
  resetting: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export const ResetPlanDialog: React.FC<ResetPlanDialogProps> = ({
  open,
  planName,
  resetting,
  error,
  onClose,
  onConfirm,
}) => (
  <Dialog open={open} onClose={resetting ? undefined : onClose}>
    <DialogTitle>Reset Plan?</DialogTitle>
    <DialogContent>
      <DialogContentText>
        Resetting “{planName}” removes its generated stages and steps, then
        prepares a new setup from the latest linked design document. The plan,
        its identity, and the design document are retained.
      </DialogContentText>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={resetting}>
        Cancel
      </Button>
      <Button
        color="error"
        variant="contained"
        onClick={onConfirm}
        disabled={resetting}
      >
        {resetting ? "Resetting…" : "Reset Plan"}
      </Button>
    </DialogActions>
  </Dialog>
);
