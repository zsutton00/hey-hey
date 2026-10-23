import type {
  ContextRelatedEntityDto,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import { unifiedApiClient } from "@hey-hey/ui-common/clients";
import React, { useCallback } from "react";
import { PaginatedCodingSessionsFeed } from "../../components/Activity/PaginatedCodingSessionsFeed";
import { TaskScopedAgentSessionsTab } from "../../components/Tabs/TaskScopedAgentSessionsTab";
import { buildTaskAgentSessionPath } from "./taskSessionRoutes";

interface TaskAgentSessionsTabProps {
  organizationId: string;
  projectId: string;
  initiativeId: string;
  taskId: string;
  taskType: string;
  relatedEntities: readonly ContextRelatedEntityDto[];
  taskName?: string;
  taskStatus?: WorkStatus;
  loading?: boolean;
  emptyMessage?: string;
  enableFilters?: boolean;
  onTaskStatusChange?: (newStatus: WorkStatus) => Promise<void>;
}

export const TaskAgentSessionsTab: React.FC<TaskAgentSessionsTabProps> = ({
  organizationId,
  projectId,
  initiativeId,
  taskId,
  taskType,
  relatedEntities,
  taskName,
  taskStatus,
  loading = false,
  emptyMessage,
  enableFilters = false,
  onTaskStatusChange,
}) => {
  const buildSessionPath = useCallback(
    (agentSessionId: string): string =>
      buildTaskAgentSessionPath(
        projectId,
        initiativeId,
        taskId,
        agentSessionId,
      ),
    [initiativeId, projectId, taskId],
  );

  const handleDeleteSession = useCallback(
    async (agentSessionId: string): Promise<void> => {
      await unifiedApiClient.deleteAgentSession(
        organizationId,
        projectId,
        agentSessionId,
      );
    },
    [organizationId, projectId],
  );

  return (
    <TaskScopedAgentSessionsTab
      organizationId={organizationId}
      projectId={projectId}
      taskId={taskId}
      taskType={taskType}
      relatedEntities={relatedEntities}
      initiativeId={initiativeId}
      taskName={taskName}
      taskStatus={taskStatus}
      loading={loading}
      emptyMessage={emptyMessage}
      enableFilters={enableFilters}
      sessionList={
        <PaginatedCodingSessionsFeed
          buildSessionPath={buildSessionPath}
          emptyMessage={emptyMessage}
          loading={loading}
          organizationId={organizationId}
          projectId={projectId}
          taskId={taskId}
          onSessionDelete={handleDeleteSession}
        />
      }
      buildSessionPath={buildSessionPath}
      onTaskStatusChange={onTaskStatusChange}
    />
  );
};
