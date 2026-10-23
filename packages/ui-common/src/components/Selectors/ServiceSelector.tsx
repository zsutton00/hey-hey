import React, { useCallback, useId, useMemo } from "react";
import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  useTheme,
  type SxProps,
  type Theme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import ClearIcon from "@mui/icons-material/Clear";
import type { ServiceDto } from "../../api";
import { useServices } from "../../data/hooks/useServices";

const NO_SELECTION_VALUE = "__service_selector_no_value__";
const DESCRIPTION_MAX_WIDTH = 400;

const getDisplayName = (service: ServiceDto): string => {
  if (service.name && service.name.trim().length > 0) {
    return service.name;
  }
  return "Untitled service";
};

interface ServiceSelectorBaseProps {
  organizationId: string;
  projectId: string;
  label?: string;
  placeholder?: string;
  helperText?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  sx?: SxProps<Theme>;
}

export interface ServiceSelectorSingleProps extends ServiceSelectorBaseProps {
  multiple?: false;
  value: string | null;
  onChange: (serviceId: string | null, service?: ServiceDto) => void;
}

export interface ServiceSelectorMultiProps extends ServiceSelectorBaseProps {
  multiple: true;
  value: string[];
  allowEmptySelection?: boolean;
  onChange: (serviceIds: string[], services: ServiceDto[]) => void;
}

export type ServiceSelectorProps =
  | ServiceSelectorSingleProps
  | ServiceSelectorMultiProps;

