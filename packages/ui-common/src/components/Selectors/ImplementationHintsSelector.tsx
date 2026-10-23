import React, { useCallback, useId, useMemo } from "react";
import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Tooltip,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import type { ImplementationHintDto } from "../../api";
import { useImplementationHints } from "../../data/hooks/useImplementationHints";

export interface ImplementationHintsSelectorProps {
  organizationId: string;
  serviceId: string | null;
  label?: string;
  placeholder?: string;
  helperText?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  sx?: SxProps<Theme>;
  value: string[];
  onChange: (hintIds: string[]) => void;
}

const getHintContent = (hint: ImplementationHintDto): string => {
  const candidates = [hint.latestVersion?.hint, hint.hint, hint.description];
  const value = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
  );
  return value?.trim() ?? "";
};

const getDisplayName = (hint: ImplementationHintDto): string => {
  if (hint.featureName && hint.featureName.trim().length > 0) {
    return hint.featureName;
  }

  const hintContent = getHintContent(hint);
  if (hintContent.length > 0) {
    return hintContent.split("\n")[0].trim().slice(0, 72);
  }

  return "Untitled hint";
};

export const ImplementationHintsSelector: React.FC<
  ImplementationHintsSelectorProps
> = ({
  organizationId,
  serviceId,
  label = "Implementation Hints",
  placeholder = "Select implementation hints",
  helperText,
  fullWidth = true,
  disabled = false,
  size = "small",
  error = false,
  sx,
  value,
  onChange,
}) => {
  const labelId = useId();
  const selectId = useId();

  const {
    hints,
    isLoading,
    error: fetchError,
  } = useImplementationHints(organizationId, serviceId ?? undefined, {
    enabled: Boolean(organizationId && serviceId),
  });

  const sortedHints = useMemo(() => {
    return [...hints].sort((a, b) =>
      getDisplayName(a).localeCompare(getDisplayName(b))
    );
  }, [hints]);

  const handleChange = useCallback(
    (event: SelectChangeEvent<string[]>) => {
      const rawValue =
        typeof event.target.value === "string"
          ? event.target.value.split(",")
          : event.target.value;

      // Filter out null, undefined, and empty strings to prevent [null] bug
      const cleanedValue = rawValue.filter(
        (item): item is string => Boolean(item) && typeof item === "string"
      );

      onChange(cleanedValue);
    },
    [onChange]
  );

  const renderValue = useCallback(
    (selected: string[]) => {
      // Filter out any null/undefined values before rendering
      const validSelected = selected.filter(
        (item): item is string => Boolean(item) && typeof item === "string"
      );

      if (!validSelected || validSelected.length === 0) {
        return (
          <Typography color="text.secondary" variant="body2">
            {placeholder}
          </Typography>
        );
      }

      return (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {validSelected.map((hintId: string) => {
            const hint = sortedHints.find((h) => h.id === hintId);
            return (
              <Chip
                key={hintId}
                label={hint ? getDisplayName(hint) : hintId}
                size="small"
              />
            );
          })}
        </Box>
      );
    },
    [sortedHints, placeholder]
  );

  const computedHelperText =
    fetchError ||
    (isLoading
      ? "Loading implementation hints…"
      : !serviceId
      ? "Select a service first"
      : hints.length === 0
      ? "No hints available for this service"
      : helperText) ||
    "";

  const shouldShowHelperText = Boolean(computedHelperText);
  const isDisabled =
    disabled ||
    isLoading ||
    !organizationId ||
    !serviceId ||
    hints.length === 0;

  // Sanitize value to ensure it's always a valid string array (no null/undefined)
  const sanitizedValue = useMemo(() => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is string => Boolean(item) && typeof item === "string"
    );
  }, [value]);

  return (
    <FormControl
      fullWidth={fullWidth}
      disabled={isDisabled}
      size={size}
      error={error || Boolean(fetchError)}
      sx={sx}
    >
      <InputLabel id={`${labelId}-label`}>{label}</InputLabel>
      <Select<string[]>
        labelId={`${labelId}-label`}
        id={`${selectId}-select`}
        multiple
        value={sanitizedValue}
        onChange={handleChange}
        input={<OutlinedInput label={label} />}
        renderValue={renderValue}
        displayEmpty
        MenuProps={{
          PaperProps: { sx: { maxHeight: 320 } },
        }}
      >
        {!serviceId && (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">
              {placeholder}
            </Typography>
          </MenuItem>
        )}
        {serviceId && hints.length === 0 && !isLoading && (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">
              No hints available
            </Typography>
          </MenuItem>
        )}
        {sortedHints.map((hint) => {
          const isSelected = sanitizedValue.includes(hint.id);
          const hintContent = getHintContent(hint);
          return (
            <MenuItem key={hint.id} value={hint.id}>
              <Checkbox
                checked={isSelected}
                sx={{ mr: 1, pointerEvents: "none" }}
                size="small"
                disableRipple
                tabIndex={-1}
              />
              <Tooltip
                title={hintContent || "No hint content available"}
                placement="right"
                arrow
                enterDelay={300}
              >
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {getDisplayName(hint)}
                </Typography>
              </Tooltip>
            </MenuItem>
          );
        })}
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
      {shouldShowHelperText && (
        <FormHelperText>{computedHelperText}</FormHelperText>
      )}
    </FormControl>
  );
};
