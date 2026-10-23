import React from "react";
import {
  Select,
  MenuItem,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import type { Priority } from "../../api";
import { getPriorityLabel, getPriorityColor } from "../../utils/statusUtils";

// Selectable priorities
const SELECTABLE_PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

export interface WorkItemPrioritySelectorProps {
  value: Priority;
  onChange: (priority: Priority) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
}

export const WorkItemPrioritySelector: React.FC<
  WorkItemPrioritySelectorProps
> = ({
  value,
  onChange,
  label = "Priority",
  helperText,
  disabled = false,
  fullWidth = false,
  size = "medium",
  error = false,
}) => {
  const handleChange = (event: SelectChangeEvent<Priority>): void => {
    onChange(event.target.value as Priority);
  };

  return (
    <FormControl fullWidth={fullWidth} error={error} size={size}>
      {label && <InputLabel>{label}</InputLabel>}
      <Select
        value={value}
        onChange={handleChange}
        disabled={disabled}
        label={label}
        renderValue={(selected) => (
          <Chip
            label={getPriorityLabel(selected as Priority)}
            color={getPriorityColor(selected as Priority)}
            size="small"
            sx={{ fontWeight: "bold" }}
          />
        )}
        sx={{
          "& .MuiSelect-select": {
            padding: "8px 12px",
          },
        }}
      >
        {SELECTABLE_PRIORITIES.map((priority) => (
          <MenuItem key={priority} value={priority}>
            <Chip
              label={getPriorityLabel(priority)}
              color={getPriorityColor(priority)}
              size="small"
              sx={{ fontWeight: "bold" }}
            />
          </MenuItem>
        ))}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};
