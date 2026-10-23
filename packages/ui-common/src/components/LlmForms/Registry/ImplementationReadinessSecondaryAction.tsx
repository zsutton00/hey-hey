import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import React, { useState } from "react";
import type { SecondaryActionRenderContext } from "./types";

type ImplementationReadinessSecondaryActionProps = Pick<
  SecondaryActionRenderContext,
  "action" | "context" | "formValues" | "onExecute"
> & {
  kind: "clarify" | "dismiss";
};

const confirmationCopy = {
  dismiss: {
    title: "Dismiss this readiness finding?",
    body: "You accept the consequences described in this finding, and planning or code-capable work can continue.",
  },
} as const;

export const ImplementationReadinessSecondaryAction: React.FC<
  ImplementationReadinessSecondaryActionProps
> = ({ action, context, formValues, onExecute, kind }) => {
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  if (kind === "clarify") {
    return (
      <Button
        variant="text"
        size="small"
        disabled={action.disabled}
        onClick={() => context.onFocusComposer?.()}
        data-testid="implementation-readiness-clarify-action"
        sx={{ py: 1.5, px: 2 }}
      >
        {action.label}
      </Button>
    );
  }

  const copy = confirmationCopy[kind];
  const confirm = () => {
    setConfirmationOpen(false);
    onExecute(formValues);
  };

  return (
    <>
      <Button
        variant="text"
        size="small"
        disabled={action.disabled}
        onClick={() => setConfirmationOpen(true)}
        data-testid={`implementation-readiness-${kind}-action`}
        sx={{ py: 1.5, px: 2 }}
      >
        {action.label}
      </Button>
      <Dialog
        open={confirmationOpen}
        onClose={() => setConfirmationOpen(false)}
        aria-labelledby={`implementation-readiness-${kind}-confirmation-title`}
        data-testid={`implementation-readiness-${kind}-confirmation`}
      >
        <DialogTitle id={`implementation-readiness-${kind}-confirmation-title`}>
          {copy.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{copy.body}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmationOpen(false)}
            data-testid={`implementation-readiness-${kind}-cancel`}
          >
            Cancel
          </Button>
          <Button
            onClick={confirm}
            variant="contained"
            data-testid={`implementation-readiness-${kind}-confirm`}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
