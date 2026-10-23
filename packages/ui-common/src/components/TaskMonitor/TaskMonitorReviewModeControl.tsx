import {
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import {
  TaskMonitorReviewMode,
  type TaskMonitorReviewMode as TaskMonitorReviewModeValue,
} from "../../api";

export interface TaskMonitorReviewModeControlProps {
  value: TaskMonitorReviewModeValue;
  onChange: (mode: TaskMonitorReviewModeValue) => void;
  disabled?: boolean;
}

export const TaskMonitorReviewModeControl = ({
  value,
  onChange,
  disabled = false,
}: TaskMonitorReviewModeControlProps) => (
  <FormControl
    component="fieldset"
    disabled={disabled}
    data-testid="task-monitor-review-mode"
  >
    <FormLabel component="legend">Review completed coding sessions</FormLabel>
    <RadioGroup
      value={value}
      onChange={(event) =>
        onChange(event.target.value as TaskMonitorReviewModeValue)
      }
    >
      <FormControlLabel
        value={TaskMonitorReviewMode.RequireReview}
        control={<Radio />}
        label={
          <Stack>
            <Typography>Review required</Typography>
            <Typography variant="body2" color="text.secondary">
              Session Monitor starts the existing Review flow before Task
              Monitor supervision continues.
            </Typography>
          </Stack>
        }
      />
      <FormControlLabel
        value={TaskMonitorReviewMode.AgentDecides}
        control={<Radio />}
        label={
          <Stack>
            <Typography>Agent decides</Typography>
            <Typography variant="body2" color="text.secondary">
              Task Monitor requests Review only when the available evidence
              warrants it.
            </Typography>
          </Stack>
        }
      />
    </RadioGroup>
  </FormControl>
);
