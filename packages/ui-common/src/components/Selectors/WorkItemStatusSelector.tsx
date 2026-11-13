import type { TaskResponseDto } from "../../api/api";
import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
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
import { WorkStatus } from "../../api";
import { useWorkItemTypeByKey } from "../../data/hooks";
import { getStatusColorMapping } from "../../utils/statusUtils";
import {
  getWorkItemStatusChoices,
  getWorkItemStatusLabel,
} from "../../utils/workItemStatusVocabulary";
import { isMachineManagedStatus } from "../../utils/workItemUtils";
import { SupersedeTaskDialog } from "../WorkItem/SupersedeTaskDialog";

export interface WorkItemStatusSelectorProps {
  value: TaskResponseDto["status"];
  onChange: (status: TaskResponseDto["status"]) => void;
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
  const [
    supersedeDialogOpen,
    setSupersedeDialogOpen,
    supersedeDialogOpenOwnerKey,
  ] = useModalState(false);
  const { workItemTypeDefinition: definition, isLoading } =
    useWorkItemTypeByKey(organizationId, projectId, taskType);

  const handleChange = (event: SelectChangeEvent): void => {
    const next = event.target.value;
    // SUPERSEDED never travels the plain status-update path — it requires a
    // named successor, collected in the supersede dialog.
    if (next === WorkStatus.Superseded) {
      setSupersedeDialogOpen(true);
      return;
    }
    onChange(next);
  };

  // The type's effective definition owns the choices and their order; the
  // picker still drops system-managed generating/refining states (a user never
  // picks those) and only offers SUPERSEDED when the type supports it and
  // there is a task to supersede.
  const allowedStatuses = definition
    ? [
        ...getWorkItemStatusChoices(definition),
        ...(definition.capabilities?.supportsSupersession && taskId
          ? [WorkStatus.Superseded]
          : []),
      ].filter((status) => !isMachineManagedStatus(status))
    : [];
  const resolveLabel = (status: TaskResponseDto["status"]): string =>
    getWorkItemStatusLabel(status, definition);

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
              label={resolveLabel(selected)}
              color={getStatusColorMapping(selected)}
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
        <ModalWorkOwner.Provider value={supersedeDialogOpenOwnerKey}>
          <SupersedeTaskDialog
            open={supersedeDialogOpen}
            organizationId={organizationId}
            projectId={projectId}
            taskId={taskId}
            onClose={() => setSupersedeDialogOpen(false)}
          />
        </ModalWorkOwner.Provider>
      )}
    </>
  );
};
