import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  AgentSessionStatus,
  WorkStatus,
  type AgentSessionDto,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorExecutionNodeLaunchConfiguration,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { agentSessionListQueryOptions } from "../../data/collections/agentSessions";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { useAgentSessions, useWorkItem, useWorkItems } from "../../data/hooks";
import { parseTaskMonitorExecutionDefinition } from "./taskMonitorSchema";

const TASK_MONITOR_TYPE = "TASK_MONITOR";
const EXECUTION_DEFINITION_SECTION = "executionDefinition";

export type TaskMonitorProjectedTask =
  { kind: "loaded"; task: WorkItemResponseDto } | { kind: "missing" };

export type TaskMonitorProjectedSession =
  | { kind: "none" }
  | { kind: "loaded"; session: AgentSessionDto }
  | { kind: "missing" };

export type TaskMonitorNodeVisualStatus =
  "idle" | "active" | "blocked" | "completed" | "stopped" | "errored";

export interface TaskMonitorProjectedNode {
  position: number;
  taskId: string;
  dependsOnTaskIds: readonly string[];
  isCursor: boolean;
  task: TaskMonitorProjectedTask;
  session: TaskMonitorProjectedSession;
  visualStatus: TaskMonitorNodeVisualStatus;
  launchConfiguration: TaskMonitorExecutionNodeLaunchConfiguration;
}

export interface UseTaskMonitorProjectionOptions {
  organizationId: string;
  projectId: string;
  monitorId: string;
}

export interface UseTaskMonitorProjectionResult {
  monitor: WorkItemResponseDto | null;
  definition: TaskMonitorExecutionDefinition | null;
  nodes: readonly TaskMonitorProjectedNode[];
  isLoading: boolean;
  isFetched: boolean;
  errorMessage: string | null;
  isSavingLaunchConfiguration: boolean;
  reconcileAfterCommand: () => Promise<void>;
  saveLaunchConfiguration: (
    taskId: string,
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<void>;
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const executionDefinitionContent = (
  monitor: WorkItemResponseDto,
): string | null =>
  monitor.sections?.find(
    (section) => section.key === EXECUTION_DEFINITION_SECTION,
  )?.materializedMarkdown ?? null;

const parseMonitorDefinition = (
  monitor: WorkItemResponseDto,
): TaskMonitorExecutionDefinition => {
  if (monitor.type !== TASK_MONITOR_TYPE) {
    throw new Error("This work item is not a Task Monitor.");
  }
  const content = executionDefinitionContent(monitor);
  if (!content) {
    throw new Error("The Task Monitor has no execution definition.");
  }
  return parseTaskMonitorExecutionDefinition(content);
};

const linkedSessionIds = (
  definition: TaskMonitorExecutionDefinition,
): string[] =>
  unique(
    definition.executionPlan.flatMap((node) =>
      node.agentSessionId ? [node.agentSessionId] : [],
    ),
  );

const taskStatusToVisualStatus = (
  status: WorkStatus,
): TaskMonitorNodeVisualStatus => {
  switch (status) {
    case WorkStatus.Active:
    case WorkStatus.Verifying:
      return "active";
    case WorkStatus.OnHold:
    case WorkStatus.Blocked:
      return "blocked";
    case WorkStatus.Completed:
      return "completed";
    case WorkStatus.Cancelled:
    case WorkStatus.Archived:
    case WorkStatus.Superseded:
      return "stopped";
    case WorkStatus.Generated:
    case WorkStatus.Backlog:
    case WorkStatus.Ready:
    case WorkStatus.Refining:
    case WorkStatus.RefiningDescription:
    case WorkStatus.RefiningDetails:
    case WorkStatus.RefiningAcceptanceCriteria:
    case WorkStatus.GeneratingDescription:
    case WorkStatus.GeneratingDetails:
    case WorkStatus.GeneratingDescriptionAndDetails:
    case WorkStatus.GeneratingAcceptanceCriteria:
    case WorkStatus.GeneratingAll:
      return "idle";
  }
};

const sessionStatusToVisualStatus = (
  status: AgentSessionStatus,
): TaskMonitorNodeVisualStatus => {
  switch (status) {
    case AgentSessionStatus.NotStarted:
      return "idle";
    case AgentSessionStatus.InProgress:
      return "active";
    case AgentSessionStatus.Completed:
      return "completed";
    case AgentSessionStatus.Errored:
      return "errored";
  }
};

const visualStatusFor = (
  task: TaskMonitorProjectedTask,
  session: TaskMonitorProjectedSession,
): TaskMonitorNodeVisualStatus => {
  if (task.kind === "missing" || session.kind === "missing") return "errored";
  if (session.kind === "loaded") {
    return sessionStatusToVisualStatus(session.session.status);
  }
  return taskStatusToVisualStatus(task.task.status);
};

export const useTaskMonitorProjection = ({
  organizationId,
  projectId,
  monitorId,
}: UseTaskMonitorProjectionOptions): UseTaskMonitorProjectionResult => {
  const enabled = Boolean(organizationId && projectId && monitorId);
  const monitorQuery = useWorkItem(organizationId, "task", monitorId, {
    projectId,
    enabled,
  });
  const queryClient = useQueryClient();
  const [isSavingLaunchConfiguration, setIsSavingLaunchConfiguration] =
    useState(false);

  const parsed = useMemo(() => {
    const monitor = monitorQuery.workItem;
    if (!monitor) return { definition: null, errorMessage: null };
    try {
      return {
        definition: parseMonitorDefinition(monitor),
        errorMessage: null,
      };
    } catch (error) {
      return {
        definition: null,
        errorMessage:
          error instanceof Error
            ? error.message
            : "The execution definition could not be read.",
      };
    }
  }, [monitorQuery.workItem]);

  const taskIds = useMemo(
    () =>
      unique(parsed.definition?.executionPlan.map((node) => node.taskId) ?? []),
    [parsed.definition],
  );
  const sessionIds = useMemo(
    () => (parsed.definition ? linkedSessionIds(parsed.definition) : []),
    [parsed.definition],
  );
  const tasksQuery = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      taskIds,
      enabled: enabled && taskIds.length > 0 && !parsed.errorMessage,
    },
  );
  const sessionsQuery = useAgentSessions(organizationId, projectId, {
    ids: sessionIds,
    enabled: enabled && sessionIds.length > 0 && !parsed.errorMessage,
  });

