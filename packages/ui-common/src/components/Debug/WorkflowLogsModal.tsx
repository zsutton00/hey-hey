import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  List,
  ListItem,
  Chip,
  Alert,
  IconButton,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

interface WorkflowLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
  data?: Record<string, unknown>;
}

interface WorkflowLogsModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Workflow ID for fetching logs */
  workflowId?: string;
  /** Function to fetch logs */
  onFetchLogs: () => Promise<WorkflowLogEntry[]>;
}

export const WorkflowLogsModal: React.FC<WorkflowLogsModalProps> = ({
  open,
  onClose,
  workflowId,
  onFetchLogs,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [logs, setLogs] = useState<WorkflowLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());

  const fetchLogs = async (): Promise<void> => {
    if (!workflowId) return;

    setIsLoading(true);
    setError(null);

    try {
      const fetchedLogs = await onFetchLogs();
      setLogs(fetchedLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch logs when modal opens
  useEffect(() => {
    if (open && workflowId) {
      fetchLogs();
    }
  }, [open, workflowId]);

  const getLogLevelColor = (level: WorkflowLogEntry["level"]): string => {
    switch (level) {
      case "error":
        return theme.palette.error.main;
      case "warn":
        return theme.palette.warning.main;
      case "info":
        return theme.palette.info.main;
      case "debug":
        return theme.palette.grey[600];
      default:
        return theme.palette.text.secondary;
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const toggleLogExpansion = (index: number): void => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedLogs(newExpanded);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      sx={{
        "& .MuiDialog-paper": {
          height: "80vh",
          maxHeight: "800px",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Typography variant="h6">
          {t("debug.workflowLogs", "Workflow Logs")}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Tooltip title={t("debug.refreshLogs", "Refresh Logs")}>
            <IconButton
              size="small"
              onClick={fetchLogs}
              disabled={isLoading}
              sx={{ padding: 0.5 }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose} sx={{ padding: 0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0, overflow: "hidden" }}>
        {!workflowId ? (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography color="text.secondary">
              {t("debug.noWorkflowId", "No workflow ID provided")}
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ p: 3 }}>
            <Alert severity="error">
              {t("debug.errorFetchingLogs", "Error fetching logs")}: {error}
            </Alert>
          </Box>
        ) : isLoading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              p: 4,
            }}
          >
            <CircularProgress />
            <Typography sx={{ ml: 2 }}>
              {t("debug.loadingLogs", "Loading logs...")}
            </Typography>
          </Box>
        ) : logs.length === 0 ? (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography color="text.secondary">
              {t("debug.noLogs", "No logs available")}
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0, height: "100%", overflow: "auto" }}>
            {logs.map((log, index) => {
              const isExpanded = expandedLogs.has(index);
              const hasData = log.data && Object.keys(log.data).length > 0;

              return (
                <ListItem
                  key={index}
                  sx={{
                    flexDirection: "column",
                    alignItems: "stretch",
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    "&:last-child": {
                      borderBottom: "none",
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      width: "100%",
                      gap: 1,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                        flex: 1,
                      }}
                    >
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Chip
                          label={log.level.toUpperCase()}
                          size="small"
                          sx={{
                            bgcolor: getLogLevelColor(log.level),
                            color: "white",
                            fontWeight: 600,
                            fontSize: "0.7rem",
                            minWidth: "60px",
                          }}
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: "monospace" }}
                        >
                          {formatTimestamp(log.timestamp)}
                        </Typography>
                        {log.source && (
                          <Chip
                            label={log.source}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: "0.7rem" }}
                          />
                        )}
                      </Box>

                      <Typography
                        variant="body2"
                        sx={{
                          wordBreak: "break-word",
                          fontFamily:
                            log.message.includes("{") ||
                            log.message.includes("[")
                              ? "monospace"
                              : "inherit",
                        }}
                      >
                        {log.message}
                      </Typography>
                    </Box>

                    {hasData && (
                      <IconButton
                        size="small"
                        onClick={() => toggleLogExpansion(index)}
                        sx={{ padding: 0.5 }}
                      >
                        {isExpanded ? (
                          <ExpandLessIcon fontSize="small" />
                        ) : (
                          <ExpandMoreIcon fontSize="small" />
                        )}
                      </IconButton>
                    )}
                  </Box>

                  {hasData && isExpanded && (
                    <Box
                      sx={{
                        mt: 1,
                        p: 1,
                        bgcolor:
                          theme.palette.mode === "dark"
                            ? "grey.900"
                            : "grey.50",
                        borderRadius: 1,
                        border: `1px solid ${theme.palette.divider}`,
                      }}
                    >
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.5 }}
                      >
                        {t("debug.additionalData", "Additional Data")}:
                      </Typography>
                      <Typography
                        variant="body2"
                        component="pre"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          margin: 0,
                        }}
                      >
                        {JSON.stringify(log.data, null, 2)}
                      </Typography>
                    </Box>
                  )}
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>

      <DialogActions
        sx={{ borderTop: `1px solid ${theme.palette.divider}`, px: 3, py: 2 }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {logs.length > 0 &&
            t("debug.logCount", "{{count}} log entries", {
              count: logs.length,
            })}
        </Typography>
        <Button onClick={onClose} variant="contained">
          {t("common.close", "Close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
