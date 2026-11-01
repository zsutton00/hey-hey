import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import React, { useCallback, useState } from "react";
import {
  DialogTitle,
  DialogContent,
  Box,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { CreateDocumentForm } from "./CreateDocumentForm";
import type { LinkedItemMode } from "./types";
import type { WorkItemSelectorValue } from "../Selectors";

export type WorkItemSelectorMode = "none" | "workItem" | "initiative" | "task";

interface CreateDocumentModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  organizationId?: string;
  workItemSelectorMode?: WorkItemSelectorMode;
  workItemSelectorInitialValue?: WorkItemSelectorValue | string | null;
  workItemSelectorReadOnly?: boolean;
}

export const CreateDocumentModal: React.FC<CreateDocumentModalProps> = ({
  open,
  onClose,
  projectId,
  organizationId: organizationIdProp,
  workItemSelectorMode = "workItem",
  workItemSelectorInitialValue = null,
  workItemSelectorReadOnly = false,
}) => {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);

  const handleClose = useCallback((): void => {
    if (!isCreating) {
      onClose();
    }
  }, [isCreating, onClose]);

  const handleSuccess = useCallback((): void => {
    setIsCreating(false);
    onClose();
  }, [onClose]);

  const handleError = useCallback((): void => {
    setIsCreating(false);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: "400px" },
      }}
      closeControl={
        <IconButton onClick={handleClose} size="small" disabled={isCreating}>
          <CloseIcon />
        </IconButton>
      }
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">
            {t("documents.createDocument", "Create Document")}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pb: 3 }}>
        <CreateDocumentForm
          projectId={projectId}
          organizationId={organizationIdProp}
          linkedItemMode={workItemSelectorMode as LinkedItemMode}
          linkedItemValue={workItemSelectorInitialValue}
          linkedItemReadOnly={workItemSelectorReadOnly}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      </DialogContent>
    </Dialog>
  );
};
