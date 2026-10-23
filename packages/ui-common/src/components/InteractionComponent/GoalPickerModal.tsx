import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import type { ActiveGoalDto, EntityType } from "../../api";
import { EntityType as EntityTypeValue, GoalAudience } from "../../api";
import { useActiveGoals } from "../../data/hooks/useActiveGoals";
import { useAttachToGoal } from "../../data/hooks/useAttachToGoal";
import { useWorkItemTypeTrackingEligibility } from "../../data/hooks/useWorkItemTypes";

export interface GoalPickerModalProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  projectId: string;
  /** Entity that will become the target of the goal's TRACKS edge. */
  targetEntityId: string;
  targetEntityType: EntityType;
  targetTaskType?: string;
  /** Optional human-readable name shown in the dialog header. */
  entityTitle?: string;
}

const formatDueDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export const GoalPickerModal: React.FC<GoalPickerModalProps> = ({
  open,
  onClose,
  organizationId,
  projectId,
  targetEntityId,
  targetEntityType,
  targetTaskType,
  entityTitle,
}) => {
  const eligibility = useWorkItemTypeTrackingEligibility(
    organizationId,
    projectId,
    targetTaskType,
    EntityTypeValue.Task,
    "GOAL"
  );
  const canAttach =
    targetEntityType === EntityTypeValue.Task &&
    eligibility.isAllowed === true;
  const goals = useActiveGoals({ organizationId, projectId });
  const {
    attach,
    isLoading: isAttaching,
    error: attachError,
  } = useAttachToGoal({
    organizationId,
    projectId,
  });

  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);

  const fetchGoals = goals.fetch;
  useEffect(() => {
    if (open && canAttach) {
      fetchGoals();
    } else {
      setSelectedGoalId(null);
    }
  }, [open, canAttach, fetchGoals]);

  const handleConfirm = useCallback(async () => {
    if (!selectedGoalId) return;
    try {
      await attach({
        goalId: selectedGoalId,
        targetEntityId,
        targetEntityType,
      });
      onClose();
    } catch {
      // Error surfaced via attachError; keep modal open so the user can retry.
    }
  }, [attach, selectedGoalId, targetEntityId, targetEntityType, onClose]);

  const handleClose = useCallback(() => {
    if (isAttaching) return;
    onClose();
  }, [isAttaching, onClose]);

  const items = goals.data ?? [];
  const hasGoals = items.length > 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="goal-picker-modal"
    >
      <DialogTitle>
        Add to Goal
        {entityTitle && (
          <Typography variant="body2" color="text.secondary" noWrap>
            {entityTitle}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {!eligibility.isReady && !eligibility.error && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              py: 4,
            }}
            data-testid="goal-picker-eligibility-loading"
          >
            <CircularProgress size={24} />
          </Box>
        )}
        {eligibility.error && (
          <Alert severity="error" data-testid="goal-picker-eligibility-error">
            Work-item type eligibility is unavailable.
          </Alert>
        )}
        {eligibility.isReady && !canAttach && (
          <Alert severity="info" data-testid="goal-picker-ineligible">
            This work-item type does not allow Goals as an inbound tracking
            source.
          </Alert>
        )}
        {canAttach && goals.isLoading && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              py: 4,
            }}
            data-testid="goal-picker-loading"
          >
            <CircularProgress size={24} />
          </Box>
        )}

        {canAttach && !goals.isLoading && goals.error && (
          <Alert severity="error" data-testid="goal-picker-error">
            {goals.error}
          </Alert>
        )}

        {canAttach && !goals.isLoading && !goals.error && !hasGoals && (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="goal-picker-empty"
            sx={{ py: 2, textAlign: "center" }}
          >
            No active goals available.
          </Typography>
        )}

        {canAttach && !goals.isLoading && !goals.error && hasGoals && (
          <List dense disablePadding data-testid="goal-picker-list">
            {items.map((goal: ActiveGoalDto) => {
              const isMembers = goal.audience === GoalAudience.Members;
              const selected = goal.id === selectedGoalId;
              return (
                <ListItemButton
                  key={goal.id}
                  selected={selected}
                  onClick={() => setSelectedGoalId(goal.id)}
                  data-testid={`goal-picker-item-${goal.id}`}
                  data-goal-audience={goal.audience}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {goal.name}
                        </Typography>
                        {isMembers && (
                          <Chip
                            size="small"
                            label="Members"
                            color="primary"
                            variant="outlined"
                            data-testid={`goal-picker-members-chip-${goal.id}`}
                          />
                        )}
                      </Stack>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {goal.dueDate === null
                          ? "No target date"
                          : `Due ${formatDueDate(goal.dueDate)}`}
                      </Typography>
                    }
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}

        {attachError && (
          <Alert
            severity="error"
            sx={{ mt: 2 }}
            data-testid="goal-picker-attach-error"
          >
            {attachError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isAttaching}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!canAttach || !selectedGoalId || isAttaching}
          data-testid="goal-picker-confirm"
        >
          {isAttaching ? "Adding..." : "Add to Goal"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
