import React from "react";
import type { FieldComponentProps } from "./types";
import { SmartTextAreaCard } from "../../SmartTextAreaCard";

// Field component registry

// Individual field components
export const TextareaField: React.FC<FieldComponentProps<string>> = ({
  config,
  value,
  onChange,
  error,
  context,
  disabled,
  isSubmitted,
  status = "draft",
  isSubmittable = true,
}) => {
  // Don't render empty textarea fields when form is no longer submittable
  if (!isSubmittable && !isSubmitted && !(value || "").trim()) {
    return null;
  }

  return (
    <div data-testid={`textarea-field-${config.field}`}>
      <SmartTextAreaCard
        value={value || ""}
        onChange={(newValue: string) => onChange?.(newValue)}
        mentionConversationId={context.conversationId}
        disabled={disabled}
        placeholder={
          isSubmitted && !disabled ? "" : config.placeholder ?? undefined
        }
        headerText={isSubmitted && !disabled ? "" : config.description}
        saveStatus={status}
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
        multiline={true}
        error={!!error}
        helperText={error}
        required={config.required}
        minRows={4}
        maxRows={40}
      />
    </div>
  );
};
