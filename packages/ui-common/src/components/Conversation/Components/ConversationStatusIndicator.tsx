import { Alert, Box } from "@mui/material";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import { ConversationStatus } from "../../../api";
import { KEYS } from "../../../i18n/keys";
import { useConversationContext } from "./ConversationContext";

interface ConversationStatusIndicatorProps {
  /** Preserve data attributes for testing */
  "data-testid"?: string;
}

/**
 * Displays workflow status with animations and appropriate messaging.
 * Extracted from ConversationViewer.tsx lines 950-979.
 *
 * @param props - Component props
 * @returns JSX element displaying workflow status
 */
export const ConversationStatusIndicator: React.FC<ConversationStatusIndicatorProps> =
  memo(({ "data-testid": dataTestId }) => {
    const { t } = useTranslation();
    // Get context data instead of props
    const { workflowStatus, activeConversation } = useConversationContext();

    const isGeneratingResponse =
      activeConversation?.status === ConversationStatus.GeneratingResponse;

    if (isGeneratingResponse) {
      return null;
    }

    return (
      <Box data-testid={dataTestId}>
        {/* Show error state */}
        {workflowStatus.status === "failed" && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {workflowStatus.message || t(KEYS.conversation.failed)}
          </Alert>
        )}
      </Box>
    );
  });
