import { FunctionalDialog as Dialog } from "../../../Modals/FunctionalDialog";
import React, { useState, useCallback } from "react";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../../i18n/keys";
import { TagsField } from "./TagsField";

// Form data interfaces
interface NewInitiativeFormData {
  name: string;
  description?: string;
  tags: string[];
  conversationId?: string;
}

interface FormErrors {
  name?: string;
  description?: string;
  tags?: string;
}

interface NewInitiativeModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (formData: NewInitiativeFormData) => void;
  isLoading?: boolean;
  conversationId: string;
  organizationId: string;
}

export const NewInitiativeModal: React.FC<NewInitiativeModalProps> = ({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  conversationId,
  organizationId,
}) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<NewInitiativeFormData>({
    name: "",
    description: "",
    tags: [],
    conversationId,
  });
  const [errors, setErrors] = useState<FormErrors>({});

  // Form validation logic
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name?.trim()) {
      newErrors.name = t(KEYS.initiatives.newInitiativeDialog.nameRequired);
    } else if (formData.name.trim().length < 3) {
      newErrors.name = t(KEYS.initiatives.newInitiativeDialog.nameTooShort);
    } else if (formData.name.trim().length > 100) {
      newErrors.name = t(KEYS.initiatives.newInitiativeDialog.nameTooLong);
    }

    if (formData.description && formData.description.trim().length > 500) {
      newErrors.description = t(
        KEYS.initiatives.newInitiativeDialog.descriptionTooLong,
      );
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData.name, formData.description, t]);

  // Event handlers
  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormData((prev) => ({ ...prev, name: value }));

      // Clear error when user starts typing
      if (errors.name && value.trim()) {
        setErrors((prev) => ({ ...prev, name: undefined }));
      }
    },
    [errors.name],
  );

  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormData((prev) => ({ ...prev, description: value }));

      // Clear error when user starts typing
      if (errors.description && value.trim()) {
        setErrors((prev) => ({ ...prev, description: undefined }));
      }
    },
    [errors.description],
  );

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      setFormData((prev) => ({ ...prev, tags }));

      // Clear tags error if any
      if (errors.tags) {
        setErrors((prev) => ({ ...prev, tags: undefined }));
      }
    },
    [errors.tags],
  );

  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      return;
    }
    onSubmit(formData);
  }, [formData, validateForm, onSubmit]);

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setFormData({ name: "", description: "", tags: [], conversationId });
      setErrors({});
      onClose();
    }
  }, [isLoading, onClose, conversationId]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="new-initiative-dialog-title"
    >
      <DialogTitle id="new-initiative-dialog-title">
        {t(KEYS.initiatives.newInitiativeDialog.title)}
      </DialogTitle>

      <DialogContent>
        <TextField
          fullWidth
          label={t(KEYS.initiatives.form.title)}
          placeholder={t(KEYS.initiatives.newInitiativeDialog.namePlaceholder)}
          value={formData.name}
          onChange={handleNameChange}
          error={!!errors.name}
          helperText={errors.name}
          margin="normal"
          autoFocus
          disabled={isLoading}
          aria-describedby="initiative-name-helper-text"
          inputProps={{
            "aria-label": t(KEYS.initiatives.form.title),
            maxLength: 100,
          }}
        />

        <TextField
          fullWidth
          label={t(KEYS.initiatives.form.description)}
          placeholder={t(
            KEYS.initiatives.newInitiativeDialog.descriptionPlaceholder,
          )}
          value={formData.description || ""}
          onChange={handleDescriptionChange}
          error={!!errors.description}
          helperText={errors.description}
          margin="normal"
          multiline
          rows={3}
          disabled={isLoading}
          inputProps={{
            "aria-label": t(KEYS.initiatives.form.description),
            maxLength: 500,
          }}
        />

        <TagsField
          value={formData.tags}
          onChange={handleTagsChange}
          disabled={isLoading}
          organizationId={organizationId}
          error={!!errors.tags}
          helperText={errors.tags}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          {t(KEYS.common.cancel)}
        </Button>

        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!formData.name.trim() || isLoading}
          startIcon={isLoading ? <CircularProgress size={16} /> : undefined}
        >
          {isLoading
            ? t(KEYS.initiatives.newInitiativeDialog.creating)
            : t(KEYS.common.create)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// Export interfaces for use by consumers
export type { NewInitiativeFormData, NewInitiativeModalProps };
