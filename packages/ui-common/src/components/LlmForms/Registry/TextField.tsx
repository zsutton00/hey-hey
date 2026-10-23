import React from "react";
import type { FieldComponentProps } from "./types";
import { useUserAction } from "../../../contexts/TrackingContext";
import { SmartTextAreaCard } from "../../SmartTextAreaCard";

export const TextField: React.FC<FieldComponentProps<string>> = ({
  config,
  value,
  onChange,
  error,
  context,
  disabled,
  isSubmitted,
  status = "draft",
}) => {
  const { trackForm } = useUserAction();

  const handleChange = (newValue: string) => {
    onChange?.(newValue);

    // Track text input with additional context
    if (newValue.length > 0) {
      trackForm("field_change", {
        formName: "dynamic-form",
        fieldName: config.field,
        fieldType: "text",
      });
    }
  };

  const handleFocus = () => {
    trackForm("field_focus", {
      formName: "dynamic-form",
      fieldName: config.field,
      fieldType: "text",
    });
  };

  return (
    <div data-testid={`text-field-${config.field}`}>
      <SmartTextAreaCard
        value={value || ""}
        onChange={handleChange}
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
        multiline={false}
        error={!!error}
        helperText={error}
        required={config.required}
        onFocus={handleFocus}
      />
    </div>
  );
};
