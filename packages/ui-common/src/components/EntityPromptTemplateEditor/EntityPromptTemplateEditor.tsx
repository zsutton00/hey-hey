import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { Alert, Box, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { TemplateAutocompletePlugin } from "./TemplateAutocompletePlugin";
import { TemplateSubstitutionNode } from "./TemplateSubstitutionNode";
import { TemplateSourcePlugin } from "./TemplateSourcePlugin";
import { $loadTemplateSource } from "./templateSerialization";
import type { EntityPromptTemplateEditorProps } from "./types";

export function EntityPromptTemplateEditor({
  source,
  readOnly,
  validation,
  onChange,
}: EntityPromptTemplateEditorProps) {
  const [isSuggestionMenuVisible, setSuggestionMenuVisible] = useState(false);
  const current =
    validation.status !== "idle" &&
    validation.source.content === source.content &&
    validation.source.syntaxVersion === source.syntaxVersion;
  return (
    <Stack spacing={1} data-testid="entity-prompt-template-editor">
      <Typography variant="body2">
        Template content · Type {"{{"} or $ to insert a field
      </Typography>
      <LexicalComposer
        key={source.syntaxVersion}
        initialConfig={{
          namespace: "EntityPromptTemplateEditor",
          nodes: [TemplateSubstitutionNode],
          editable: !readOnly,
          onError: (error) => {
            throw error;
          },
          editorState: () =>
            $loadTemplateSource(source.content, source.syntaxVersion),
        }}
      >
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 2,
            typography: "body2",
            "& [contenteditable]": {
              minHeight: 192,
              outline: 0,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            },
            "& p": { m: 0 },
            '& [data-testid="template-substitution"]': {
              bgcolor: "action.selected",
              color: "primary.main",
              borderRadius: 0.5,
            },
          }}
        >
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                aria-label="Template content"
                aria-multiline="true"
                data-testid="entity-prompt-template-editor-input"
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </Box>
        <HistoryPlugin />
        <TemplateSourcePlugin
          source={source}
          readOnly={readOnly}
          onChange={onChange}
        />
        <TemplateAutocompletePlugin
          syntaxVersion={source.syntaxVersion}
          onMenuVisibilityChange={setSuggestionMenuVisible}
        />
      </LexicalComposer>
      <Box
        aria-live="polite"
        data-testid="template-draft-validation"
        // Reserve one status line even while feedback is empty or suppressed.
        sx={(theme) => ({ minHeight: theme.spacing(3) })}
      >
        {current && validation.status === "pending" && (
          <Typography variant="body2">Checking template…</Typography>
        )}
        {current && validation.status === "valid" && (
          <Typography variant="body2" color="success.main">
            Template is valid.
          </Typography>
        )}
        {current && validation.status === "error" && (
          <Alert severity="error">{validation.message}</Alert>
        )}
        {current &&
          validation.status === "invalid" &&
          !isSuggestionMenuVisible && (
            <Alert severity="error">
              {validation.issues.map((issue, index) => (
                <Typography
                  key={index}
                  variant="body2"
                  data-testid="template-validation-issue"
                  data-path={issue.path}
                >
                  {issue.path}: {issue.message}
                </Typography>
              ))}
            </Alert>
          )}
      </Box>
    </Stack>
  );
}
