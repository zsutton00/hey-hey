import {
  queryOptions,
  type InvalidateQueryFilters,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import {
  type AgentEdgeEndpointEntityType,
  type AgentEdgeType,
  type TaskHierarchyResponseDto,
  type TaskResponseDto,
  type TaskSortBy,
  type TaskSortDir,
  WorkStatus,
} from "../../api";
import { tasksClient, unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type { CollectionInvalidator } from "../relationships/invalidator";
import type { WorkItemResponseDto } from "./workItems";

/** Every server list shape of `GET /tasks` within one project. */
export interface WorkItemListParams {
  taskType?: string;
  /** @deprecated Still supported for initiative-scoped views during transition */
  initiativeId?: string;
  /** `undefined` = no parent filter; `null` = only items without a parent. */
  parentTaskId?: string | null;
  parentTaskIds?: string[];
  status?: WorkStatus[];
  taskIds?: string[];
  includeSectionKeys?: string[];
  includeServiceRelations?: boolean;
  includeEdges?: boolean;
  edgeTypes?: AgentEdgeType[];
  includeDescendants?: boolean;
  includeTrackedEntities?: boolean;
  /** Request the compact GOAL tracked-work aggregate; independent of snapshots. */
  includeTrackedWorkSummary?: boolean;
  relatedEntityId?: string;
  relatedEntityType?: AgentEdgeEndpointEntityType;
  page?: number;
  limit?: number;
  sortBy?: TaskSortBy;
  sortDir?: TaskSortDir;
}

/** Response variants of a single work item; each is its own cache entry. */
export interface WorkItemDetailVariant {
  includeServiceRelations?: boolean;
  includeEdges?: boolean;
  edgeTypes?: AgentEdgeType[];
}

export interface WorkItemHierarchyVariant {
  includeDesignDocCounts?: boolean;
  includeAgentSessionCounts?: boolean;
}

/**
 * Prefix tree for every work-item read. A work-item change in a project
 * invalidates `project(organizationId, projectId)`. Single-item reads made
 * without a project sit under the `""` project.
 */
export const workItemKeys = {
  root: () => ["workItems"] as const,
  all: (organizationId: string) => ["workItems", organizationId] as const,
  project: (organizationId: string, projectId: string) =>
    [...workItemKeys.all(organizationId), projectId] as const,
  lists: (organizationId: string, projectId: string) =>
    [...workItemKeys.project(organizationId, projectId), "list"] as const,
  list: (organizationId: string, projectId: string, params: WorkItemListParams) =>
    [
      ...workItemKeys.lists(organizationId, projectId),
      normalizeWorkItemListParams(params),
    ] as const,
  details: (organizationId: string, projectId: string) =>
    [...workItemKeys.project(organizationId, projectId), "detail"] as const,
  detail: (
    organizationId: string,
    projectId: string,
    taskId: string,
    variant: WorkItemDetailVariant = {}
  ) =>
    [
      ...workItemKeys.details(organizationId, projectId),
      taskId,
      normalizeDetailVariant(variant),
    ] as const,
  hierarchies: (organizationId: string, projectId: string) =>
    [...workItemKeys.project(organizationId, projectId), "hierarchy"] as const,
  hierarchy: (
    organizationId: string,
    projectId: string,
    taskId: string,
    variant: WorkItemHierarchyVariant = {}
  ) =>
    [
      ...workItemKeys.hierarchies(organizationId, projectId),
      taskId,
      normalizeHierarchyVariant(variant),
    ] as const,
};

/** Key positions: [root, org, project, kind, (params | taskId), variant]. */
const KEY_KIND_INDEX = 3;
const KEY_TASK_ID_INDEX = 4;

const sortedUnique = <T extends string>(values: T[] | undefined) =>
  values?.length ? [...new Set(values)].sort() : null;

/**
 * Statuses an unfiltered list may omit (archived and superseded items are
 * only returned on request), so a filter naming them stays server-side.
 */
const SERVER_ONLY_STATUSES: readonly WorkStatus[] = [
  WorkStatus.Archived,
  WorkStatus.Superseded,
];

/**
 * A status filter over a complete list returns the same rows as the server
 * filter, so it is applied as a `select` over the shared unfiltered entry.
 * Paged or limited reads are not complete lists and keep the server filter.
 */
function statusAsSelect(params: WorkItemListParams): WorkStatus[] | null {
  const status = sortedUnique(params.status);
  if (!status) return null;
  if (params.page !== undefined || params.limit !== undefined) return null;
  if (status.some((value) => SERVER_ONLY_STATUSES.includes(value))) return null;
  return status;
}

function normalizeWorkItemListParams(params: WorkItemListParams) {
  return {
    taskType: params.taskType ?? null,
    initiativeId: params.initiativeId ?? null,
    // undefined (no filter) and null (root items only) are different reads.
    parentTaskId:
      params.parentTaskId === undefined
        ? null
        : params.parentTaskId === null
          ? "null"
          : params.parentTaskId,
    parentTaskIds: sortedUnique(params.parentTaskIds),
    status: statusAsSelect(params) ? null : sortedUnique(params.status),
    taskIds: sortedUnique(params.taskIds),
    includeSectionKeys: sortedUnique(params.includeSectionKeys),
    includeServiceRelations: params.includeServiceRelations ?? false,
    includeEdges: params.includeEdges ?? false,
    edgeTypes: sortedUnique(params.edgeTypes),
    includeDescendants: params.includeDescendants ?? false,
    includeTrackedEntities: params.includeTrackedEntities ?? true,
    includeTrackedWorkSummary: params.includeTrackedWorkSummary ?? false,
    relatedEntityId: params.relatedEntityId ?? null,
    relatedEntityType: params.relatedEntityType ?? null,
    page: params.page ?? null,
    limit: params.limit ?? null,
    sortBy: params.sortBy ?? null,
    sortDir: params.sortDir ?? null,
  };
}

function normalizeDetailVariant(variant: WorkItemDetailVariant) {
  return {
    includeServiceRelations: variant.includeServiceRelations ?? false,
    includeEdges: variant.includeEdges ?? false,
    edgeTypes: sortedUnique(variant.edgeTypes),
  };
}

function normalizeHierarchyVariant(variant: WorkItemHierarchyVariant) {
  return {
    includeDesignDocCounts: variant.includeDesignDocCounts ?? false,
    includeAgentSessionCounts: variant.includeAgentSessionCounts ?? false,
  };
}

async function fetchWorkItemList(
  organizationId: string,
  projectId: string,
  params: ReturnType<typeof normalizeWorkItemListParams>,
  requestOptions: AxiosRequestConfig
): Promise<WorkItemResponseDto[]> {
  const response = await unifiedApiClient.getTasks(
    {
      organizationId,
      projectId,
      type: params.taskType ?? undefined,
      initiativeId: params.initiativeId ?? undefined,
      parentTaskId:
        params.parentTaskId === null
          ? undefined
          : params.parentTaskId === "null"
            ? null
            : params.parentTaskId,
      parentTaskIds: params.parentTaskIds ?? undefined,
      status: params.status ?? undefined,
      taskIds: params.taskIds ?? undefined,
      includeSectionKeys: params.includeSectionKeys ?? undefined,
      includeServiceRelations: params.includeServiceRelations || undefined,
      includeEdges: params.includeEdges || undefined,
      ...(params.edgeTypes ? { edgeTypes: params.edgeTypes } : {}),
      includeDescendants: params.includeDescendants || undefined,
      includeTrackedEntities: params.includeTrackedEntities,
      includeTrackedWorkSummary: params.includeTrackedWorkSummary || undefined,
      relatedEntityId: params.relatedEntityId ?? undefined,
      relatedEntityType: params.relatedEntityType ?? undefined,
      page: params.page ?? undefined,
      limit: params.limit ?? undefined,
      sortBy: params.sortBy ?? undefined,
      sortDir: params.sortDir ?? undefined,
    },
    requestOptions
  );
  return (
    (response as { data?: { data?: TaskResponseDto[] | null } })?.data?.data ??
    []
  ) as WorkItemResponseDto[];
}

export function workItemListQueryOptions(
  organizationId: string,
  projectId: string,
  params: WorkItemListParams
) {
  const queryKey = workItemKeys.list(organizationId, projectId, params);
  const selectedStatus = statusAsSelect(params);
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: ({ signal }) =>
      fetchWorkItemList(organizationId, projectId, queryKey[4], {
        ...captureRequestOptions(),
        signal,
      }),
    ...(selectedStatus
      ? {
          select: (items: WorkItemResponseDto[]) =>
            items.filter((item) => selectedStatus.includes(item.status)),
        }
      : {}),
  });
}

