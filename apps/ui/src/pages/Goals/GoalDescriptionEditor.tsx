import EditIcon from "@mui/icons-material/Edit";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useCallback, useState } from "react";

interface GoalDescriptionEditorProps {
  description: string;
  disabled?: boolean;
  isSaving?: boolean;
  onSave: (description: string) => Promise<void>;
}

export const GoalDescriptionEditor: React.FC<GoalDescriptionEditorProps> = ({
  description,
  disabled = false,
  isSaving = false,
  onSave,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [draft, setDraft] = useState(description);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleOpen = useCallback(() => {
    setDraft(description);
    setSaveError(null);
    setIsDialogOpen(true);
  }, [description]);

  const handleClose = useCallback(() => {
    if (!isSaving) {
      setIsDialogOpen(false);
    }
  }, [isSaving]);

  const handleSave = useCallback(async () => {
    setSaveError(null);

    try {
      await onSave(draft);
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Failed to update goal description:", error);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Failed to update goal description",
      );
    }
  }, [draft, onSave]);

  return (
    <>
      <Box
        data-testid="goal-description"
        sx={{
          minWidth: 0,
          flex: "1 1 300px",
          maxWidth: "300px",
          alignSelf: "flex-start",
        }}
      >
        <ButtonBase
          aria-label="Edit goal description"
          data-testid="goal-description-edit"
          disabled={disabled || isSaving}
          onClick={handleOpen}
          title={description || "No description provided."}
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 0,
            width: "100%",
            minWidth: 0,
            justifyContent: "flex-start",
            textAlign: "left",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            minWidth={0}
            width="100%"
            sx={{ p: "10px" }}
          >
            <InfoOutlinedIcon
              fontSize="small"
              color="action"
              aria-hidden="true"
            />
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="goal-description-text"
              noWrap
              sx={{
                minWidth: 0,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {description || "No description provided."}
            </Typography>
            <EditIcon fontSize="small" color="action" aria-hidden="true" />
          </Stack>
        </ButtonBase>
      </Box>

      <Dialog
        open={isDialogOpen}
        onClose={handleClose}
        fullWidth
        maxWidth="sm"
        aria-labelledby="goal-description-dialog-title"
      >
        <DialogTitle id="goal-description-dialog-title">
          Edit goal description
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={5}
            label="Description"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="goal-description-input"
            sx={{ mt: 1 }}
          />
          {saveError && (
            <Typography
              variant="body2"
              color="error"
              role="alert"
              sx={{ mt: 1.5 }}
            >
              {saveError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={isSaving}
            data-testid="goal-description-save"
          >
            {isSaving ? <CircularProgress size={18} /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
