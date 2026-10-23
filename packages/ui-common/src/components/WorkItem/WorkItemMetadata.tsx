import { Box, useMediaQuery } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import React from "react";
import type {
  Priority,
  ServiceDto,
  TaskResponseDto,
  WorkStatus,
} from "../../api";
import { WorkStatus as WorkStatusEnum } from "../../api";
import { FEATURE_TASK_TYPE } from "../../constants/taskTypes";
import { AssigneeSelector } from "../Selectors/AssigneeSelector";
import { DueDateSelector } from "../Selectors/DueDateSelector";
import { FeatureSelector } from "../Selectors/FeatureSelector";
import { ServiceSelector } from "../Selectors/ServiceSelector";
import { TaskSelector } from "../Selectors/TaskSelector";
import { WorkItemPrioritySelector } from "../Selectors/WorkItemPrioritySelector";
import { WorkItemStatusSelector } from "../Selectors/WorkItemStatusSelector";
import { StatusActionCompact } from "./StatusActionCompact";

export type ReadOnlyMetadataField<Value> = {
  mode: "readOnly";
  value: Value;
};

export type EditableMetadataField<Value, ChangeValue = Value> = {
  mode: "editable";
  value: Value;
  onChange: (value: ChangeValue) => void;
};

export type MetadataField<Value, ChangeValue = Value> =
  ReadOnlyMetadataField<Value> | EditableMetadataField<Value, ChangeValue>;

type DueDateMetadataField = MetadataField<string | null> & {
  allowClear?: boolean;
  actionLabels?: { noDate: string; set: string; change: string; clear: string };
};

export interface WorkItemMetadataFields {
  status?: MetadataField<WorkStatus>;
  priority?: MetadataField<Priority>;
  dueDate?: DueDateMetadataField;
  assignee?: MetadataField<string | null>;
}

export interface WorkItemMetadataProps {
  fields: WorkItemMetadataFields;
  parentTaskId?: string | null;
  currentTaskId?: string;
  taskType?: string;

  // Organization context (needed for AssigneeSelector)
  organizationId: string;
  projectId: string;

  onFeatureChange?: (
    featureId: string | null,
    feature?: TaskResponseDto,
  ) => void;
  onParentTaskChange?: (taskId: string | null, task?: TaskResponseDto) => void;
  taskServices?: {
    serviceIds: string[];
    onChange: (serviceIds: string[], services: ServiceDto[]) => void;
  };

  // Optional UI controls
  disabled?: boolean;
  showLabels?: boolean;
  size?: "small" | "medium";
  rootClassName?: string;
  rootSx?: SxProps<Theme>;
}

