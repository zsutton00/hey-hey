import React, { useCallback, useId, useMemo } from "react";
import {
  Box,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import ClearIcon from "@mui/icons-material/Clear";
import type { TaskResponseDto } from "../../api";
import { useFeatureHierarchy } from "../../data/hooks/useFeatureHierarchy";
import { useFeatureDocumentContent } from "../../data/hooks/useFeatureDocumentContent";

const NO_SELECTION_VALUE = "__feature_selector_no_value__";

export interface FeatureSelectorProps {
  organizationId: string;
  projectId: string;
  label?: string;
  placeholder?: string;
  helperText?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  sx?: SxProps<Theme>;
  clearable?: boolean;
  value: string | null;
  onChange: (featureId: string | null, feature?: TaskResponseDto) => void;
}

export const FeatureSelector: React.FC<FeatureSelectorProps> = ({
  organizationId,
  projectId,
  label = "Feature",
  placeholder = "Select a feature",
  helperText,
  fullWidth = true,
  disabled = false,
  size = "small",
  error = false,
  sx,
  clearable = true,
  value,
  onChange,
}) => {
  const labelId = useId();
  const selectId = useId();

  const {
    nodes,
    isLoading,
    error: fetchError,
  } = useFeatureHierarchy(organizationId, projectId);
  const [open, setOpen] = React.useState(false);
  const features = useMemo(
    () =>
      [...nodes.values()]
        .map((node) => node.feature)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [nodes]
  );
  const { entries } = useFeatureDocumentContent(
    organizationId,
    projectId,
    open ? features.map((feature) => feature.id) : [],
    undefined,
    "metadata"
  );

  const handleChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const rawValue = event.target.value;
      if (rawValue === NO_SELECTION_VALUE) {
        onChange(null);
        return;
      }

      const selected = entries.get(rawValue)?.data;
      if (selected) onChange(rawValue, selected);
    },
    [entries, onChange]
  );

  const handleClear = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onChange(null);
    },
    [onChange]
  );

  const renderValue = useCallback(
    (selected: unknown) => {
      const selectedId = value ?? String(selected);

      if (selectedId === NO_SELECTION_VALUE) {
        return (
          <Typography color="text.secondary" variant="body2">
            {placeholder}
          </Typography>
        );
      }

      const feature = features.find((item) => item.id === selectedId);
      return (
        <Typography variant="body2">
          {feature?.name ??
            (isLoading ? "Loading feature…" : "Feature unavailable")}
        </Typography>
      );
    },
    [features, placeholder, isLoading, value]
  );

  const computedHelperText =
    fetchError?.message || (isLoading ? "Loading features…" : helperText) || "";
  const shouldShowHelperText = Boolean(computedHelperText);
  const hasValue = value !== null;

  return (
    <FormControl
      fullWidth={fullWidth}
      disabled={disabled || isLoading}
      size={size}
      error={error || Boolean(fetchError)}
      sx={sx}
    >
      <InputLabel id={`${labelId}-label`}>{label}</InputLabel>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Select
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          labelId={`${labelId}-label`}
          id={`${selectId}-select`}
          label={label}
          value={value && nodes.has(value) ? value : NO_SELECTION_VALUE}
          onChange={handleChange}
          displayEmpty
          renderValue={renderValue}
          MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
          sx={{ flex: 1 }}
        >
          <MenuItem value={NO_SELECTION_VALUE} disabled>
            {placeholder}
          </MenuItem>
          {features.map((feature) => (
            <MenuItem
              key={feature.id}
              value={feature.id}
              disabled={!entries.get(feature.id)?.data}
              data-testid="feature-selector-option"
              data-feature-id={feature.id}
            >
              <Box sx={{ display: "flex", flexDirection: "column" }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {feature.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Status:{" "}
                  {entries.get(feature.id)?.data?.status ??
                    (entries.get(feature.id)?.status === "error"
                      ? "Unavailable"
                      : "Loading…")}
                </Typography>
              </Box>
            </MenuItem>
          ))}
          {isLoading && (
            <MenuItem disabled>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              </Box>
            </MenuItem>
          )}
        </Select>
        {clearable && hasValue && !disabled && !isLoading && (
          <IconButton
            size="small"
            onClick={handleClear}
            sx={{ mt: size === "small" ? 0.5 : 1 }}
            aria-label="Clear selection"
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      {shouldShowHelperText && (
        <FormHelperText>{computedHelperText}</FormHelperText>
      )}
    </FormControl>
  );
};
