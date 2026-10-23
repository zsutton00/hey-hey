import { Autocomplete, Stack, TextField } from "@mui/material";
import { WorkItemTypeGuidanceExamples } from "./WorkItemTypeGuidanceExamples";
import { type GuidanceContext } from "./workItemTypeGuidanceForm";
import { WORK_ITEM_TYPE_FIELD_PRESENTATION as presentation } from "./workItemTypeFormPresentation";

export interface GuidanceTypeOption {
  key: string;
  name: string;
}
interface Props {
  context: GuidanceContext;
  options: GuidanceTypeOption[];
  disabled: boolean;
  onChange: (context: GuidanceContext) => void;
}

export function WorkItemTypeGuidanceContextFields({
  context,
  options,
  disabled,
  onChange,
}: Props) {
  return (
    <Stack spacing={2}>
      <Autocomplete
        multiple
        disableCloseOnSelect
        disabled={disabled}
        options={[
          ...options,
          ...context.focalTypeKeys
            .filter((key) => !options.some((option) => option.key === key))
            .map((key) => ({ key, name: `Unavailable type (${key})` })),
        ]}
        value={context.focalTypeKeys.map(
          (key) =>
            options.find((option) => option.key === key) ?? {
              key,
              name: `Unavailable type (${key})`,
            },
        )}
        isOptionEqualToValue={(option, value) => option.key === value.key}
        getOptionLabel={(option) => option.name}
        getOptionDisabled={(option) =>
          context.focalTypeKeys.includes(option.key)
        }
        onChange={(_, selected) =>
          onChange({
            ...context,
            focalTypeKeys: selected.map((option) => option.key),
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={presentation["agentGuidance.contexts.focalTypeKeys"].label}
            error={context.focalTypeKeys.length === 0}
            helperText={
              context.focalTypeKeys.length === 0
                ? "Select at least one focal type."
                : presentation["agentGuidance.contexts.focalTypeKeys"].help
            }
          />
        )}
      />
      <TextField
        label={presentation["agentGuidance.contexts.guidance"].label}
        required
        multiline
        value={context.guidance}
        error={!context.guidance.trim()}
        helperText={
          !context.guidance.trim()
            ? "Enter contextual guidance."
            : presentation["agentGuidance.contexts.guidance"].help
        }
        onChange={(event) =>
          onChange({ ...context, guidance: event.target.value })
        }
      />
      <WorkItemTypeGuidanceExamples
        label={presentation["agentGuidance.contexts.examples"].label}
        examples={context.examples}
        onChange={(examples) => onChange({ ...context, examples })}
      />
    </Stack>
  );
}
