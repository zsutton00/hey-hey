import React, { useState, useCallback, useEffect } from "react";
import type { TFunction } from "i18next";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import type { TaskPriority } from "../../api";
import { Priority, SuggestedActionNextAction } from "../../api";
import { FeatureSelector, TaskSelector } from "../Selectors";
import type { SuggestedActionTaskData } from "../../contexts/types/modalTypes";

interface FormErrors {
  name?: string;
  description?: string;
}

export interface SuggestedActionTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SuggestedActionTaskData) => void;
  isLoading?: boolean;
  organizationId: string;
  projectId: string;
  actionLabel: string;
  nextAction: SuggestedActionNextAction;
}

const validateName = (name: string, t: TFunction): string | undefined => {
  const trimmed = name.trim();
  if (!trimmed) {
    return t(KEYS.tasks.dialog.nameRequired);
  }
  if (trimmed.length < 3) {
    return t(KEYS.tasks.dialog.nameTooShort);
  }
  if (trimmed.length > 100) {
    return t(KEYS.tasks.dialog.nameTooLong);
  }
  return undefined;
};

const validateDescription = (
  description: string,
  t: TFunction
): string | undefined => {
  if (description.length > 500) {
    return t(KEYS.tasks.dialog.descriptionTooLong);
  }
  return undefined;
};

export const SuggestedActionTaskModal: React.FC<
  SuggestedActionTaskModalProps
> = ({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  organizationId,
  projectId,
  actionLabel,
  nextAction,
}) => {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(Priority.Medium);
  const [initiativeId, setInitiativeId] = useState<string | null>(null);
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setPriority(Priority.Medium);
      setInitiativeId(null);
      setParentTaskId(null);
      setErrors({});
    }
  }, [open]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setName(value);
      const error = validateName(value, t);
      setErrors((prev) => ({ ...prev, name: error }));
    },
    [t]
  );

  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setDescription(value);
      const error = validateDescription(value, t);
      setErrors((prev) => ({ ...prev, description: error }));
    },
    [t]
  );

  const handlePriorityChange = useCallback((priority: TaskPriority) => {
    setPriority(priority);
  }, []);

  const handleInitiativeChange = useCallback((initiativeId: string | null) => {
    setInitiativeId(initiativeId);
    setParentTaskId(null);
  }, []);

  const handleParentTaskChange = useCallback((taskId: string | null) => {
    setParentTaskId(taskId);
  }, []);

  const handleSubmit = useCallback(() => {
    const nameError = validateName(name, t);
    const descriptionError = validateDescription(description, t);

    if (nameError || descriptionError) {
      setErrors({
        name: nameError,
        description: descriptionError,
      });
      return;
    }

    if (!initiativeId) {
      return;
    }

    const data: SuggestedActionTaskData = {
      name: name.trim(),
      description: description.trim() || undefined,
      priority,
      initiativeId,
      parentTaskId: parentTaskId || undefined,
      nextAction,
    };

    onSubmit(data);
  }, [
    name,
    description,
    priority,
    initiativeId,
    parentTaskId,
    nextAction,
    onSubmit,
    t,
  ]);

  const isFormValid = useCallback((): boolean => {
    return (
      !errors.name &&
      !errors.description &&
      name.trim().length >= 3 &&
      name.trim().length <= 100 &&
      description.length <= 500 &&
      initiativeId !== null
    );
  }, [errors, name, description, initiativeId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="suggested-action-task-dialog-title"
    >
      <DialogTitle id="suggested-action-task-dialog-title">
        {actionLabel}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            fullWidth
            required
            label={t(KEYS.tasks.form.title)}
            placeholder={t(KEYS.tasks.dialog.namePlaceholder)}
            value={name}
            onChange={handleNameChange}
            error={Boolean(errors.name)}
            helperText={errors.name}
            disabled={isLoading}
            autoFocus
          />

          <TextField
            fullWidth
            multiline
            rows={3}
            label={t(KEYS.tasks.form.description)}
            placeholder={t(KEYS.tasks.dialog.descriptionPlaceholder)}
            value={description}
            onChange={handleDescriptionChange}
            error={Boolean(errors.description)}
            helperText={errors.description}
            disabled={isLoading}
          />

          <FormControl fullWidth size="small">
            <InputLabel>{t(KEYS.tasks.form.priority)}</InputLabel>
            <Select
              value={priority}
              label={t(KEYS.tasks.form.priority)}
              onChange={(e) =>
                handlePriorityChange(e.target.value as TaskPriority)
              }
              disabled={isLoading}
            >
              <MenuItem value={Priority.Low}>
                {t(KEYS.tasks.priority.low)}
              </MenuItem>
              <MenuItem value={Priority.Medium}>
                {t(KEYS.tasks.priority.medium)}
              </MenuItem>
              <MenuItem value={Priority.High}>
                {t(KEYS.tasks.priority.high)}
              </MenuItem>
            </Select>
          </FormControl>

          <FeatureSelector
            organizationId={organizationId}
            projectId={projectId}
            label={t(KEYS.conversation.suggestedAction.initiativeLabel)}
            placeholder={t(
              KEYS.conversation.suggestedAction.initiativePlaceholder
            )}
            value={initiativeId}
            onChange={handleInitiativeChange}
            disabled={isLoading}
            size="small"
            fullWidth
          />

          <TaskSelector
            organizationId={organizationId}
            projectId={projectId}
            label={t(KEYS.conversation.suggestedAction.parentTaskLabel)}
            placeholder={t(
              KEYS.conversation.suggestedAction.parentTaskPlaceholder
            )}
            value={parentTaskId}
            onChange={handleParentTaskChange}
            disabled={isLoading}
            size="small"
            fullWidth
            includeNone
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          {t(KEYS.conversation.suggestedAction.cancel)}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!isFormValid() || isLoading}
          startIcon={isLoading ? <CircularProgress size={16} /> : undefined}
        >
          {isLoading
            ? t(KEYS.tasks.dialog.creating)
            : t(KEYS.conversation.suggestedAction.create)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
