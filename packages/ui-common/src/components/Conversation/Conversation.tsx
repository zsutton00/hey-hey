import { Alert, Snackbar } from "@mui/material";
import { useState } from "react";
import {
  ConversationViewer,
  type PersistedConversationViewerProps,
} from "./ConversationViewer";

export interface ConversationManagerProps
  extends PersistedConversationViewerProps {
  /**
   * Callback when conversation is updated via manual refresh
   * Optional - WebSocket auto-invalidation handles most real-time updates
   */
  onConversationUpdated?: () => Promise<void>;
}

export const Conversation = ({
  conversation,
  project,
  onConversationUpdated,
  onSubmitOnboardingReply,
  onSubmitRepositoryImportReply,
  ...viewerProps
}: ConversationManagerProps) => {
  const [notification, setNotification] = useState<{
    message: string;
    severity: "info" | "warning" | "error";
  } | null>(null);

  // Real-time updates are handled at the collection level

  return (
    <>
      <ConversationViewer
        conversation={conversation}
        project={project}
        onConversationUpdated={onConversationUpdated}
        onSubmitOnboardingReply={onSubmitOnboardingReply}
        onSubmitRepositoryImportReply={onSubmitRepositoryImportReply}
        {...viewerProps}
      />

      {/* System Notifications */}
      <Snackbar
        open={!!notification}
        autoHideDuration={6000}
        onClose={() => setNotification(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          onClose={() => setNotification(null)}
          severity={notification?.severity || "info"}
          sx={{ width: "100%" }}
        >
          {notification?.message}
        </Alert>
      </Snackbar>
    </>
  );
};
