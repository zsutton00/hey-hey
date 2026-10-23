import React, { useState, useCallback, useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { SmartTextAreaCard } from "../../SmartTextAreaCard";
import { DesignDocSuggestedContent } from "../../SuggestedContent/index";
import type { FieldComponentProps } from "./types";
import type { AdrContentApplyPayloadAllOfSections } from "../../../api";

export type AdrContextStarterFieldProps = FieldComponentProps<string>;

/**
 * ADR Context Starter Field Component
 *
 * Displays agent's conversational feedback and provides a textarea for users to
 * enter their ADR context. Can be used with a secondary action button to apply
 * suggested context.
 */
export const AdrContextStarterField: React.FC<AdrContextStarterFieldProps> = ({
  config,
  value = "",
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
  context,
}) => {
  const { t } = useTranslation();

  // Context text state
  const [contextText, setContextText] = useState<string>(value || "");
  const [hasUnsavedContext, setHasUnsavedContext] = useState(false);

  // Track unsaved context changes
  useEffect(() => {
    setHasUnsavedContext(contextText.trim().length > 0);
  }, [contextText]);

  const handleContextChange = useCallback(
    (newValue: string) => {
      setContextText(newValue);

      // Notify parent component (DynamicForm) when context text changes
      // This enables the Next button when content is entered
      if (onChange) {
        onChange(newValue);
      }
    },
    [onChange]
  );

  // Handle accepting suggested content
  const handleAcceptSuggestion = useCallback(
    (sections: AdrContentApplyPayloadAllOfSections[]) => {
      // Combine sections into formatted text with section keys as headings
      const formattedContent = sections
        .map((section) => `### ${section.key}\n\n${section.content}`)
        .join("\n\n");
      handleContextChange(formattedContent);
    },
    [handleContextChange]
  );

  // Handle rejecting suggested content (no-op, handled by SuggestedContent itself)
  const handleRejectSuggestion = useCallback(() => {
    // Component handles dismissal internally
  }, []);

  // If submitted, show read-only view
  if (isSubmitted && value) {
    return (
      <Box
        sx={{ mb: 2 }}
        data-testid={`adr-context-starter-field-${config.field}`}
      >
        {config.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {config.description}
          </Typography>
        )}
        <Typography
          variant="body1"
          sx={{
            p: 2,
            backgroundColor: "grey.50",
            borderRadius: 1,
            whiteSpace: "pre-wrap",
          }}
        >
          {value}
        </Typography>
      </Box>
    );
  }

  return (
    <Box data-testid={`adr-context-starter-field-${config.field}`}>
      <Box sx={{ mb: 2 }}>
        {/* Suggested Content - only render if presentation is not INLINE */}
        {config.secondaryAction &&
          config.secondaryAction.presentation !== "INLINE" && (
            <DesignDocSuggestedContent
              secondaryAction={config.secondaryAction}
              title={t("adr.context.suggested", "Suggested Context")}
              designDocId={context.workflowAboutId}
              organizationId={context.organizationId}
              projectId={context.projectId}
              onAccept={handleAcceptSuggestion}
              onReject={handleRejectSuggestion}
              messageId={context.messageId}
              sx={{ mb: 2 }}
            />
          )}

        {/* Context Input */}
        <SmartTextAreaCard
          value={contextText}
          onChange={handleContextChange}
          mentionConversationId={context.conversationId}
          headerText={
            config.description ?? t("adr.context.header", "ADR Context")
          }
          placeholder={
            config.placeholder ||
            t(
              "adr.context.placeholder",
              "Describe the context and background for this architecture decision..."
            )
          }
          saveStatus={"complete"}
          saveMode={null}
          hasUnsavedChanges={hasUnsavedContext}
          isSaving={false}
          minRows={4}
          maxRows={40}
          disabled={isSubmitted || disabled}
          error={!!error}
          helperText={error}
        />
      </Box>
    </Box>
  );
};
