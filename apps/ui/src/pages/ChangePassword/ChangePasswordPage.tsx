import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Alert, Box, CircularProgress, TextField } from "@mui/material";
import {
  BRANDED_FIELD_LABEL_SX,
  BRANDED_FIELD_SX,
  BrandedButton,
  BrandedCard,
  BrandedHeadline,
  BrandedPage,
  BrandedWordmark,
} from "@hey-hey/ui-common/components";
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
    `${window.location.pathname}${window.location.search}`,
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
  const [recoveryCredential] = useState(captureRecoveryCredentialFromFragment);
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
    [],
  );

  if (!passwordChangeToken) {
    return (
      <BrandedPage>
        <BrandedWordmark>HEY HEY</BrandedWordmark>
        <BrandedCard>
          <Alert severity="error" sx={{ mb: 2 }}>
            This password-change link is invalid or no longer available.
          </Alert>
          <BrandedButton type="button" onClick={() => navigate("/login")}>
            Back to Login
          </BrandedButton>
        </BrandedCard>
      </BrandedPage>
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
          "This password-change link is invalid or no longer available.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : t(KEYS.alerts.errorOccurred),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <BrandedPage>
      <BrandedWordmark>HEY HEY</BrandedWordmark>
      <BrandedHeadline line={t(KEYS.auth.mustChangePassword)}>
        {t(KEYS.auth.setNewPassword)}
      </BrandedHeadline>
      <BrandedCard>
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
          <Box
            component="label"
            htmlFor="new-password"
            sx={BRANDED_FIELD_LABEL_SX}
          >
            {t(KEYS.auth.newPassword)}
          </Box>
          <TextField
            required
            fullWidth
            id="new-password"
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
            sx={BRANDED_FIELD_SX}
          />
          <Box
            component="label"
            htmlFor="confirm-password"
            sx={BRANDED_FIELD_LABEL_SX}
          >
            {t(KEYS.auth.confirmPassword)}
          </Box>
          <TextField
            required
            fullWidth
            id="confirm-password"
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
            sx={BRANDED_FIELD_SX}
          />

          <BrandedButton
            type="submit"
            disabled={loading || !isFormValid()}
            data-testid="change-password-submit"
          >
            {loading ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              t(KEYS.auth.changePassword)
            )}
          </BrandedButton>
        </Box>
      </BrandedCard>
    </BrandedPage>
  );
};
