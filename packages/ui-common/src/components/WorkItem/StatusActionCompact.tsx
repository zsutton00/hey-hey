import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import FlagIcon from "@mui/icons-material/Flag";
import LayersIcon from "@mui/icons-material/Layers";
import PersonIcon from "@mui/icons-material/Person";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Typography,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Priority, ServiceDto, WorkStatus } from "../../api";
import { WorkStatus as WorkStatusEnum } from "../../api";
import { FEATURE_TASK_TYPE } from "../../constants/taskTypes";
import { useAuth } from "../../contexts/AuthContext";
import {
  useServices,
  useTaskAllowedStatuses,
  useUsers,
} from "../../data/hooks";
import {
  getPriorityColor,
  getPriorityLabel,
  getStatusColorMapping,
  getStatusLabel,
} from "../../utils/statusUtils";
import { isMachineManagedStatus } from "../../utils/workItemUtils";
import { SupersedeTaskDialog } from "./SupersedeTaskDialog";
import type { WorkItemMetadataFields } from "./WorkItemMetadata";

const SELECTABLE_PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

const featureStatusLabel = (status: WorkStatus): string => {
  if (status === WorkStatusEnum.Active) return "Ready";
  return getStatusLabel(status);
};

const formatDueDateLabel = (value: string | null): string => {
  if (!value) return "No due date";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "No due date";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "No due date";
  }
};

const ICON_BUTTON_SX = {
  width: 44,
  height: 44,
  borderRadius: 1,
  border: "1px solid",
  borderColor: "divider",
};

const resolvePaletteMain = (
  theme: Theme,
  key:
    | "default"
    | "primary"
    | "secondary"
    | "error"
    | "info"
    | "success"
    | "warning"
    | "ready"
    | "active",
): string => {
  if (key === "default") return theme.palette.text.secondary;
  const palette = theme.palette as Theme["palette"] &
    Record<string, { main?: string } | undefined>;
  return palette[key]?.main ?? theme.palette.text.secondary;
};

interface StatusActionCompactTaskServices {
  serviceIds: string[];
  onChange: (serviceIds: string[], services: ServiceDto[]) => void;
}

export interface StatusActionCompactProps {
  fields: WorkItemMetadataFields;
  organizationId: string;
  /** Required to resolve the backend per-type allowed status set. */
  projectId: string;
  /**
   * The task being edited. Required for the supersede transition; when absent
   * SUPERSEDED is not offered.
   */
  taskId?: string;
  taskType?: string;
  taskServices?: StatusActionCompactTaskServices;
  disabled?: boolean;
}

