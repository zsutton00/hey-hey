import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

interface RestartPlanGenerationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  restarting: boolean;
}

/**
 * Confirmation gate for restarting plan generation. Restarting tears down the
 * draft plan, its proposals, and its reports and relaunches a fresh run from
 * the same design doc — so the dialog spells out exactly what is discarded and
 * what is kept before the user commits. This is a plain client gate; the signed
 * teardown envelope is constructed server-side by the restart endpoint.
 */
export const RestartPlanGenerationDialog = ({
  open,
  onClose,
  onConfirm,
  restarting,
}: RestartPlanGenerationDialogProps) => (
  <Dialog
    open={open}
    onClose={restarting ? undefined : onClose}
    maxWidth="sm"
    fullWidth
    data-testid="plan-generation-restart-dialog"
  >
    <DialogTitle>Restart plan generation?</DialogTitle>
    <DialogContent>
      <DialogContentText>
        This stops generation, discards its pending proposals and reports, and
        removes generated stages and tasks. Your Plan and design doc are kept.
        The Plan returns to draft so you can review the design doc and start
        generating again.
      </DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={restarting}>
        Cancel
      </Button>
      <Button
        variant="contained"
        color="error"
        onClick={onConfirm}
        disabled={restarting}
        data-testid="plan-generation-restart-confirm"
      >
        {restarting ? "Restarting…" : "Restart"}
      </Button>
    </DialogActions>
  </Dialog>
);
