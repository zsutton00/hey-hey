import React, { useCallback, useEffect, useState } from "react";
import {
  FormControl,
  IconButton,
  InputAdornment,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { parseDateForLocalPicker } from "../../utils/dateTime";

export interface DueDateSelectorProps {
  value: string | null;
  onChange: (date: string | null) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  allowClear?: boolean;
}

export const DueDateSelector: React.FC<DueDateSelectorProps> = ({
  value,
  onChange,
  label = "Due Date",
  helperText,
  disabled = false,
  fullWidth = false,
  size = "medium",
  error = false,
  allowClear = true,
}) => {
  const [currentDate, setCurrentDate] = useState<Date | null>(() =>
    parseDateForLocalPicker(value),
  );
  const [open, setOpen] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentDate(parseDateForLocalPicker(value));
  }, [value]);

  const handleDateChange = useCallback(
    (newDate: Date | null) => {
      if (dateError) setDateError(null);

      try {
        if (!newDate) {
          if (!allowClear) return;
          setCurrentDate(null);
          onChange(null);
          return;
        }

        if (isNaN(newDate.getTime())) {
          setDateError("Invalid date selected");
          return;
        }

        setCurrentDate(newDate);
        onChange(newDate.toISOString());
      } catch {
        setDateError("Invalid date selected");
      }
    },
    [allowClear, onChange, dateError],
  );

  const handleClear = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!allowClear) return;
      setCurrentDate(null);
      setDateError(null);
      onChange(null);
    },
    [allowClear, onChange],
  );

  const hasError = !!dateError || error;
  const displayHelperText = dateError || helperText;

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <FormControl
        fullWidth={fullWidth}
        error={hasError}
        size={size}
        disabled={disabled}
      >
        <DatePicker
          value={currentDate}
          onChange={handleDateChange}
          disabled={disabled}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          slotProps={{
            textField: {
              label: label,
              size: "small",
              fullWidth: fullWidth || false,
              error: hasError,
              helperText: displayHelperText,
              onFocus: () => setOpen(true),
              onClick: () => setOpen(true),
              InputProps: {
                endAdornment:
                  value && !disabled && allowClear ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={handleClear}
                        edge="end"
                        data-testid="due-date-clear"
                        aria-label="Clear due date"
                        sx={{ visibility: value ? "visible" : "hidden" }}
                      >
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
              },
            },
          }}
        />
      </FormControl>
    </LocalizationProvider>
  );
};
