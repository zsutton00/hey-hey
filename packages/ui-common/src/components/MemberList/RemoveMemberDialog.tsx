import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import React from "react";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

export type RemoveMemberScope = "project" | "organization";

export type RemoveMemberError =
  { kind: "lastOwner"; message: string } | { kind: "generic"; message: string };

export interface RemoveMemberDialogProps {
  open: boolean;
  scope: RemoveMemberScope;
  memberName: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  error?: RemoveMemberError | null;
}

const titleFor = (scope: RemoveMemberScope): string =>
  scope === "project" ? "Remove from project" : "Remove from organization";

const bodyFor = (scope: RemoveMemberScope, name: string): string =>
  scope === "project"
    ? `Remove ${name} from this project? They will lose access to this project but keep access to any other projects in your organization.`
    : `Remove ${name} from this organization? They will lose access to the organization and all of its projects.`;

export const RemoveMemberDialog: React.FC<RemoveMemberDialogProps> = ({
  open,
  scope,
  memberName,
  onClose,
  onConfirm,
  loading = false,
  error = null,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid={`remove-member-dialog-${scope}`}
    >
      <DialogTitle>{titleFor(scope)}</DialogTitle>
      <DialogContent>
        <DialogContentText data-testid="remove-member-dialog-body">
          {bodyFor(scope, memberName)}
        </DialogContentText>
        {error && (
          <Alert
            severity={error.kind === "lastOwner" ? "warning" : "error"}
            sx={{ mt: 2 }}
            data-testid="remove-member-dialog-error"
          >
            {error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={loading}
          data-testid="remove-member-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={loading}
          data-testid="remove-member-dialog-confirm"
        >
          {scope === "project"
            ? "Remove from project"
            : "Remove from organization"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
