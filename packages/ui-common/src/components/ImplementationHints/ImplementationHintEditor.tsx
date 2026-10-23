import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Stack, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ImplementationHintDto } from "../../api";
import { useImplementationHints } from "../../data";
import { SmartTextAreaCard, type SaveStatus } from "../SmartTextAreaCard";

interface ImplementationHintEditorProps {
  hint: ImplementationHintDto;
  organizationId: string;
  serviceId: string;
  onSuccess?: (hint: ImplementationHintDto) => void;
  onError?: (error: string) => void;
}

const getCanonicalHintContent = (hint: ImplementationHintDto): string => {
  const preferredHint = hint.hint?.trim();
  if (preferredHint && preferredHint.length > 0) {
    return hint.hint ?? "";
  }

  return hint.description;
};

export const ImplementationHintEditor: React.FC<
  ImplementationHintEditorProps
> = ({ hint, organizationId, serviceId, onSuccess, onError }) => {
  const { t } = useTranslation();
  const { update } = useImplementationHints(organizationId, serviceId);
  const [featureName, setFeatureName] = useState(hint.featureName);
  const [hintContent, setHintContent] = useState(getCanonicalHintContent(hint));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("draft");

  useEffect(() => {
    setFeatureName(hint.featureName);
    setHintContent(getCanonicalHintContent(hint));
    setSaveStatus("draft");
    setError(null);
  }, [hint.description, hint.featureName, hint.hint]);

  const savedHintContent = getCanonicalHintContent(hint);
  const hasUnsavedChanges = useMemo(
    () =>
      featureName.trim() !== hint.featureName.trim() ||
      hintContent.trim() !== savedHintContent.trim(),
    [featureName, hint.featureName, hintContent, savedHintContent]
  );

  const handleSave = useCallback(async (): Promise<void> => {
    if (!featureName.trim()) {
      const errorMsg = t(
        "implementationHints.errors.featureRequired",
        "Feature name is required"
      );
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    if (!hintContent.trim()) {
      const errorMsg = t(
        "implementationHints.errors.descriptionRequired",
        "Description is required"
      );
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    setError(null);
    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const normalizedHintContent = hintContent.trim();
      const updatedHint = await update(hint.id, {
        featureName: featureName.trim(),
        description: normalizedHintContent,
        hint: normalizedHintContent,
        serviceId,
      });
      setSaveStatus("saved");
      onSuccess?.(updatedHint);
    } catch (err) {
      const errorMsg =
        (err as { message?: string })?.message ||
        t(
          "implementationHints.errors.updateFailed",
          "Failed to update implementation hint. Please try again."
        );
      setError(errorMsg);
      setSaveStatus("draft");
      onError?.(errorMsg);
    } finally {
      setIsSaving(false);
    }
  }, [
    featureName,
    hint.id,
    hintContent,
    onError,
    onSuccess,
    serviceId,
    t,
    update,
  ]);

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack spacing={2}>
        <TextField
          label={t("implementationHints.featureName", "Feature name")}
          value={featureName}
          onChange={(event) => {
            setFeatureName(event.target.value);
            setSaveStatus("draft");
          }}
          fullWidth
          required
          error={!!error}
          helperText={error ?? undefined}
          placeholder={t(
            "implementationHints.featurePlaceholder",
            "e.g., Notification system"
          )}
        />
        <SmartTextAreaCard
          headerText={t(
            "implementationHints.description",
            "Implementation guidance"
          )}
          value={hintContent}
          onChange={(value) => {
            setHintContent(value);
            setSaveStatus("draft");
          }}
          hasUnsavedChanges={hasUnsavedChanges}
          saveStatus={saveStatus}
          saveMode={null}
          isSaving={isSaving}
          onSaveWithoutFeedback={handleSave}
          saveWithoutFeedbackText={t("common.save", "Save")}
          disabled={isSaving}
          placeholder={t(
            "implementationHints.descriptionPlaceholder",
            "Share conventions, decisions, or gotchas to keep in mind"
          )}
          error={!!error}
          helperText={error ?? undefined}
          minRows={6}
        />
      </Stack>
    </Box>
  );
};
