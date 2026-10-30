import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Alert,
  Box,
  CircularProgress,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { usePathService } from "../../contexts";
import {
  useFileTaskHistory,
  type FileTaskHistoryKey,
} from "../../data/hooks/useFileTouchHistory";

export interface FileTouchHistoryPanelProps extends FileTaskHistoryKey {
  open: boolean;
  onClose: () => void;
}

export const FileTouchHistoryPanel: React.FC<FileTouchHistoryPanelProps> = ({
  open,
  onClose,
  organizationId,
  projectId,
  serviceId,
  normalizedPath,
}) => {
  const pathService = usePathService();
  const state = useFileTaskHistory({
    organizationId,
    projectId,
    serviceId,
    normalizedPath,
    active: open,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      closeControl={
        <IconButton
          aria-label="Close task history"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      }
    >
      <DialogTitle sx={{ pr: 6 }}>
        Task history
        <Typography variant="body2" color="text.secondary" noWrap>
          {normalizedPath}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {state.status === "loading" && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress aria-label="Loading task history" size={24} />
          </Box>
        )}

        {state.status === "error" && (
          <Alert severity="error">
            Couldn’t load task history: {state.error.message}
          </Alert>
        )}

        {state.status === "empty" && (
          <Alert severity="info">
            No tasks have historical evidence for this file.
          </Alert>
        )}

        {(state.status === "ready" || state.status === "updating") && (
          <>
            {state.status === "updating" && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Updating historical task evidence…
              </Alert>
            )}
            <List aria-label="Tasks that touched this file" disablePadding>
              {state.entries.map((entry, index) => (
                <React.Fragment key={entry.taskId}>
                  {index > 0 && <Divider component="li" />}
                  <ListItem alignItems="flex-start">
                    <ListItemText
                      primary={
                        <Link
                          component={RouterLink}
                          data-task-id={entry.taskId}
                          data-testid="file-task-history-task-link"
                          onClick={onClose}
                          to={pathService.task({
                            projectId,
                            taskId: entry.taskId,
                          })}
                        >
                          {entry.taskName}
                        </Link>
                      }
                      secondary={
                        <Box component="span" sx={{ display: "block" }}>
                          <Typography component="span" variant="body2">
                            {entry.taskType} · {entry.touchCount} touch
                            {entry.touchCount === 1 ? "" : "es"}
                          </Typography>
                          <Typography
                            component="span"
                            variant="body2"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            {entry.directFeatureName ??
                              entry.directFeatureId ??
                              "No direct feature"}
                            {entry.lastTouchedAt
                              ? ` · Last touched ${entry.lastTouchedAt}`
                              : ""}
                          </Typography>
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", mt: 0.5 }}
                          >
                            {entry.evidence.map((evidence, evidenceIndex) => (
                              <React.Fragment key={evidence.reportId}>
                                {evidenceIndex > 0 && " · "}
                                <Link
                                  component={RouterLink}
                                  data-agent-session-id={
                                    evidence.agentSessionId
                                  }
                                  data-testid="file-task-history-session-link"
                                  onClick={onClose}
                                  to={pathService.agentSession({
                                    projectId,
                                    agentSessionId: evidence.agentSessionId,
                                  })}
                                >
                                  {evidence.agentSessionTitle}
                                </Link>
                              </React.Fragment>
                            ))}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
