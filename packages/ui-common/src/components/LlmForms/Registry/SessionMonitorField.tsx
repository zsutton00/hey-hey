import { Box, Chip, Typography } from "@mui/material";
import React from "react";
import type {
  SessionMonitorContinuationCompletionAction,
  SessionMonitorSystemMessageData,
} from "../../../api";
import { SessionMonitorOutcome } from "../../../api";
import type { FieldComponentProps } from "./types";

function isActionCompletion(
  cc: SessionMonitorSystemMessageData["continuationCompletion"]
): cc is SessionMonitorContinuationCompletionAction {
  return !!cc && "action" in cc;
}

export const SessionMonitorField: React.FC<FieldComponentProps> = ({
  config,
  context,
}) => {
  const messageData = context.messageData as
    | SessionMonitorSystemMessageData
    | undefined;
  if (!messageData) return null;

  const cc = messageData.continuationCompletion;
  const badgeLabel = isActionCompletion(cc) ? cc.action : messageData.outcome;
  const bodyText =
    (isActionCompletion(cc) ? cc.response : undefined) ?? messageData.content;

  const chipColor =
    badgeLabel === SessionMonitorOutcome.Continued
      ? "success"
      : badgeLabel === SessionMonitorOutcome.Deferred
      ? "warning"
      : "info";

  return (
    <Box
      data-testid={`session-monitor-field-${config.field}`}
      sx={(theme) => ({
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(103, 58, 183, 0.12)"
            : "rgba(103, 58, 183, 0.08)",
        borderRadius: 1,
        padding: 2,
        boxShadow: "none",
        minHeight: "auto",
      })}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: bodyText ? 1 : 0,
        }}
      >
        <Chip label={badgeLabel} size="small" color={chipColor} />
      </Box>
      {bodyText && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {bodyText}
        </Typography>
      )}
    </Box>
  );
};
