import React, { useCallback, useId, useMemo } from "react";
import {
  Box,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import ClearIcon from "@mui/icons-material/Clear";
import type { TaskResponseDto } from "../../api";
import type { WorkItemTypeKey } from "../../constants/taskTypes";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { getWorkItemSectionContent } from "../../utils/workItemSections";

const NO_SELECTION_VALUE = "__task_selector_no_value__";
const NONE_VALUE = "__task_selector_none__";

type TaskOption = TaskResponseDto & { id: string };

export interface TaskSelectorProps {
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
  excludeTaskIds?: string[];
  includeNone?: boolean;
  taskType?: WorkItemTypeKey;
  value: string | null;
  onChange: (taskId: string | null, task?: TaskResponseDto) => void;
}

const getDisplayName = (task: TaskResponseDto): string => {
  if (task.name && task.name.trim().length > 0) {
    return task.name;
  }
  const description = getWorkItemSectionContent(task.sections, "description");
  if (description.trim().length > 0) {
    return description;
  }
  return "Untitled task";
};

export const TaskSelector: React.FC<TaskSelectorProps> = ({
  organizationId,
  projectId,
  label = "Task",
  placeholder = "Select a task",
  helperText,
  fullWidth = true,
  disabled = false,
  size = "small",
  error = false,
  sx,
  excludeTaskIds = [],
  includeNone = false,
  taskType,
  value,
  onChange,
}) => {
  const labelId = useId();
  const selectId = useId();

  const {
    workItems,
    isLoading,
    error: fetchError,
  } = useWorkItems(organizationId, "task", projectId, undefined, {
    enabled: Boolean(organizationId),
    taskType,
  });

  const allTasks = useMemo(() => {
    return workItems
      .filter((item): item is TaskOption => {
        return "source" in item && typeof item.id === "string";
      })
      .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
  }, [workItems]);

  const tasks = useMemo(() => {
    const exclusionSet = new Set(
      excludeTaskIds.filter((taskId): taskId is string => Boolean(taskId))
    );

    return allTasks.filter((task) => !exclusionSet.has(task.id));
  }, [allTasks, excludeTaskIds]);

  const handleChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const rawValue = event.target.value;
      if (rawValue === NONE_VALUE) {
        onChange(null);
        return;
      }
      if (rawValue === NO_SELECTION_VALUE) {
        onChange(null);
        return;
      }

      const selectedTask = tasks.find((task) => task.id === rawValue);
      onChange(rawValue, selectedTask);
    },
    [onChange, tasks]
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
      const selectedId = String(selected);

      if (selectedId === NO_SELECTION_VALUE) {
        return (
          <Typography color="text.secondary" variant="body2">
            {placeholder}
          </Typography>
        );
      }

      if (includeNone && (selectedId === NONE_VALUE || !selectedId)) {
        return (
          <Typography variant="body2" color="text.secondary">
            None
          </Typography>
        );
      }

      const task = allTasks.find((item) => item.id === selectedId);
      return (
        <Typography variant="body2">
          {task ? getDisplayName(task) : placeholder}
        </Typography>
      );
    },
    [allTasks, placeholder, includeNone]
  );

  const computedHelperText =
    fetchError?.message || (isLoading ? "Loading tasks…" : helperText) || "";

  const shouldShowHelperText = Boolean(computedHelperText);
  const hasValue = value !== null;
  const isDisabled = disabled || isLoading;

  return (
    <FormControl
      fullWidth={fullWidth}
      disabled={isDisabled}
      size={size}
      error={error || Boolean(fetchError)}
      sx={sx}
    >
      <InputLabel id={`${labelId}-label`}>{label}</InputLabel>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Select
          labelId={`${labelId}-label`}
          id={`${selectId}-select`}
          value={value ?? NO_SELECTION_VALUE}
          label={label}
          onChange={handleChange}
          displayEmpty
          renderValue={renderValue}
          MenuProps={{
            PaperProps: { sx: { maxHeight: 320 } },
          }}
          sx={{ flex: 1 }}
        >
          <MenuItem value={NO_SELECTION_VALUE} disabled>
            {placeholder}
          </MenuItem>
          {includeNone && (
            <MenuItem value={NONE_VALUE}>
              <Typography variant="body2" color="text.secondary">
                None
              </Typography>
            </MenuItem>
          )}
          {tasks.map((task) => (
            <MenuItem key={task.id} value={task.id}>
              <Box sx={{ display: "flex", flexDirection: "column" }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {getDisplayName(task)}
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
        {!includeNone && hasValue && !isDisabled && (
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