export const StatusActionCompact: React.FC<StatusActionCompactProps> = ({
  fields,
  organizationId,
  projectId,
  taskId,
  taskType,
  taskServices,
  disabled = false,
}) => {
  const status = fields.status?.value;
  const priority = fields.priority?.value;
  const dueDate = fields.dueDate?.value;
  const assigneeId = fields.assignee?.value;
  const { user: currentUser } = useAuth();
  const { data: allMembers } = useUsers(organizationId);
  const servicesEnabled = Boolean(taskServices);
  const { services: serviceList } = useServices(organizationId, {
    projectId,
    enabled: servicesEnabled,
  });
  const { getAllowedStatuses, isLoading: statusesLoading } =
    useTaskAllowedStatuses({ organizationId, projectId });

  const members = useMemo(
    () =>
      allMembers
        .filter((member) => member.isActive && member.user)
        .map((member) => ({
          id: member.userId,
          name: member.user?.name || "Unknown User",
        })),
    [allMembers],
  );

  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const priorityButtonRef = useRef<HTMLButtonElement | null>(null);
  const dueDateButtonRef = useRef<HTMLButtonElement | null>(null);
  const assigneeButtonRef = useRef<HTMLButtonElement | null>(null);
  const servicesButtonRef = useRef<HTMLButtonElement | null>(null);

  const [openMenu, setOpenMenu] = useState<
    "status" | "priority" | "dueDate" | "assignee" | "services" | null
  >(null);
  const [
    supersedeDialogOpen,
    setSupersedeDialogOpen,
    supersedeDialogOpenOwnerKey,
  ] = useModalState(false);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const isFeature = taskType === FEATURE_TASK_TYPE;
  // The backend per-type set is the source of truth for status validity; the
  // picker still drops system-managed generating/refining states (a user never
  // picks those) and only offers SUPERSEDED when there is a task to supersede.
  const statuses = useMemo(
    () =>
      getAllowedStatuses(taskType).filter(
        (s) =>
          !isMachineManagedStatus(s) &&
          (s !== WorkStatusEnum.Superseded || Boolean(taskId)),
      ),
    [getAllowedStatuses, taskType, taskId],
  );
  const resolveStatusLabel = useCallback(
    (s: WorkStatus) => (isFeature ? featureStatusLabel(s) : getStatusLabel(s)),
    [isFeature],
  );

  const currentStatusLabel = status ? resolveStatusLabel(status) : null;
  const currentPriorityLabel = priority ? getPriorityLabel(priority) : null;
  const currentDueDateLabel = formatDueDateLabel(dueDate ?? null);
  const currentAssignee = members.find((m) => m.id === assigneeId);
  const currentAssigneeLabel = assigneeId
    ? (currentAssignee?.name ?? "Unknown User")
    : "Unassigned";

  const sortedServices = useMemo(
    () =>
      [...serviceList].sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? ""),
      ),
    [serviceList],
  );
  const selectedServiceIds = taskServices?.serviceIds ?? [];
  const currentServicesLabel =
    selectedServiceIds.length === 0
      ? "No services"
      : `${selectedServiceIds.length} service${
          selectedServiceIds.length === 1 ? "" : "s"
        }`;

  const handleStatusSelect = (next: WorkStatus): void => {
    if (fields.status?.mode !== "editable") return;
    // SUPERSEDED never travels the plain status-update path — it requires a
    // named successor, collected in the supersede dialog.
    if (next === WorkStatusEnum.Superseded) {
      closeMenu();
      setSupersedeDialogOpen(true);
      return;
    }
    fields.status.onChange(next);
    closeMenu();
  };

  const handlePrioritySelect = (next: Priority): void => {
    if (fields.priority?.mode !== "editable") return;
    fields.priority.onChange(next);
    closeMenu();
  };

  const handleAssigneeSelect = (next: string | null): void => {
    if (fields.assignee?.mode !== "editable") return;
    fields.assignee.onChange(next);
    closeMenu();
  };

  const handleDueDateSelect = (next: Date | null): void => {
    if (fields.dueDate?.mode !== "editable") return;
    if (!next || Number.isNaN(next.getTime())) {
      if (fields.dueDate.allowClear === false) return;
      fields.dueDate.onChange(null);
    } else {
      fields.dueDate.onChange(next.toISOString());
    }
    closeMenu();
  };

  const handleServiceToggle = (serviceId: string): void => {
    if (!taskServices) return;
    const isSelected = selectedServiceIds.includes(serviceId);
    const nextIds = isSelected
      ? selectedServiceIds.filter((id) => id !== serviceId)
      : [...selectedServiceIds, serviceId];
    const nextServices = nextIds
      .map((id) => sortedServices.find((service) => service.id === id))
      .filter((service): service is ServiceDto => service !== undefined);
    taskServices.onChange(nextIds, nextServices);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
      }}
      data-testid="status-action-compact"
    >
      {fields.status && (
        <>
          <IconButton
            ref={statusButtonRef}
            onClick={() => setOpenMenu("status")}
            disabled={disabled || fields.status.mode === "readOnly"}
            aria-label={`Status: ${currentStatusLabel}`}
            data-testid="status-action-compact-status"
            sx={ICON_BUTTON_SX}
          >
            <RadioButtonCheckedIcon
              fontSize="small"
              sx={{
                color: (theme) =>
                  status
                    ? resolvePaletteMain(theme, getStatusColorMapping(status))
                    : theme.palette.text.secondary,
              }}
            />
          </IconButton>
          <Menu
            anchorEl={statusButtonRef.current}
            open={openMenu === "status"}
            onClose={closeMenu}
          >
            {statuses.length === 0 && (
              <MenuItem disabled>
                {statusesLoading ? "Loading…" : "No transitions available"}
              </MenuItem>
            )}
            {statuses.map((s) => (
              <MenuItem
                key={s}
                selected={s === status}
                onClick={() => handleStatusSelect(s)}
              >
                <Chip
                  label={resolveStatusLabel(s)}
                  color={getStatusColorMapping(s)}
                  size="small"
                  sx={{ fontWeight: "bold" }}
                />
              </MenuItem>
            ))}
          </Menu>
        </>
      )}

      {fields.priority && (
        <>
          <IconButton
            ref={priorityButtonRef}
            onClick={() => setOpenMenu("priority")}
            disabled={disabled || fields.priority.mode === "readOnly"}
            aria-label={`Priority: ${currentPriorityLabel}`}
            data-testid="status-action-compact-priority"
            sx={ICON_BUTTON_SX}
          >
            <FlagIcon
              fontSize="small"
              sx={{
                color: (theme) =>
                  priority
                    ? resolvePaletteMain(theme, getPriorityColor(priority))
                    : theme.palette.text.secondary,
              }}
            />
          </IconButton>
          <Menu
            anchorEl={priorityButtonRef.current}
            open={openMenu === "priority"}
            onClose={closeMenu}
          >
            {SELECTABLE_PRIORITIES.map((p) => (
              <MenuItem
                key={p}
                selected={p === priority}
                onClick={() => handlePrioritySelect(p)}
              >
                <Chip
                  label={getPriorityLabel(p)}
                  color={getPriorityColor(p)}
                  size="small"
                  sx={{ fontWeight: "bold" }}
                />
              </MenuItem>
            ))}
          </Menu>
        </>
      )}

      {fields.dueDate && (
        <>
          {fields.dueDate.actionLabels && (
            <Typography variant="body2">
              {dueDate
                ? currentDueDateLabel
                : fields.dueDate.actionLabels.noDate}
            </Typography>
          )}
          {fields.dueDate.actionLabels ? (
            <Button
              ref={dueDateButtonRef}
              onClick={() => setOpenMenu("dueDate")}
              disabled={disabled || fields.dueDate.mode === "readOnly"}
              data-testid="status-action-compact-due-date"
            >
              {dueDate
                ? fields.dueDate.actionLabels.change
                : fields.dueDate.actionLabels.set}
            </Button>
          ) : (
            <IconButton
              ref={dueDateButtonRef}
              onClick={() => setOpenMenu("dueDate")}
              disabled={disabled || fields.dueDate.mode === "readOnly"}
              aria-label={`Due date: ${currentDueDateLabel}`}
              data-testid="status-action-compact-due-date"
              sx={ICON_BUTTON_SX}
            >
              <CalendarTodayIcon
                fontSize="small"
                sx={{
                  color: (theme) =>
                    dueDate
                      ? theme.palette.primary.main
                      : theme.palette.text.secondary,
                }}
              />
            </IconButton>
          )}
          <Popover
            anchorEl={dueDateButtonRef.current}
            open={openMenu === "dueDate"}
            onClose={closeMenu}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          >
            <Box sx={{ p: 1 }}>
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <DateCalendar
                  value={dueDate ? new Date(dueDate) : null}
                  onChange={handleDueDateSelect}
                />
              </LocalizationProvider>
              {dueDate && fields.dueDate.allowClear !== false && (
                <Box sx={{ display: "flex", justifyContent: "flex-end", p: 1 }}>
                  <MenuItem
                    onClick={() => handleDueDateSelect(null)}
                    data-testid="status-action-compact-due-date-clear"
                  >
                    {fields.dueDate.actionLabels?.clear ?? "Clear date"}
                  </MenuItem>
                </Box>
              )}
            </Box>
          </Popover>
        </>
      )}

      {fields.assignee && (
        <>
          <IconButton
            ref={assigneeButtonRef}
            onClick={() => setOpenMenu("assignee")}
            disabled={disabled || fields.assignee.mode === "readOnly"}
            aria-label={`Assignee: ${currentAssigneeLabel}`}
            data-testid="status-action-compact-assignee"
            sx={ICON_BUTTON_SX}
          >
            <PersonIcon
              fontSize="small"
              sx={{
                color: (theme) =>
                  assigneeId
                    ? theme.palette.primary.main
                    : theme.palette.text.secondary,
              }}
            />
          </IconButton>
          <Menu
            anchorEl={assigneeButtonRef.current}
            open={openMenu === "assignee"}
            onClose={closeMenu}
          >
            <MenuItem
              selected={!assigneeId}
              onClick={() => handleAssigneeSelect(null)}
            >
              <Chip label="Unassigned" size="small" variant="outlined" />
            </MenuItem>
            {currentUser?.id && assigneeId !== currentUser.id && (
              <MenuItem
                onClick={() => handleAssigneeSelect(currentUser.id)}
                data-testid="status-action-compact-assign-to-me"
              >
                <Chip
                  label="Assign to me"
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              </MenuItem>
            )}
            {members.map((m) => (
              <MenuItem
                key={m.id}
                selected={m.id === assigneeId}
                onClick={() => handleAssigneeSelect(m.id)}
              >
                <Chip label={m.name} size="small" sx={{ fontWeight: "bold" }} />
              </MenuItem>
            ))}
          </Menu>
        </>
      )}

      {taskServices && (
        <>
          <IconButton
            ref={servicesButtonRef}
            onClick={() => setOpenMenu("services")}
            disabled={disabled}
            aria-label={`Services: ${currentServicesLabel}`}
            data-testid="status-action-compact-services"
            sx={ICON_BUTTON_SX}
          >
            <LayersIcon
              fontSize="small"
              sx={{
                color: (theme) =>
                  selectedServiceIds.length > 0
                    ? theme.palette.primary.main
                    : theme.palette.text.secondary,
              }}
            />
          </IconButton>
          <Menu
            anchorEl={servicesButtonRef.current}
            open={openMenu === "services"}
            onClose={closeMenu}
            slotProps={{ paper: { sx: { maxHeight: 320, minWidth: 240 } } }}
          >
            {sortedServices.length === 0 && (
              <MenuItem disabled>
                <Typography variant="body2" color="text.secondary">
                  No services available
                </Typography>
              </MenuItem>
            )}
            {sortedServices.map((service) => {
              const isSelected = selectedServiceIds.includes(service.id);
              const displayName =
                service.name && service.name.trim().length > 0
                  ? service.name
                  : "Untitled service";
              return (
                <MenuItem
                  key={service.id}
                  selected={isSelected}
                  onClick={() => handleServiceToggle(service.id)}
                  data-testid={`status-action-compact-service-${service.id}`}
                >
                  <Checkbox
                    checked={isSelected}
                    size="small"
                    sx={{ p: 0.5, mr: 1 }}
                  />
                  <ListItemText
                    primary={displayName}
                    secondary={service.description ?? undefined}
                    primaryTypographyProps={{ variant: "body2" }}
                    secondaryTypographyProps={{
                      variant: "caption",
                      noWrap: true,
                    }}
                  />
                </MenuItem>
              );
            })}
          </Menu>
        </>
      )}

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
    </Box>
  );
};
