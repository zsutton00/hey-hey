import { Alert, Box, Button, CircularProgress, TextField } from "@mui/material";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n";

export interface CurrentPasswordChangeCredentials {
  currentPassword: string;
  newPassword: string;
}

export interface CurrentPasswordChangeFormProps {
  onSubmit: (
    credentials: CurrentPasswordChangeCredentials,
  ) => Promise<void>;
}

export const CurrentPasswordChangeForm = ({
  onSubmit,
}: CurrentPasswordChangeFormProps) => {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const clearFeedback = (): void => {
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t(KEYS.forms.required));
      return;
    }
    if (newPassword.length < 8) {
      setError(t(KEYS.forms.passwordTooShort));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t(KEYS.forms.passwordMismatch));
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await onSubmit({ currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t(KEYS.auth.passwordChangeFailed),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      data-testid="current-password-change-form"
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      {error && (
        <Alert severity="error" data-testid="current-password-change-error">
          {error}
        </Alert>
      )}
      {success && (
        <Alert
          severity="success"
          data-testid="current-password-change-success"
        >
          {t(KEYS.auth.passwordChanged)}
        </Alert>
      )}
      <TextField
        label={t(KEYS.auth.currentPassword)}
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => {
          setCurrentPassword(event.target.value);
          clearFeedback();
        }}
        disabled={submitting}
        required
        inputProps={{ "data-testid": "current-password-change-current" }}
      />
      <TextField
        label={t(KEYS.auth.newPassword)}
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => {
          setNewPassword(event.target.value);
          clearFeedback();
        }}
        disabled={submitting}
        required
        inputProps={{ "data-testid": "current-password-change-new" }}
      />
      <TextField
        label={t(KEYS.auth.confirmPassword)}
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => {
          setConfirmPassword(event.target.value);
          clearFeedback();
        }}
        disabled={submitting}
        required
        inputProps={{ "data-testid": "current-password-change-confirm" }}
      />
      <Button
        type="submit"
        variant="contained"
        disabled={submitting}
        data-testid="current-password-change-submit"
      >
        {submitting ? (
          <CircularProgress size={20} />
        ) : (
          t(KEYS.auth.changePassword)
        )}
      </Button>
    </Box>
  );
};
