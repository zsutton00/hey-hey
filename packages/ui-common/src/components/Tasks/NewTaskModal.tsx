import React, { useState, useCallback } from "react";
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
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import type { TaskPriority, CreateTaskDto } from "../../api";
import { Priority, WorkStatus as WorkStatusEnum } from "../../api";
import { SmarterTextAreaCard } from "../SmarterTextAreaCard";

interface FormErrors {
  name?: string;
  priority?: string;
}

export interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (formData: CreateTaskDto) => void;
  isLoading?: boolean;
  parentTaskId?: string;
  extraFields?: React.ReactNode;
  submitDisabled?: boolean;
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  parentTaskId,
  extraFields,
  submitDisabled = false,
}) => {
  const { t } = useTranslation();
  const [description, setDescription] = useState("");
  const [formData, setFormData] = useState<CreateTaskDto>({
    name: "",
    priority: Priority.Medium,
    status: WorkStatusEnum.RefiningDescription,
    ...(parentTaskId ? { parentTaskId } : {}),
  });
  const [errors, setErrors] = useState<FormErrors>({});

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name?.trim()) {
      newErrors.name = t(KEYS.tasks.dialog.nameRequired);
    } else if (formData.name.trim().length < 3) {
      newErrors.name = t(KEYS.tasks.dialog.nameTooShort);
    } else if (formData.name.trim().length > 100) {
      newErrors.name = t(KEYS.tasks.dialog.nameTooLong);
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, t]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormData((prev) => ({ ...prev, name: value }));

      if (errors.name && value.trim()) {
        setErrors((prev) => ({ ...prev, name: undefined }));
      }
    },
    [errors.name],
  );

  const handleDescriptionChange = useCallback((value: string) => {
    setDescription(value);
  }, []);

  const handlePriorityChange = useCallback(
    (event: SelectChangeEvent<TaskPriority>) => {
      const value = event.target.value as TaskPriority;
      setFormData((prev) => ({ ...prev, priority: value }));
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      return;
    }
    const sections = description.trim()
      ? [{ key: "description", content: description.trim() }]
      : undefined;
    onSubmit({ ...formData, ...(sections ? { sections } : {}) });
  }, [formData, description, validateForm, onSubmit]);

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setFormData({
        name: "",
        priority: Priority.Medium,
        status: WorkStatusEnum.RefiningDescription,
        ...(parentTaskId ? { parentTaskId } : {}),
      });
      setDescription("");
      setErrors({});
      onClose();
    }
  }, [isLoading, onClose, parentTaskId]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="new-task-dialog-title"
    >
      <DialogTitle id="new-task-dialog-title">
        {t(KEYS.tasks.dialog.createTitle)}
      </DialogTitle>

      <DialogContent>
        <TextField
          fullWidth
          label={t(KEYS.tasks.form.title)}
          placeholder={t(KEYS.tasks.dialog.namePlaceholder)}
          value={formData.name}
          onChange={handleNameChange}
          error={!!errors.name}
          helperText={errors.name}
          margin="normal"
          autoFocus
          disabled={isLoading}
          aria-describedby="task-name-helper-text"
          inputProps={{
            "aria-label": t(KEYS.tasks.form.title),
            maxLength: 100,
          }}
        />

        <Box sx={{ mt: 2, mb: 1 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 0.5 }}
          >
            {t(KEYS.tasks.form.description)}
          </Typography>
          <SmarterTextAreaCard
            value={description}
            onChange={handleDescriptionChange}
            placeholder={t(KEYS.tasks.dialog.descriptionPlaceholder)}
            saveStatus="draft"
            saveMode={null}
            hasUnsavedChanges={false}
            disabled={isLoading}
            minInputHeight={96}
            transparent
          />
        </Box>

        <FormControl fullWidth margin="normal" disabled={isLoading}>
          <InputLabel id="priority-select-label">
            {t(KEYS.tasks.form.priority)}
          </InputLabel>
          <Select
            labelId="priority-select-label"
            value={formData.priority}
            label={t(KEYS.tasks.form.priority)}
            onChange={handlePriorityChange}
          >
            <MenuItem value="LOW">{t(KEYS.tasks.priority.low)}</MenuItem>
            <MenuItem value="MEDIUM">{t(KEYS.tasks.priority.medium)}</MenuItem>
            <MenuItem value="HIGH">{t(KEYS.tasks.priority.high)}</MenuItem>
          </Select>
        </FormControl>

        {extraFields}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          {t(KEYS.common.cancel)}
        </Button>

        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!formData.name.trim() || isLoading || submitDisabled}
          startIcon={isLoading ? <CircularProgress size={16} /> : undefined}
        >
          {isLoading ? t(KEYS.tasks.dialog.creating) : t(KEYS.common.create)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
