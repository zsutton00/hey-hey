import {
  Select,
  MenuItem,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import type {
  DesignDocStatusByTemplate,
  SupportedDesignDocTemplate,
} from "../../types/designDocStatus";
import {
  getDesignDocSelectableStatuses,
  getDesignDocStatusInfo,
} from "../../types/designDocStatus";

export interface DesignDocStatusSelectorProps<
  TTemplate extends SupportedDesignDocTemplate = SupportedDesignDocTemplate
> {
  template: TTemplate;
  value: DesignDocStatusByTemplate[TTemplate];
  onChange: (status: DesignDocStatusByTemplate[TTemplate]) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  readOnly?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
}

export const DesignDocStatusSelector = <
  TTemplate extends SupportedDesignDocTemplate
>({
  template,
  value,
  onChange,
  label = "Status",
  helperText,
  disabled = false,
  readOnly = false,
  fullWidth = false,
  size = "medium",
  error = false,
}: DesignDocStatusSelectorProps<TTemplate>) => {
  const handleChange = (
    event: SelectChangeEvent<DesignDocStatusByTemplate[TTemplate]>
  ): void => {
    onChange(event.target.value as DesignDocStatusByTemplate[TTemplate]);
  };

  const selectableStatuses = getDesignDocSelectableStatuses(template);

  return (
    <FormControl fullWidth={fullWidth} error={error} size={size}>
      {label && <InputLabel>{label}</InputLabel>}
      <Select
        value={value}
        onChange={handleChange}
        disabled={disabled}
        label={label}
        readOnly={readOnly}
        renderValue={(selected) => {
          const info = getDesignDocStatusInfo(
            template,
            selected as DesignDocStatusByTemplate[TTemplate]
          );
          return (
            <Chip
              label={info.label}
              color={info.color}
              size="small"
              sx={{ fontWeight: "bold" }}
            />
          );
        }}
        sx={{
          "& .MuiSelect-select": {
            padding: "8px 12px",
          },
        }}
      >
        {selectableStatuses
          .filter((status) => status !== value)
          .map((status) => {
            const info = getDesignDocStatusInfo(
              template,
              status as DesignDocStatusByTemplate[TTemplate]
            );
            return (
              <MenuItem key={status} value={status}>
                <Chip
                  label={info.label}
                  color={info.color}
                  size="small"
                  sx={{ fontWeight: "bold" }}
                />
              </MenuItem>
            );
          })}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};
