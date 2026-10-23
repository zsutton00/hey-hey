import {
  type AgentSessionDto,
  AgentSessionStatus,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import type { WorkItemResponseDto } from "@hey-hey/ui-common/data";
import { agentSessionsClient } from "@hey-hey/ui-common/clients";
import {
  CapsuleAction,
  CompleteSessionPanel,
} from "@hey-hey/ui-common/components";
import { useWorkItems } from "@hey-hey/ui-common/data";
import ReadyIcon from "@mui/icons-material/CheckCircleOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import type { ElementType } from "react";
import { useCallback, useMemo, useState } from "react";

interface AgentSessionStatusActionCapsuleProps {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  taskData?: WorkItemResponseDto | null;
  onStatusUpdated?: () => Promise<unknown> | void;
}

interface StatusActionConfig {
  label: string;
  title: string;
  nextStatus: AgentSessionStatus;
  icon: ElementType;
}

const resolveStatusAction = (
  status: AgentSessionDto["status"],
): StatusActionConfig | null => {
  switch (status) {
    case AgentSessionStatus.NotStarted:
    case AgentSessionStatus.InProgress:
    case AgentSessionStatus.Errored:
      return {
        label: "Complete",
        title: "Complete Coding Session",
        nextStatus: AgentSessionStatus.Completed,
        icon: ReadyIcon,
      };
    case AgentSessionStatus.Completed:
      return {
        label: "Resume",
        title: "Resume Coding Session",
        nextStatus: AgentSessionStatus.InProgress,
        icon: PlayArrowIcon,
      };
    default:
      return null;
  }
};

export const AgentSessionStatusActionCapsule: React.FC<
  AgentSessionStatusActionCapsuleProps
> = ({ organizationId, projectId, agentSession, taskData, onStatusUpdated }) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const statusAction = useMemo(
    () => resolveStatusAction(agentSession.status),
    [agentSession.status],
  );

  const isCompleteAction =
    statusAction?.nextStatus === AgentSessionStatus.Completed;
  const hasActiveTask =
    !!taskData && taskData.status !== WorkStatus.Completed;

  const { updateTask } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      initiativeId: taskData?.initiativeId ?? "",
      enabled: false,
    },
  );

  const handleStatusUpdate = useCallback(async () => {
    if (!statusAction || isUpdating || !agentSession.machineId) {
      return;
    }

    setIsUpdating(true);

    try {
      await agentSessionsClient.updateAgentSession(
        {
          organizationId,
          projectId,
          agentSessionId: agentSession.id,
          updateAgentSessionDto: {
            machineId: agentSession.machineId,
            status: statusAction.nextStatus,
          },
        },
      );
      await onStatusUpdated?.();
    } catch (error) {
      console.error("Failed to update coding session status:", error);
    } finally {
      setIsUpdating(false);
    }
  }, [
    agentSession.id,
    agentSession.machineId,
    isUpdating,
    onStatusUpdated,
    organizationId,
    projectId,
    statusAction,
  ]);

  const handleCompleteSessionOnly = useCallback(async () => {
    if (!agentSession.machineId) {
      return;
    }

    await agentSessionsClient.updateAgentSession(
      {
        organizationId,
        projectId,
        agentSessionId: agentSession.id,
        updateAgentSessionDto: {
          machineId: agentSession.machineId,
          status: AgentSessionStatus.Completed,
        },
      },
    );
    await onStatusUpdated?.();
  }, [
    organizationId,
    projectId,
    agentSession.id,
    agentSession.machineId,
    onStatusUpdated,
  ]);

  const renderCompleteContent = useCallback(() => {
    if (!taskData) return null;
    return (
      <CompleteSessionPanel
        taskId={taskData.id}
        currentStatus={taskData.status}
        onUpdateStatus={async (id, update) => {
          await updateTask(id, update);
        }}
        onPanelComplete={async () => {
          if (!agentSession.machineId) {
            return;
          }

          await agentSessionsClient.updateAgentSession(
            {
              organizationId,
              projectId,
              agentSessionId: agentSession.id,
              updateAgentSessionDto: {
                machineId: agentSession.machineId,
                status: AgentSessionStatus.Completed,
              },
            },
          );
          await onStatusUpdated?.();
        }}
        onCompleteSessionOnly={handleCompleteSessionOnly}
      />
    );
  }, [
    taskData,
    updateTask,
    organizationId,
    projectId,
    agentSession.id,
    agentSession.machineId,
    onStatusUpdated,
    handleCompleteSessionOnly,
  ]);

  if (!statusAction) {
    return null;
  }

  // When completing a session that has an active task, expand to show
  // Verifying/Completed task status options instead of direct click.
  if (isCompleteAction && hasActiveTask) {
    return (
      <CapsuleAction
        id={`agent-session-status-${agentSession.id}`}
        behavior="expand"
        icon={statusAction.icon}
        label={statusAction.label}
        title={statusAction.title}
        actionGroup="page"
        tier="page"
        order={100}
        disabled={isUpdating}
        inProgress={isUpdating}
        renderContent={renderCompleteContent}
      />
    );
  }

  return (
    <CapsuleAction
      id={`agent-session-status-${agentSession.id}`}
      behavior="click"
      icon={statusAction.icon}
      label={statusAction.label}
      title={statusAction.title}
      actionGroup="page"
      tier="page"
      order={100}
      onClick={handleStatusUpdate}
      disabled={isUpdating}
      inProgress={isUpdating}
    />
  );
};
