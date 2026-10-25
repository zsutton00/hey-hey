import { useModalState } from "../../../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../../../Modals/FunctionalDialog";
import React, { useState } from "react";
import {
  Box,
  Button,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Alert,
  CircularProgress,
} from "@mui/material";
import DisconnectIcon from "@mui/icons-material/LinkOff";
import ReconnectIcon from "@mui/icons-material/Refresh";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../../i18n/keys";
import { useIntegrationService } from "../../../../hooks/useIntegrationService";
import type {
  UpdateIntegrationDto,
  GitHubIntegrationConfig,
} from "../../../../api";

interface GitHubAccountControlsProps {
  organizationId: string;
  projectId: string;
  integrationId: string;
  isConnected: boolean;
  onDisconnectSuccess?: () => void;
  onError?: (error: string) => void;
}

/**
 * Controls for managing GitHub OAuth connection including
 * disconnect (clear tokens) and reconnect (re-initiate OAuth) actions.
 */
export const GitHubAccountControls: React.FC<GitHubAccountControlsProps> = ({
  organizationId,
  projectId,
  integrationId,
  isConnected,
  onDisconnectSuccess,
  onError,
}) => {
  const { t } = useTranslation();
  const { updateIntegration } = useIntegrationService();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [
    showDisconnectDialog,
    setShowDisconnectDialog,
    showDisconnectDialogOwnerKey,
  ] = useModalState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    setError(null);

    try {
      // Clear OAuth tokens from integration config
      const updateData: UpdateIntegrationDto = {
        config: {
          type: "GITHUB",
          token: undefined,
          refreshToken: undefined,
          tokenExpiresAt: undefined,
          refreshTokenExpiresAt: undefined,
          scope: undefined,
          tokenType: undefined,
        } as GitHubIntegrationConfig,
      };

      await updateIntegration(projectId, integrationId, updateData);
      setShowDisconnectDialog(false);
      onDisconnectSuccess?.();
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to disconnect GitHub account";
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleReconnect = () => {
    // Redirect to authorize endpoint for reconnection
    const apiUrl = `${window.location.origin}/api/v1/organizations/${organizationId}/projects/${projectId}/integrations/github/authorize?integrationId=${integrationId}`;
    window.location.href = apiUrl;
  };

  return (
    <Box>
      <Box display="flex" gap={2}>
        {isConnected ? (
          <>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<DisconnectIcon />}
              onClick={() => setShowDisconnectDialog(true)}
              disabled={isDisconnecting}
            >
              {t(KEYS.integrations.github.disconnect)}
            </Button>
            <Button
              variant="outlined"
              startIcon={<ReconnectIcon />}
              onClick={handleReconnect}
              disabled={isDisconnecting}
            >
              {t(KEYS.integrations.github.reconnect)}
            </Button>
          </>
        ) : (
          <Button
            variant="outlined"
            startIcon={<ReconnectIcon />}
            onClick={handleReconnect}
          >
            {t(KEYS.integrations.github.reconnect)}
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {/* Disconnect Confirmation Dialog */}
      <Dialog
        ownerKey={showDisconnectDialogOwnerKey}
        open={showDisconnectDialog}
        onClose={() => !isDisconnecting && setShowDisconnectDialog(false)}
      >
        <DialogTitle>
          {t(KEYS.integrations.github.disconnectConfirmTitle)}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t(KEYS.integrations.github.disconnectConfirmMessage)}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowDisconnectDialog(false)}
            disabled={isDisconnecting}
          >
            {t(KEYS.common.cancel)}
          </Button>
          <Button
            onClick={handleDisconnect}
            color="warning"
            variant="contained"
            disabled={isDisconnecting}
            startIcon={
              isDisconnecting ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <DisconnectIcon />
              )
            }
          >
            {isDisconnecting
              ? t(KEYS.integrations.github.disconnecting)
              : t(KEYS.integrations.github.disconnect)}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
