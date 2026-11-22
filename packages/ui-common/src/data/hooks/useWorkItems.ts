import { useFutureOffers } from "../futureOffers/FutureOfferContext";
import { useApolloClient } from "@apollo/client/react";
import { useCallback, useMemo } from "react";
import {
  type CreateInitiativeDto,
  type AgentEdgeEndpointEntityType,
  type AgentEdgeType,
  type CreateTaskDto,
  type InitiativeResponseDto,
  type ProposalResponseDto,
  type TaskSortBy,
  type TaskSortDir,
  type TaskResponseDto,
  type UpdateInitiativeDto,
  type UpdateTaskDto,
  UpdateTaskResultStatus,
  WorkStatus,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { FEATURE_TASK_TYPE } from "../../constants/taskTypes";
import type { WorkItemSectionSelection } from "../../utils/workItemSections";
import type { WorkItemResponseDto } from "../collections/workItems";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
  MutationCallbacks,
} from "../core/types";
import { useDeepCompareCallback } from "../core/useDeepCompareCallback";
import {
  workItemListRead,
  type WorkItemListParams,
} from "../collections/workItemLists";
import { readCachedWorkItem } from "../graphql/workItemCache";
import { useGraphQLRead } from "../graphql/useGraphQLRead";
import { useRelationshipMutationInvalidation } from "./relationshipMutationInvalidation";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export const ENTITY_TYPE = "Task";

export interface UpdateTaskMutationCallbacks extends MutationCallbacks<TaskResponseDto> {
  /** @deprecated Writes reach views through the server's change event, not an optimistic copy. */
  authoritativeTask?: TaskResponseDto;
  /** @deprecated Writes reach views through the server's change event, not an optimistic copy. */
  sectionSelection?: WorkItemSectionSelection;
  /**
   * Fired when the server staged the PATCH behind a pending proposal instead
   * of applying it immediately. Carries the proposal awaiting review and the
   * unchanged task state the server returned alongside it.
   */
  onPendingProposal?: (
    proposal: ProposalResponseDto,
    task: TaskResponseDto,
  ) => void;
}

export interface WorkItemHookOptions extends CollectionHookOptions<WorkItemResponseDto> {
  parentTaskId?: string | null;
  parentTaskIds?: string[];
  includeSectionKeys?: string[];
  includeServiceRelations?: boolean;
  includeEdges?: boolean;
  edgeTypes?: AgentEdgeType[];
  includeDescendants?: boolean;
  includeTrackedEntities?: boolean;
  /** Request the compact GOAL tracked-work aggregate; independent of snapshots. */
  includeTrackedWorkSummary?: boolean;
  status?: TaskResponseDto["status"] | TaskResponseDto["status"][];
  taskIds?: string[];
  websocketsEnabled?: boolean;
  taskType?: string;
  relatedEntityId?: string;
  relatedEntityType?: AgentEdgeEndpointEntityType;
  /** @deprecated Still supported for initiative-scoped views during transition */
  initiativeId?: string;
  page?: number;
  limit?: number;
  sortBy?: TaskSortBy;
  sortDir?: TaskSortDir;
}

export interface UseWorkItemsReturn extends Omit<
  DataCollectionHookReturn<WorkItemResponseDto>,
  "data"
> {
  workItems: WorkItemResponseDto[];
  createTask: (
    newTask: CreateTaskDto,
    callbacks?: MutationCallbacks<TaskResponseDto>,
  ) => Promise<TaskResponseDto>;
  /** @deprecated Initiatives removed. Creates a feature task instead. */
  createInitiative: (
    newInitiative: CreateInitiativeDto,
    callbacks?: MutationCallbacks<InitiativeResponseDto>,
  ) => Promise<InitiativeResponseDto>;
  updateTask: (
    id: string,
    updates: UpdateTaskDto,
    callbacks?: UpdateTaskMutationCallbacks,
  ) => Promise<TaskResponseDto>;
  /** @deprecated Initiatives removed. Updates a task instead. */
  updateInitiative: (
    id: string,
    updates: UpdateInitiativeDto,
    callbacks?: MutationCallbacks<InitiativeResponseDto>,
  ) => Promise<InitiativeResponseDto>;
  remove: (id: string, callbacks?: MutationCallbacks<void>) => Promise<void>;
}

