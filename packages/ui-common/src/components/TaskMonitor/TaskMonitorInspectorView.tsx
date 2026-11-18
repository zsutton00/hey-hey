import { Alert, LinearProgress, Stack, Typography } from "@mui/material";
import type { WorkStatus } from "../../api";
import { usePathService } from "../../contexts";
import { resolveAgentSessionMetadata } from "../AgentSession/resolveAgentSessionMetadata";
import { TaskMonitorConversationPane } from "./TaskMonitorConversationPane";
import { TaskMonitorSessionActivityIndicator } from "./TaskMonitorSessionActivityIndicator";
import { resolveTaskMonitorInspectorPresentation } from "./taskMonitorInspectorState";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";
import { useTaskMonitorConversation } from "./useTaskMonitorSessionReports";

export interface TaskMonitorInspectorViewProps {
  organizationId: string;
  projectId: string;
  monitorStatus: WorkStatus;
  node: TaskMonitorProjectedNode;
}

export const TaskMonitorInspectorView = ({
  organizationId,
  projectId,
  monitorStatus,
  node,
}: TaskMonitorInspectorViewProps) => {
  const pathService = usePathService();
  const session = node.session.kind === "loaded" ? node.session.session : null;
  const conversation = useTaskMonitorConversation({
    organizationId,
    projectId,
    session,
  });
  if (node.task.kind === "missing") {
    return (
      <Alert severity="error" data-testid="task-monitor-inspector-missing-task">
        The canonical task could not be loaded.
      </Alert>
    );
  }

  if (node.session.kind === "missing") {
    return (
      <Alert
        severity="error"
        data-testid="task-monitor-inspector-missing-session"
      >
        The canonical linked session could not be loaded.
      </Alert>
    );
  }

  const presentation = resolveTaskMonitorInspectorPresentation({
    monitorStatus,
    node,
  });
  if (presentation.kind === "waiting-for-session") {
    return (
      <Stack
        spacing={2}
        data-testid="task-monitor-waiting-for-session"
        sx={{ p: 2 }}
      >
        <Typography variant="h6">Current session</Typography>
        <LinearProgress aria-label="Waiting for session to start" />
        <Typography color="text.secondary">
          Waiting for session to start
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <TaskMonitorConversationPane
        title={session?.title ?? "Current session"}
        conversation={conversation.conversation}
        project={conversation.project}
        readOnly
        loading={conversation.loading}
        fetched={conversation.fetched}
        errorMessage={conversation.errorMessage}
        emptyMessage={
          session
            ? "This session does not have a conversation."
            : "No session has been linked to this task."
        }
        sessionHref={
          session
            ? pathService.agentSession({
                projectId,
                agentSessionId: session.id,
              })
            : undefined
        }
        agentSessionMetadata={
          session ? resolveAgentSessionMetadata(session) : undefined
        }
        contentAfter={
          <TaskMonitorSessionActivityIndicator
            organizationId={organizationId}
            projectId={projectId}
            agentSessionId={session?.id ?? null}
          />
        }
        testId="task-monitor-current-session"
      />
    </Stack>
  );
};
