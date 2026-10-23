import React from "react";
import { Box, Typography, Alert } from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../../i18n/keys";
import { GitHubOAuthConnect } from "./GitHubOAuthConnect";
import { GitHubConnectionStatus } from "./GitHubConnectionStatus";
import { GitHubAccountControls } from "./GitHubAccountControls";
import type { IntegrationResponseDto } from "../../../../api";
import { IntegrationConnectionStatus } from "../../../../api";
import type { GitHubIntegrationConfig } from "../../../../api";

interface GitHubIntegrationFormProps {
  integration: IntegrationResponseDto;
  organizationId: string;
  projectId: string;
  onConnectionChange?: () => void;
}

/**
 * GitHub integration form using OAuth flow.
 * Replaces the old token-based authentication with GitHub OAuth.
 *
 * Flow:
 * 1. Integration is created with basic info (name, description)
 * 2. User clicks "Connect GitHub Account" button
 * 3. Redirects to GitHub for authorization
 * 4. GitHub redirects to backend callback
 * 5. Backend updates integration with OAuth tokens
 * 6. User is redirected back to integrations page
 */
export const GitHubIntegrationForm: React.FC<GitHubIntegrationFormProps> = ({
  integration,
  organizationId,
  projectId,
  onConnectionChange,
}) => {
  const { t } = useTranslation();

  const config = integration.config;
  const hasToken = !!(
    config &&
    typeof config === "object" &&
    "token" in config &&
    config.token
  );
  const isConnected =
    hasToken &&
    integration.connectionStatus === IntegrationConnectionStatus.Connected;

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t(KEYS.integrations.github.configuration)}
      </Typography>

      {!isConnected && !hasToken && (
        <Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t(KEYS.integrations.github.oauthFlowDescription)}
          </Alert>
          <GitHubOAuthConnect
            organizationId={organizationId}
            projectId={projectId}
            integrationId={integration.id}
            onError={(error) => {
              console.error("OAuth connection error:", error);
            }}
          />
        </Box>
      )}

      {hasToken && config && typeof config === "object" && (
        <Box>
          <GitHubConnectionStatus
            config={config as GitHubIntegrationConfig}
            lastConnectionCheck={integration.lastConnectionCheck ?? undefined}
          />

          <Box sx={{ mt: 3 }}>
            <GitHubAccountControls
              organizationId={organizationId}
              projectId={projectId}
              integrationId={integration.id}
              isConnected={isConnected}
              onDisconnectSuccess={onConnectionChange}
              onError={(error) => {
                console.error("Account control error:", error);
              }}
            />
          </Box>
        </Box>
      )}

      {!isConnected && hasToken && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t(KEYS.integrations.github.tokenExpiredWarning)}
        </Alert>
      )}
    </Box>
  );
};
