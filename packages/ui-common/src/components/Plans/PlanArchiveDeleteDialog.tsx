import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import React, { useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { WorkStatus } from "../../api";
import { useCanonicalPlanMutations } from "../../data";

export interface PlanArchiveDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  planId: string;
  planName: string;
  planStatus: WorkStatus;
  organizationId: string;
  projectId: string;
  onComplete?: () => void;
  onArchived?: () => void;
  onDeleted?: () => void;
}

type OperationType = "archive" | "delete" | null;

export const PlanArchiveDeleteDialog: React.FC<
  PlanArchiveDeleteDialogProps
> = ({
  open,
  onClose,
  planId,
  planName,
  planStatus,
  organizationId,
  projectId,
  onComplete,
  onArchived,
  onDeleted,
}) => {
  const [loadingAction, setLoadingAction] = useState<OperationType>(null);
  const [error, setError] = useState<string | null>(null);
  const { updatePlan, deletePlan } = useCanonicalPlanMutations(
    organizationId,
    projectId,
  );

  const allowArchive = planStatus !== WorkStatus.Archived;

  const handleArchive = async () => {
    setLoadingAction("archive");
    setError(null);

    try {
      const result = await updatePlan(planId, { status: WorkStatus.Archived });
      onComplete?.();
      if (result.status === "applied") onArchived?.();
      onClose();
    } catch (err) {
      console.error("Failed to archive plan:", err);
      setError("Failed to archive this plan. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDelete = async () => {
    setLoadingAction("delete");
    setError(null);

    try {
      await deletePlan(planId);
      onComplete?.();
      onDeleted?.();
      onClose();
    } catch (err) {
      console.error("Failed to delete plan:", err);
      setError("Failed to delete this plan. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  };

  const isBusy = loadingAction !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Manage Plan: {planName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body1">
            Archive will remove your plan from the knowledge base. It will not
            appear in the UI or searches.
          </Typography>
          <Typography variant="body1">
            Delete will permanently delete this plan.
          </Typography>
          <Typography variant="body2">
            With either option, any completed work will be saved in the
            knowledge base.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isBusy}>
          Cancel
        </Button>
        {allowArchive && (
          <Button variant="outlined" onClick={handleArchive} disabled={isBusy}>
            {loadingAction === "archive" ? (
              <CircularProgress size={20} />
            ) : (
              "Archive"
            )}
          </Button>
        )}
        <Button
          variant="contained"
          color="error"
          onClick={handleDelete}
          disabled={isBusy}
        >
          {loadingAction === "delete" ? (
            <CircularProgress size={20} />
          ) : (
            "Delete"
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
