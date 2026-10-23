import React from "react";
import {
  Box,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { FeatureTag } from "../../api";
import { FeatureTagBadge } from "../Features/FeatureTagBadge";
import {
  FEATURE_TAG_PALETTE,
  FEATURE_TAG_VALUES,
} from "../Features/featureTagPalette";

export interface FeatureTagSelectorProps {
  value: FeatureTag | null | undefined;
  onChange: (tag: FeatureTag) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
}

export const FeatureTagSelector: React.FC<FeatureTagSelectorProps> = ({
  value,
  onChange,
  label = "Tag",
  helperText,
  disabled = false,
  fullWidth = false,
  size = "medium",
  error = false,
}) => {
  const handleChange = (event: SelectChangeEvent<FeatureTag | "">): void => {
    const next = event.target.value;
    if (next === "") return;
    onChange(next as FeatureTag);
  };

  return (
    <FormControl
      fullWidth={fullWidth}
      error={error}
      size={size}
      disabled={disabled}
    >
      {label && <InputLabel shrink>{label}</InputLabel>}
      <Select
        value={value ?? ""}
        onChange={handleChange}
        disabled={disabled}
        label={label}
        displayEmpty
        renderValue={(selected) => (
          <FeatureTagBadge tag={(selected as FeatureTag) || null} />
        )}
        sx={{ "& .MuiSelect-select": { padding: "8px 12px" } }}
      >
        {FEATURE_TAG_VALUES.map((tagValue) => {
          const entry = FEATURE_TAG_PALETTE[tagValue];
          return (
            <MenuItem key={tagValue} value={tagValue}>
              <Box
                sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: entry.color,
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {entry.label}
                </Typography>
              </Box>
            </MenuItem>
          );
        })}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};
