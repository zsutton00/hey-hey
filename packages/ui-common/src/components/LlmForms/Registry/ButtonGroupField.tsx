import React from "react";
import { Box, Button, Typography, useTheme, Chip } from "@mui/material";
import type { FieldComponentProps } from "./types";

export type ButtonGroupFieldProps = FieldComponentProps<string>;

export const ButtonGroupField: React.FC<ButtonGroupFieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  const theme = useTheme();

  const options = config.options || [];

  const handleSelect = (optionValue: string) => {
    if (!disabled && !isSubmitted) {
      onChange?.(optionValue);
    }
  };

  // If submitted, show a read-only chip
  if (isSubmitted && value) {
    const selectedOption = options.find((opt) => opt === value) || value;
    return (
      <Box sx={{ mb: 2 }}>
        {config.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {config.description}
          </Typography>
        )}
        <Chip
          label={selectedOption}
          color="primary"
          variant="filled"
          sx={{
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      {config.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {config.description}
          {config.required && (
            <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
              *
            </Typography>
          )}
        </Typography>
      )}

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        {options.map((option, index) => {
          const isSelected = value === option;
          return (
            <Button
              key={index}
              variant={isSelected ? "contained" : "outlined"}
              color={isSelected ? "primary" : "inherit"}
              onClick={() => handleSelect(option)}
              disabled={disabled}
              sx={{
                flex: { xs: "1 1 auto", sm: "0 1 auto" },
                minWidth: { xs: "100%", sm: "120px" },
                textTransform: "none",
                fontWeight: isSelected ? 600 : 400,
                borderColor: isSelected
                  ? theme.palette.primary.main
                  : theme.palette.divider,
                "&:hover": {
                  borderColor: theme.palette.primary.main,
                  backgroundColor: isSelected
                    ? theme.palette.primary.main
                    : theme.palette.primary.light + "10",
                },
                transition: theme.transitions.create(
                  ["background-color", "border-color", "box-shadow"],
                  {
                    duration: theme.transitions.duration.short,
                  }
                ),
              }}
            >
              {option}
            </Button>
          );
        })}
      </Box>

      {error && (
        <Typography
          variant="caption"
          color="error"
          sx={{ mt: 1, display: "block" }}
        >
          {error}
        </Typography>
      )}
    </Box>
  );
};
