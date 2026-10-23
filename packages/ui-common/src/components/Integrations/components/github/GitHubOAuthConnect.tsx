import React, { useState } from "react";
import { Box, Button, Alert, CircularProgress } from "@mui/material";
import GitHubIcon from "@mui/icons-material/GitHub";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../../i18n/keys";
import { unifiedApiClient } from "../../../../clients/serviceClients";

interface GitHubOAuthConnectProps {
  organizationId: string;
  projectId: string;
  integrationId: string;
  onError?: (error: string) => void;
  disabled?: boolean;
}

/**
 * Button component that initiates the GitHub OAuth flow.
 * Redirects the user to GitHub for authorization.
 */
export const GitHubOAuthConnect: React.FC<GitHubOAuthConnectProps> = ({
  organizationId,
  projectId,
  integrationId,
  onError,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // Store state in sessionStorage for CSRF protection
      const state = `${organizationId}:${projectId}:${Date.now()}`;
      sessionStorage.setItem("github_oauth_state", state);

      // Call the authorize endpoint - backend will redirect to GitHub
      const apiUrl = `${unifiedApiClient["client"]["basePath"]}/organizations/${organizationId}/projects/${projectId}/integrations/github/authorize?integrationId=${integrationId}`;

      // Redirect browser to the authorization endpoint
      window.location.href = apiUrl;
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to initiate GitHub authorization";
      setError(errorMessage);
      onError?.(errorMessage);
      setIsConnecting(false);
    }
  };

  return (
    <Box>
      <Button
        variant="contained"
        color="primary"
        size="large"
        startIcon={
          isConnecting ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            <GitHubIcon />
          )
        }
        onClick={handleConnect}
        disabled={disabled || isConnecting}
        fullWidth
        sx={{ py: 1.5 }}
      >
        {isConnecting
          ? t(KEYS.integrations.github.connecting)
          : t(KEYS.integrations.github.connectGitHub)}
      </Button>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ mt: 2 }}>
        <Alert severity="info">
          {t(KEYS.integrations.github.oauthRedirectInfo)}
        </Alert>
      </Box>
    </Box>
  );
};
