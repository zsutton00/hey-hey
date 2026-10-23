import {
  Alert,
  Autocomplete,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import React, { useMemo } from "react";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import {
  readModeProjectAssistantSetting,
  serializeModeSettings,
} from "./modeFilesSection";

export interface ModeSettingsSectionRendererProps {
  content: unknown;
  /** Prior value, shown alongside `content` when a proposal changes it. */
  previousContent?: unknown;
  /** When provided the setting is editable and emits canonical section JSON. */
  onChange?: (content: string) => void;
  disabled?: boolean;
  /** Project scope for listing active effective types while editing. */
  organizationId?: string;
  projectId?: string;
}

const label = (enabled: boolean): string => (enabled ? "On" : "Off");

const LEGACY_ELIGIBILITY_LABEL = "Default for all modes";

const eligibleLabel = (keys: readonly string[] | null): string =>
  keys === null ? LEGACY_ELIGIBILITY_LABEL : keys.join(", ");

/**
 * Renders the registry-owned MODE settings section as typed controls rather
 * than generic JSON. Fails closed when the stored value is not the supported
 * schema so an invalid value is never silently shown as a choice.
 */
export const ModeSettingsSectionRenderer: React.FC<
  ModeSettingsSectionRendererProps
> = ({
  content,
  previousContent,
  onChange,
  disabled = false,
  organizationId,
  projectId,
}) => {
  const setting = useMemo(
    () => readModeProjectAssistantSetting(content),
    [content]
  );
  const previous = useMemo(
    () =>
      previousContent === undefined
        ? undefined
        : readModeProjectAssistantSetting(previousContent),
    [previousContent]
  );
  const { workItemTypes } = useWorkItemTypes(organizationId, {
    projectId,
    enabled: Boolean(onChange),
  });
  const typeOptions = useMemo(
    () =>
      workItemTypes
        .filter((type) => type.status === "ACTIVE")
        .map((type) => type.definition.key)
        .sort(),
    [workItemTypes]
  );

  if (setting.status === "invalid") {
    return (
      <Alert severity="warning" data-testid="mode-settings-section-unavailable">
        MODE settings are unavailable because the stored settings value is
        invalid.
      </Alert>
    );
  }

  const changedFrom =
    previous?.status === "valid" && previous.enabled !== setting.enabled
      ? label(previous.enabled)
      : undefined;
  const eligibleChangedFrom =
    previous?.status === "valid" &&
    eligibleLabel(previous.eligibleWorkItemTypeKeys) !==
      eligibleLabel(setting.eligibleWorkItemTypeKeys)
      ? eligibleLabel(previous.eligibleWorkItemTypeKeys)
      : undefined;

  return (
    <Paper
      variant="outlined"
      data-testid="mode-settings-section-renderer"
      sx={{ px: 2, py: 1.5 }}
    >
      <Stack spacing={1.5}>
        <Stack spacing={0.5}>
          {onChange ? (
            <FormControlLabel
              control={
                <Switch
                  checked={setting.enabled}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      serializeModeSettings(
                        event.target.checked,
                        setting.eligibleWorkItemTypeKeys
                      )
                    )
                  }
                  slotProps={{
                    input: { "aria-label": "Run Project Assistant" },
                  }}
                  data-testid="mode-settings-project-assistant-toggle"
                />
              }
              label={`Project Assistant: ${label(setting.enabled)}`}
            />
          ) : (
            <Typography
              variant="body2"
              data-testid="mode-settings-project-assistant"
              data-enabled={String(setting.enabled)}
            >
              Project Assistant: {changedFrom ? `${changedFrom} → ` : ""}
              <strong>{label(setting.enabled)}</strong>
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Runs before the first turn of sessions launched with this mode.
            Sessions already launched keep the value they started with.
          </Typography>
        </Stack>
        <Stack spacing={0.5}>
          {onChange ? (
            <Autocomplete
              multiple
              size="small"
              disabled={disabled}
              options={Array.from(
                new Set([
                  ...typeOptions,
                  ...(setting.eligibleWorkItemTypeKeys ?? []),
                ])
              ).sort()}
              value={setting.eligibleWorkItemTypeKeys ?? []}
              onChange={(_event, keys) =>
                onChange(serializeModeSettings(setting.enabled, keys))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Eligible work-item types"
                  placeholder={
                    setting.eligibleWorkItemTypeKeys === null
                      ? LEGACY_ELIGIBILITY_LABEL
                      : undefined
                  }
                />
              )}
              data-testid="mode-settings-eligible-types-select"
            />
          ) : (
            <Typography
              variant="body2"
              data-testid="mode-settings-eligible-types"
            >
              Eligible work-item types:{" "}
              {eligibleChangedFrom ? `${eligibleChangedFrom} → ` : ""}
              <strong>{eligibleLabel(setting.eligibleWorkItemTypeKeys)}</strong>
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Work items this mode can launch on, further limited by the Features
            it depends on. Leave empty to keep the default shared by all modes.
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
};
