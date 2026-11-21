import {
  TaskMonitor,
  type TaskMonitorProps,
  type TaskMonitorPane,
} from "@hey-hey/ui-common/components";
import { Stack } from "@mui/material";
import { SegmentedToggle, type Segment } from "./SegmentedToggle";

const TASK_MONITOR_PANES: readonly Segment<TaskMonitorPane>[] = [
  { value: "steps", label: "Steps" },
  { value: "monitor", label: "Task Monitor" },
  { value: "session", label: "Active Session" },
];
const renderPaneNavigation: NonNullable<
  TaskMonitorProps["renderPaneNavigation"]
> = ({ activePane, availablePanes, onSelectPane }) => (
  <SegmentedToggle
    mobileDropdown
    segments={TASK_MONITOR_PANES.filter((pane) =>
      availablePanes.includes(pane.value),
    )}
    value={activePane}
    onChange={onSelectPane}
    sx={{ display: { xs: "inline-flex", lg: "none" }, flexShrink: 0 }}
  />
);

export interface TaskMonitorResponsiveWorkspaceProps {
  organizationId: string;
  projectId: string;
  monitorId: string;
}

export const TaskMonitorResponsiveWorkspace = ({
  organizationId,
  projectId,
  monitorId,
}: TaskMonitorResponsiveWorkspaceProps) => {
  return (
    <Stack
      spacing={1.5}
      data-testid="task-monitor-responsive-workspace"
      sx={{ height: "100%", minHeight: 0 }}
    >
      <Stack sx={{ flex: 1, minHeight: 0 }}>
        <TaskMonitor
          key={monitorId}
          organizationId={organizationId}
          projectId={projectId}
          monitorId={monitorId}
          activePane="session"
          renderPaneNavigation={renderPaneNavigation}
        />
      </Stack>
    </Stack>
  );
};