export function workItemDetailQueryOptions(
  organizationId: string,
  projectId: string,
  taskId: string,
  variant: WorkItemDetailVariant = {}
) {
  const queryKey = workItemKeys.detail(organizationId, projectId, taskId, variant);
  const { includeServiceRelations, includeEdges, edgeTypes } = queryKey[5];
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async ({ signal }): Promise<WorkItemResponseDto | null> => {
      const response = await unifiedApiClient.getTask(
        {
          organizationId,
          projectId,
          taskId,
          includeServiceRelations,
          includeEdges,
          ...(edgeTypes ? { edgeTypes } : {}),
        },
        { ...captureRequestOptions(), signal }
      );
      return (
        ((response as { data?: { data?: TaskResponseDto | null } })?.data
          ?.data as WorkItemResponseDto | null | undefined) ?? null
      );
    },
  });
}

/** The hierarchy is cached as the server returns it. */
export function workItemHierarchyQueryOptions(
  organizationId: string,
  projectId: string,
  taskId: string,
  variant: WorkItemHierarchyVariant = {}
) {
  const queryKey = workItemKeys.hierarchy(
    organizationId,
    projectId,
    taskId,
    variant
  );
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async ({ signal }): Promise<TaskHierarchyResponseDto | null> => {
      const response =
        await tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet(
          {
            organizationId,
            projectId,
            taskId,
            ...queryKey[5],
          },
          { ...captureRequestOptions(), signal }
        );
      return response.data?.data ?? null;
    },
  });
}