export const WorkItemMetadata: React.FC<WorkItemMetadataProps> = ({
  fields,
  parentTaskId,
  currentTaskId,
  taskType,
  organizationId,
  projectId,
  onFeatureChange,
  onParentTaskChange,
  taskServices,
  disabled = false,
  showLabels = true,
  size = "medium",
  rootClassName,
  rootSx,
}) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const status = fields.status?.value;
  const assigneeId = fields.assignee?.value;
  const isAssigneeRequired =
    status === WorkStatusEnum.Active || status === WorkStatusEnum.Completed;
  const showAssigneeError = isAssigneeRequired && !assigneeId;
  const isServiceSelectionRequired =
    status === WorkStatusEnum.Backlog ||
    status === WorkStatusEnum.Active ||
    status === WorkStatusEnum.Completed;
  const showServiceError =
    taskServices !== undefined &&
    isServiceSelectionRequired &&
    taskServices.serviceIds.length === 0;
  const serviceHelperText = showServiceError
    ? status === WorkStatusEnum.Backlog
      ? "Select one or more services for ready work items."
      : "Select one or more services for active or completed work items."
    : "Select one or more services linked to this work item.";

  const parentTaskExclusions = React.useMemo(
    () =>
      [currentTaskId, parentTaskId].filter((taskId): taskId is string =>
        Boolean(taskId),
      ),
    [currentTaskId, parentTaskId],
  );

  type ExtractArrayElement<T> =
    T extends ReadonlyArray<infer Element> ? Element : never;
  type RootSxArrayElement = ExtractArrayElement<SxProps<Theme>>;
  type RootSxArray = ReadonlyArray<RootSxArrayElement>;

  const baseSx: RootSxArrayElement = {
    display: "flex",
    flexDirection: { xs: "column", md: "row" },
    flexWrap: "wrap",
    gap: 2,
    alignItems: { xs: "stretch", md: "flex-start" },
  };

  const isRootSxArray = (
    value: SxProps<Theme> | undefined,
  ): value is RootSxArray => Array.isArray(value);

  const normalizeRootSx = (value: SxProps<Theme> | undefined): RootSxArray => {
    if (!value) {
      return [];
    }

    return isRootSxArray(value) ? value : [value];
  };

  return (
    <Box className={rootClassName} sx={[baseSx, ...normalizeRootSx(rootSx)]}>
      {isCompact ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            width: "100%",
            flexWrap: "wrap",
          }}
        >
          <StatusActionCompact
            fields={fields}
            organizationId={organizationId}
            projectId={projectId}
            taskId={currentTaskId}
            taskType={taskType}
            taskServices={taskServices}
            disabled={disabled}
          />
        </Box>
      ) : (
        <>
          {fields.status && (
            <Box
              sx={{
                flex: { md: "1 1 auto" },
                width: { xs: "100%", md: "auto" },
                maxWidth: "200px",
                minWidth: 140,
              }}
            >
              <WorkItemStatusSelector
                value={fields.status.value}
                onChange={
                  fields.status.mode === "editable"
                    ? fields.status.onChange
                    : () => undefined
                }
                organizationId={organizationId}
                projectId={projectId}
                taskId={currentTaskId}
                taskType={taskType}
                label={showLabels ? "Status" : undefined}
                disabled={disabled || fields.status.mode === "readOnly"}
                fullWidth
                size={size}
              />
            </Box>
          )}

          {fields.priority && (
            <Box
              sx={{
                flex: { md: "1 1 auto" },
                width: { xs: "100%", md: "auto" },
                maxWidth: "160px",
                minWidth: 120,
              }}
            >
              <WorkItemPrioritySelector
                value={fields.priority.value}
                onChange={
                  fields.priority.mode === "editable"
                    ? fields.priority.onChange
                    : () => undefined
                }
                label={showLabels ? "Priority" : undefined}
                disabled={disabled || fields.priority.mode === "readOnly"}
                fullWidth
                size={size}
              />
            </Box>
          )}

          {fields.dueDate && (
            <Box
              sx={{
                flex: { md: "1 1 auto" },
                width: { xs: "100%", md: "auto" },
                maxWidth: "200px",
                minWidth: 140,
              }}
            >
              <DueDateSelector
                value={fields.dueDate.value}
                onChange={
                  fields.dueDate.mode === "editable"
                    ? fields.dueDate.onChange
                    : () => undefined
                }
                label={showLabels ? "Due Date" : undefined}
                disabled={disabled || fields.dueDate.mode === "readOnly"}
                fullWidth
                size={size}
                allowClear={fields.dueDate.allowClear}
              />
            </Box>
          )}

          {fields.assignee && (
            <Box
              sx={{
                flex: { md: "1 1 auto" },
                width: { xs: "100%", md: "auto" },
                maxWidth: "200px",
                minWidth: 140,
              }}
            >
              <AssigneeSelector
                value={fields.assignee.value}
                onChange={
                  fields.assignee.mode === "editable"
                    ? fields.assignee.onChange
                    : () => undefined
                }
                organizationId={organizationId}
                label={showLabels ? "Assignee" : undefined}
                helperText={
                  showAssigneeError
                    ? "Assignee required for active or completed tasks."
                    : undefined
                }
                disabled={disabled || fields.assignee.mode === "readOnly"}
                error={showAssigneeError}
                fullWidth
                size={size}
              />
            </Box>
          )}
        </>
      )}

      {taskServices && !isCompact && (
        <Box
          data-testid="work-item-service-selector"
          sx={{
            flex: { md: "1 1 auto" },
            width: { xs: "100%", md: "auto" },
            maxWidth: "240px",
            minWidth: 140,
          }}
        >
          <ServiceSelector
            organizationId={organizationId}
            projectId={projectId}
            value={taskServices.serviceIds}
            onChange={taskServices.onChange}
            label={showLabels ? "Services" : undefined}
            helperText={serviceHelperText}
            error={showServiceError}
            disabled={disabled}
            fullWidth
            size={size}
            multiple
          />
        </Box>
      )}

      {onFeatureChange && taskType === FEATURE_TASK_TYPE && (
        <Box
          sx={{
            flex: { md: "1 1 auto" },
            width: { xs: "100%", md: "auto" },
            maxWidth: "220px",
            minWidth: 140,
          }}
        >
          <FeatureSelector
            organizationId={organizationId}
            projectId={projectId}
            value={parentTaskId ?? null}
            onChange={onFeatureChange}
            label={showLabels ? "Feature" : undefined}
            disabled={disabled}
            fullWidth
            size={size}
            clearable={false}
          />
        </Box>
      )}

      {onParentTaskChange && (
        <Box
          sx={{
            flex: { md: "1 1 auto" },
            width: { xs: "100%", md: "auto" },
            maxWidth: "240px",
            minWidth: 140,
          }}
        >
          <TaskSelector
            organizationId={organizationId}
            projectId={projectId}
            value={parentTaskId ?? null}
            excludeTaskIds={parentTaskExclusions}
            onChange={onParentTaskChange}
            label={showLabels ? "Parent Task" : undefined}
            disabled={disabled}
            fullWidth
            size={size}
            includeNone={true}
          />
        </Box>
      )}
    </Box>
  );
};
