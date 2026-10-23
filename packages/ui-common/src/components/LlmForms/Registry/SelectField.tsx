import React from "react";
import {
  FormControl,
  Select,
  MenuItem,
  Chip,
  Box,
  Paper,
  Typography,
  useTheme,
  Button,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../i18n/keys";
import type { FieldComponentProps } from "./types";

export const SelectField: React.FC<FieldComponentProps> = ({
  config,
  value,
  onChange,
  error,
  disabled,
  isSubmitted,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const isMultiple = config.multiple === true;
  const options =
    config.selectOptions ??
    config.options?.map((value) => ({ value, label: value })) ??
    [];
  const optionLabel = (selected: string): string =>
    options.find((option) => option.value === selected)?.label ?? selected;
  const selectValue = isMultiple
    ? Array.isArray(value)
      ? value
      : []
    : value || "";

  const handleChange = (newValue: unknown): void => {
    if (isMultiple) {
      onChange?.(newValue as string[]);
    } else {
      onChange?.(newValue as string);
    }
  };

  const renderValue = (selected: unknown): React.ReactNode => {
    if (!isMultiple) {
      if (selected === "" || selected === null || selected === undefined) {
        return (
          <Typography color="text.secondary" sx={{ fontSize: "1.125rem" }}>
            {placeholder}
          </Typography>
        );
      }
      return optionLabel(selected as string);
    }

    const selectedArray = Array.isArray(selected) ? selected : [];
    if (selectedArray.length === 0) {
      return (
        <Typography color="text.secondary" sx={{ fontSize: "1.125rem" }}>
          {placeholder}
        </Typography>
      );
    }
    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {selectedArray.map((val: string) => (
          <Chip key={val} label={optionLabel(val)} size="small" />
        ))}
      </Box>
    );
  };

  const placeholder = isMultiple ? "Select one or more" : "Select one";

  const renderButtonGroup = (): React.ReactNode => {
    if (options.length === 0) {
      return null;
    }

    const handleButtonClick = (option: string): void => {
      if (isMultiple) {
        const currentValues = Array.isArray(value) ? value : [];
        const isSelected = currentValues.includes(option);
        const newValues = isSelected
          ? currentValues.filter((v) => v !== option)
          : [...currentValues, option];
        onChange?.(newValues);
      } else {
        onChange?.(option);
      }
    };

    const isOptionSelected = (option: string): boolean => {
      if (isMultiple) {
        const currentValues = Array.isArray(value) ? value : [];
        return currentValues.includes(option);
      }
      return value === option;
    };

    return (
      <Box
        sx={{
          p: 2,
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        {options.map((option) => (
          <Button
            key={option.value}
            data-testid="select-field-option"
            data-option-value={option.value}
            variant={isOptionSelected(option.value) ? "contained" : "outlined"}
            onClick={() => handleButtonClick(option.value)}
            disabled={disabled}
            size="small"
            sx={{
              textTransform: "none",
              minWidth: "fit-content",
            }}
          >
            {option.label}
          </Button>
        ))}
      </Box>
    );
  };

  const shouldUseButtonGroup = options.length > 0 && options.length < 5;

  return (
    <Box
      data-testid={`select-field-${config.field}`}
      sx={{
        maxWidth: { xs: 400, md: 800 },
        width: "fit-content",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          borderRadius: `${theme.shape.borderRadius}px`,
          overflow: "hidden",
          border: `1px solid ${
            error ? theme.palette.error.main : theme.palette.divider
          }`,
        }}
      >
        {/* Header Section */}
        <Box
          sx={{
            display: "flex",
            minHeight: 48,
            borderBottom: `1px solid ${
              theme.palette.mode === "dark" ? theme.palette.divider : "#f5f5f5"
            }`,
          }}
        >
          {/* Header/Label Text */}
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              px: 2,
              py: 1.5,
              bgcolor: theme.palette.mode === "dark" ? "grey.800" : "#fcfcfc",
            }}
          >
            {config.description ? (
              <Typography
                variant="body2"
                color={
                  isSubmitted && disabled ? "text.secondary" : "text.primary"
                }
                sx={{
                  fontFamily: [
                    '"Tilt Neon"',
                    '"Fira Code"',
                    '"Source Code Pro"',
                    '"SF Mono"',
                    '"Cascadia Code"',
                    '"Consolas"',
                    "monospace",
                  ].join(","),
                  fontSize: isSubmitted && disabled ? "0.875rem" : "1rem",
                  lineHeight: 1.5,
                }}
              >
                {config.description}
                {config.required && !isSubmitted && " *"}
              </Typography>
            ) : (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  fontFamily: [
                    '"Tilt Neon"',
                    '"Fira Code"',
                    '"Source Code Pro"',
                    '"SF Mono"',
                    '"Cascadia Code"',
                    '"Consolas"',
                    "monospace",
                  ].join(","),
                  fontSize: "0.875rem",
                  lineHeight: 1.5,
                }}
              >
                {t(KEYS.common.edit)}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Input Section - Button Group or Select */}
        <Box
          sx={{
            bgcolor:
              theme.palette.mode === "dark"
                ? "background.paper"
                : "background.paper",
          }}
        >
          {shouldUseButtonGroup ? (
            renderButtonGroup()
          ) : (
            <FormControl
              fullWidth
              variant="standard"
              error={!!error}
              disabled={disabled}
            >
              <Select
                data-testid={`select-field-${config.field}-input`}
                value={selectValue}
                onChange={(e) => handleChange(e.target.value)}
                required={config.required}
                multiple={isMultiple}
                renderValue={renderValue}
                displayEmpty
                sx={{
                  "& .MuiSelect-select": {
                    p: 2,
                    minHeight: 40,
                    fontSize: "1.125rem",
                    lineHeight: 1.5,
                    "&:focus": {
                      backgroundColor: "transparent",
                    },
                  },
                  "&:before": {
                    borderBottom: "none !important",
                  },
                  "&:after": {
                    borderBottom: "none !important",
                  },
                  "&:hover:not(.Mui-disabled):before": {
                    borderBottom: "none !important",
                  },
                  "& .MuiInput-underline:before": {
                    display: "none",
                  },
                  "& .MuiInput-underline:after": {
                    display: "none",
                  },
                  "& .MuiInput-underline:hover:not(.Mui-disabled):before": {
                    display: "none",
                  },
                  ...(disabled && {
                    "& .MuiSelect-select": {
                      color: "text.primary",
                      p: "calc(2 * var(--mui-spacing))",
                    },
                  }),
                }}
              >
                {!isMultiple && !selectValue && (
                  <MenuItem value="" disabled sx={{ display: "none" }}>
                    {placeholder}
                  </MenuItem>
                )}
                {options.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {error && (
            <Typography
              variant="caption"
              color="error.main"
              sx={{ px: 2, pb: 1, display: "block" }}
            >
              {error}
            </Typography>
          )}
        </Box>
      </Paper>
    </Box>
  );
};