type CachedWorkItemData =
  | WorkItemResponseDto
  | WorkItemResponseDto[]
  | TaskHierarchyResponseDto
  | null
  | undefined;

export type WorkItemCacheSnapshot = Array<[QueryKey, CachedWorkItemData]>;

const keyKind = (queryKey: QueryKey) => queryKey[KEY_KIND_INDEX];

const isDetailOf = (queryKey: QueryKey, taskId: string) =>
  keyKind(queryKey) === "detail" && queryKey[KEY_TASK_ID_INDEX] === taskId;

/**
 * Detail entries for one item anywhere in the organization: a single-item
 * read made without a project is keyed under the `""` project.
 */
const detailsOf = (organizationId: string, taskId: string) => ({
  queryKey: workItemKeys.all(organizationId),
  predicate: ({ queryKey }: { queryKey: QueryKey }) =>
    isDetailOf(queryKey, taskId),
});

/**
 * Every cached work-item entry in a project (lists, details, hierarchies),
 * plus `taskId`'s detail entries outside it, for optimistic rollback.
 */
export function snapshotWorkItemCaches(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  taskId?: string
): WorkItemCacheSnapshot {
  const project = queryClient.getQueriesData<CachedWorkItemData>({
    queryKey: workItemKeys.project(organizationId, projectId),
  });
  if (taskId === undefined) return project;
  const seen = new Set(project.map(([queryKey]) => JSON.stringify(queryKey)));
  const elsewhere = queryClient
    .getQueriesData<CachedWorkItemData>(detailsOf(organizationId, taskId))
    .filter(([queryKey]) => !seen.has(JSON.stringify(queryKey)));
  return [...project, ...elsewhere];
}

/** Puts every snapshotted entry back, re-creating removed ones. */
export function restoreWorkItemCaches(
  queryClient: QueryClient,
  snapshot: WorkItemCacheSnapshot
): void {
  for (const [queryKey, data] of snapshot) {
    queryClient.setQueryData(queryKey, data);
  }
}

