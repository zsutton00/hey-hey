import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
/**
 * Context Management Panel Component
 *
 * Manages workflow context versions including snapshot creation,
 * rollback functionality, and shared context management
 */

import React, { useState } from "react";
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Paper,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  IconButton,
  Tooltip,
} from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import RestoreIcon from "@mui/icons-material/Restore";
import SnapshotIcon from "@mui/icons-material/CameraAlt";
import ShareIcon from "@mui/icons-material/Share";
import TimeIcon from "@mui/icons-material/Schedule";
import PersonIcon from "@mui/icons-material/Person";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import {
  useContextVersions,
  useCreateContextSnapshot,
  useRollbackContextVersion,
} from "../../hooks/useWorkflowData";
import type {
  ContextVersion,
  SharedContext,
  ContextRollbackRequest,
} from "../../types/workflow";

interface ContextManagementPanelProps {
  workflowId: string;
}

interface RollbackDialogProps {
  open: boolean;
  version: ContextVersion | null;
  onClose: () => void;
  onConfirm: (rollbackRequest: ContextRollbackRequest) => void;
  isLoading: boolean;
}

const RollbackDialog: React.FC<RollbackDialogProps> = ({
  open,
  version,
  onClose,
  onConfirm,
  isLoading,
}) => {
  const { t } = useTranslation();

  const handleConfirm = () => {
    if (!version) return;

    const rollbackRequest: ContextRollbackRequest = {
      targetVersionId: version.id,
      reason: t(KEYS.workflow.context.userRequestedRollback),
      rollbackBy: "user",
      preserveCurrentAsSnapshot: true,
    };

    onConfirm(rollbackRequest);
  };

  if (!version) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      closeControl={
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      }
    >
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6">Confirm Rollback</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This action will rollback the workflow context to version{" "}
          {version.version}. The current context will be saved as a snapshot
          before rollback.
        </Alert>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Target Version Details:
          </Typography>
          <Box sx={{ pl: 2 }}>
            <Typography variant="body2">
              <strong>Version:</strong>{" "}
              {t(KEYS.workflow.context.version, { version: version.version })}
            </Typography>
            <Typography variant="body2">
              <strong>Created:</strong>{" "}
              {new Date(version.timestamp).toLocaleString()}
            </Typography>
            <Typography variant="body2">
              <strong>Reason:</strong> {version.metadata.reason}
            </Typography>
            <Typography variant="body2">
              <strong>Created by:</strong> {version.metadata.createdBy}
            </Typography>
          </Box>
        </Box>

        {version.metadata.tags.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Tags:
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", pl: 2 }}>
              {version.metadata.tags.map((tag) => (
                <Chip key={tag} label={tag} size="small" variant="outlined" />
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="warning"
          disabled={isLoading}
          startIcon={
            isLoading ? <CircularProgress size={16} /> : <RestoreIcon />
          }
        >
          {isLoading ? "Rolling back..." : t(KEYS.workflow.context.rollback)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const ContextManagementPanel: React.FC<ContextManagementPanelProps> = ({
  workflowId,
}) => {
  const { t } = useTranslation();
  const [
    rollbackDialogOpen,
    setRollbackDialogOpen,
    rollbackDialogOpenOwnerKey,
  ] = useModalState(false);
  const [selectedVersion, setSelectedVersion] = useState<ContextVersion | null>(
    null,
  );

  const {
    data: contextData,
    isLoading: contextLoading,
    error: contextError,
  } = useContextVersions(workflowId);

  const createSnapshotMutation = useCreateContextSnapshot();
  const rollbackMutation = useRollbackContextVersion();

  const versions: ContextVersion[] = contextData?.data.versions || [];
  const sharedContexts: SharedContext[] =
    contextData?.data.sharedContexts || [];

  const handleCreateSnapshot = async () => {
    try {
      await createSnapshotMutation.mutateAsync({
        workflowId,
        metadata: {
          reason: t(KEYS.workflow.context.manualSnapshot),
          createdBy: "user",
          tags: [
            t(KEYS.workflow.context.manual),
            t(KEYS.workflow.context.checkpoint),
          ],
        },
      });
    } catch (error) {
      console.error("Failed to create snapshot:", error);
    }
  };

  const handleRollbackClick = (version: ContextVersion) => {
    setSelectedVersion(version);
    setRollbackDialogOpen(true);
  };

  const handleRollbackConfirm = async (
    rollbackRequest: ContextRollbackRequest,
  ) => {
    try {
      await rollbackMutation.mutateAsync({
        workflowId,
        rollbackRequest,
      });
      setRollbackDialogOpen(false);
      setSelectedVersion(null);
    } catch (error) {
      console.error("Failed to rollback:", error);
    }
  };

  const handleCloseRollbackDialog = () => {
    if (!rollbackMutation.isPending) {
      setRollbackDialogOpen(false);
      setSelectedVersion(null);
    }
  };

  if (contextError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Error loading context data: {contextError.message}
        </Alert>
      </Box>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      {/* Header */}
      <Box
        sx={{
          mb: 3,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Box>
          <Typography variant="h5" component="h1" gutterBottom>
            {t(KEYS.workflow.context.title)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage workflow context versions and rollbacks
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<SnapshotIcon />}
          onClick={handleCreateSnapshot}
          disabled={createSnapshotMutation.isPending || contextLoading}
        >
          {createSnapshotMutation.isPending ? (
            <CircularProgress size={16} />
          ) : (
            t(KEYS.workflow.context.createSnapshot)
          )}
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Context Versions */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <HistoryIcon sx={{ mr: 1, verticalAlign: "bottom" }} />
                {t(KEYS.workflow.context.versions)}
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {contextLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
                  <CircularProgress />
                </Box>
              ) : versions.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ p: 2, textAlign: "center" }}
                >
                  No context versions available
                </Typography>
              ) : (
                <List>
                  {versions.map((version, index) => (
                    <React.Fragment key={version.id}>
                      <ListItem sx={{ px: 0 }}>
                        <Box sx={{ width: "100%" }}>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              mb: 1,
                            }}
                          >
                            <Typography
                              variant="subtitle1"
                              sx={{ fontWeight: "medium" }}
                            >
                              {t(KEYS.workflow.context.version, {
                                version: version.version,
                              })}
                            </Typography>
                            <Box sx={{ ml: "auto", display: "flex", gap: 1 }}>
                              {version.metadata.tags.map((tag) => (
                                <Chip
                                  key={tag}
                                  label={tag}
                                  size="small"
                                  variant="outlined"
                                />
                              ))}
                            </Box>
                          </Box>

                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 2,
                              mb: 1,
                            }}
                          >
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 0.5,
                              }}
                            >
                              <TimeIcon fontSize="small" color="action" />
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {new Date(version.timestamp).toLocaleString()}
                              </Typography>
                            </Box>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 0.5,
                              }}
                            >
                              <PersonIcon fontSize="small" color="action" />
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {version.metadata.createdBy}
                              </Typography>
                            </Box>
                          </Box>

                          <Typography
                            variant="body2"
                            color="text.secondary"
                            gutterBottom
                          >
                            {t(KEYS.workflow.context.reason, {
                              reason: version.metadata.reason,
                            })}
                          </Typography>

                          <ListItemSecondaryAction>
                            <Tooltip
                              title={`Rollback to version ${version.version}`}
                            >
                              <IconButton
                                edge="end"
                                onClick={() => handleRollbackClick(version)}
                                disabled={rollbackMutation.isPending}
                                size="small"
                              >
                                <RestoreIcon />
                              </IconButton>
                            </Tooltip>
                          </ListItemSecondaryAction>
                        </Box>
                      </ListItem>
                      {index < versions.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Shared Contexts */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <ShareIcon sx={{ mr: 1, verticalAlign: "bottom" }} />
                {t(KEYS.workflow.context.sharedContexts)}
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {contextLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : sharedContexts.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", p: 2 }}
                >
                  No shared contexts
                </Typography>
              ) : (
                <List dense>
                  {sharedContexts.map((context) => (
                    <ListItem key={context.id} sx={{ px: 0 }}>
                      <ListItemText
                        primary={context.name}
                        secondary={
                          <Box>
                            <Typography variant="caption" display="block">
                              {context.workflowIds.length} workflows
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Updated:{" "}
                              {new Date(
                                context.lastUpdated,
                              ).toLocaleDateString()}
                            </Typography>
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Quick Actions
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<SnapshotIcon />}
                  onClick={handleCreateSnapshot}
                  disabled={createSnapshotMutation.isPending}
                  fullWidth
                >
                  Create Manual Snapshot
                </Button>

                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<HistoryIcon />}
                  disabled={versions.length === 0}
                  fullWidth
                >
                  View Full History
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Rollback Confirmation Dialog */}
      <ModalWorkOwner.Provider value={rollbackDialogOpenOwnerKey}>
        <RollbackDialog
          open={rollbackDialogOpen}
          version={selectedVersion}
          onClose={handleCloseRollbackDialog}
          onConfirm={handleRollbackConfirm}
          isLoading={rollbackMutation.isPending}
        />
      </ModalWorkOwner.Provider>
    </Paper>
  );
};
