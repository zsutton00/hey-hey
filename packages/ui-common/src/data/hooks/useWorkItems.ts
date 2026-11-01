import { useFutureOffers } from "../futureOffers/FutureOfferContext";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  type CreateInitiativeDto,
  type AgentEdgeEndpointEntityType,
  type AgentEdgeType,
  type CreateTaskDto,
  type InitiativeResponseDto,
  Priority,
  type ProposalResponseDto,
  type TaskSortBy,
  type TaskSortDir,
  TaskSource,
  type TaskResponseDto,
  type UpdateInitiativeDto,
  type UpdateTaskDto,
  UpdateTaskResultStatus,
  WorkStatus,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  FEATURE_TASK_TYPE,
  STANDARD_TASK_TYPE,
} from "../../constants/taskTypes";
import { applyTaskSectionInputsToMaterialized } from "../../utils/workItemSections";
import type { WorkItemSectionSelection } from "../../utils/workItemSections";
import type { WorkItemResponseDto } from "../collections/workItems";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
  MutationCallbacks,
} from "../core/types";
import { useDeepCompareCallback } from "../core/useDeepCompareCallback";
import {
  findCachedWorkItem,
  invalidateWorkItemParents,
  removeWorkItem,
  restoreWorkItemCaches,
  snapshotWorkItemCaches,
  updateWorkItemLists,
  workItemListQueryOptions,
  writeWorkItem,
  type WorkItemCacheSnapshot,
  type WorkItemListParams,
} from "../collections/workItemLists";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useRelationshipMutationInvalidation } from "./relationshipMutationInvalidation";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export const ENTITY_TYPE = "Task";

export interface UpdateTaskMutationCallbacks extends MutationCallbacks<TaskResponseDto> {
  authoritativeTask?: TaskResponseDto;
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
  status?: WorkStatus | WorkStatus[];
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
  const queryClient = useQueryClient();
  const futureOffers = useFutureOffers();