/** Applies an optimistic write to every cached list in a project. */
export function updateWorkItemLists(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  update: (items: WorkItemResponseDto[]) => WorkItemResponseDto[]
): void {
  queryClient.setQueriesData<WorkItemResponseDto[]>(
    { queryKey: workItemKeys.lists(organizationId, projectId) },
    (items) => (items ? update(items) : items)
  );
}

// Variant-only fields (edges, service relations) a narrower response lacks
// are kept from the cached entry.
const merge = (
  cached: WorkItemResponseDto,
  item: WorkItemResponseDto
): WorkItemResponseDto => ({ ...cached, ...item });

/**
 * Writes one item into every cached list, detail and hierarchy entry that
 * holds it. Entries that do not hold it are left for invalidation.
 */
export function writeWorkItem(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  item: WorkItemResponseDto
): void {
  updateWorkItemLists(queryClient, organizationId, projectId, (items) =>
    items.some((candidate) => candidate.id === item.id)
      ? items.map((candidate) =>
          candidate.id === item.id ? merge(candidate, item) : candidate
        )
      : items
  );
  queryClient.setQueriesData<WorkItemResponseDto | null>(
    detailsOf(organizationId, item.id),
    (cached) => (cached ? merge(cached, item) : cached)
  );
  queryClient.setQueriesData<TaskHierarchyResponseDto | null>(
    { queryKey: workItemKeys.hierarchies(organizationId, projectId) },
    (hierarchy) => {
      if (!hierarchy) return hierarchy;
      const writeTask = (task: TaskResponseDto) =>
        task.id === item.id
          ? (merge(task as WorkItemResponseDto, item) as TaskResponseDto)
          : task;
      const holdsItem =
        hierarchy.task.id === item.id ||
        hierarchy.parent?.id === item.id ||
        hierarchy.children.some((child) => child.id === item.id);
      if (!holdsItem) return hierarchy;
      return {
        ...hierarchy,
        task: writeTask(hierarchy.task),
        ...(hierarchy.parent ? { parent: writeTask(hierarchy.parent) } : {}),
        children: hierarchy.children.map(writeTask),
      };
    }
  );
}

/**
 * Removes an item from every cached list and hierarchy's children and drops
 * its detail entries.
 */
export function removeWorkItem(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  taskId: string
): void {
  updateWorkItemLists(queryClient, organizationId, projectId, (items) =>
    items.some((item) => item.id === taskId)
      ? items.filter((item) => item.id !== taskId)
      : items
  );
  queryClient.setQueriesData<TaskHierarchyResponseDto | null>(
    { queryKey: workItemKeys.hierarchies(organizationId, projectId) },
    (hierarchy) =>
      hierarchy?.children.some((child) => child.id === taskId)
        ? {
            ...hierarchy,
            children: hierarchy.children.filter((child) => child.id !== taskId),
          }
        : hierarchy
  );
  queryClient.removeQueries(detailsOf(organizationId, taskId));
}

/** Whether a cached work-item entry is, or contains, the item. */
function holdsWorkItem(
  queryKey: QueryKey,
  data: CachedWorkItemData,
  taskId: string
): boolean {
  switch (keyKind(queryKey)) {
    case "detail":
      return queryKey[KEY_TASK_ID_INDEX] === taskId;
    case "list":
      return !!(data as WorkItemResponseDto[] | undefined)?.some(
        (item) => item.id === taskId
      );
    case "hierarchy": {
      const hierarchy = data as TaskHierarchyResponseDto | null | undefined;
      return (
        queryKey[KEY_TASK_ID_INDEX] === taskId ||
        hierarchy?.task.id === taskId ||
        hierarchy?.parent?.id === taskId ||
        !!hierarchy?.children.some((child) => child.id === taskId)
      );
    }
    default:
      return false;
  }
}

/**
 * Invalidates only the entries holding one item: its single-item reads in any
 * project, and the lists and hierarchies whose cached data contains it. For
 * changes to the item's own data (e.g. its agent-session counts) that cannot
 * move it between lists.
 */
