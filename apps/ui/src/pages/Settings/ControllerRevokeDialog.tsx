import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import type {
  ControllerCredentialSummaryDto,
  MachineDto,
} from "@hey-hey/ui-common/api";
import {
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

interface ControllerRevokeDialogProps {
  open: boolean;
  machine: MachineDto;
  controller: ControllerCredentialSummaryDto | null;
  isRevoking: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ControllerRevokeDialog: React.FC<ControllerRevokeDialogProps> = ({
  open,
  machine,
  controller,
  isRevoking,
  onConfirm,
  onCancel,
}) => (
  <Dialog
    open={open}
    onClose={isRevoking ? undefined : onCancel}
    aria-labelledby="revoke-controller-dialog-title"
    aria-describedby="revoke-controller-dialog-description"
    data-testid="revoke-controller-dialog"
  >
    <DialogTitle id="revoke-controller-dialog-title">
      Remove Passkey
    </DialogTitle>
    <DialogContent>
      <DialogContentText id="revoke-controller-dialog-description">
        Remove <strong>{controller?.label ?? "this Passkey"}</strong> from the{" "}
        <strong>{machine.name}</strong> Agent Bridge? It will no longer
        authorize work on that computer. If it is the last Passkey, signing in
        cannot restore access; on that computer, run{" "}
        <code>heyhey controllers add</code>.
      </DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button
        onClick={onCancel}
        disabled={isRevoking}
        data-testid="revoke-controller-cancel"
      >
        Cancel
      </Button>
      <Button
        onClick={onConfirm}
        color="error"
        variant="contained"
        disabled={isRevoking || controller === null}
        data-testid="revoke-controller-confirm"
      >
        {isRevoking ? <CircularProgress size={20} color="inherit" /> : "Remove"}
      </Button>
    </DialogActions>
  </Dialog>
);
