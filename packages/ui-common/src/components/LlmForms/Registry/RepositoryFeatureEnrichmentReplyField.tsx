import { Box } from "@mui/material";
import React from "react";
import { SmarterTextAreaCard } from "../../SmarterTextAreaCard";
import type { FieldComponentProps } from "./types";

export const RepositoryFeatureEnrichmentReplyField: React.FC<
  FieldComponentProps<string>
> = ({
  config,
  context,
  value = "",
  onChange,
  disabled = false,
  isSubmitted,
}) => (
  <Box data-testid={`repository-feature-enrichment-reply-${config.field}`}>
    <SmarterTextAreaCard
      value={value}
      onChange={(reply: string) => onChange?.(reply)}
      placeholder={config.placeholder ?? "Answer the questions above..."}
      disabled={disabled || isSubmitted}
      mentionConversationId={context.conversationId}
      saveStatus="draft"
      saveMode={null}
      hasUnsavedChanges={false}
      minRows={3}
    />
  </Box>
);
