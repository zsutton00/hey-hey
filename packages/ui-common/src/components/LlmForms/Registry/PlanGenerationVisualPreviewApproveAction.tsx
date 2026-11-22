import { Button } from "@mui/material";
import React from "react";
import { useConversationEvents } from "../../Conversation/hooks/useConversationEvents";
import { type SecondaryActionRenderContext } from "./types";

export type PlanGenerationVisualPreviewApproveActionProps = Pick<
  SecondaryActionRenderContext,
  "action" | "context" | "formValues" | "isSubmissionLocked" | "onExecute"
>;

/**
 * Moves past the approved visual under review, or confirms the complete,
 * all-approved visual set. It only submits the typed answer: the API decides
 * from live proposal status whether the run may move on, and this answer
 * never approves visuals.
 */
export const PlanGenerationVisualPreviewApproveAction: React.FC<
  PlanGenerationVisualPreviewApproveActionProps
> = ({ action, context, formValues, isSubmissionLocked, onExecute }) => {
  const [submitted, setSubmitted] = React.useState(false);
  const submittedRef = React.useRef(false);
  const { on } = useConversationEvents(context.conversationId);

  // A failed submission leaves the review unanswered, so allow another attempt.
  React.useEffect(
    () =>
      on("submission-error", () => {
        submittedRef.current = false;
        setSubmitted(false);
      }),
    [on],
  );

  const submit = () => {
    if (action.disabled || isSubmissionLocked || submittedRef.current) {
      return;
    }
    submittedRef.current = true;
    setSubmitted(true);
    onExecute(formValues);
  };

  return (
    <Button
      variant="contained"
      size="small"
      disabled={action.disabled || isSubmissionLocked || submitted}
      sx={{ py: 1.5, px: 2 }}
      onClick={submit}
      data-testid="plan-generation-visual-preview-approve"
    >
      {action.label}
    </Button>
  );
};
