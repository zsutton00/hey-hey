import React, { useState, useCallback, useEffect } from "react";
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
import { useTranslation } from "react-i18next";
import { KEYS } from "@hey-hey/ui-common/i18n";
import type { TaskPriority, WorkStatus } from "@hey-hey/ui-common/api";
import { Priority, WorkStatus as WorkStatusEnum } from "@hey-hey/ui-common/api";
import { SmarterTextAreaCard } from "@hey-hey/ui-common/components";
import type { WorkItemSectionSelection } from "../../types/workItemTypes";

// Form data interfaces
export interface NewTaskFormData {
  name: string;
  description?: string;
  acceptanceCriteria?: string;
  sectionContent?: Record<string, string>;
  priority?: TaskPriority;
  status?: WorkStatus;
  initiativeId: string;
}

interface FormErrors {
  name?: string;
  priority?: string;
}

export interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (formData: NewTaskFormData) => void;
  isLoading?: boolean;
  initiativeId: string;
  /**
   * Omit for legacy task creation. Parent work-item pages must provide the
   * selected child's registry-backed section selection, including unavailable.
   */
  sectionSelection?: WorkItemSectionSelection;
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  initiativeId,
  sectionSelection,
}) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<NewTaskFormData>({
    name: "",
    description: "",
    acceptanceCriteria: "",
    priority: Priority.Medium,
    status: WorkStatusEnum.RefiningDescription,
    initiativeId,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [sectionContent, setSectionContent] = useState<Record<string, string>>(
    {},
  );
  const declaredSections =
    sectionSelection?.status === "resolved" ? sectionSelection.sections : [];
  const declaredSectionSignature = declaredSections
    .map((section) => section.key)
    .join("\u0000");
  const usesRegistrySections = sectionSelection !== undefined;

  useEffect(() => {
    if (!open || !usesRegistrySections) return;

    setSectionContent(
      Object.fromEntries(
        declaredSectionSignature
          ? declaredSectionSignature.split("\u0000").map((key) => [key, ""])
          : [],
      ),
    );
  }, [declaredSectionSignature, open, usesRegistrySections]);

  // Form validation logic
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

  const handleDescriptionChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, description: value }));
  }, []);

  const handleAcceptanceCriteriaChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, acceptanceCriteria: value }));
  }, []);

  const handleSectionChange = useCallback((key: string, value: string) => {
    setSectionContent((current) => ({ ...current, [key]: value }));
  }, []);

  const handlePriorityChange = useCallback((event: unknown) => {
    const changeEvent = event as React.ChangeEvent<{ value: unknown }>;
    const value = changeEvent.target.value as TaskPriority;
    setFormData((prev) => ({ ...prev, priority: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      return;
    }
    onSubmit(
      sectionSelection === undefined
        ? formData
        : { ...formData, sectionContent },
    );
  }, [formData, onSubmit, sectionContent, sectionSelection, validateForm]);

  // Submit on cmd-enter (mac) / ctrl-enter (windows/linux) when focus is
  // outside the rich-text editor; SmarterTextAreaCard wires its own handler
  // for cmd-enter while the editor has focus via the onSubmit prop below.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!isLoading && formData.name.trim()) {
          handleSubmit();
        }
      }
    },
    [handleSubmit, isLoading, formData.name],
  );

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setFormData({
        name: "",
        description: "",
        acceptanceCriteria: "",
        priority: Priority.Medium,
        status: WorkStatusEnum.RefiningDescription,
        initiativeId,
      });
      setErrors({});
      setSectionContent({});
      onClose();
    }
  }, [isLoading, onClose, initiativeId]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      onKeyDown={handleKeyDown}
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

        {sectionSelection === undefined && (
          <Box sx={{ mt: 2, mb: 1 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              {t(KEYS.tasks.form.description)}
            </Typography>
            <SmarterTextAreaCard
              value={formData.description ?? ""}
              onChange={handleDescriptionChange}
              placeholder={t(KEYS.tasks.dialog.descriptionPlaceholder)}
              saveStatus="draft"
              saveMode={null}
              hasUnsavedChanges={false}
              disabled={isLoading}
              minInputHeight={96}
              onSubmit={handleSubmit}
              transparent
            />
          </Box>
        )}

        {sectionSelection === undefined && (
          <Box sx={{ mt: 2, mb: 1 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              {t(KEYS.tasks.dialog.acceptanceCriteriaLabel)}
            </Typography>
            <SmarterTextAreaCard
              value={formData.acceptanceCriteria ?? ""}
              onChange={handleAcceptanceCriteriaChange}
              placeholder={t(KEYS.tasks.dialog.acceptanceCriteriaPlaceholder)}
              saveStatus="draft"
              saveMode={null}
              hasUnsavedChanges={false}
              disabled={isLoading}
              minInputHeight={96}
              onSubmit={handleSubmit}
              transparent
            />
          </Box>
        )}

        {sectionSelection?.status === "unavailable" && (
          <Typography
            color="text.secondary"
            data-testid="new-task-sections-unavailable"
            sx={{ my: 2 }}
          >
            The work item type definition is unavailable, so its content
            sections cannot be created yet.
          </Typography>
        )}

        {sectionSelection?.status === "resolved" &&
          declaredSections.map((section) => (
            <Box key={section.key} sx={{ mt: 2, mb: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 0.5 }}
              >
                {section.label}
              </Typography>
              <SmarterTextAreaCard
                value={sectionContent[section.key] ?? ""}
                onChange={(value) => handleSectionChange(section.key, value)}
                placeholder={section.writingStandard || section.label}
                saveStatus="draft"
                saveMode={null}
                hasUnsavedChanges={false}
                disabled={isLoading}
                minInputHeight={96}
                onSubmit={handleSubmit}
                transparent
              />
              {section.writingStandard && (
                <Typography variant="caption" color="text.secondary">
                  {section.writingStandard}
                </Typography>
              )}
            </Box>
          ))}

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
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          {t(KEYS.common.cancel)}
        </Button>

        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={
            !formData.name.trim() ||
            isLoading ||
            sectionSelection?.status === "unavailable"
          }
          startIcon={isLoading ? <CircularProgress size={16} /> : undefined}
        >
          {isLoading ? t(KEYS.tasks.dialog.creating) : t(KEYS.common.create)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
