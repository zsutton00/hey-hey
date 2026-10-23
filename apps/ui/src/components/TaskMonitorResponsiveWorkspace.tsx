import {
  TaskMonitor,
  type TaskMonitorPane,
} from "@hey-hey/ui-common/components";
import { Stack } from "@mui/material";
import { useState } from "react";
import { SegmentedToggle, type Segment } from "./SegmentedToggle";

const TASK_MONITOR_PANES: readonly Segment<TaskMonitorPane>[] = [
  { value: "steps", label: "Steps" },
  { value: "monitor", label: "Task Monitor" },
  { value: "session", label: "Active Session" },
];

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
  const [activePane, setActivePane] = useState<TaskMonitorPane>("monitor");

  return (
    <Stack
      spacing={1.5}
      data-testid="task-monitor-responsive-workspace"
      sx={{ height: "100%", minHeight: 0 }}
    >
      <SegmentedToggle
        mobileDropdown
        segments={TASK_MONITOR_PANES}
        value={activePane}
        onChange={setActivePane}
        sx={{ display: { xs: "inline-flex", lg: "none" }, flexShrink: 0 }}
      />
      <Stack sx={{ flex: 1, minHeight: 0 }}>
        <TaskMonitor
          organizationId={organizationId}
          projectId={projectId}
          monitorId={monitorId}
          activePane={activePane}
        />
      </Stack>
    </Stack>
  );
};
