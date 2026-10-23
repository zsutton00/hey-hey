import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  TextField,
} from "@mui/material";
import { useAuth, useOrganization } from "@hey-hey/ui-common/context";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { useTranslation } from "react-i18next";

interface WelcomeSignInFormProps {
  maxWidth?: number;
}

const WELCOME_CREDENTIAL_FRAGMENT_KEY = "welcomeCredential";
const INVALID_WELCOME_LINK_MESSAGE =
  "This welcome link is invalid or has expired.";
const HANDOFF_ERROR_MESSAGE =
  "We couldn't finish setting up your organization. Try again or return to sign in.";
let capturedWelcomeCredential = "";

const captureAndScrubWelcomeCredential = (): string => {
  if (window.location.hash) {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const credentialFromUrl =
      fragment.get(WELCOME_CREDENTIAL_FRAGMENT_KEY)?.trim() ?? "";

    if (credentialFromUrl) {
      capturedWelcomeCredential = credentialFromUrl;
    }

    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }

  return capturedWelcomeCredential;
};

export const WelcomeSignInForm: React.FC<WelcomeSignInFormProps> = ({
  maxWidth = 420,
}) => {
  const navigate = useNavigate();
  const {
    completeChangePassword,
    isAuthenticated,
    loading: authLoading,
    logout,
  } = useAuth();
  const { currentOrganization, refreshOrganizations } = useOrganization();
  const { t } = useTranslation();

  const welcomeCredential = captureAndScrubWelcomeCredential();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordExchangeComplete, setPasswordExchangeComplete] = useState(false);
  // Authentication survives remounts; local submission state does not.
  const handoffPending = passwordExchangeComplete || isAuthenticated;
  const [organizationInitializationComplete, setOrganizationInitializationComplete] =
    useState(false);
  const [organizationInitializationAttempt, setOrganizationInitializationAttempt] =
    useState(0);
  const organizationInitializationStarted = useRef(false);
  const componentMounted = useRef(true);

  useEffect(() => {
    componentMounted.current = true;

    return () => {
      componentMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      !handoffPending ||
      authLoading ||
      !isAuthenticated ||
      organizationInitializationStarted.current
    ) {
      return;
    }

    organizationInitializationStarted.current = true;

    void refreshOrganizations()
      .catch(() => {
        if (componentMounted.current) setError(HANDOFF_ERROR_MESSAGE);
      })
      .finally(() => {
        if (componentMounted.current) {
          setOrganizationInitializationComplete(true);
        }
      });
  }, [
    authLoading,
    handoffPending,
    isAuthenticated,
    organizationInitializationAttempt,
    refreshOrganizations,
  ]);

  useEffect(() => {
    if (!handoffPending || !organizationInitializationComplete) return;

    if (isAuthenticated && currentOrganization) {
      capturedWelcomeCredential = "";
      navigate("/welcome", { replace: true });
      return;
    }

    setLoading(false);
    setError(HANDOFF_ERROR_MESSAGE);
  }, [
    currentOrganization,
    handoffPending,
    isAuthenticated,
    navigate,
    organizationInitializationComplete,
  ]);

  const clearError = (): void => {
    if (error) setError("");
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!welcomeCredential) {
      setError(INVALID_WELCOME_LINK_MESSAGE);
      return;
    }

    if (!newPassword || !confirmPassword) {
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

    setLoading(true);
    setError("");

    try {
      await completeChangePassword(welcomeCredential, newPassword);
      capturedWelcomeCredential = "";
      setPasswordExchangeComplete(true);
    } catch {
      setError(INVALID_WELCOME_LINK_MESSAGE);
      setLoading(false);
    }
  };

  const retryOrganizationInitialization = (): void => {
    organizationInitializationStarted.current = false;
    setOrganizationInitializationComplete(false);
    setOrganizationInitializationAttempt((attempt) => attempt + 1);
    setError("");
    setLoading(true);
  };

  const returnToSignIn = async (): Promise<void> => {
    try {
      await logout();
    } finally {
      capturedWelcomeCredential = "";
      navigate("/login", { replace: true });
    }
  };

  if (handoffPending) {
    return (
      <Card
        sx={{ width: "100%", maxWidth, mx: "auto", color: "text.primary" }}
        data-testid="welcome-handoff"
      >
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          {error ? (
            <>
              <Alert
                severity="error"
                sx={{ mb: 2 }}
                data-testid="welcome-handoff-error"
              >
                {error}
              </Alert>
              <Button
                fullWidth
                color="actionable"
                variant="contained"
                onClick={retryOrganizationInitialization}
                data-testid="welcome-handoff-retry"
              >
                Try again
              </Button>
              <Button
                fullWidth
                variant="text"
                onClick={() => void returnToSignIn()}
                data-testid="welcome-handoff-sign-in"
                sx={{ mt: 1 }}
              >
                Return to sign in
              </Button>
            </>
          ) : (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 2,
                py: 2,
              }}
              data-testid="welcome-handoff-loading"
            >
              <CircularProgress size={32} />
              Finishing your setup...
            </Box>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      sx={{ width: "100%", maxWidth, mx: "auto", color: "text.primary" }}
      data-testid="welcome-card"
    >
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} data-testid="welcome-error">
            {error}
          </Alert>
        )}

        <Box
          component="form"
          onSubmit={handleSubmit}
          data-testid="welcome-form"
        >
          <TextField
            margin="dense"
            required
            fullWidth
            size="small"
            id="welcome-new-password"
            label={t(KEYS.auth.newPassword)}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              clearError();
            }}
            disabled={loading}
            inputProps={{ "data-testid": "welcome-new-password-input" }}
          />
          <TextField
            margin="dense"
            required
            fullWidth
            size="small"
            id="welcome-confirm-password"
            label={t(KEYS.auth.confirmPassword)}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearError();
            }}
            disabled={loading}
            inputProps={{ "data-testid": "welcome-confirm-password-input" }}
          />

          <Button
            type="submit"
            fullWidth
            color="actionable"
            variant="contained"
            sx={{ mt: 2, py: 1.25 }}
            disabled={loading}
            data-testid="welcome-submit"
          >
            {loading ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              "Get Started"
            )}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};

export default WelcomeSignInForm;
