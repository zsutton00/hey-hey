import type { AccountProofInput } from "@hey-hey/ui-common/services";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

interface AccountProofDialogProps {
  title: string;
  description: string;
  /** Shown only when adding: the new passkey's display name. */
  askForName: boolean;
  canUsePasskey: boolean;
  onCancel: () => void;
  onConfirm: (input: {
    name: string;
    proof: AccountProofInput;
  }) => Promise<void>;
}

/**
 * Asks the person to prove they own the account (current password or one of
 * their passkeys) before a passkey is added or removed.
 */
export const AccountProofDialog: React.FC<AccountProofDialogProps> = ({
  title,
  description,
  askForName,
  canUsePasskey,
  onCancel,
  onConfirm,
}) => {
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (proof: AccountProofInput): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await onConfirm({ name: name.trim(), proof });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work.");
    } finally {
      setPending(false);
    }
  };

  const nameMissing = askForName && name.trim().length === 0;

  return (
    <Dialog
      open
      onClose={pending ? undefined : onCancel}
      data-testid="account-proof-dialog"
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {description}
        </Typography>
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            data-testid="account-proof-error"
          >
            {error}
          </Alert>
        )}
        {askForName && (
          <TextField
            fullWidth
            margin="dense"
            label="Passkey name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{
              htmlInput: {
                maxLength: 100,
                "data-testid": "passkey-name-input",
              },
            }}
          />
        )}
        <TextField
          fullWidth
          margin="dense"
          type="password"
          label="Current password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          slotProps={{ htmlInput: { "data-testid": "account-proof-password" } }}
        />
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onCancel}
          disabled={pending}
          data-testid="account-proof-cancel"
        >
          Cancel
        </Button>
        {canUsePasskey && (
          <Button
            onClick={() => void handleConfirm({ kind: "passkey" })}
            disabled={pending || nameMissing}
            data-testid="account-proof-use-passkey"
          >
            Confirm with a passkey
          </Button>
        )}
        <Button
          variant="contained"
          onClick={() =>
            void handleConfirm({ kind: "password", currentPassword })
          }
          disabled={pending || nameMissing || currentPassword.length === 0}
          data-testid="account-proof-use-password"
        >
          Confirm with password
        </Button>
      </DialogActions>
    </Dialog>
  );
};
