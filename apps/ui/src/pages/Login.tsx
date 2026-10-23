import React, { useState } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  TextField,
  Typography,
  Alert,
  CircularProgress,
} from "@mui/material";
import { useAuth } from "@hey-hey/ui-common/context";
import { useTranslation } from "react-i18next";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { resolveAuthReturnTarget } from "../utils/authReturnTarget";

const PASSWORD_RECOVERY_ACKNOWLEDGEMENT =
  "We've sent an email with recovery instructions";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    login,
    initiatePasswordRecovery,
    isAuthenticated,
  } = useAuth();
  const { t } = useTranslation();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryAcknowledgement, setRecoveryAcknowledgement] = useState("");

  const from = resolveAuthReturnTarget(location);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error when user starts typing
    if (error) setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      setError("Please fill in all fields");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await login(formData);
      if ("mustChangePassword" in result) {
        navigate("/change-password", {
          replace: true,
          state: { passwordChangeToken: result.passwordChangeToken, from },
        });
        return;
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await initiatePasswordRecovery(recoveryEmail);
      setRecoveryAcknowledgement(PASSWORD_RECOVERY_ACKNOWLEDGEMENT);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to request recovery"
      );
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  // If user is not authenticated, show login form
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
              sx={{ mb: 3 }}
            >
              Welcome Back
            </Typography>

            <Typography
              variant="body2"
              align="center"
              color="text.secondary"
              sx={{ mb: 3 }}
            >
              Sign in to continue to your projects
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
              <TextField
                margin="normal"
                required
                fullWidth
                id="email"
                label="Email Address"
                name="email"
                autoComplete="email"
                autoFocus
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label="Password"
                type="password"
                id="password"
                autoComplete="current-password"
                value={formData.password}
                onChange={handleChange}
                disabled={loading}
              />

              <Button
                type="submit"
                fullWidth
                color="actionable"
                variant="contained"
                sx={{ mt: 3, mb: 2, py: 1.5 }}
                disabled={loading}
              >
                {loading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  t(KEYS.auth.signIn)
                )}
              </Button>
              <Button
                type="button"
                fullWidth
                variant="text"
                onClick={() => {
                  setShowRecovery((visible) => !visible);
                  setRecoveryAcknowledgement("");
                  setError("");
                }}
                aria-expanded={showRecovery}
                data-testid="forgot-credentials-button"
              >
                Forgot credentials?
              </Button>
            </Box>

            {showRecovery && (
              <Box
                component="form"
                onSubmit={handleRecoverySubmit}
                data-testid="password-recovery-form"
                sx={{ mt: 2 }}
              >
                {recoveryAcknowledgement ? (
                  <Alert
                    severity="success"
                    data-testid="password-recovery-acknowledgement"
                  >
                    {recoveryAcknowledgement}
                  </Alert>
                ) : (
                  <>
                    <TextField
                      required
                      fullWidth
                      type="email"
                      label="Email Address"
                      autoComplete="email"
                      value={recoveryEmail}
                      onChange={(event) => setRecoveryEmail(event.target.value)}
                      disabled={loading}
                      inputProps={{ "data-testid": "password-recovery-email" }}
                    />
                    <Button
                      type="submit"
                      fullWidth
                      variant="outlined"
                      disabled={loading}
                      data-testid="password-recovery-submit"
                      sx={{ mt: 2 }}
                    >
                      Send recovery instructions
                    </Button>
                  </>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default Login;
