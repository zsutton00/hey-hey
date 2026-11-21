import type { QueryKey } from "@tanstack/react-query";
import type { ApolloClient } from "@apollo/client";
import {
  type AgentEdgeEndpointEntityType,
  type AgentEdgeType,
  type TaskHierarchyResponseDto,
  type TaskSortBy,
  type TaskSortDir,
  type TaskResponseDto,
} from "../../api";
import {
  GetWorkItemDocument,
  GetWorkItemHierarchyDocument,
  GetWorkItemsDocument,
  type GetWorkItemHierarchyQuery,
  type GetWorkItemHierarchyQueryVariables,
  type GetWorkItemQuery,
  type GetWorkItemQueryVariables,
  type GetWorkItemsQuery,
  type GetWorkItemsQueryVariables,
} from "../../graphql/generated/graphql";
import {
  getProjectGraphQLClient,
  type GraphQLProjectScope,
} from "../graphql/client";
import {
  edgeTypeName,
  endpointEntityTypeName,
  toHierarchyResponse,
  toWorkItemResponse,
} from "../graphql/records";
import type { GraphQLReadSpec } from "../graphql/useGraphQLRead";
import type { CollectionInvalidator } from "../relationships/invalidator";
import type { WorkItemResponseDto } from "./workItems";

/** Every server list shape of the project's work items. */
export interface WorkItemListParams {
  taskType?: string;
  /** @deprecated Still supported for initiative-scoped views during transition */
  initiativeId?: string;
  /** `undefined` = no parent filter; `null` = only items without a parent. */
  parentTaskId?: string | null;
  parentTaskIds?: string[];
  status?: TaskResponseDto["status"][];
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

/** Parts of a single work item a read may include beyond its own fields. */
export interface WorkItemDetailVariant {
  includeServiceRelations?: boolean;
  includeEdges?: boolean;
  edgeTypes?: AgentEdgeType[];
}

export interface WorkItemHierarchyVariant {
  includeDesignDocCounts?: boolean;
  includeAgentSessionCounts?: boolean;
}

/** The part switches every work-item query takes. */
type PartVariables = Pick<
  GetWorkItemsQueryVariables,
  | "withSections"
  | "sectionKeys"
  | "withEdges"
  | "edgeTypes"
  | "withServiceRelations"
  | "withTrackedEntities"
  | "withTrackedWorkSummary"
  | "withDesignDocCounts"
  | "withAgentSessionCounts"
>;

const sortedUnique = <T extends string>(values: T[] | undefined) =>
  values?.length ? [...new Set(values)].sort() : undefined;

const edgeTypeNames = (types: AgentEdgeType[] | undefined) =>
  sortedUnique(types)?.map(edgeTypeName);

const noParts: PartVariables = {
  withSections: false,
  withEdges: false,
  withServiceRelations: false,
  withTrackedEntities: false,
  withTrackedWorkSummary: false,
  withDesignDocCounts: false,
  withAgentSessionCounts: false,
};

function listVariables(params: WorkItemListParams): GetWorkItemsQueryVariables {
  const sectionKeys = sortedUnique(params.includeSectionKeys);
  const edgeTypes = edgeTypeNames(params.edgeTypes);
  const related =
    params.relatedEntityId && params.relatedEntityType
      ? {
          entityId: params.relatedEntityId,
          entityType: endpointEntityTypeName(params.relatedEntityType),
          edgeTypes: edgeTypes ?? [],
        }
      : undefined;

  return {
    ...noParts,
    withSections: sectionKeys !== undefined,
    sectionKeys,
    withEdges: params.includeEdges === true,
    edgeTypes,
    withServiceRelations: params.includeServiceRelations === true,
    withTrackedEntities: params.includeTrackedEntities ?? true,
    withTrackedWorkSummary: params.includeTrackedWorkSummary === true,
    initiativeId: params.initiativeId,
    // `undefined` omits the filter; `null` asks for items without a parent.
    parentTaskId: params.parentTaskId,
    parentTaskIds: sortedUnique(params.parentTaskIds),
    ids: sortedUnique(params.taskIds),
    type: params.taskType,
    statuses: sortedUnique(params.status),
    includeDescendants: params.includeDescendants || undefined,
    relatedTo: related,
    sort: params.sortBy
      ? { field: params.sortBy, direction: params.sortDir ?? "desc" }
      : undefined,
    page: params.page,
    limit: params.limit,
  };
}

export const workItemListRead = (
  scope: GraphQLProjectScope,
  params: WorkItemListParams,
): GraphQLReadSpec<
  GetWorkItemsQuery,
  GetWorkItemsQueryVariables,
  WorkItemResponseDto[]
> => ({
  document: GetWorkItemsDocument,
  variables: listVariables(params),
  scope,
  select: (data) => data.workItems.map(toWorkItemResponse),
});

function detailVariables(
  taskId: string,
  variant: WorkItemDetailVariant,
): GetWorkItemQueryVariables {
  return {
    ...noParts,
    id: taskId,
    // The single-item read returns every section its type declares.
    withSections: true,
    withEdges: variant.includeEdges === true,
    edgeTypes: edgeTypeNames(variant.edgeTypes),
    withServiceRelations: variant.includeServiceRelations === true,
  };
}

/** `null` when the project does not hold the item. */
export const workItemDetailRead = (
  scope: GraphQLProjectScope,
  taskId: string,
  variant: WorkItemDetailVariant = {},
): GraphQLReadSpec<
  GetWorkItemQuery,
  GetWorkItemQueryVariables,
  WorkItemResponseDto
> => ({
  document: GetWorkItemDocument,
  variables: detailVariables(taskId, variant),
  scope,
  select: (data) => toWorkItemResponse(data.workItem),
});

function hierarchyVariables(
  taskId: string,
  variant: WorkItemHierarchyVariant,
): GetWorkItemHierarchyQueryVariables {
  const designDocCounts = variant.includeDesignDocCounts === true;
  const agentSessionCounts = variant.includeAgentSessionCounts === true;

  return {
    ...noParts,
    id: taskId,
    includeDesignDocCounts: designDocCounts,
    includeAgentSessionCounts: agentSessionCounts,
    withSections: true,
    withDesignDocCounts: designDocCounts,
    withAgentSessionCounts: agentSessionCounts,
  };
}

/** The hierarchy as REST returns it; its members are shared work-item records. */
export const workItemHierarchyRead = (
  scope: GraphQLProjectScope,
  taskId: string,
  variant: WorkItemHierarchyVariant = {},
): GraphQLReadSpec<
  GetWorkItemHierarchyQuery,
  GetWorkItemHierarchyQueryVariables,
  TaskHierarchyResponseDto
> => ({
  document: GetWorkItemHierarchyDocument,
  variables: hierarchyVariables(taskId, variant),
  scope,
  select: (data) => toHierarchyResponse(data.workItemHierarchy),
});

/** Reads one hierarchy once, outside a mounted view. */
export async function fetchWorkItemHierarchy(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  taskId: string,
  variant: WorkItemHierarchyVariant,
): Promise<TaskHierarchyResponseDto> {
  const { data } = await getProjectGraphQLClient(client, scope).query({
    query: GetWorkItemHierarchyDocument,
    variables: hierarchyVariables(taskId, variant),
    context: scope,
  });
  if (!data) {
    throw new Error("Failed to fetch task hierarchy");
  }

  return toHierarchyResponse(data.workItemHierarchy);
}

/** Reads one list once, outside a mounted view. */
export async function fetchWorkItemList(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  params: WorkItemListParams,
): Promise<WorkItemResponseDto[]> {
  const read = workItemListRead(scope, params);
  const { data } = await getProjectGraphQLClient(client, scope).query({
    query: read.document,
    variables: read.variables,
    // Each call is its own read: a restarted read must not join a stale one.
    context: { ...scope, queryDeduplication: false },
    fetchPolicy: "network-only",
  });

  return data ? (read.select(data) ?? []) : [];
}

/** Reads one work item once, outside a mounted view. */
export async function fetchWorkItem(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  taskId: string,
  variant: WorkItemDetailVariant = {},
): Promise<WorkItemResponseDto> {
  const read = workItemDetailRead(scope, taskId, variant);
  const { data } = await getProjectGraphQLClient(client, scope).query({
    query: read.document,
    variables: read.variables,
    context: scope,
    fetchPolicy: "network-only",
  });
  if (!data) {
    throw new Error("Failed to fetch work item");
  }

  return toWorkItemResponse(data.workItem);
}

/** What a mounted work-item view is refreshed through. */
export interface WorkItemRefresh {
  /** Every work-item list, hierarchy and reference read in the project. */
  lists: (organizationId: string, projectId: string | undefined) => void;
  /** One work item's reads, and the lists that may hold it. */
  item: (
    organizationId: string,
    projectId: string | undefined,
    taskId: string,
  ) => void;
}

const KEY_ROOT = "workItems";

/**
 * Relationship-invalidation registration for work items. Other entities'
 * changes that affect work items (a design doc link, a service) reach the
 * cache by refreshing the reads that show them: scope patterns refresh the
 * project's lists; item cascades refresh that item's reads. The keys the
 * coordinator routes are tokens for these two refreshes.
 *
 * `listsInvalidated`: the caller already refreshed the lists for this
 * change, so scope refreshes are skipped.
 */
export function createWorkItemInvalidator(
  organizationId: string,
  projectId: string | undefined,
  refresh: WorkItemRefresh,
  { listsInvalidated = false }: { listsInvalidated?: boolean } = {},
): CollectionInvalidator<QueryKey> {
  return {
    dispatch: ({ queryKey }) => {
      const [, , keyProjectId, kind, taskId] = queryKey as string[];
      const project = keyProjectId || undefined;
      if (kind === "item") {
        refresh.item(organizationId, project, taskId);
      } else if (!listsInvalidated) {
        refresh.lists(organizationId, project);
      }
    },
    buildScopeKey: ({ lookupField, lookupValue }) => {
      const project =
        lookupField === "projectId" &&
        typeof lookupValue === "string" &&
        lookupValue
          ? lookupValue
          : projectId;

      return [KEY_ROOT, organizationId, project ?? "", "list"];
    },
    buildItemKey: ({ id }) => [
      KEY_ROOT,
      organizationId,
      projectId ?? "",
      "item",
      id,
    ],
  };
}
