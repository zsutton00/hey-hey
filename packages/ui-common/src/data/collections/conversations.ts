import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import type {
  ConversationResponseDto,
  ConversationStatus,
  GetWorkflowConversationsSortByEnum,
  GetWorkflowConversationsSortOrderEnum,
  WorkflowName,
} from "../../api";
import { platformClient } from "../../clients/serviceClients";
import logger from "../../utils/logger";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export type ConversationListFilters = {
  workflowName?: string;
  search?: string;
  workflowAboutId?: string;
  workflowAboutType?: string;
  statuses?: ConversationStatus[];
  includeSuggestionDecisions?: boolean;
};

export type WorkflowConversationListParams = {
  workflowName: string;
  workflowAboutId: string;
  sortBy?: GetWorkflowConversationsSortByEnum;
  sortOrder?: GetWorkflowConversationsSortOrderEnum;
  status?: ConversationStatus;
  page?: number;
  limit?: number;
};

/**
 * Prefix tree for conversation reads. Every envelope variant of one
 * conversation sits under `conversation`, so invalidating it covers all of
 * them. `includeSuggestionDecisions` stays in the key because the server
 * returns a different body for it. Lists and workflow lists are separate
 * requests with their own keys under the project.
 *
 * Keys: [root, org, project, "conversation", id, "envelope", variant]
 *       [root, org, project, "list", filters]
 *       [root, org, project, "workflow", params]
 */
export const conversationKeys = {
  root: () => ["conversations"] as const,
  all: (organizationId: string) =>
    [...conversationKeys.root(), organizationId] as const,
  project: (organizationId: string, projectId: string) =>
    [...conversationKeys.all(organizationId), projectId] as const,
  conversation: (
    organizationId: string,
    projectId: string,
    conversationId: string,
  ) =>
    [
      ...conversationKeys.project(organizationId, projectId),
      "conversation",
      conversationId,
    ] as const,
  envelope: (
    organizationId: string,
    projectId: string,
    conversationId: string,
    includeSuggestionDecisions = false,
  ) =>
    [
      ...conversationKeys.conversation(
        organizationId,
        projectId,
        conversationId,
      ),
      "envelope",
      { includeSuggestionDecisions },
    ] as const,
  lists: (organizationId: string, projectId: string) =>
    [...conversationKeys.project(organizationId, projectId), "list"] as const,
  list: (
    organizationId: string,
    projectId: string,
    filters: ConversationListFilters,
  ) =>
    [
      ...conversationKeys.lists(organizationId, projectId),
      {
        ...filters,
        includeSuggestionDecisions: filters.includeSuggestionDecisions ?? false,
      },
    ] as const,
  workflowLists: (organizationId: string, projectId: string) =>
    [
      ...conversationKeys.project(organizationId, projectId),
      "workflow",
    ] as const,
  workflowList: (
    organizationId: string,
    projectId: string,
    params: WorkflowConversationListParams,
  ) =>
    [
      ...conversationKeys.workflowLists(organizationId, projectId),
      params,
    ] as const,
};

const requestOptionsWith = (signal: AbortSignal): AxiosRequestConfig => ({
  ...captureRequestOptions(),
  signal,
});

async function fetchConversation(
  organizationId: string,
  projectId: string,
  conversationId: string,
  includeSuggestionDecisions: boolean,
  requestOptions: AxiosRequestConfig,
): Promise<ConversationResponseDto> {
  logger.info("data_core", "[conversations] Fetch conversation", {
    conversationId,
    includeSuggestionDecisions,
  });
  const response = await platformClient.getConversation(
    {
      organizationId,
      projectId,
      conversationId,
      includeSuggestionDecisions: includeSuggestionDecisions || undefined,
    },
    requestOptions,
  );
  const conversation = response.data?.data;
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }
  return conversation;
}

async function fetchConversationList(
  organizationId: string,
  projectId: string,
  filters: ConversationListFilters,
  requestOptions: AxiosRequestConfig,
): Promise<ConversationResponseDto[]> {
  logger.info("data_core", "[conversations] Fetch conversation list", {
    projectId,
    ...filters,
  });
  const workflowNames = filters.workflowName
    ? (filters.workflowName.split(",").filter(Boolean) as WorkflowName[])
    : undefined;
  const statuses =
    filters.statuses && filters.statuses.length > 0
      ? filters.statuses
      : undefined;
  const common = {
    organizationId,
    projectId,
    page: 1,
    limit: 100,
    workflowAboutId: filters.workflowAboutId || undefined,
    workflowAboutType: filters.workflowAboutType || undefined,
    search: filters.search || undefined,
    includeSuggestionDecisions: filters.includeSuggestionDecisions || undefined,
  };

  const response = statuses
    ? await platformClient.getAllConversations(
        { ...common, status: statuses, workflowName: workflowNames },
        requestOptions,
      )
    : await platformClient.getActiveConversations(
        { ...common, workflowName: workflowNames?.join(",") },
        requestOptions,
      );
  return response.data?.data?.data ?? [];
}

