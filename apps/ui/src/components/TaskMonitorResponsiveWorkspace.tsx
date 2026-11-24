import { TaskMonitor } from "@hey-hey/ui-common/components";
import { Stack } from "@mui/material";

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
        />
      </Stack>
    </Stack>
  );
};