  const nodes = useMemo<readonly TaskMonitorProjectedNode[]>(() => {
    const tasksById = new Map(
      tasksQuery.workItems.map((task) => [task.id, task]),
    );
    const sessionsById = new Map(
      sessionsQuery.agentSessions.map((session) => [session.id, session]),
    );
    return (parsed.definition?.executionPlan ?? []).map((node, position) => {
      const canonicalTask = tasksById.get(node.taskId);
      const task: TaskMonitorProjectedTask = canonicalTask
        ? { kind: "loaded", task: canonicalTask }
        : { kind: "missing" };
      const canonicalSession = node.agentSessionId
        ? sessionsById.get(node.agentSessionId)
        : null;
      const session: TaskMonitorProjectedSession = !node.agentSessionId
        ? { kind: "none" }
        : canonicalSession
          ? { kind: "loaded", session: canonicalSession }
          : { kind: "missing" };
      return {
        position,
        taskId: node.taskId,
        dependsOnTaskIds: node.dependsOnTaskIds,
        isCursor: position === parsed.definition?.cursor,
        task,
        session,
        visualStatus: visualStatusFor(task, session),
        launchConfiguration: node.launchConfiguration,
      };
    });
  }, [parsed.definition, sessionsQuery.agentSessions, tasksQuery.workItems]);

  const tasksRequired = Boolean(parsed.definition && taskIds.length > 0);
  const sessionsRequired = Boolean(parsed.definition && sessionIds.length > 0);
  const loadError =
    monitorQuery.error ?? tasksQuery.error ?? sessionsQuery.error;
  const reconcileAfterCommand = useCallback(async (): Promise<void> => {
    const refreshedMonitor = await monitorQuery.refetch();
    if (!refreshedMonitor) {
      throw new Error("The canonical Task Monitor could not be refreshed.");
    }

    const refreshedDefinition = parseMonitorDefinition(refreshedMonitor);
    const refreshedSessionIds = linkedSessionIds(refreshedDefinition);
    if (refreshedSessionIds.length === 0) return;

    // A fresh read even when cached: the command may have changed sessions.
    await queryClient.fetchQuery({
      ...agentSessionListQueryOptions(organizationId, projectId, {
        ids: refreshedSessionIds,
      }),
      staleTime: 0,
    });
  }, [monitorQuery, organizationId, projectId, queryClient]);
  const saveLaunchConfiguration = useCallback(
    async (
      taskId: string,
      configuration: TaskMonitorExecutionNodeLaunchConfiguration,
    ): Promise<void> => {
      if (!parsed.definition || isSavingLaunchConfiguration) {
        throw new Error(
          "The Task Monitor launch configuration is unavailable.",
        );
      }
      setIsSavingLaunchConfiguration(true);
      try {
        await unifiedApiClient.updateTask({
          organizationId,
          projectId,
          taskId: monitorId,
          updateTaskDto: {
            sections: [
              {
                key: EXECUTION_DEFINITION_SECTION,
                content: {
                  ...parsed.definition,
                  executionPlan: parsed.definition.executionPlan.map((node) =>
                    node.taskId === taskId
                      ? { ...node, launchConfiguration: configuration }
                      : node,
                  ),
                },
              },
            ],
          },
        });
        await monitorQuery.refetch();
      } finally {
        setIsSavingLaunchConfiguration(false);
      }
    },
    [
      isSavingLaunchConfiguration,
      monitorId,
      monitorQuery,
      organizationId,
      parsed.definition,
      projectId,
    ],
  );
  return {
    monitor: monitorQuery.workItem,
    definition: parsed.definition,
    nodes,
    isLoading:
      enabled &&
      (monitorQuery.isLoading ||
        (tasksRequired && tasksQuery.isLoading) ||
        (sessionsRequired && sessionsQuery.isLoading)),
    isFetched:
      !enabled ||
      (monitorQuery.isFetched &&
        (!tasksRequired || tasksQuery.isFetched) &&
        (!sessionsRequired || sessionsQuery.isFetched)),
    errorMessage:
      parsed.errorMessage ??
      (loadError ? "Unable to load the Task Monitor execution data." : null),
    isSavingLaunchConfiguration,
    reconcileAfterCommand,
    saveLaunchConfiguration,
  };
};
