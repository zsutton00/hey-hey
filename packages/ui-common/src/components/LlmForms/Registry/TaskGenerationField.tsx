import React from "react";
import { Box, Typography } from "@mui/material";
import type { FieldComponentProps } from "./types";
import { SmartTextAreaCard } from "../../SmartTextAreaCard";

export const TaskGenerationField: React.FC<FieldComponentProps<string>> = ({
  config,
  value = "",
  onChange,
  error,
  context,
  disabled = false,
  isSubmitted = false,
  status = "draft",
}) => {
  const headerText =
    config.description ||
    "I can help you generate tasks or just talk them through...";
  return (
    <Box sx={{ mb: 2 }} data-testid={`task-generation-field-${config.field}`}>
      {/* Header Text */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {headerText}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>
      <SmartTextAreaCard
        value={value || ""}
        onChange={(newValue: string) => onChange?.(newValue)}
        mentionConversationId={context.conversationId}
        disabled={disabled}
        placeholder={
          isSubmitted && !disabled
            ? ""
            : config.placeholder || "Type your message here..."
        }
        headerText={isSubmitted && !disabled ? "" : headerText}
        saveStatus={status}
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
        multiline={true}
        error={!!error}
        helperText={error}
        required={config.required}
        minRows={4}
        maxRows={12}
      />
    </Box>
  );
};
