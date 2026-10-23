import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

export interface PlanAutomationChoiceDialogProps {
  open: boolean;
  relatedMonitorCount: number;
  onViewExisting: () => void;
  onCreateAnother: () => void;
}

export const PlanAutomationChoiceDialog = ({
  open,
  relatedMonitorCount,
  onViewExisting,
  onCreateAnother,
}: PlanAutomationChoiceDialogProps) => (
  <Dialog open={open} data-testid="plan-automation-choice-dialog">
    <DialogTitle>Plan automation already exists</DialogTitle>
    <DialogContent>
      <Typography>
        {relatedMonitorCount === 1
          ? "A non-terminal Task Monitor is related to this plan."
          : `${relatedMonitorCount} non-terminal Task Monitors are related to this plan.`}
      </Typography>
    </DialogContent>
    <DialogActions>
      <Button
        onClick={onViewExisting}
        data-testid="plan-automation-view-existing"
      >
        View existing automation
      </Button>
      <Button
        variant="contained"
        onClick={onCreateAnother}
        data-testid="plan-automation-create-another"
      >
        Create another monitor
      </Button>
    </DialogActions>
  </Dialog>
);
