import { Box } from "@mui/material";
import React from "react";
import { SmartTextAreaCard } from "../../SmartTextAreaCard";
import type { FieldComponentProps } from "./types";

export type AgentResponseValue = string;

export type AgentResponseFieldProps = FieldComponentProps<AgentResponseValue>;

/**
 * Agent Response Field Component
 *
 * Generic field component that handles both ADR and Initiative content suggestions.
 * Displays AI-suggested items (sections for ADR, fields for Initiative) with independent
 * accept/reject actions, plus a textarea for manual content entry.
 * Tracks which items have been accepted as part of the field value.
 */
export const AgentResponseField: React.FC<AgentResponseFieldProps> = ({
  config,
  value,
  onChange,
  error,
  context,
  disabled = false,
  isSubmitted = false,
}) => {
  return (
    <Box data-testid={`agent-response-field-${config.field}`}>
      {/* Render a SuggestedContent for each item (section for ADR, field for Initiative) */}

      {/* Manual Content Input */}
      <SmartTextAreaCard
        value={value || ""}
        onChange={onChange!}
        mentionConversationId={context.conversationId}
        headerText={config.description}
        placeholder={config.placeholder}
        saveStatus={isSubmitted ? "complete" : "draft"}
        saveMode={null}
        isSaving={false}
        minRows={4}
        maxRows={40}
        hasUnsavedChanges={!isSubmitted}
        disabled={isSubmitted || disabled}
        error={!!error}
        helperText={error}
      />
    </Box>
  );
};
