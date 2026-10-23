import {
  Box,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  reportGuides,
  type ProjectReportPresetOption,
  type ProjectReportRequestState,
} from "./projectReportRequestState";

export interface ProjectReportQuestionFieldsProps {
  state: ProjectReportRequestState;
  disabled: boolean;
  onApplyPreset: (preset: ProjectReportPresetOption) => void;
  onQuestionChange: (question: string) => void;
  onOutlineChange: (outline: string) => void;
}

export const ProjectReportQuestionFields = ({
  state,
  disabled,
  onApplyPreset,
  onQuestionChange,
  onOutlineChange,
}: ProjectReportQuestionFieldsProps) => (
  <Stack spacing={2} data-testid="project-report-question-fields">
    <TextField
      label="What would you like to understand?"
      value={state.question}
      onChange={(event) => onQuestionChange(event.target.value)}
      multiline
      minRows={4}
      fullWidth
      disabled={disabled}
      slotProps={{ htmlInput: { "data-testid": "project-report-question" } }}
    />
    <Box>
      <Typography
        id="project-report-presets-label"
        variant="caption"
        color="text.secondary"
      >
        Outline guide
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={state.preset?.key ?? null}
        aria-labelledby="project-report-presets-label"
        sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}
        data-testid="project-report-presets"
      >
        {reportGuides(state.kind).map((preset) => (
          <ToggleButton
            key={preset.key}
            value={preset.key}
            disabled={disabled}
            onClick={() => onApplyPreset(preset)}
            data-testid="project-report-preset"
            data-preset-key={preset.key}
          >
            {preset.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
    <TextField
      label="Suggested outline (optional)"
      value={state.outline}
      onChange={(event) => onOutlineChange(event.target.value)}
      multiline
      minRows={3}
      fullWidth
      disabled={disabled}
      helperText="One section per line. The report may adapt it to the evidence."
      slotProps={{ htmlInput: { "data-testid": "project-report-outline" } }}
    />
  </Stack>
);