async function fetchWorkflowConversationList(
  organizationId: string,
  projectId: string,
  params: WorkflowConversationListParams,
  requestOptions: AxiosRequestConfig,
): Promise<ConversationResponseDto[]> {
  logger.info("data_core", "[conversations] Fetch workflow conversations", {
    projectId,
    ...params,
  });
  const response = await platformClient.getWorkflowConversations(
    {
      organizationId,
      projectId,
      workflowName: params.workflowName,
      workflowAboutId: params.workflowAboutId,
      page: params.page ?? 1,
      limit: params.limit ?? 100,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      status: params.status ? [params.status] : undefined,
    },
    requestOptions,
  );
  return response.data?.data?.data ?? [];
}

export function conversationQueryOptions(
  organizationId: string,
  projectId: string,
  conversationId: string,
  includeSuggestionDecisions = false,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: conversationKeys.envelope(
      organizationId,
      projectId,
      conversationId,
      includeSuggestionDecisions,
    ),
    queryFn: ({ signal }) =>
      fetchConversation(
        organizationId,
        projectId,
        conversationId,
        includeSuggestionDecisions,
        requestOptionsWith(signal),
      ),
  });
}

export function conversationListQueryOptions(
  organizationId: string,
  projectId: string,
  filters: ConversationListFilters,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: conversationKeys.list(organizationId, projectId, filters),
    queryFn: ({ signal }) =>
      fetchConversationList(
        organizationId,
        projectId,
        filters,
        requestOptionsWith(signal),
      ),
  });
}

export function workflowConversationListQueryOptions(
  organizationId: string,
  projectId: string,
  params: WorkflowConversationListParams,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: conversationKeys.workflowList(organizationId, projectId, params),
    queryFn: ({ signal }) =>
      fetchWorkflowConversationList(
        organizationId,
        projectId,
        params,
        requestOptionsWith(signal),
      ),
  });
}

// Keys are [root, org, project, kind, ...]; see `conversationKeys`.
const isListKey = (queryKey: readonly unknown[]): boolean =>
  queryKey[3] === "list" || queryKey[3] === "workflow";

const listContains = (data: unknown, conversationId: string): boolean =>
  Array.isArray(data) &&
  data.some(
    (conversation: ConversationResponseDto) =>
      conversation.id === conversationId,
  );

/**
 * One conversation changed: its envelopes and every list currently holding
 * it are invalidated. Scope is the whole root because realtime events do not
 * always carry the project.
 */
export function invalidateConversation(
  queryClient: QueryClient,
  conversationId: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: conversationKeys.root(),
    predicate: ({ queryKey, state }) =>
      (queryKey[3] === "conversation" && queryKey[4] === conversationId) ||
      (isListKey(queryKey) && listContains(state.data, conversationId)),
  });
}

/** Conversation membership changed in a project: every list there re-reads. */
export function invalidateConversationLists(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: conversationKeys.project(organizationId, projectId),
    predicate: ({ queryKey }) => isListKey(queryKey),
  });
}

/**
 * Writes a server-returned conversation into its base envelope and into every
 * cached list row with the same id. Variant envelopes (with suggestion
 * decisions) carry fields this body lacks, so they are invalidated instead.
 */
export function writeConversation(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  conversation: ConversationResponseDto,
): void {
  queryClient.setQueryData(
    conversationKeys.envelope(organizationId, projectId, conversation.id),
    conversation,
  );
  queryClient.setQueriesData<ConversationResponseDto[]>(
    {
      queryKey: conversationKeys.project(organizationId, projectId),
      predicate: ({ queryKey, state }) =>
        isListKey(queryKey) && listContains(state.data, conversation.id),
    },
    (current) =>
      current?.map((row) =>
        row.id === conversation.id ? { ...row, ...conversation } : row,
      ),
  );
  void queryClient.invalidateQueries({
    queryKey: conversationKeys.envelope(
      organizationId,
      projectId,
      conversation.id,
      true,
    ),
    exact: true,
  });
}

/** A conversation was deleted: drop its envelopes and remove it from lists. */
export function removeConversation(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  conversationId: string,
): void {
  queryClient.removeQueries({
    queryKey: conversationKeys.conversation(
      organizationId,
      projectId,
      conversationId,
    ),
  });
  queryClient.setQueriesData<ConversationResponseDto[]>(
    {
      queryKey: conversationKeys.project(organizationId, projectId),
      predicate: ({ queryKey, state }) =>
        isListKey(queryKey) && listContains(state.data, conversationId),
    },
    (current) => current?.filter((row) => row.id !== conversationId),
  );
}
