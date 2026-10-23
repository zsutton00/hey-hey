import { usePlatformAdminAccess } from "@hey-hey/ui-common/data";
import React, { useState } from "react";
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
import { getApiClient } from "@hey-hey/ui-common/clients";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { useTranslation } from "react-i18next";
import type { OnboardBetaUserDto } from "@hey-hey/ui-common/api";

interface SuccessState {
  email: string;
  name: string;
  organizationName: string;
}

const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const BetaOnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const { isPlatformAdmin } = usePlatformAdminAccess();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<SuccessState | null>(null);

  if (!isPlatformAdmin) {
    return (
      <Container component="main" maxWidth="sm">
        <Box sx={{ marginTop: 8 }}>
          <Alert severity="error">{t(KEYS.betaOnboarding.accessDenied)}</Alert>
        </Box>
      </Container>
    );
  }

  const isFormValid = (): boolean =>
    email.trim().length > 0 &&
    isValidEmail(email) &&
    name.trim().length > 0 &&
    organizationName.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!isFormValid()) {
      if (!email.trim()) {
        setError(t(KEYS.forms.required));
      } else if (!isValidEmail(email)) {
        setError(t(KEYS.forms.invalidEmail));
      } else if (!name.trim()) {
        setError(t(KEYS.forms.required));
      } else if (!organizationName.trim()) {
        setError(t(KEYS.forms.required));
      } else {
        setError(t(KEYS.forms.required));
      }
      return;
    }

    setLoading(true);
    setError("");
    setSuccess(null);

    try {
      const dto: OnboardBetaUserDto = {
        email: email.trim(),
        name: name.trim(),
        organizationName: organizationName.trim(),
      };
      await getApiClient().onboardBetaUser({ onboardBetaUserDto: dto });
      setSuccess({
        email: email.trim(),
        name: name.trim(),
        organizationName: organizationName.trim(),
      });
      setEmail("");
      setName("");
      setOrganizationName("");
    } catch (err) {
      const errorObj = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      setError(
        errorObj.response?.data?.message ??
          errorObj.message ??
          t(KEYS.alerts.errorOccurred),
      );
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
        <Card sx={{ width: "100%", maxWidth: 480 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography
              component="h1"
              variant="h4"
              align="center"
              gutterBottom
              sx={{ mb: 3 }}
            >
              {t(KEYS.betaOnboarding.title)}
            </Typography>

            {success && (
              <Alert
                severity="success"
                sx={{ mb: 2 }}
                data-testid="beta-onboarding-success"
              >
                {t(KEYS.betaOnboarding.successMessage)} — {success.name} (
                {success.email})
              </Alert>
            )}

            {error && (
              <Alert
                severity="error"
                sx={{ mb: 2 }}
                data-testid="beta-onboarding-error"
              >
                {error}
              </Alert>
            )}

            <Box
              component="form"
              onSubmit={handleSubmit}
              data-testid="beta-onboarding-form"
            >
              <TextField
                margin="normal"
                required
                fullWidth
                id="beta-email"
                label={t(KEYS.betaOnboarding.emailLabel)}
                name="email"
                type="email"
                autoComplete="off"
                autoFocus
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError("");
                }}
                disabled={loading}
                inputProps={{ "data-testid": "beta-email-input" }}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="beta-name"
                label={t(KEYS.betaOnboarding.nameLabel)}
                name="name"
                type="text"
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError("");
                }}
                disabled={loading}
                inputProps={{ "data-testid": "beta-name-input" }}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="beta-organization-name"
                label={t(KEYS.betaOnboarding.organizationNameLabel)}
                name="organizationName"
                type="text"
                autoComplete="off"
                value={organizationName}
                onChange={(e) => {
                  setOrganizationName(e.target.value);
                  if (error) setError("");
                }}
                disabled={loading}
                inputProps={{ "data-testid": "beta-organization-name-input" }}
              />

              <Button
                type="submit"
                fullWidth
                color="actionable"
                variant="contained"
                sx={{ mt: 3, mb: 2, py: 1.5 }}
                disabled={loading || !isFormValid()}
                data-testid="beta-onboarding-submit"
              >
                {loading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  t(KEYS.betaOnboarding.submit)
                )}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};
