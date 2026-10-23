import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { ProjectRole } from "../../api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_OPTIONS: { value: ProjectRole; label: string }[] = [
  { value: ProjectRole.Owner, label: "Owner" },
  { value: ProjectRole.Architect, label: "Architect" },
  { value: ProjectRole.Member, label: "Member" },
  { value: ProjectRole.Viewer, label: "Viewer" },
];

export interface InviteByEmailDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (email: string, role: ProjectRole) => void;
  loading?: boolean;
  error?: InviteByEmailError | null;
}

export type InviteByEmailError =
  | { kind: "duplicate"; message?: string }
  | { kind: "generic"; message: string };

export const InviteByEmailDialog: React.FC<InviteByEmailDialogProps> = ({
  open,
  onClose,
  onSubmit,
  loading = false,
  error = null,
}) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>(ProjectRole.Member);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setRole(ProjectRole.Member);
      setEmailError(undefined);
    }
  }, [open]);

  const validate = useCallback((): boolean => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError("Email is required");
      return false;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError("Enter a valid email address");
      return false;
    }
    setEmailError(undefined);
    return true;
  }, [email]);

  const handleEmailChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setEmail(event.target.value);
      if (emailError) setEmailError(undefined);
    },
    [emailError]
  );

  const handleRoleChange = useCallback(
    (event: SelectChangeEvent<ProjectRole>) => {
      setRole(event.target.value as ProjectRole);
    },
    []
  );

  const handleSubmit = useCallback(() => {
    if (!validate()) return;
    onSubmit(email.trim(), role);
  }, [email, role, onSubmit, validate]);

  const handleClose = useCallback(() => {
    if (!loading) onClose();
  }, [loading, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="invite-by-email-dialog-title"
      data-testid="invite-by-email-dialog"
    >
      <DialogTitle id="invite-by-email-dialog-title">
        Invite by email
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error?.kind === "duplicate" && (
            <Alert severity="warning" data-testid="invite-by-email-duplicate">
              A user with that email already belongs to this organization. Use
              the &ldquo;Add existing user&rdquo; flow to add them to this
              project.
            </Alert>
          )}
          {error?.kind === "generic" && (
            <Alert severity="error" data-testid="invite-by-email-error">
              {error.message}
            </Alert>
          )}

          <TextField
            fullWidth
            type="email"
            label="Email"
            placeholder="teammate@example.com"
            value={email}
            onChange={handleEmailChange}
            error={!!emailError}
            helperText={emailError}
            disabled={loading}
            autoFocus
            inputProps={{
              "aria-label": "Email",
              "data-testid": "invite-by-email-email",
            }}
          />

          <FormControl fullWidth disabled={loading}>
            <InputLabel id="invite-by-email-role-label">Role</InputLabel>
            <Select
              labelId="invite-by-email-role-label"
              label="Role"
              value={role}
              onChange={handleRoleChange}
              inputProps={{ "data-testid": "invite-by-email-role" }}
            >
              {ROLE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !email.trim()}
          startIcon={loading ? <CircularProgress size={16} /> : undefined}
          data-testid="invite-by-email-submit"
        >
          {loading ? "Sending invite…" : "Send invite"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
