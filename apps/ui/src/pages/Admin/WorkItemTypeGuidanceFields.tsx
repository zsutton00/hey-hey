import { Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useImperativeHandle, useState, type Ref } from "react";
import type { WorkItemTypeDefinitionDto } from "@hey-hey/ui-common/api";
import { WorkItemTypeGuidanceExamples } from "./WorkItemTypeGuidanceExamples";
import {
  WorkItemTypeGuidanceContextFields,
  type GuidanceTypeOption,
} from "./WorkItemTypeGuidanceContextFields";
import {
  moveGuidanceItem,
  type GuidanceDraft,
} from "./workItemTypeGuidanceForm";
import { WORK_ITEM_TYPE_FIELD_PRESENTATION as presentation } from "./workItemTypeFormPresentation";

export interface WorkItemTypeGuidanceHandle {
  getValue: () => GuidanceDraft;
}

interface Props {
  definition: WorkItemTypeDefinitionDto | undefined;
  ref: Ref<WorkItemTypeGuidanceHandle>;
  options: GuidanceTypeOption[];
  disabled: boolean;
}

export function WorkItemTypeGuidanceFields({
  definition,
  ref,
  options,
  disabled,
}: Props) {
  const [draft, setDraft] = useState(() => ({
    source: definition,
    value: definition?.agentGuidance,
  }));
  // A new authoritative definition resets the editor; unrelated parent renders
  // must not replace locally authored values. Reset before children commit.
  if (draft.source !== definition) {
    setDraft({ source: definition, value: definition?.agentGuidance });
  }
  const value = draft.value;
  const onChange = (next: GuidanceDraft) => {
    setDraft({ source: definition, value: next });
  };
  useImperativeHandle(ref, () => ({ getValue: () => value }), [value]);
  const contexts = value?.contexts ?? [];
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, mb: 2.5 }}
      data-testid="wit-guidance"
    >
      <Stack spacing={2}>
        <Typography variant="h6">{presentation.agentGuidance.label}</Typography>
        <Typography variant="body2">
          {presentation.agentGuidance.help}
        </Typography>
        {value === undefined ? (
          <Button onClick={() => onChange({ overview: "" })}>
            Add semantic guidance
          </Button>
        ) : (
          <>
            <Button onClick={() => onChange(undefined)}>
              Remove semantic guidance
            </Button>
            <TextField
              label={presentation["agentGuidance.overview"].label}
              required
              multiline
              value={value.overview}
              error={!value.overview.trim()}
              helperText={
                !value.overview.trim()
                  ? "Enter an overview."
                  : presentation["agentGuidance.overview"].help
              }
              onChange={(event) =>
                onChange({ ...value, overview: event.target.value })
              }
            />
            <WorkItemTypeGuidanceExamples
              label={presentation["agentGuidance.examples"].label}
              examples={value.examples}
              onChange={(examples) => onChange({ ...value, examples })}
            />
            {contexts.map((context, index) => (
              <Stack
                spacing={1}
                key={index}
                role="group"
                aria-label={`Contextual guidance ${index + 1}`}
              >
                <WorkItemTypeGuidanceContextFields
                  context={context}
                  disabled={disabled}
                  options={options}
                  onChange={(next) =>
                    onChange({
                      ...value,
                      contexts: contexts.map((row, i) =>
                        i === index ? next : row,
                      ),
                    })
                  }
                />
                <Stack direction="row">
                  <Button
                    disabled={index === 0}
                    onClick={() =>
                      onChange({
                        ...value,
                        contexts: moveGuidanceItem(contexts, index, -1),
                      })
                    }
                  >
                    Move contextual guidance up
                  </Button>
                  <Button
                    disabled={index === contexts.length - 1}
                    onClick={() =>
                      onChange({
                        ...value,
                        contexts: moveGuidanceItem(contexts, index, 1),
                      })
                    }
                  >
                    Move contextual guidance down
                  </Button>
                  <Button
                    onClick={() =>
                      onChange({
                        ...value,
                        contexts: contexts.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove contextual guidance
                  </Button>
                </Stack>
              </Stack>
            ))}
            <Button
              onClick={() =>
                onChange({
                  ...value,
                  contexts: [...contexts, { focalTypeKeys: [], guidance: "" }],
                })
              }
            >
              Add contextual guidance
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}
