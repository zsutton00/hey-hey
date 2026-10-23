import {
  Button,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import {
  readExternalEditorPreference,
  resetExternalEditorPreference,
  validateExternalEditorUrlTemplate,
  writeExternalEditorPreference,
  type ExternalEditorPreference,
} from "./editorPreference";

type EditorChoice = "vscode" | "custom";

export interface ExternalEditorPreferenceControlProps {
  onCancel?: () => void;
  onSaved?: (preference: ExternalEditorPreference) => void;
}

const getInitialChoice = (
  preference: ExternalEditorPreference | null
): EditorChoice => (preference?.kind === "custom" ? "custom" : "vscode");

export const ExternalEditorPreferenceControl = ({
  onCancel,
  onSaved,
}: ExternalEditorPreferenceControlProps) => {
  const [savedPreference, setSavedPreference] = useState(
    readExternalEditorPreference
  );
  const [choice, setChoice] = useState<EditorChoice>(() =>
    getInitialChoice(savedPreference)
  );
  const [urlTemplate, setUrlTemplate] = useState(() =>
    savedPreference?.kind === "custom" ? savedPreference.urlTemplate : ""
  );
  const templateError =
    choice === "custom" ? validateExternalEditorUrlTemplate(urlTemplate) : null;

  const handleSave = () => {
    const preference: ExternalEditorPreference =
      choice === "vscode"
        ? { kind: "preset", editor: "vscode" }
        : { kind: "custom", urlTemplate: urlTemplate.trim() };

    if (preference.kind === "custom" && templateError) return;
    if (!writeExternalEditorPreference(preference)) return;

    setSavedPreference(preference);
    onSaved?.(preference);
  };

  const handleReset = () => {
    if (!resetExternalEditorPreference()) return;
    setSavedPreference(null);
    setChoice("vscode");
    setUrlTemplate("");
  };

  return (
    <Stack spacing={2} data-testid="external-editor-preference-control">
      <Typography variant="body2" color="text.secondary">
        This setting is saved only in this browser on this machine.
      </Typography>
      <FormControl>
        <RadioGroup
          value={choice}
          onChange={(event) => setChoice(event.target.value as EditorChoice)}
          data-testid="external-editor-choice"
        >
          <FormControlLabel
            value="vscode"
            control={<Radio />}
            label="Visual Studio Code"
          />
          <FormControlLabel
            value="custom"
            control={<Radio />}
            label="Custom URL template"
          />
        </RadioGroup>
        {choice === "custom" && (
          <TextField
            label="URL template"
            value={urlTemplate}
            onChange={(event) => setUrlTemplate(event.target.value)}
            placeholder="cursor://file/{path}:{line}:{column}"
            error={templateError !== null}
            helperText={
              templateError ?? "Available values: {path}, {line}, {column}"
            }
            inputProps={{ "data-testid": "external-editor-url-template" }}
            sx={{ mt: 1 }}
          />
        )}
      </FormControl>
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        {savedPreference && (
          <Button
            onClick={handleReset}
            color="inherit"
            data-testid="external-editor-reset"
          >
            Reset
          </Button>
        )}
        {onCancel && (
          <Button
            onClick={onCancel}
            color="inherit"
            data-testid="external-editor-cancel"
          >
            Cancel
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={templateError !== null}
          data-testid="external-editor-save"
        >
          Save
        </Button>
      </Stack>
    </Stack>
  );
};
