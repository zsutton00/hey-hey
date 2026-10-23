import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import type { UpdateTaskResponseDto } from "../../api";
import { useSupersedeTask } from "../../data/hooks";
import { TaskSelector } from "../Selectors/TaskSelector";

export interface SupersedeTaskDialogProps {
  open: boolean;
  organizationId: string;
  projectId: string;
  /** The task being superseded. */
  taskId: string;
  onClose: () => void;
  /** Invoked after the supersede transition succeeds. */
  onSuperseded?: (result: UpdateTaskResponseDto) => void;
}

/**
 * Collects the successor task and runs the atomic supersede transition. A
 * successor is required — a task is superseded *by* a replacement, never into
 * a void — so the confirm action stays disabled until one is chosen. Because
 * the transition authors the SUPERSEDED status and the SUPERSEDES edge on a
 * single proposal, SUPERSEDED is never emitted through the plain status path.
 */
export const SupersedeTaskDialog: React.FC<SupersedeTaskDialogProps> = ({
  open,
  organizationId,
  projectId,
  taskId,
  onClose,
  onSuperseded,
}) => {
  const [successorTaskId, setSuccessorTaskId] = useState<string | null>(null);
  const { supersede, isLoading, error } = useSupersedeTask({
    organizationId,
    projectId,
  });

  useEffect(() => {
    if (!open) {
      setSuccessorTaskId(null);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (isLoading) return;
    onClose();
  }, [isLoading, onClose]);

  const handleConfirm = useCallback(async () => {
    if (!successorTaskId) return;
    try {
      const result = await supersede(taskId, successorTaskId);
      onSuperseded?.(result);
      onClose();
    } catch {
      // Error surfaced inline via the hook's `error` state.
    }
  }, [successorTaskId, supersede, taskId, onSuperseded, onClose]);

  return (
    <Dialog
      data-testid="supersede-task-dialog"
      open={open}
      onClose={handleClose}
      disableEscapeKeyDown={isLoading}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>Supersede task</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Choose the task that replaces this one. The current task is marked
            Superseded and a link to its successor is recorded together, in a
            single reviewable change.
          </Typography>

          {error ? (
            <Alert data-testid="supersede-task-error" severity="error">
              {error}
            </Alert>
          ) : null}

          <TaskSelector
            organizationId={organizationId}
            projectId={projectId}
            label="Successor task"
            placeholder="Select the replacement task"
            value={successorTaskId}
            onChange={(nextTaskId) => setSuccessorTaskId(nextTaskId)}
            excludeTaskIds={[taskId]}
            disabled={isLoading}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          data-testid="supersede-task-cancel"
          onClick={handleClose}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button
          data-testid="supersede-task-confirm"
          onClick={() => {
            void handleConfirm();
          }}
          disabled={!successorTaskId || isLoading}
          variant="contained"
          startIcon={
            isLoading ? (
              <CircularProgress color="inherit" size={16} />
            ) : undefined
          }
        >
          Supersede
        </Button>
      </DialogActions>
    </Dialog>
  );
};
