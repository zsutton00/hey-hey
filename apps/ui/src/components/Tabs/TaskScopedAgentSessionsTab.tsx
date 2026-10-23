import type {
  ContextRelatedEntityDto,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import { AgentSessionType, EntityType } from "@hey-hey/ui-common/api";
import {
  useAgentSessions,
  useCreateAgentSession,
} from "@hey-hey/ui-common/data";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { TaskScopedAgentSessionsTabView } from "./TaskScopedAgentSessionsTabView";
import {
  cancelTaskSessionLaunch,
  continueTaskSessionLaunch,
  startTaskSessionLaunch,
  type TaskSessionLaunchState,
} from "./taskCodingSessionLaunchPreflight";

interface TaskScopedAgentSessionsTabProps {
  organizationId: string;
  projectId: string;
  taskId: string;
  taskType: string;
  relatedEntities?: readonly ContextRelatedEntityDto[];
  initiativeId?: string;
  taskName?: string;
  taskStatus?: WorkStatus;
  loading?: boolean;
  emptyMessage?: string;
  enableFilters?: boolean;
  sessionList?: React.ReactNode;
  buildSessionPath: (agentSessionId: string) => string;
  onTaskStatusChange?: (newStatus: WorkStatus) => Promise<void>;
}

export const TaskScopedAgentSessionsTab: React.FC<
  TaskScopedAgentSessionsTabProps
> = ({
  organizationId,
  projectId,
  taskId,
  taskType,
  relatedEntities = [],
  taskName,
  taskStatus,
  loading = false,
  emptyMessage,
  enableFilters = false,
  sessionList,
  buildSessionPath,
  onTaskStatusChange,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("created-desc");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isUpdatingTaskStatus, setIsUpdatingTaskStatus] = useState(false);
  const [launchState, setLaunchState] = useState<TaskSessionLaunchState>({
    kind: "idle",
  });
  const [error, setError] = useState<string | null>(null);

  const { agentSessions, isLoading, remove } = useAgentSessions(
    organizationId,
    projectId,
    {
      entityType: EntityType.Task,
      entityId: taskId,
      type: AgentSessionType.Coding,
      enabled: sessionList === undefined,
    },
  );
  const createAgentSessionMutation = useCreateAgentSession();

  const isLoadingState = isLoading || loading;

  const handleDelete = useCallback(
    (sessionId: string) => {
      return async () => {
        try {
          await remove(sessionId, {
            onError: (deleteError: Error) => {
              console.error("Failed to delete coding session:", deleteError);
            },
          });
        } catch (deleteError) {
          console.error("Delete failed:", deleteError);
        }
      };
    },
    [remove],
  );

  const filteredAndSortedSessions = useMemo(() => {
    const sessions = agentSessions ?? [];
    let filtered = [...sessions];

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter((session) => {
        const title = session.title?.toLowerCase() || "";
        const sessionId = session.id?.toLowerCase() || "";
        return title.includes(searchLower) || sessionId.includes(searchLower);
      });
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case "created-asc": {
          const aTime = new Date(a.sessionDate).getTime();
          const bTime = new Date(b.sessionDate).getTime();
          return aTime - bTime;
        }
        case "created-desc": {
          const aTime = new Date(a.sessionDate).getTime();
          const bTime = new Date(b.sessionDate).getTime();
          return bTime - aTime;
        }
        case "name-asc": {
          const aName = a.title || "";
          const bName = b.title || "";
          return aName.localeCompare(bName);
        }
        case "name-desc": {
          const aName = a.title || "";
          const bName = b.title || "";
          return bName.localeCompare(aName);
        }
        default: {
          const aTime = new Date(a.sessionDate).getTime();
          const bTime = new Date(b.sessionDate).getTime();
          return bTime - aTime;
        }
      }
    });

    return filtered;
  }, [agentSessions, searchTerm, sortBy]);

  const navigateToSession = useCallback(
    (agentSessionId: string): void => {
      navigate(buildSessionPath(agentSessionId));
    },
    [buildSessionPath, navigate],
  );

  const handleCreateNewSession = useCallback(async (): Promise<void> => {
    if (!organizationId || !projectId || !taskId) {
      return;
    }

    setIsCreatingNew(true);
    setError(null);
    try {
      const session = await createAgentSessionMutation.mutate({
        organizationId,
        agentSession: {
          projectId,
          sessionDate: new Date().toISOString(),
          title: taskName || undefined,
          entityType: EntityType.Task,
          entityId: taskId,
          type: AgentSessionType.Coding,
        },
      });
      navigateToSession(session.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t(
              "codingSessions.errorStartSession",
              "Failed to start coding session.",
            ),
      );
    } finally {
      setIsCreatingNew(false);
      setLaunchState(cancelTaskSessionLaunch());
    }
  }, [
    createAgentSessionMutation,
    navigateToSession,
    organizationId,
    projectId,
    taskId,
    taskName,
    t,
  ]);

  const applyLaunchState = useCallback(
    (nextState: TaskSessionLaunchState): void => {
      setLaunchState(nextState);
      if (nextState.kind === "creating") {
        void handleCreateNewSession();
      }
    },
    [handleCreateNewSession],
  );

  const taskNeedsActivation =
    taskStatus === "BACKLOG" && Boolean(onTaskStatusChange);

  const handleStartNewSessionClick = useCallback((): void => {
    setError(null);
    applyLaunchState(
      startTaskSessionLaunch({
        relatedEntities,
        taskNeedsActivation,
        taskType,
      }),
    );
  }, [applyLaunchState, relatedEntities, taskNeedsActivation, taskType]);

  const handleContinueDependencyWarning = useCallback((): void => {
    applyLaunchState(
      continueTaskSessionLaunch(launchState, taskNeedsActivation),
    );
  }, [applyLaunchState, launchState, taskNeedsActivation]);

  const handleCancelDependencyWarning = useCallback((): void => {
    setLaunchState(cancelTaskSessionLaunch());
  }, []);

  const handleConfirmBacklogDialog = useCallback((): void => {
    void (async () => {
      if (!onTaskStatusChange) {
        setLaunchState({ kind: "creating" });
        await handleCreateNewSession();
        return;
      }

      setIsUpdatingTaskStatus(true);
      setError(null);

      try {
        await onTaskStatusChange("ACTIVE");
        setLaunchState({ kind: "creating" });
        await handleCreateNewSession();
      } catch (statusError) {
        setError(
          statusError instanceof Error
            ? statusError.message
            : t(
                "codingSessions.errorUpdateTaskStatus",
                "Failed to update task status.",
              ),
        );
      } finally {
        setIsUpdatingTaskStatus(false);
      }
    })();
  }, [handleCreateNewSession, onTaskStatusChange, t]);

  const handleCancelBacklogDialog = useCallback((): void => {
    if (!isUpdatingTaskStatus) {
      setLaunchState(cancelTaskSessionLaunch());
    }
  }, [isUpdatingTaskStatus]);

  const unfinishedDependencies =
    launchState.kind === "dependencyWarning" ? launchState.dependencies : [];

  return (
    <TaskScopedAgentSessionsTabView
      organizationId={organizationId}
      projectId={projectId}
      taskId={taskId}
      sessionList={sessionList}
      sessions={filteredAndSortedSessions}
      isLoading={isLoadingState}
      emptyMessage={emptyMessage}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      sortBy={sortBy}
      onSortByChange={setSortBy}
      enableFilters={enableFilters}
      isCreatingNew={isCreatingNew || launchState.kind === "creating"}
      isUpdatingTaskStatus={isUpdatingTaskStatus}
      unfinishedDependencies={unfinishedDependencies}
      isBacklogDialogOpen={launchState.kind === "inactiveTaskCheck"}
      error={error}
      onStartNewSession={handleStartNewSessionClick}
      onContinueDependencyWarning={handleContinueDependencyWarning}
      onCancelDependencyWarning={handleCancelDependencyWarning}
      onConfirmBacklogDialog={handleConfirmBacklogDialog}
      onCancelBacklogDialog={handleCancelBacklogDialog}
      buildSessionPath={buildSessionPath}
      onDeleteSession={handleDelete}
    />
  );
};
