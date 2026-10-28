import {
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import {
  TIME_LIMIT_PRESETS_MINUTES,
  TOKEN_LIMIT_PRESETS,
  formatTokenCount,
  type LimitChoice,
  type RunSettingsDraft,
} from "./evalRunView";

const NONE = "none";
const CUSTOM = "custom";

const parsePositiveInteger = (raw: string): number | null => {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isInteger(value) && value >= 1
    ? value
    : null;
};

const choiceToSelectValue = (choice: LimitChoice): string =>
  choice.kind === "none"
    ? NONE
    : choice.kind === "custom"
      ? CUSTOM
      : String(choice.value);

const selectValueToChoice = (value: string): LimitChoice =>
  value === NONE
    ? { kind: "none" }
    : value === CUSTOM
      ? { kind: "custom", value: null }
      : { kind: "preset", value: Number(value) };

interface LimitFieldProps {
  id: string;
  label: string;
  customLabel: string;
  choice: LimitChoice;
  presets: readonly { value: number; label: string }[];
  disabled: boolean;
  onChange: (choice: LimitChoice) => void;
}

const LimitField: React.FC<LimitFieldProps> = ({
  id,
  label,
  customLabel,
  choice,
  presets,
  disabled,
  onChange,
}) => {
  const { t } = useTranslation();
  const handleSelect = (event: SelectChangeEvent) =>
    onChange(selectValueToChoice(event.target.value));
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      <FormControl size="small" sx={{ minWidth: 200 }} disabled={disabled}>
        <InputLabel id={`${id}-label`}>{label}</InputLabel>
        <Select
          labelId={`${id}-label`}
          label={label}
          value={choiceToSelectValue(choice)}
          onChange={handleSelect}
          data-testid={id}
          slotProps={{ input: { "aria-label": label } }}
        >
          <MenuItem value={NONE}>{t("eval.run.settings.noLimit")}</MenuItem>
          {presets.map((preset) => (
            <MenuItem key={preset.value} value={String(preset.value)}>
              {preset.label}
            </MenuItem>
          ))}
          <MenuItem value={CUSTOM}>{t("eval.run.settings.custom")}</MenuItem>
        </Select>
      </FormControl>
      {choice.kind === "custom" && (
        <TextField
          size="small"
          type="number"
          label={customLabel}
          disabled={disabled}
          value={choice.value ?? ""}
          error={choice.value === null}
          onChange={(event) =>
            onChange({
              kind: "custom",
              value: parsePositiveInteger(event.target.value),
            })
          }
          slotProps={{ htmlInput: { min: 1, "data-testid": `${id}-custom` } }}
          sx={{ width: 140 }}
        />
      )}
    </Box>
  );
};

export interface RunSettingsFieldsProps {
  value: RunSettingsDraft;
  disabled: boolean;
  onChange: (value: RunSettingsDraft) => void;
}

export const RunSettingsFields: React.FC<RunSettingsFieldsProps> = ({
  value,
  disabled,
  onChange,
}) => {
  const { t } = useTranslation();
  const timePresets = TIME_LIMIT_PRESETS_MINUTES.map((minutes) => ({
    value: minutes,
    label: t("eval.run.settings.minutes", { count: minutes }),
  }));
  const tokenPresets = TOKEN_LIMIT_PRESETS.map((tokens) => ({
    value: tokens,
    label: t("eval.run.settings.tokens", { value: formatTokenCount(tokens) }),
  }));
  return (
    <Box data-testid="eval-run-settings">
      <Typography variant="subtitle1" component="h3" sx={{ mb: 1.5 }}>
        {t("eval.run.settings.title")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        <TextField
          size="small"
          type="number"
          label={t("eval.run.settings.concurrency")}
          disabled={disabled}
          value={value.concurrency ?? ""}
          error={value.concurrency === null}
          onChange={(event) =>
            onChange({
              ...value,
              concurrency: parsePositiveInteger(event.target.value),
            })
          }
          slotProps={{
            htmlInput: {
              min: 1,
              "data-testid": "eval-run-setting-concurrency",
            },
          }}
          sx={{ width: 160 }}
        />
        <LimitField
          id="eval-run-setting-time-limit"
          label={t("eval.run.settings.timeLimit")}
          customLabel={t("eval.run.settings.customMinutes")}
          choice={value.timeLimit}
          presets={timePresets}
          disabled={disabled}
          onChange={(timeLimit) => onChange({ ...value, timeLimit })}
        />
        <LimitField
          id="eval-run-setting-token-limit"
          label={t("eval.run.settings.tokenLimit")}
          customLabel={t("eval.run.settings.customTokens")}
          choice={value.tokenLimit}
          presets={tokenPresets}
          disabled={disabled}
          onChange={(tokenLimit) => onChange({ ...value, tokenLimit })}
        />
      </Box>
      <FormControlLabel
        sx={{ mt: 1 }}
        disabled={disabled}
        control={
          <Switch
            checked={value.projectAssistantEnabled}
            onChange={(event) =>
              onChange({
                ...value,
                projectAssistantEnabled: event.target.checked,
              })
            }
            data-testid="eval-run-setting-project-assistant"
            slotProps={{
              input: { "aria-label": t("eval.run.settings.projectAssistant") },
            }}
          />
        }
        label={t("eval.run.settings.projectAssistant")}
      />
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="eval-run-project-assistant-note"
      >
        {t("eval.run.settings.projectAssistantNote")}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 1 }}
        data-testid="eval-run-limits-note"
      >
        {t("eval.run.settings.limitsNote")}
      </Typography>
    </Box>
  );
};
