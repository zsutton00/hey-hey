import { Alert } from "@mui/material";
import { TaskMonitorInterventionMessage } from "../Conversation/Components/TaskMonitorInterventionMessage";
import { useConversationMessages } from "../../data/hooks/useConversationMessages";
import { useProjectWorkItemExecutionState } from "../../data/hooks/useWorkItemExecutionState";

/** Surface outstanding permissions until their persisted cards arrive. */
export function MonitorHeldPermissions({
  organizationId,
  projectId,
  monitorId,
  conversationId,
  agentSessionId,
  taskTitle,
}: {
  organizationId: string;
  projectId: string;
  monitorId: string;
  conversationId: string;
  agentSessionId: string;
  taskTitle: string | null;
}) {
  const state = useProjectWorkItemExecutionState(
    organizationId,
    projectId,
    monitorId,
  );
  const messages = useConversationMessages(
    organizationId,
    projectId,
    conversationId,
    { refetchOnMount: false },
  );
  if (
    state.status !== "retained" ||
    state.delivery !== "LIVE" ||
    state.freshness.status !== "CURRENT"
  ) {
    return null;
  }

  const posted = new Set(
    messages.orderedData.flatMap((message) =>
      message.type === "SYSTEM" &&
      message.data.type === "TASK_MONITOR_INTERVENTION" &&
      "interventionId" in message.data
        ? [message.data.interventionId]
        : [],
    ),
  );
  return state.state.projection.outstandingPermissions
    ?.filter(
      (request) =>
        request.agentSessionId === agentSessionId &&
        !posted.has(request.interventionId),
    )
    .map((request) =>
      request.owner === "MONITOR" ? (
        <Alert
          severity="info"
          key={request.interventionId}
          data-testid="task-monitor-awaiting-monitor"
        >
          Awaiting the Task Monitor · {request.action} · {request.target}
        </Alert>
      ) : (
        <TaskMonitorInterventionMessage
          key={request.interventionId}
          data={{
            ...request,
            expiresAt: null,
            reason: request.reason ?? null,
            taskTitle,
            response: "",
            choices: ["APPROVE", "DENY"],
          }}
        />
      ),
    );
}
