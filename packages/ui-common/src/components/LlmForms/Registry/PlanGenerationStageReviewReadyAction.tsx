import { FunctionalDialog as Dialog } from "../../Modals/FunctionalDialog";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import React from "react";
import { type PlanGenerationStageReviewPayload } from "../../../api";
import {
  countApprovedPlanStages,
  decideStageReadiness,
} from "./planGenerationStageReviewUtils";
import { type SecondaryActionRenderContext } from "./types";

export type PlanGenerationStageReviewReadyActionProps = Pick<
  SecondaryActionRenderContext,
  "action" | "context" | "formValues" | "handleNext" | "messageId" | "onExecute"
> & { payload: PlanGenerationStageReviewPayload };

export const PlanGenerationStageReviewReadyAction: React.FC<
  PlanGenerationStageReviewReadyActionProps
> = ({ action, context, formValues, onExecute, payload }) => {
  const [mismatch, setMismatch] = React.useState<{
    expectedStageCount: number;
    approvedStageCount: number;
  } | null>(null);
  const approvedStageCount = countApprovedPlanStages(context.interaction);
  const hasNoApprovedStages = approvedStageCount === 0;
  // Stage readiness debug: inspect action.disabled, approvedStageCount and interaction.

  const handleReady = () => {
    if (action.disabled || hasNoApprovedStages) return;
    const decision = decideStageReadiness(payload, context.interaction);
    // Stage readiness debug: inspect the count comparison after an enabled click.

    if (decision.kind === "submit-approved") {
      onExecute(formValues);
      return;
    }
    setMismatch(decision);
  };

  return (
    <>
      <Button
        variant="contained"
        size="small"
        disabled={action.disabled || hasNoApprovedStages}
        title={
          hasNoApprovedStages
            ? "Approve at least one proposed stage before continuing."
            : undefined
        }
        sx={{ py: 1.5, px: 2 }}
        onClick={handleReady}
        data-testid="plan-generation-stage-review-ready"
      >
        {action.label}
      </Button>
      <Dialog open={mismatch !== null} onClose={() => setMismatch(null)}>
        <DialogTitle>Not every proposed stage is approved</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {mismatch
              ? `${mismatch.approvedStageCount}/${mismatch.expectedStageCount} stages are approved.`
              : ""}
          </DialogContentText>
          <DialogContentText>
            Please reject any undesired stage, then inform the agent via a
            message and click “Continue Revising”.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setMismatch(null)}>
            Acknowledged
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