export const ServiceSelector: React.FC<ServiceSelectorProps> = (props) => {
  const theme = useTheme();
  const {
    organizationId,
    projectId,
    label = "Service",
    placeholder = "Select a service",
    helperText,
    fullWidth = true,
    disabled = false,
    size = "small",
    error = false,
    sx,
  } = props;

  const isMultiple = props.multiple === true;
  const allowsEmptySelection =
    !isMultiple || props.allowEmptySelection !== false;
  const labelId = useId();
  const selectId = useId();

  const {
    services,
    isLoading,
    error: fetchError,
  } = useServices(organizationId, {
    projectId,
    enabled: Boolean(organizationId && projectId),
  });

  const sortedServices = useMemo(() => {
    return [...services].sort((a, b) =>
      getDisplayName(a).localeCompare(getDisplayName(b))
    );
  }, [services]);

  const handleSingleChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      if (isMultiple) return;
      const cb = (props as ServiceSelectorSingleProps).onChange;
      const rawValue = event.target.value;
      if (rawValue === NO_SELECTION_VALUE) {
        cb(null);
        return;
      }
      const selectedService = sortedServices.find(
        (service) => service.id === rawValue
      );
      cb(rawValue, selectedService);
    },
    [isMultiple, props, sortedServices]
  );

  const handleMultiChange = useCallback(
    (event: SelectChangeEvent<string[]>) => {
      if (!isMultiple) return;
      const cb = (props as ServiceSelectorMultiProps).onChange;
      const rawValue = event.target.value;
      const selectedIds =
        typeof rawValue === "string" ? rawValue.split(",") : rawValue;
      if (!allowsEmptySelection && selectedIds.length === 0) return;
      const selectedServices = selectedIds
        .map((id) => sortedServices.find((s) => s.id === id))
        .filter((s): s is ServiceDto => s !== undefined);
      cb(selectedIds, selectedServices);
    },
    [allowsEmptySelection, isMultiple, props, sortedServices]
  );

  const handleClear = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (isMultiple) {
        if (!allowsEmptySelection) return;
        (props as ServiceSelectorMultiProps).onChange([], []);
      } else {
        (props as ServiceSelectorSingleProps).onChange(null);
      }
    },
    [allowsEmptySelection, isMultiple, props]
  );

  const renderSingleValue = useCallback(
    (selected: unknown) => {
      const selectedId = String(selected);
      if (selectedId === NO_SELECTION_VALUE) {
        return (
          <Typography color="text.secondary" variant="body2">
            {placeholder}
          </Typography>
        );
      }
      const service = sortedServices.find((item) => item.id === selectedId);
      return (
        <Typography variant="body2">
          {service ? getDisplayName(service) : placeholder}
        </Typography>
      );
    },
    [sortedServices, placeholder]
  );

  const renderMultiValue = useCallback(
    (selected: string[]) => {
      if (selected.length === 0) {
        return (
          <Typography color="text.secondary" variant="body2">
            {placeholder}
          </Typography>
        );
      }
      return (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {selected.map((id) => {
            const service = sortedServices.find((s) => s.id === id);
            return (
              <Chip
                key={id}
                label={
                  service ? getDisplayName(service) : "Unavailable service"
                }
                size="small"
              />
            );
          })}
        </Box>
      );
    },
    [sortedServices, placeholder]
  );

  const computedHelperText =
    fetchError?.message ||
    (isLoading
      ? "Loading services…"
      : !projectId
      ? "Project ID required"
      : helperText) ||
    "";

  const shouldShowHelperText = Boolean(computedHelperText);

  const hasValue = isMultiple
    ? (props as ServiceSelectorMultiProps).value.length > 0
    : (props as ServiceSelectorSingleProps).value !== null;

  const isDisabled = disabled || isLoading || !organizationId || !projectId;

  const multiValue = isMultiple
    ? (props as ServiceSelectorMultiProps).value
    : [];

  const selectMenuPaperSx: SxProps<Theme> = {
    maxHeight: 320,
    backgroundColor:
      theme.palette.mode === "dark"
        ? theme.palette.grey[900]
        : theme.palette.background.paper,
    color: theme.palette.text.primary,
    border: `1px solid ${theme.palette.divider}`,
  };

  const selectMenuListSx: SxProps<Theme> = {
    backgroundColor:
      theme.palette.mode === "dark"
        ? theme.palette.grey[900]
        : theme.palette.background.paper,
  };

  const menuItems = sortedServices.map((service) => {
    const isSelected = isMultiple && multiValue.includes(service.id);
    return (
      <MenuItem key={service.id} value={service.id}>
        {isMultiple && <Checkbox checked={isSelected} size="small" />}
        <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {getDisplayName(service)}
          </Typography>
          {service.description && (
            <Tooltip title={service.description} enterDelay={1000}>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ maxWidth: DESCRIPTION_MAX_WIDTH }}
              >
                {service.description}
              </Typography>
            </Tooltip>
          )}
        </Box>
      </MenuItem>
    );
  });

  const loadingItem = isLoading ? (
    <MenuItem disabled>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      </Box>
    </MenuItem>
  ) : null;

  return (
    <FormControl
      fullWidth={fullWidth}
      disabled={isDisabled}
      size={size}
      error={error || Boolean(fetchError)}
      sx={sx}
    >
      <InputLabel id={`${labelId}-label`} shrink>
        {label}
      </InputLabel>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        {isMultiple ? (
          <Select<string[]>
            labelId={`${labelId}-label`}
            id={`${selectId}-select`}
            multiple
            value={multiValue}
            label={label}
            onChange={handleMultiChange}
            displayEmpty
            renderValue={renderMultiValue}
            MenuProps={{
              PaperProps: { sx: selectMenuPaperSx },
              MenuListProps: { sx: selectMenuListSx },
            }}
            sx={{ flex: 1 }}
          >
            {menuItems}
            {loadingItem}
          </Select>
        ) : (
          <Select
            labelId={`${labelId}-label`}
            id={`${selectId}-select`}
            value={
              (props as ServiceSelectorSingleProps).value ?? NO_SELECTION_VALUE
            }
            label={label}
            onChange={handleSingleChange}
            displayEmpty
            renderValue={renderSingleValue}
            MenuProps={{
              PaperProps: { sx: selectMenuPaperSx },
              MenuListProps: { sx: selectMenuListSx },
            }}
            sx={{ flex: 1 }}
          >
            <MenuItem value={NO_SELECTION_VALUE} disabled>
              {placeholder}
            </MenuItem>
            {menuItems}
            {loadingItem}
          </Select>
        )}
        {hasValue && !isDisabled && allowsEmptySelection && (
          <IconButton
            size="small"
            onClick={handleClear}
            sx={{ mt: size === "small" ? 0.5 : 1 }}
            aria-label="Clear selection"
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      {shouldShowHelperText && (
        <FormHelperText>{computedHelperText}</FormHelperText>
      )}
    </FormControl>
  );
};