const normalizeSectionKeys = (keys?: string[]): string[] | undefined => {
  if (!keys?.length) {
    return undefined;
  }

  return [...new Set(keys)].filter((key) => key.length > 0);
};

/**
 * Hook for managing work items (tasks).
 * The entityType and conversationId parameters are accepted for backward
 * compatibility but only tasks are supported (initiatives have been removed).
 */
export function useWorkItems(
  organizationId: string,
  _entityType: "initiative" | "task",
  projectId: string,
  _conversationId?: string,
  options: WorkItemHookOptions = {},
): UseWorkItemsReturn {
  const {
    parentTaskId,
    parentTaskIds,
    initiativeId,
    includeSectionKeys,
    includeServiceRelations,
    includeEdges,
    edgeTypes,
    includeDescendants,
    includeTrackedEntities,
    includeTrackedWorkSummary,
    status,
    taskIds,
    taskType,
    relatedEntityId,
    relatedEntityType,
    page,
    limit,
    sortBy,
    sortDir,
    enabled: enabledOption,
    websocketsEnabled = true,
    ...collectionOptions
  } = options;

  const normalizedSectionKeys = normalizeSectionKeys(includeSectionKeys);
  const invalidateRelationships = useRelationshipMutationInvalidation();
  const graphqlClient = useApolloClient();
  const futureOffers = useFutureOffers();

  // The endpoint is project-scoped, so a read needs the project.
  const isEnabled = enabledOption !== false && !!organizationId && !!projectId;
  // Array params are joined so the memoised options follow their contents.
  // Status names may contain commas, so their key is JSON rather than a join.
  const statusKey = status === undefined ? "" : JSON.stringify([status].flat());
  const sectionKey = normalizedSectionKeys?.join(",") ?? "";
  const edgeTypesKey = edgeTypes?.join(",") ?? "";
  const parentTaskIdsKey = parentTaskIds?.join(",") ?? "";
  const taskIdsKey = taskIds?.join(",") ?? "";
  const spec = useMemo(() => {
    const split = <T extends string>(value: string) =>
      value ? (value.split(",") as T[]) : undefined;
    const params: WorkItemListParams = {
      taskType,
      initiativeId,
      parentTaskId,
      parentTaskIds: split(parentTaskIdsKey),
      status: statusKey
        ? (JSON.parse(statusKey) as TaskResponseDto["status"][])
        : undefined,
      taskIds: split(taskIdsKey),
      includeSectionKeys: split(sectionKey),
      includeServiceRelations,
      includeEdges,
      edgeTypes: split<AgentEdgeType>(edgeTypesKey),
      includeDescendants,
      includeTrackedEntities,
      includeTrackedWorkSummary,
      relatedEntityId,
      relatedEntityType,
      page,
      limit,
      sortBy,
      sortDir,
    };
    return workItemListRead({ organizationId, projectId }, params);
  }, [
    organizationId,
    projectId,
    taskType,
    initiativeId,
    parentTaskId,
    parentTaskIdsKey,
    statusKey,
    taskIdsKey,
    sectionKey,
    includeServiceRelations,
    includeEdges,
    edgeTypesKey,
    includeDescendants,
    includeTrackedEntities,
    includeTrackedWorkSummary,
    relatedEntityId,
    relatedEntityType,
    page,
    limit,
    sortBy,
    sortDir,
  ]);
  const { data, ...query } = useGraphQLRead(spec, {
    enabled: isEnabled,
    refetchOnMount: collectionOptions.refetchOnMount,
    refetchOnWindowFocus: collectionOptions.refetchOnWindowFocus,
    staleTimeMs: collectionOptions.staleTimeMs,
  });

  // Writes go to the server; every view of the item, this one included,
  // updates when the server's change event refreshes the shared record.
  const createTask = useCallback(
    async (
      newTask: CreateTaskDto,
      callbacks?: MutationCallbacks<TaskResponseDto>,
    ): Promise<TaskResponseDto> => {
      try {
        const response = await unifiedApiClient.createTask({
          organizationId,
          projectId,
          createTaskDto: newTask,
        });
        const createdData = response.data.data;

        if (!createdData) {
          throw new Error("No data returned from create task");
        }

        invalidateRelationships({
          entityType: ENTITY_TYPE,
          operation: "create",
          sourceEntity: createdData,
          organizationId,
          projectId,
        });
        callbacks?.onSuccess?.(createdData);
        return createdData;
      } catch (error) {
        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [invalidateRelationships, organizationId, projectId],
  );

  const updateTask = useCallback(
    async (
      id: string,
      updates: UpdateTaskDto,
      callbacks?: UpdateTaskMutationCallbacks,
    ): Promise<TaskResponseDto> => {
      if (!organizationId) {
        throw new Error("Organization ID is required to update tasks");
      }

      try {
        const response = await unifiedApiClient.updateTask({
          organizationId,
          projectId,
          taskId: id,
          updateTaskDto: updates,
        });

        const updatedData = response.data.data;

        if (!updatedData) {
          throw new Error("Update response data is missing");
        }

        const serverTask = updatedData.task;
        const isPending = updatedData.status === UpdateTaskResultStatus.Pending;

        if (!isPending) {
          invalidateRelationships({
            entityType: ENTITY_TYPE,
            operation: "update",
            sourceEntity: serverTask,
            organizationId,
            projectId,
          });
        }

        if (isPending && updatedData.proposal) {
          callbacks?.onPendingProposal?.(updatedData.proposal, serverTask);
        }

        if (
          !isPending &&
          (updates.status === WorkStatus.Verifying ||
            updates.status === WorkStatus.Completed) &&
          serverTask.status === updates.status
        ) {
          futureOffers?.checkTask(id);
        }
        callbacks?.onSuccess?.(serverTask);
        return serverTask;
      } catch (error) {
        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [invalidateRelationships, futureOffers, organizationId, projectId],
  );

  const remove = useCallback(
    async (id: string, callbacks?: MutationCallbacks<void>): Promise<void> => {
      const itemToDelete = readCachedWorkItem(
        graphqlClient,
        { organizationId, projectId },
        id,
      );

      if (!itemToDelete) {
        throw new Error(`Work item ${id} not found`);
      }

      try {
        await unifiedApiClient.removeTask({
          organizationId,
          projectId,
          taskId: id,
        });
        invalidateRelationships({
          entityType: ENTITY_TYPE,
          operation: "delete",
          sourceEntity: itemToDelete,
          organizationId,
          projectId,
        });
        callbacks?.onSuccess?.();
      } catch (error) {
        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [graphqlClient, invalidateRelationships, organizationId, projectId],
  );

  useWebsocketSubscriptions(
    {
      projectIds: projectId ? [projectId] : [],
      initiativeIds: [],
    },
    {
      enabled: websocketsEnabled && (enabledOption ?? true),
    },
  );

  const { refetch, markStale } = query;

  // Backward-compat shims: initiatives are now tasks
  const createInitiative = useDeepCompareCallback(
    async (
      newInitiative: CreateInitiativeDto,
      callbacks?: MutationCallbacks<InitiativeResponseDto>,
    ): Promise<InitiativeResponseDto> => {
      const taskDto: CreateTaskDto = {
        name: newInitiative.name ?? "",
        sections:
          newInitiative.sections as unknown as CreateTaskDto["sections"],
        status: newInitiative.status,
        priority: newInitiative.priority,
        type: FEATURE_TASK_TYPE,
      };
      const result = await createTask(
        taskDto,
        callbacks as unknown as MutationCallbacks<TaskResponseDto>,
      );
      return result as unknown as InitiativeResponseDto;
    },
    [createTask],
  );

  const updateInitiative = useCallback(
    async (
      id: string,
      updates: UpdateInitiativeDto,
      callbacks?: MutationCallbacks<InitiativeResponseDto>,
    ): Promise<InitiativeResponseDto> => {
      const taskUpdates: UpdateTaskDto = {
        name: updates.name,
        sections: updates.sections as unknown as UpdateTaskDto["sections"],
        status: updates.status,
        priority: updates.priority,
        assigneeId: updates.assigneeId,
        dueDate: updates.dueDate,
      };
      const result = await updateTask(
        id,
        taskUpdates,
        callbacks as unknown as MutationCallbacks<TaskResponseDto>,
      );
      return result as unknown as InitiativeResponseDto;
    },
    [updateTask],
  );

  return {
    workItems: data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isReady: query.isFetched && !query.error,
    error: query.error,
    isStale: query.isStale,
    createTask,
    createInitiative,
    updateTask,
    updateInitiative,
    remove,
    refetch,
    markStale,
  };
}
