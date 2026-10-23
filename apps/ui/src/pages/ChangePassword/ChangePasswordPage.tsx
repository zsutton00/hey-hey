import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  TextField,
  Typography,
} from "@mui/material";
import { useAuth } from "@hey-hey/ui-common/context";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_POST_LOGIN_PATH,
  normalizeInternalReturnTarget,
} from "../../utils/authReturnTarget";

interface LocationState {
  passwordChangeToken?: string;
  from?: string;
}

let capturedRecoveryCredential: string | null = null;

const captureRecoveryCredentialFromFragment = (): string | null => {
  if (typeof window === "undefined") return capturedRecoveryCredential;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const recoveryCredential = fragment.get("recoveryCredential");
  if (!recoveryCredential) return capturedRecoveryCredential;

  capturedRecoveryCredential = recoveryCredential;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`
  );
  return capturedRecoveryCredential;
};

export const clearCapturedRecoveryCredential = (): void => {
  capturedRecoveryCredential = null;
};

export const ChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeChangePassword } = useAuth();
  const { t } = useTranslation();

  const state = location.state as LocationState | null;
  const [recoveryCredential] = useState(
    captureRecoveryCredentialFromFragment
  );
  const passwordChangeToken =
    recoveryCredential ?? state?.passwordChangeToken ?? "";
  const from =
    normalizeInternalReturnTarget(state?.from) ?? DEFAULT_POST_LOGIN_PATH;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      clearCapturedRecoveryCredential();
    },
    []
  );

  if (!passwordChangeToken) {
    return (
      <Container component="main" maxWidth="sm">
        <Box
          sx={{
            marginTop: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <Alert severity="error">
            This password-change link is invalid or no longer available.
          </Alert>
          <Button
            sx={{ mt: 2 }}
            variant="contained"
            onClick={() => navigate("/login")}
          >
            Back to Login
          </Button>
        </Box>
      </Container>
    );
  }

  const isFormValid = (): boolean =>
    newPassword.length >= 8 && newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!isFormValid()) {
      if (newPassword.length < 8) {
        setError(t(KEYS.forms.passwordTooShort));
      } else {
        setError(t(KEYS.forms.passwordMismatch));
      }
      return;
    }

    setLoading(true);
    setError("");

    try {
      await completeChangePassword(passwordChangeToken, newPassword);
      if (recoveryCredential) clearCapturedRecoveryCredential();
      navigate(from, { replace: true });
    } catch (err) {
      if (recoveryCredential) {
        clearCapturedRecoveryCredential();
        setError(
          "This password-change link is invalid or no longer available."
        );
      } else {
        setError(
          err instanceof Error ? err.message : t(KEYS.alerts.errorOccurred)
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="sm">
      <Box
        sx={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Card sx={{ width: "100%", maxWidth: 400 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography
              component="h1"
              variant="h4"
              align="center"
              gutterBottom
              sx={{ mb: 1 }}
            >
              {t(KEYS.auth.setNewPassword)}
            </Typography>

            <Typography
              variant="body2"
              align="center"
              color="text.secondary"
              sx={{ mb: 3 }}
            >
              {t(KEYS.auth.mustChangePassword)}
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <Box
              component="form"
              onSubmit={handleSubmit}
              data-testid="change-password-form"
            >
              <TextField
                margin="normal"
                required
                fullWidth
                id="new-password"
                label={t(KEYS.auth.newPassword)}
                name="newPassword"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (error) setError("");
                }}
                disabled={loading}
                inputProps={{ "data-testid": "new-password-input" }}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="confirm-password"
                label={t(KEYS.auth.confirmPassword)}
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError("");
                }}
                disabled={loading}
                inputProps={{ "data-testid": "confirm-password-input" }}
              />

              <Button
                type="submit"
                fullWidth
                color="actionable"
                variant="contained"
                sx={{ mt: 3, mb: 2, py: 1.5 }}
                disabled={loading || !isFormValid()}
                data-testid="change-password-submit"
              >
                {loading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  t(KEYS.auth.changePassword)
                )}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};
