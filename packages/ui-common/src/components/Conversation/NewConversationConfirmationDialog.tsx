import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import React, { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface NewConversationConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isConfirming?: boolean;
  /** Configuration controls that apply only to the conversation being created. */
  setupContent?: ReactNode;
}

/**
 * Shared confirmation surface for starting a fresh conversation.
 *
 * The caller owns the mutation and any draft captured before opening the
 * dialog. This component deliberately only invokes that mutation from the
 * explicit confirm action.
 */
export const NewConversationConfirmationDialog: React.FC<
  NewConversationConfirmationDialogProps
> = ({ open, onClose, onConfirm, isConfirming = false, setupContent }) => {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="new-conversation-dialog-title"
      data-testid="new-conversation-confirmation-dialog"
    >
      <DialogTitle id="new-conversation-dialog-title">
        {t("conversation.newConversation.dialogTitle", "Are your sure?")}
      </DialogTitle>
      <DialogContent
        data-testid="new-conversation-dialog-content"
        sx={{ overflowX: "hidden" }}
      >
        <Typography variant="body2" color="text.secondary">
          {t(
            "conversation.newConversation.confirm",
            "Your current conversation remains available in the Conversations tab.",
          )}
        </Typography>
        {setupContent}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isConfirming}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button variant="contained" onClick={onConfirm} disabled={isConfirming}>
          {isConfirming
            ? t("conversation.newConversation.creating", "Creating...")
            : t(
                "conversation.newConversation.confirm_button",
                "Start new conversation",
              )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
