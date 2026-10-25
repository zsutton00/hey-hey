import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import type { MachineDto } from "@hey-hey/ui-common/api";
import {
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

interface RevokeMachineDialogProps {
  open: boolean;
  machine: MachineDto | null;
  isRevoking: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const RevokeMachineDialog: React.FC<RevokeMachineDialogProps> = ({
  open,
  machine,
  isRevoking,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog
      open={open}
      onClose={isRevoking ? undefined : onCancel}
      aria-labelledby="revoke-machine-dialog-title"
      aria-describedby="revoke-machine-dialog-description"
      data-testid="revoke-machine-dialog"
    >
      <DialogTitle id="revoke-machine-dialog-title">
        Remove Agent Bridge
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="revoke-machine-dialog-description">
          Remove <strong>{machine?.name ?? ""}</strong>? This Agent Bridge will
          immediately lose its connection, Passkeys, and permission to run work.
          Its history will remain available.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onCancel}
          color="primary"
          disabled={isRevoking}
          data-testid="revoke-machine-cancel"
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={isRevoking}
          data-testid="revoke-machine-confirm"
        >
          {isRevoking ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            "Remove"
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
