import { Box } from "@mui/material";
import { useAgentSessionCurrentState } from "../../data/hooks/useAgentSessionCurrentState";
import { AgentSessionCurrentStateIndicator } from "../AgentSession/AgentSessionCurrentStateIndicator";
import {
  getTaskMonitorSessionActivityPhase,
} from "./taskMonitorSessionActivity";

export interface TaskMonitorSessionActivityIndicatorProps {
  organizationId: string;
  projectId: string;
  agentSessionId: string | null;
}

export const TaskMonitorSessionActivityIndicator = ({
  organizationId,
  projectId,
  agentSessionId,
}: TaskMonitorSessionActivityIndicatorProps) => {
  const currentState = useAgentSessionCurrentState(
    organizationId,
    projectId,
    agentSessionId ?? undefined,
  ).currentState;
  const activityPhase = getTaskMonitorSessionActivityPhase(currentState);

  if (!activityPhase) {
    return null;
  }

  return (
    <Box
      data-testid="task-monitor-session-activity"
      data-phase={activityPhase}
      sx={{ display: "flex", justifyContent: "center" }}
    >
      <AgentSessionCurrentStateIndicator
        currentState={activityPhase}
        presentation="animated"
        sx={{ marginTop: 0, marginBottom: 0 }}
      />
    </Box>
  );
};
