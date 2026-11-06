import type { AccountPasskeyDto } from "@hey-hey/contracts/api/models";
import { useAccountPasskeys } from "@hey-hey/ui-common/data";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { AccountProofDialog } from "./AccountProofDialog";

type PendingChange =
  { kind: "add" } | { kind: "remove"; passkey: AccountPasskeyDto };

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString();

/**
 * Account sign-in passkeys. These are separate from the passkeys that
 * authorize Agent Bridges; adding or removing one signs out every other
 * browser while this one stays signed in.
 */
export const AccountPasskeysSection: React.FC = () => {
  const { passkeys, loadError, add, rename, remove } = useAccountPasskeys();
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(
    null,
  );
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleRenameSave = async (): Promise<void> => {
    if (!renaming) {
      return;
    }
    try {
      await rename(renaming.id, renaming.name.trim());
      setRenaming(null);
      setRenameError(null);
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : "Rename failed");
    }
  };

  const handleConfirm = async ({
    name,
    proof,
  }: Parameters<
    React.ComponentProps<typeof AccountProofDialog>["onConfirm"]
  >[0]): Promise<void> => {
    if (!pendingChange) {
      return;
    }
    if (pendingChange.kind === "add") {
      await add(name, proof);
    } else {
      await remove(pendingChange.passkey.id, proof);
    }
    setPendingChange(null);
  };

  return (
    <Box
      component="section"
      data-testid="settings-passkeys-section"
      sx={{ mb: 4 }}
    >
      <Typography
        variant="h6"
        component="h2"
        gutterBottom
        data-testid="settings-passkeys-heading"
      >
        Passkeys
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Use a passkey to sign in to your account. Adding or removing a passkey
        signs you out everywhere else.
      </Typography>
      {loadError && <Alert severity="error">{loadError}</Alert>}
      {renameError && <Alert severity="error">{renameError}</Alert>}
      {passkeys === null && !loadError && <CircularProgress size={24} />}
      {passkeys !== null && passkeys.length === 0 && (
        <Typography variant="body2" data-testid="settings-passkeys-empty">
          You have no passkeys yet.
        </Typography>
      )}
      {passkeys !== null && passkeys.length > 0 && (
        <List dense data-testid="settings-passkeys-list">
          {passkeys.map((passkey) => (
            <ListItem
              key={passkey.id}
              data-testid="settings-passkey-item"
              data-passkey-id={passkey.id}
              secondaryAction={
                renaming?.id === passkey.id ? (
                  <Button
                    onClick={() => void handleRenameSave()}
                    data-testid="settings-passkey-rename-save"
                  >
                    Save
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() =>
                        setRenaming({ id: passkey.id, name: passkey.name })
                      }
                      data-testid="settings-passkey-rename"
                    >
                      Rename
                    </Button>
                    <Button
                      color="error"
                      onClick={() =>
                        setPendingChange({ kind: "remove", passkey })
                      }
                      data-testid="settings-passkey-remove"
                    >
                      Remove
                    </Button>
                  </>
                )
              }
            >
              {renaming?.id === passkey.id ? (
                <TextField
                  size="small"
                  value={renaming.name}
                  onChange={(event) =>
                    setRenaming({ id: passkey.id, name: event.target.value })
                  }
                  slotProps={{
                    htmlInput: {
                      maxLength: 100,
                      "data-testid": "settings-passkey-rename-input",
                    },
                  }}
                />
              ) : (
                <ListItemText
                  primary={passkey.name}
                  secondary={`Added ${formatDate(passkey.createdAt)}${
                    passkey.lastUsedAt
                      ? ` · Last used ${formatDate(passkey.lastUsedAt)}`
                      : " · Not used yet"
                  }`}
                />
              )}
            </ListItem>
          ))}
        </List>
      )}
      <Button
        variant="outlined"
        onClick={() => setPendingChange({ kind: "add" })}
        disabled={passkeys === null}
        data-testid="settings-add-passkey-button"
        sx={{ mt: 1 }}
      >
        Add a passkey
      </Button>
      {pendingChange && (
        <AccountProofDialog
          title={
            pendingChange.kind === "add"
              ? "Add a passkey"
              : `Remove ${pendingChange.passkey.name}`
          }
          description="Confirm it's you. Other browsers signed in to your account will be signed out."
          askForName={pendingChange.kind === "add"}
          canUsePasskey={(passkeys?.length ?? 0) > 0}
          onCancel={() => setPendingChange(null)}
          onConfirm={handleConfirm}
        />
      )}
    </Box>
  );
};
