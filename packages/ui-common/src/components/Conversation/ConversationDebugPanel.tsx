import React from "react";
import { Box, Paper, Typography } from "@mui/material";
import type { ConversationMessage } from "../../types/conversation";
import type { WorkflowState } from "../../types/WorkflowState";

interface ConversationDebugPanelProps {
  workflowStatus: WorkflowState;
  isSubmitting: boolean;
  conversationTimeline: ConversationMessage[];
  sidebarWidth?: number;
}

export const ConversationDebugPanel: React.FC<ConversationDebugPanelProps> = ({
  workflowStatus,
  isSubmitting,
  conversationTimeline,
  sidebarWidth,
}) => {
  // Only show in development
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <Paper
      elevation={1}
      sx={{
        p: 2,
        mb: 2,
        backgroundColor: "grey.50",
        border: "1px dashed",
        borderColor: "warning.main",
        width: sidebarWidth ? `${sidebarWidth}px` : "100%",
      }}
    >
      <Typography variant="h6" color="warning.main" gutterBottom>
        🐛 Debug Information
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="body2">
          <strong>Workflow Status:</strong>
        </Typography>
        <Box sx={{ pl: 2, fontSize: "0.75rem", fontFamily: "monospace" }}>
          <div>• canSubmit: {workflowStatus.canSubmit ? "✅" : "❌"}</div>
          <div>• status: {workflowStatus.status}</div>
          <div>• message: {workflowStatus.message}</div>
          <div>• showLoader: {workflowStatus.showLoader ? "✅" : "❌"}</div>
        </Box>

        <Typography variant="body2" sx={{ mt: 1 }}>
          <strong>Form States:</strong>
        </Typography>
        <Box sx={{ pl: 2, fontSize: "0.75rem", fontFamily: "monospace" }}>
          <div>• isSubmitting: {isSubmitting ? "✅" : "❌"}</div>
        </Box>

        <Typography variant="body2" sx={{ mt: 1 }}>
          <strong>
            Current Timeline ({conversationTimeline.length} messages):
          </strong>
        </Typography>
        <Box
          sx={{
            pl: 2,
            fontSize: "0.75rem",
            fontFamily: "monospace",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {conversationTimeline.map((msg, index) => {
            const disabled =
              !msg.canEdit || !workflowStatus.canSubmit || isSubmitting;

            return (
              <div key={msg.message.id} style={{ marginBottom: "4px" }}>
                <strong>#{index + 1}:</strong>
                <div style={{ paddingLeft: "16px" }}>
                  <div>• id: {msg.message.id.slice(0, 8)}...</div>
                  <div>• type: {msg.message.data?.type || "unknown"}</div>
                  <div>• state: {msg.state}</div>
                  <div>• canEdit: {msg.canEdit ? "✅" : "❌"}</div>
                  <div>
                    • hasUIElements:{" "}
                    {(msg.message.data as { uiElements?: unknown[] })
                      ?.uiElements?.length
                      ? "✅"
                      : "❌"}
                  </div>
                  <div>
                    • <strong>DISABLED: {disabled ? "❌ YES" : "✅ NO"}</strong>
                  </div>
                  {disabled && (
                    <div style={{ color: "#d32f2f", paddingLeft: "8px" }}>
                      Reasons:
                      {!msg.canEdit && <div>- Message not editable</div>}
                      {!workflowStatus.canSubmit && (
                        <div>- Workflow doesn't allow submit</div>
                      )}
                      {isSubmitting && <div>- Currently submitting</div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
};
