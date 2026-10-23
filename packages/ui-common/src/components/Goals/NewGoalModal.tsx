import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import type { CreateGoalDto, EntityType } from "../../api";
import { Priority, WorkStatus as WorkStatusEnum } from "../../api";
import {
  formatLocalDateInputValue,
  localDateInputToISOString,
} from "../../utils/dateTime";

export interface GoalSourceEntityRef {
  entityType: EntityType;
  entityId: string;
}

interface FormErrors {
  name?: string;
  description?: string;
}

export interface NewGoalModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    payload: CreateGoalDto,
    sourceEntityRefs: GoalSourceEntityRef[],
  ) => void;
  isLoading?: boolean;
  initialName?: string;
  initialDescription?: string;
  initialDueDate?: string;
  initialSourceEntityRefs?: GoalSourceEntityRef[];
}

export const NewGoalModal: React.FC<NewGoalModalProps> = ({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  initialName,
  initialDescription,
  initialDueDate,
  initialSourceEntityRefs,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName ?? "");
  const [description, setDescription] = useState(initialDescription ?? "");
  const [dueDate, setDueDate] = useState(() =>
    formatLocalDateInputValue(initialDueDate),
  );
  const [sourceEntityRefs, setSourceEntityRefs] = useState<
    GoalSourceEntityRef[]
  >(initialSourceEntityRefs ?? []);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setDescription(initialDescription ?? "");
      setDueDate(formatLocalDateInputValue(initialDueDate));
      setSourceEntityRefs(initialSourceEntityRefs ?? []);
      setErrors({});
    }
  }, [
    open,
    initialName,
    initialDescription,
    initialDueDate,
    initialSourceEntityRefs,
  ]);

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = t(KEYS.tasks.dialog.nameRequired);
    } else if (name.trim().length < 3) {
      newErrors.name = t(KEYS.tasks.dialog.nameTooShort);
    } else if (name.trim().length > 100) {
      newErrors.name = t(KEYS.tasks.dialog.nameTooLong);
    }

    if (description.trim().length > 500) {
      newErrors.description = t(KEYS.tasks.dialog.descriptionTooLong);
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, description, t]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setName(value);
      if (errors.name && value.trim()) {
        setErrors((prev) => ({ ...prev, name: undefined }));
      }
    },
    [errors.name],
  );

  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setDescription(value);
      if (errors.description && value.trim().length <= 500) {
        setErrors((prev) => ({ ...prev, description: undefined }));
      }
    },
    [errors.description],
  );

  const handleDueDateChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setDueDate(event.target.value);
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
    const dueDateTimestamp = localDateInputToISOString(dueDate);
    if (dueDate && !dueDateTimestamp) return;
    const payload: CreateGoalDto = {
      name: name.trim(),
      ...(dueDateTimestamp ? { dueDate: dueDateTimestamp } : {}),
      priority: Priority.Medium,
      status: WorkStatusEnum.RefiningDescription,
      ...(sections ? { sections } : {}),
    };
    onSubmit(payload, sourceEntityRefs);
  }, [name, description, dueDate, sourceEntityRefs, validateForm, onSubmit]);

  const handleClose = useCallback(() => {
    if (!isLoading) {
      onClose();
    }
  }, [isLoading, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="new-goal-dialog-title"
    >
      <DialogTitle id="new-goal-dialog-title">
        {t(KEYS.goals.dialog.createTitle)}
      </DialogTitle>

      <DialogContent>
        <TextField
          fullWidth
          label={t(KEYS.tasks.form.title)}
          placeholder={t(KEYS.tasks.dialog.namePlaceholder)}
          value={name}
          onChange={handleNameChange}
          error={!!errors.name}
          helperText={errors.name}
          margin="normal"
          autoFocus
          disabled={isLoading}
          inputProps={{
            "aria-label": t(KEYS.tasks.form.title),
            maxLength: 100,
          }}
        />

        <TextField
          fullWidth
          label={t(KEYS.tasks.form.description)}
          placeholder={t(KEYS.tasks.dialog.descriptionPlaceholder)}
          value={description}
          onChange={handleDescriptionChange}
          error={!!errors.description}
          helperText={errors.description}
          margin="normal"
          multiline
          rows={3}
          disabled={isLoading}
          inputProps={{
            "aria-label": t(KEYS.tasks.form.description),
            maxLength: 500,
          }}
        />

        <TextField
          fullWidth
          type="date"
          label={t(KEYS.goals.dialog.dueDateLabel)}
          placeholder={t(KEYS.goals.dialog.dueDatePlaceholder)}
          value={dueDate}
          onChange={handleDueDateChange}
          helperText={dueDate ? undefined : t(KEYS.goals.date.noTargetDate)}
          margin="normal"
          disabled={isLoading}
          InputLabelProps={{ shrink: true }}
          inputProps={{
            "aria-label": t(KEYS.goals.dialog.dueDateLabel),
          }}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          {t(KEYS.common.cancel)}
        </Button>

        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!name.trim() || isLoading}
          startIcon={isLoading ? <CircularProgress size={16} /> : undefined}
        >
          {isLoading
            ? t(KEYS.tasks.dialog.creating)
            : t(KEYS.goals.dialog.createButton)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