  const isEnabled = enabledOption !== false && !!organizationId;
  // Array params are joined so the memoised options follow their contents.
  const statusKey = status === undefined ? "" : [status].flat().join(",");
  const sectionKey = normalizedSectionKeys?.join(",") ?? "";
  const edgeTypesKey = edgeTypes?.join(",") ?? "";
  const parentTaskIdsKey = parentTaskIds?.join(",") ?? "";
  const taskIdsKey = taskIds?.join(",") ?? "";
  const listOptions = useMemo(() => {
    const split = <T extends string>(value: string) =>
      value ? (value.split(",") as T[]) : undefined;
    const params: WorkItemListParams = {
      taskType,
      initiativeId,
      parentTaskId,
      parentTaskIds: split(parentTaskIdsKey),
      status: split<WorkStatus>(statusKey),
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
    return workItemListQueryOptions(organizationId, projectId, params);
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
  const { result, state: query } = useDataLayerQuery(listOptions, {
    enabled: isEnabled,
    refetchOnMount: collectionOptions.refetchOnMount,
    refetchOnWindowFocus: collectionOptions.refetchOnWindowFocus,
    staleTimeMs: collectionOptions.staleTimeMs,
    maxCacheAgeMs: collectionOptions.maxCacheAgeMs,
  });
  const data = result.data ?? null;

  const snapshot = useCallback(
    (taskId?: string): WorkItemCacheSnapshot =>
      snapshotWorkItemCaches(queryClient, organizationId, projectId, taskId),
    [queryClient, organizationId, projectId],
  );
  const restore = useCallback(
    (cacheSnapshot: WorkItemCacheSnapshot) =>
      restoreWorkItemCaches(queryClient, cacheSnapshot),
    [queryClient],
  );

  // Create task function with optimistic updates
  const createTask = useCallback(
    async (
      newTask: CreateTaskDto,
      callbacks?: MutationCallbacks<TaskResponseDto>,
    ): Promise<TaskResponseDto> => {
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const { sections: sectionInputs, ...rest } = newTask;
      const now = new Date().toISOString();
      const optimisticDto: WorkItemResponseDto = {
        id: tempId,
        ...rest,
        type: newTask.type ?? STANDARD_TASK_TYPE,
        sections: applyTaskSectionInputsToMaterialized(
          undefined,
          sectionInputs,
        ),
        organizationId,
        projectId,
        status: newTask.status || WorkStatus.Backlog,
        source: newTask.source || TaskSource.System,
        priority: newTask.priority || Priority.Medium,
        createdAt: now,
        updatedAt: now,
      };

      const cacheSnapshot = snapshot();
      queryClient.setQueryData<WorkItemResponseDto[]>(
        listOptions.queryKey,
        (items) => (items ? [...items, optimisticDto] : items),
      );

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

        updateWorkItemLists(queryClient, organizationId, projectId, (items) =>
          items.map((item) => (item.id === tempId ? createdData : item)),
        );

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
        restore(cacheSnapshot);

        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [
      invalidateRelationships,
      listOptions.queryKey,
      organizationId,
      projectId,
      queryClient,
      restore,
      snapshot,
    ],
  );

  // Update task function
  const updateTask = useCallback(
    async (
      id: string,
      updates: UpdateTaskDto,
      callbacks?: UpdateTaskMutationCallbacks,
    ): Promise<TaskResponseDto> => {
      const currentTask =
        callbacks?.authoritativeTask ??
        findCachedWorkItem(queryClient, organizationId, projectId, id);

      if (!currentTask) {
        throw new Error(`Task ${id} not found in collection state`);
      }

      if (!organizationId) {
        throw new Error("Organization ID is required to update tasks");
      }

      const now = new Date().toISOString();
      const isParentChange =
        updates.parentTaskId !== undefined &&
        updates.parentTaskId !== currentTask.parentTaskId;
      // The moved item's own hierarchy holds its parent too.
      const invalidateParents = () =>
        isParentChange
          ? void invalidateWorkItemParents(
              queryClient,
              organizationId,
              projectId,
              [currentTask.parentTaskId, updates.parentTaskId, id],
            )
          : undefined;

      const { sections: sectionUpdates, ...restUpdates } = updates;
      const optimisticTask: WorkItemResponseDto = {
        ...currentTask,
        ...restUpdates,
        sections: applyTaskSectionInputsToMaterialized(
          currentTask.sections,
          sectionUpdates,
          callbacks?.sectionSelection,
        ),
        dueDate: updates.dueDate ?? currentTask.dueDate,
        assigneeId: updates.assigneeId ?? currentTask.assigneeId,
        parentTaskId:
          updates.parentTaskId !== undefined
            ? (updates.parentTaskId ?? undefined)
            : currentTask.parentTaskId,
        updatedAt: now,
      };

      const cacheSnapshot = snapshot(id);
      writeWorkItem(queryClient, organizationId, projectId, optimisticTask);
      invalidateParents();

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

        if (isPending) {
          // Server staged the PATCH behind a proposal — drop the optimistic
          // mutation; the unchanged entity it returned is written below.
          restore(cacheSnapshot);
          invalidateParents();
        }
        writeWorkItem(queryClient, organizationId, projectId, serverTask);

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
        restore(cacheSnapshot);
        // Re-read the parents' lists so they show the original placement.
        invalidateParents();

        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [
      invalidateRelationships,
      futureOffers,
      organizationId,
      projectId,
      queryClient,
      restore,
      snapshot,
    ],
  );

  // Remove function
  const remove = useCallback(
    async (id: string, callbacks?: MutationCallbacks<void>): Promise<void> => {
      const itemToDelete = findCachedWorkItem(
        queryClient,
        organizationId,
        projectId,
        id,
      );

      if (!itemToDelete) {
        throw new Error(`Work item ${id} not found`);
      }

      const cacheSnapshot = snapshot(id);
      removeWorkItem(queryClient, organizationId, projectId, id);

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
        restore(cacheSnapshot);

        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [
      invalidateRelationships,
      organizationId,
      projectId,
      queryClient,
      restore,
      snapshot,
    ],
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
