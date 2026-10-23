import React from "react";
import { Box, Paper, Typography, useTheme } from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import type { FieldComponentProps } from "./types";

export const DatePickerField: React.FC<FieldComponentProps<string>> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  const theme = useTheme();
  const currentDate = React.useMemo(() => {
    if (!value) return null;
    // Parse as local date to avoid timezone issues
    // Value format is "YYYY-MM-DD"
    const parts = value.split("-");
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // months are 0-indexed
    const day = parseInt(parts[2], 10);
    const parsed = new Date(year, month, day);
    return isNaN(parsed.getTime()) ? null : parsed;
  }, [value]);

  const handleChange = (newDate: Date | null) => {
    if (!newDate || isNaN(newDate.getTime())) {
      onChange?.("");
      return;
    }

    // Use local date methods to avoid timezone conversion issues
    const year = newDate.getFullYear();
    const month = String(newDate.getMonth() + 1).padStart(2, "0");
    const day = String(newDate.getDate()).padStart(2, "0");
    onChange?.(`${year}-${month}-${day}`);
  };

  const isDisabled = disabled || isSubmitted;

  return (
    <div data-testid={`datepicker-field-${config.field}`}>
      <Paper
        elevation={0}
        sx={{
          overflow: "hidden",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            py: 1.5,
            bgcolor: "background.paper",
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography
            sx={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: theme.palette.heyhey?.main ?? "rgb(8, 126, 139)",
              flexShrink: 0,
            }}
          >
            Q
          </Typography>
          <Typography
            variant="body2"
            color={config.description ? "text.primary" : "text.secondary"}
            sx={{ flex: 1, fontSize: "0.875rem" }}
          >
            {config.description}
          </Typography>
        </Box>

        <Box sx={{ p: 2, bgcolor: "background.paper" }}>
          <LocalizationProvider dateAdapter={AdapterDateFns}>
            <DatePicker
              value={currentDate}
              onChange={handleChange}
              disabled={isDisabled}
              slotProps={{
                textField: {
                  label: undefined,
                  placeholder: config.placeholder,
                  error: !!error,
                  helperText: error,
                  required: config.required,
                  size: "small",
                  sx: {
                    width: "100%",
                    maxWidth: { xs: "100%", sm: 240 },
                  },
                },
              }}
            />
          </LocalizationProvider>
        </Box>
      </Paper>
    </div>
  );
};
