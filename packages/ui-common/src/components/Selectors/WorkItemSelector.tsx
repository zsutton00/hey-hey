import React, { useCallback, useId, useMemo } from "react";
import {
  Box,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import ClearIcon from "@mui/icons-material/Clear";
import type { InitiativeResponseDto, TaskResponseDto } from "../../api";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { getWorkItemSectionContent } from "../../utils/workItemSections";

const NO_SELECTION_VALUE = "__work_item_selector_no_value__";

type WorkItemType = "initiative" | "task";
type TaskOption = TaskResponseDto & { id: string };

export type WorkItemSelectorValue = {
  type: WorkItemType;
  id: string;
} | null;

export interface WorkItemSelectorProps {
  organizationId: string;
  projectId: string;
  conversationId?: string;
  initiativeId?: string;
  includeInitiatives?: boolean;
  includeTasks?: boolean;
  label?: string;
  placeholder?: string;
  helperText?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  sx?: SxProps<Theme>;
  value: WorkItemSelectorValue;
  onChange: (
    selection: WorkItemSelectorValue,
    workItem?: InitiativeResponseDto | TaskResponseDto
  ) => void;
}

const encodeValue = (type: WorkItemType, id: string): string => `${type}:${id}`;

export const WorkItemSelector: React.FC<WorkItemSelectorProps> = ({
  organizationId,
  projectId,
  conversationId,
  initiativeId,
  includeInitiatives = true,
  includeTasks = true,
  label = "Work Item",
  placeholder = "Select a work item",
  helperText,
  fullWidth = true,
  disabled = false,
  size = "small",
  error = false,
  sx,
  value,
  onChange,
}) => {
  const labelId = useId();
  const selectId = useId();

  const shouldLoadInitiatives = includeInitiatives;
  const shouldLoadTasks = includeTasks;

  const {
    workItems: initiativeItems,
    isLoading: initiativesLoading,
    error: initiativesError,
  } = useWorkItems(organizationId, "initiative", projectId, conversationId, {
    enabled: shouldLoadInitiatives && Boolean(organizationId),
  });

  const {
    workItems: taskItems,
    isLoading: tasksLoading,
    error: tasksError,
  } = useWorkItems(organizationId, "task", projectId, undefined, {
    initiativeId,
    enabled: shouldLoadTasks && Boolean(organizationId),
  });

  const initiatives = useMemo(() => {
    return (initiativeItems as unknown as InitiativeResponseDto[])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [initiativeItems]);

  const tasks = useMemo(() => {
    return taskItems
      .filter((item): item is TaskOption => {
        return "source" in item && typeof item.id === "string";
      })
      .sort((a, b) => {
        const aName =
          a.name ?? getWorkItemSectionContent(a.sections, "description") ?? "";
        const bName =
          b.name ?? getWorkItemSectionContent(b.sections, "description") ?? "";
        return aName.localeCompare(bName);
      });
  }, [taskItems]);

  const handleChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const rawValue = event.target.value;
      if (rawValue === NO_SELECTION_VALUE) {
        onChange(null);
        return;
      }

      const [type, ...rest] = rawValue.split(":");
      const id = rest.join(":");
      const normalizedType = (type as WorkItemType) ?? "initiative";
      const selectedItem =
        normalizedType === "task"
          ? tasks.find((task) => task.id === id)
          : initiatives.find((initiative) => initiative.id === id);

      onChange({ type: normalizedType, id }, selectedItem ?? undefined);
    },
    [initiatives, onChange, tasks]
  );

  const handleClear = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onChange(null);
    },
    [onChange]
  );

  const renderValue = useCallback(
    (selected: unknown) => {
      if (selected === NO_SELECTION_VALUE) {
        return (
          <Typography color="text.secondary" variant="body2">
            {placeholder}
          </Typography>
        );
      }

      const [type, ...rest] = String(selected).split(":");
      const id = rest.join(":");
      const normalizedType = type as WorkItemType;
      const workItem =
        normalizedType === "task"
          ? tasks.find((item) => item.id === id)
          : initiatives.find((item) => item.id === id);

      return (
        <Typography variant="body2">
          {workItem
            ? normalizedType === "task"
              ? workItem.name ??
                getWorkItemSectionContent(workItem.sections, "description") ??
                placeholder
              : workItem.name
            : placeholder}
        </Typography>
      );
    },
    [initiatives, placeholder, tasks]
  );

  const fetchError = initiativesError ?? tasksError;

  const computedHelperText =
    fetchError?.message ||
    ((initiativesLoading || tasksLoading) &&
    (shouldLoadInitiatives || shouldLoadTasks)
      ? "Loading work items…"
      : helperText) ||
    "";

  const shouldShowHelperText = Boolean(computedHelperText);
  const safeValue = value
    ? encodeValue(value.type, value.id)
    : NO_SELECTION_VALUE;
  const isLoading =
    (shouldLoadInitiatives && initiativesLoading) ||
    (shouldLoadTasks && tasksLoading);
  const hasValue = value !== null;

  return (
    <FormControl
      fullWidth={fullWidth}
      disabled={disabled || isLoading}
      size={size}
      error={error || Boolean(fetchError)}
      sx={sx}
    >
      <InputLabel id={`${labelId}-label`}>{label}</InputLabel>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Select
          labelId={`${labelId}-label`}
          id={`${selectId}-select`}
          label={label}
          value={safeValue}
          onChange={handleChange}
          displayEmpty
          renderValue={renderValue}
          MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
          sx={{ flex: 1 }}
        >
          <MenuItem value={NO_SELECTION_VALUE} disabled>
            {placeholder}
          </MenuItem>
          {includeInitiatives && initiatives.length > 0 && (
            <ListSubheader disableSticky>Features</ListSubheader>
          )}
          {includeInitiatives &&
            initiatives.map((initiative) => (
              <MenuItem
                key={`initiative-${initiative.id}`}
                value={encodeValue("initiative", initiative.id)}
              >
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {initiative.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Status: {initiative.status}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          {includeTasks && tasks.length > 0 && (
            <ListSubheader disableSticky>Tasks</ListSubheader>
          )}
          {includeTasks &&
            tasks.map((task) => (
              <MenuItem
                key={`task-${task.id}`}
                value={encodeValue("task", task.id)}
              >
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {task.name ??
                      getWorkItemSectionContent(task.sections, "description") ??
                      "Untitled task"}
                  </Typography>
                  {task.status && (
                    <Typography variant="caption" color="text.secondary">
                      Status: {task.status}
                    </Typography>
                  )}
                </Box>
              </MenuItem>
            ))}
          {isLoading && (
            <MenuItem disabled>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              </Box>
            </MenuItem>
          )}
        </Select>
        {hasValue && !disabled && !isLoading && (
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
