import FastForwardIcon from "@mui/icons-material/FastForward";
import { Button, CircularProgress } from "@mui/material";
import React from "react";
import { WorkStatus } from "../../api";

interface WorkItemRefinementActionsProps {
  canRevealAll: boolean;
  isRevealingAll: boolean;
  disabled: boolean;
  workItemStatus?: WorkStatus;
  onRevealAll: () => void;
}

const SHOW_REFINEMENT_SKIP_BUTTON = false;

const getSkipLabel = (workItemStatus?: WorkStatus): string => {
  if (workItemStatus === WorkStatus.RefiningAcceptanceCriteria) {
    return "Ready - Add to backlog";
  }

  return "Skip Refinement";
};

export const WorkItemRefinementActions: React.FC<
  WorkItemRefinementActionsProps
> = ({
  canRevealAll,
  isRevealingAll,
  disabled,
  workItemStatus,
  onRevealAll,
}) => {
  if (!SHOW_REFINEMENT_SKIP_BUTTON) {
    return null;
  }

  if (!canRevealAll) {
    return null;
  }

  return (
    <Button
      variant="text"
      size="small"
      onClick={onRevealAll}
      disabled={isRevealingAll || disabled}
      startIcon={<FastForwardIcon />}
      sx={{
        mt: 1,
        mb: 1,
        alignSelf: "flex-start",
        textTransform: "none",
        color: "rgb(60, 114, 160)",
        "&:hover": {
          backgroundColor: "rgba(60, 114, 160, 0.1)",
        },
        "&:disabled": {
          color: (theme) => theme.palette.action.disabled,
        },
      }}
    >
      {isRevealingAll ? (
        <>
          <CircularProgress
            size={16}
            sx={{ mr: 1, color: "rgb(60, 114, 160)" }}
          />
          Skipping...
        </>
      ) : (
        getSkipLabel(workItemStatus)
      )}
    </Button>
  );
};
