import React from "react";
import {
  Autocomplete,
  TextField,
  Chip,
  FormControl,
  FormHelperText,
} from "@mui/material";

export interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  placeholder?: string;
}

export const TagsInput: React.FC<TagsInputProps> = ({
  value,
  onChange,
  label = "Tags",
  helperText,
  disabled = false,
  fullWidth = false,
  size = "medium",
  error = false,
  placeholder = "Add tags...",
}) => {
  const handleChange = (
    _event: React.SyntheticEvent,
    newValue: string[]
  ): void => {
    onChange(newValue);
  };

  return (
    <FormControl fullWidth={fullWidth} error={error} size={size}>
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        size={size}
        renderTags={(tagValue, getTagProps) =>
          tagValue.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option}
              label={option}
              size="small"
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={placeholder}
            error={error}
          />
        )}
      />
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};
