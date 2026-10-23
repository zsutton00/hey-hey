import React from "react";
import { TextField as MuiTextField, InputAdornment } from "@mui/material";
import type { FieldComponentProps } from "./types";

export const CurrencyField: React.FC<FieldComponentProps> = ({
  config,
  value,
  onChange,
  error,
  disabled,
  isSubmitted,
}) => (
  <MuiTextField
    label={config.description}
    type="number"
    slotProps={{
      htmlInput: {
        step: "0.01",
        min: config.validation?.min || 0,
      },
      input: {
        startAdornment: <InputAdornment position="start">$</InputAdornment>,
      },
    }}
    value={value || ""}
    onChange={(e) => onChange?.(parseFloat(e.target.value) || 0)}
    placeholder={isSubmitted && !disabled ? "" : config.placeholder || "0.00"}
    required={config.required}
    error={!!error}
    helperText={error}
    fullWidth
    variant="outlined"
    margin="normal"
    disabled={disabled}
    sx={
      disabled
        ? {
            "& .MuiOutlinedInput-root": {
              "& fieldset": {
                border: "none",
              },
              "& input": {
                color: "text.primary",
                "-webkit-text-fill-color": "unset",
              },
            },
            "& .MuiInputLabel-root": {
              color: "text.primary",
            },
            "& .MuiInputAdornment-root": {
              color: "text.primary",
            },
          }
        : undefined
    }
  />
);
