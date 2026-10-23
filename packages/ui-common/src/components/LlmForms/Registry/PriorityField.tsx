import React from "react";
import {
  Box,
  Typography,
  Slider,
  FormLabel,
  FormControl,
  FormHelperText,
} from "@mui/material";
import type { FieldComponentProps } from "./types";

export const PriorityField: React.FC<FieldComponentProps> = ({
  config,
  value,
  onChange,
  error,
  disabled,
}) => {
  const min = config.min || 1;
  const max = config.max || 10;
  const currentValue = typeof value === "number" ? value : min;

  return (
    <FormControl
      fullWidth
      margin="normal"
      error={!!error}
      disabled={disabled}
      sx={
        disabled
          ? {
              border: "none",
              "& .MuiFormLabel-root": {
                border: "none",
                color: "text.primary",
              },
            }
          : undefined
      }
    >
      <FormLabel component="legend">{config.description}</FormLabel>
      <Box sx={{ px: 2, pt: 2 }}>
        <Slider
          value={currentValue}
          onChange={(_, newValue) =>
            onChange?.(Array.isArray(newValue) ? newValue[0] : newValue)
          }
          min={min}
          max={max}
          step={1}
          marks={[
            { value: min, label: `Low (${min})` },
            { value: max, label: `High (${max})` },
          ]}
          valueLabelDisplay="auto"
          aria-labelledby="priority-slider"
          disabled={disabled}
        />
        <Typography
          variant="body2"
          color={disabled ? "text.primary" : "text.secondary"}
          sx={{ mt: 1, textAlign: "center" }}
        >
          Current: {currentValue}
        </Typography>
      </Box>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
};
