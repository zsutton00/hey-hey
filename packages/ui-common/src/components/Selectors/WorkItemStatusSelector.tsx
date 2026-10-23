import React, { useState } from "react";
import {
  Select,
  MenuItem,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { WorkStatus } from "../../api";
import { FEATURE_TASK_TYPE } from "../../constants/taskTypes";
import { useTaskAllowedStatuses } from "../../data/hooks";
import {
  getStatusLabel,
  getStatusColorMapping,
  getPlanStatusLabel,
} from "../../utils/statusUtils";
import { isMachineManagedStatus } from "../../utils/workItemUtils";
import { SupersedeTaskDialog } from "../WorkItem/SupersedeTaskDialog";

// Features follow a simple REFINING → READY (Active) flow, so Active reads
// as "Ready" for them.
const getFeatureStatusLabel = (status: WorkStatus): string => {
  if (status === WorkStatus.Active) return "Ready";
  return getStatusLabel(status);
};

export interface WorkItemStatusSelectorProps {
  value: WorkStatus;
  onChange: (status: WorkStatus) => void;
  /** Required to resolve the backend per-type allowed status set. */
  organizationId: string;
  projectId: string;
  /**
   * The task being edited. Required for the supersede transition; when absent
   * (e.g. task creation) SUPERSEDED is not offered.
   */
  taskId?: string;
  taskType?: string;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  readOnly?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
}

export const WorkItemStatusSelector: React.FC<WorkItemStatusSelectorProps> = ({
  value,
  onChange,
  organizationId,
  projectId,
  taskId,
  taskType,
  label = "Status",
  helperText,
  disabled = false,
  readOnly = false,
  fullWidth = false,
  size = "medium",
  error = false,
}) => {
  const [supersedeDialogOpen, setSupersedeDialogOpen] = useState(false);
  const { getAllowedStatuses, isLoading } = useTaskAllowedStatuses({
    organizationId,
    projectId,
  });

  const handleChange = (event: SelectChangeEvent<WorkStatus>): void => {
    const next = event.target.value as WorkStatus;
    // SUPERSEDED never travels the plain status-update path — it requires a
    // named successor, collected in the supersede dialog.
    if (next === WorkStatus.Superseded) {
      setSupersedeDialogOpen(true);
      return;
    }
    onChange(next);
  };

  // The backend per-type set is the source of truth for status validity; the
  // picker still drops system-managed generating/refining states (a user never
  // picks those) and only offers SUPERSEDED when there is a task to supersede.
  const allowedStatuses = getAllowedStatuses(taskType).filter(
    (status) =>
      !isMachineManagedStatus(status) &&
      (status !== WorkStatus.Superseded || Boolean(taskId))
  );
  const isFeature = taskType === FEATURE_TASK_TYPE;
  const resolveLabel = (status: WorkStatus) =>
    isFeature
      ? getFeatureStatusLabel(status)
      : taskType === "PLAN"
      ? getPlanStatusLabel(status)
      : getStatusLabel(status);

  return (
    <>
      <FormControl fullWidth={fullWidth} error={error} size={size}>
        {label && <InputLabel>{label}</InputLabel>}
        <Select
          value={value}
          onChange={handleChange}
          disabled={disabled}
          label={label}
          readOnly={readOnly}
          renderValue={(selected) => (
            <Chip
              label={resolveLabel(selected as WorkStatus)}
              color={getStatusColorMapping(selected as WorkStatus)}
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
          {isLoading && (
            <MenuItem disabled value="">
              Loading…
            </MenuItem>
          )}
          {allowedStatuses
            .filter((status) => status !== value)
            .map((status) => (
              <MenuItem key={status} value={status}>
                <Chip
                  label={resolveLabel(status)}
                  color={getStatusColorMapping(status)}
                  size="small"
                  sx={{ fontWeight: "bold" }}
                />
              </MenuItem>
            ))}
        </Select>
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
      </FormControl>
      {taskId && (
        <SupersedeTaskDialog
          open={supersedeDialogOpen}
          organizationId={organizationId}
          projectId={projectId}
          taskId={taskId}
          onClose={() => setSupersedeDialogOpen(false)}
        />
      )}
    </>
  );
};
