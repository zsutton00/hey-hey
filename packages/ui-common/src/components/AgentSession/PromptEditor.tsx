import { Alert, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SmarterTextAreaCard } from "../SmarterTextAreaCard";
import { PromptEditorInstructions } from "../shared/PromptEditorInstructions";

interface PromptEditorProps {
  prompt: string;
  submittingPrompt: boolean;
  submitDisabled: boolean;
  submitDisabledReason: string | null;
  onPromptChange: (value: string) => void;
  onSubmitPrompt: () => void;
  placeholder?: string;
  /** Launch failures stay next to the action that can retry them. */
  errorMessages?: readonly string[];
  /**
   * Optional buttons rendered on the same row as Submit Prompt, to the left
   * of the submit. Step 3 of AgentSetupView uses this to surface its Back
   * button alongside Submit Prompt.
   */
  leadingActions?: ReactNode;
}

export const PromptEditor = ({
  prompt,
  submittingPrompt,
  submitDisabled,
  submitDisabledReason,
  onPromptChange,
  onSubmitPrompt,
  placeholder = "Add optional context for the coding agent.",
  errorMessages = [],
  leadingActions = null,
}: PromptEditorProps) => {
  return (
    <Stack spacing={1.5} data-testid="prompt-editor" pb={2}>
      <SmarterTextAreaCard
        value={prompt}
        onChange={onPromptChange}
        placeholder={placeholder}
        saveStatus={submittingPrompt ? "submitting" : "draft"}
        saveMode={null}
        hasUnsavedChanges={prompt.trim().length > 0}
        isSaving={submittingPrompt}
        disabled={submittingPrompt}
        minInputHeight={88}
        headerSx={{ display: "none" }}
        onSubmit={onSubmitPrompt}
      />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
        data-testid="prompt-editor-actions"
      >
        {leadingActions}
        <Button
          type="button"
          variant="contained"
          onClick={onSubmitPrompt}
          disabled={submittingPrompt || submitDisabled}
        >
          {submittingPrompt ? "Submitting Prompt..." : "Submit Prompt"}
        </Button>
        {errorMessages.length > 0 ? (
          <Stack
            spacing={0.5}
            sx={{ flex: 1, minWidth: 0 }}
            data-testid="prompt-editor-launch-errors"
          >
            {errorMessages.map((message) => (
              <Alert key={message} severity="error">
                {message}
              </Alert>
            ))}
          </Stack>
        ) : null}
      </Stack>

      <PromptEditorInstructions />

      {submitDisabledReason ? (
        <Typography variant="body2" color="text.secondary">
          {submitDisabledReason}
        </Typography>
      ) : null}
    </Stack>
  );
};
