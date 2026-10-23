import { Alert, Box, Button, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";
import { KEYS } from "../i18n/keys";
import type { MessageRetryState } from "../types/conversation";

interface SystemMessageErrorProps {
  /** Retry state for failed messages */
  retryState?: MessageRetryState;
  /** Generic error message to display for failed messages */
  errorMessage?: string;
}

/**
 * SystemMessageError component that displays error states with retry functionality.
 * This component is designed to only show generic error messages and never expose
 * technical error details or actual message content.
 */
export const SystemMessageError: React.FC<SystemMessageErrorProps> = ({
  retryState,
  errorMessage = "Something went wrong. Please try again.",
}) => {
  const { t } = useTranslation();

  return (
    <Box sx={{ mb: 2 }}>
      <Alert
        severity="error"
        sx={{
          mb: 2,
          backgroundColor: "transparent",
          border: "none",
          padding: 0,
        }}
      >
        <Typography variant="body2" sx={{ mb: 1 }}>
          {errorMessage}
        </Typography>

        {retryState && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              onClick={retryState.retry}
              disabled={retryState.isRetrying}
              sx={{
                minWidth: "auto",
                px: 2,
                py: 0.5,
                fontSize: "0.875rem",
              }}
            >
              {retryState.isRetrying
                ? t(KEYS.common.retrying)
                : t(KEYS.common.retry)}
            </Button>

            {retryState.isPolling && retryState.retryStatus && (
              <Typography variant="caption" sx={{ ml: 1, opacity: 0.8 }}>
                Retry Count: {retryState.retryStatus.retryCount}
                {retryState.retryStatus.failedWorkflowStep &&
                  ` - Failed at: ${retryState.retryStatus.failedWorkflowStep}`}
              </Typography>
            )}
          </Box>
        )}
      </Alert>
    </Box>
  );
};
