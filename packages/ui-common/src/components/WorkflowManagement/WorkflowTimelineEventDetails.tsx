import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
/**
 * Workflow Timeline Event Details Component
 *
 * Displays detailed information about a timeline event in a popover
 */

import React from "react";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CopyIcon from "@mui/icons-material/ContentCopy";
import type { Theme } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type { WorkflowTimelineEventDto } from "../../api";

interface WorkflowTimelineEventDetailsProps {
  /** Event to display details for */
  event: WorkflowTimelineEventDto | null;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
}

/**
 * Get color for event level
 */
const getEventLevelColor = (
  level: string | null | undefined,
  theme: Theme,
): string => {
  switch (level?.toLowerCase()) {
    case "error":
      return theme.palette.error.main;
    case "warn":
    case "warning":
      return theme.palette.warning.main;
    case "info":
      return theme.palette.info.main;
    case "debug":
      return theme.palette.grey[600];
    default:
      return theme.palette.text.secondary;
  }
};

/**
 * Format timestamp for display
 */
const formatTimestamp = (timestamp: string | null | undefined): string => {
  if (!timestamp) return "N/A";

  try {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
};

/**
 * Recursively parse stringified JSON values
 */
const deepParse = (value: unknown): unknown => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      // Recursively parse the result
      return deepParse(parsed);
    } catch {
      // Not JSON, return as-is
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepParse(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deepParse(v);
    }
    return result;
  }

  return value;
};

/**
 * Parse double-stringified JSON values in metadata
 */
const parseMetadata = (
  metadata: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    result[key] = deepParse(value);
  }

  return result;
};

export const WorkflowTimelineEventDetails: React.FC<
  WorkflowTimelineEventDetailsProps
> = ({ event, open, onClose }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!event) return null;

  const eventColor = getEventLevelColor(event.level, theme);

  const handleCopyEvent = (): void => {
    const eventData = JSON.stringify(event, null, 2);
    navigator.clipboard.writeText(eventData);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      sx={{
        "& .MuiDialog-paper": {
          maxHeight: "80vh",
        },
      }}
      closeControl={
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6">
            {t("workflow.timeline.eventDetails", "Event Details")}
          </Typography>
          <Chip
            label={event.level?.toUpperCase() || "LOG"}
            size="small"
            sx={{
              bgcolor: eventColor,
              color: "white",
              fontWeight: 600,
            }}
          />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Tooltip title={t("workflow.timeline.copyEvent", "Copy Event")}>
            <IconButton size="small" onClick={handleCopyEvent}>
              <CopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Timestamp */}
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("workflow.timeline.timestamp", "Timestamp")}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
              {formatTimestamp(event.at)}
            </Typography>
          </Box>

          <Divider />

          {/* Logger */}
          {event.logger && (
            <>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("workflow.timeline.logger", "Logger")}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {event.logger}
                </Typography>
              </Box>
              <Divider />
            </>
          )}

          {/* Message */}
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("workflow.timeline.message", "Message")}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {event.message}
            </Typography>
          </Box>

          {/* Metadata */}
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <>
              <Divider />
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  gutterBottom
                >
                  {t("workflow.timeline.metadata", "Metadata")}
                </Typography>
                <Box
                  sx={{
                    bgcolor:
                      theme.palette.mode === "dark" ? "grey.900" : "grey.50",
                    p: 2,
                    borderRadius: 1,
                    border: `1px solid ${theme.palette.divider}`,
                    maxHeight: "300px",
                    overflow: "auto",
                  }}
                >
                  <Typography
                    component="pre"
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(parseMetadata(event.metadata), null, 2)}
                  </Typography>
                </Box>
              </Box>
            </>
          )}

          {/* Event Type */}
          {event.type && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("workflow.timeline.eventType", "Event Type")}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {event.type}
                </Typography>
              </Box>
            </>
          )}

          {/* Line Number */}
          {event.line !== null && event.line !== undefined && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("workflow.timeline.lineNumber", "Line Number")}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {event.line}
                </Typography>
              </Box>
            </>
          )}

          {/* Confidence */}
          {event.confidence && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("workflow.timeline.confidence", "Confidence")}
                </Typography>
                <Chip
                  label={event.confidence}
                  size="small"
                  variant="outlined"
                  sx={{ mt: 0.5 }}
                />
              </Box>
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          {t("common.close", "Close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