export function invalidateWorkItemHolders(
  queryClient: QueryClient,
  organizationId: string,
  taskId: string
): Promise<void> {
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: workItemKeys.all(organizationId),
    predicate: (query) =>
      holdsWorkItem(
        query.queryKey,
        query.state.data as CachedWorkItemData,
        taskId
      ),
  });
}

/** The cached copy of an item from any detail, list or hierarchy entry. */
export function findCachedWorkItem(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  id: string
): WorkItemResponseDto | undefined {
  for (const [, item] of queryClient.getQueriesData<WorkItemResponseDto | null>(
    detailsOf(organizationId, id)
  )) {
    if (item) return item;
  }
  for (const [queryKey, data] of snapshotWorkItemCaches(
    queryClient,
    organizationId,
    projectId
  )) {
    if (!data) continue;
    if (keyKind(queryKey) === "list") {
      const listed = (data as WorkItemResponseDto[]).find(
        (candidate) => candidate.id === id
      );
      if (listed) return listed;
    } else if (keyKind(queryKey) === "hierarchy") {
      const hierarchy = data as TaskHierarchyResponseDto;
      const held = [hierarchy.task, hierarchy.parent, ...hierarchy.children].find(
        (candidate) => candidate?.id === id
      );
      if (held) return held as WorkItemResponseDto;
    }
  }
  return undefined;
}

/**
 * Lists and hierarchies whose membership depends on `parentTaskId`: lists
 * filtered by either parent, and both parents' hierarchies.
 */
export function invalidateWorkItemParents(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  parentIds: Array<string | null | undefined>
): Promise<void> {
  const ids = new Set(parentIds.filter((id): id is string => !!id));
  if (ids.size === 0) return Promise.resolve();
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: workItemKeys.project(organizationId, projectId),
    predicate: ({ queryKey }) => {
      if (keyKind(queryKey) === "hierarchy") {
        return ids.has(queryKey[KEY_TASK_ID_INDEX] as string);
      }
      if (keyKind(queryKey) !== "list") return false;
      const params = queryKey[KEY_TASK_ID_INDEX] as ReturnType<
        typeof normalizeWorkItemListParams
      >;
      return (
        (params.parentTaskId !== null && ids.has(params.parentTaskId)) ||
        !!params.parentTaskIds?.some((id) => ids.has(id))
      );
    },
  });
}

/** Detail entries for one item, in any project of the organization. */
export function workItemDetailFilter(organizationId: string, taskId: string) {
  return detailsOf(organizationId, taskId);
}

/**
 * Relationship-invalidation registration for work items. Scope patterns map
 * to the project's lists (filters such as parent or initiative move items
 * between them); item cascades map to that item's single-item reads in any
 * project.
 *
 * `listsInvalidated`: the caller already ran `invalidateProjectWorkItemQueries`
 * for this change, so scope invalidations are skipped — a second
 * invalidation in the same tick would cancel and restart those reads.
 */
export function createWorkItemInvalidator(
  organizationId: string,
  projectId: string | undefined,
  invalidate: (filters: InvalidateQueryFilters) => void,
  { listsInvalidated = false }: { listsInvalidated?: boolean } = {}
): CollectionInvalidator<QueryKey> {
  return {
    dispatch: ({ queryKey }) => {
      if (keyKind(queryKey) === "detail") {
        invalidate(
          workItemDetailFilter(
            organizationId,
            queryKey[KEY_TASK_ID_INDEX] as string
          )
        );
      } else if (!listsInvalidated) {
        invalidate({ queryKey });
      }
    },
    buildScopeKey: ({ lookupField, lookupValue }) => {
      const project =
        lookupField === "projectId" && typeof lookupValue === "string" && lookupValue
          ? lookupValue
          : projectId;
      return project === undefined
        ? workItemKeys.all(organizationId)
        : workItemKeys.lists(organizationId, project);
    },
    buildItemKey: ({ id }) => [
      ...workItemKeys.details(organizationId, projectId ?? ""),
      id,
    ],
  };
}
