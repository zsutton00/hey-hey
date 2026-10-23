import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type {
  AgentSessionDto,
  AgentSessionListSort,
  AgentSessionStatus,
  AgentSessionType,
  EntityType,
  ListAgentSessions200Response,
  PaginatedAgentSessionItemDto,
} from "../../api";
import { agentSessionsClient, dataClient } from "../../clients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { logger } from "../../utils/logger";

export type AgentSessionsFilters = {
  ids?: string[];
  userId?: string;
  conversationId?: string;
  entityType?: EntityType;
  entityId?: string;
  serviceId?: string;
  type?: AgentSessionType;
};

export type PaginatedAgentSessionsFilters = {
  type?: AgentSessionType;
  excludeType?: AgentSessionType;
  hasUserMessage?: boolean;
  userId?: string;
  serviceId?: string;
  taskId?: string;
  statuses?: AgentSessionStatus[];
  sort?: AgentSessionListSort;
  limit?: number;
};

export interface PaginatedAgentSessionsPage {
  items: PaginatedAgentSessionItemDto[];
  nextCursor: string | null;
}

export type PaginatedAgentSessionsData = InfiniteData<
  PaginatedAgentSessionsPage,
  string | null
>;

const normalizeIds = (ids: readonly string[] | undefined) =>
  ids?.length ? [...new Set(ids)].sort() : undefined;

const normalizeStatuses = (statuses: AgentSessionStatus[] | undefined) =>
  statuses?.length ? [...new Set(statuses)].sort() : undefined;

/**
 * Prefix tree for Agent Session reads. Everything held for one session (its
 * canonical read and its live current state, context size and output
 * attention) sits under `session`, so removing that prefix drops all of it.
 * Lists and paginated feeds are separate requests keyed by their normalized
 * filters under the project. A paginated feed is one infinite query; its
 * cursors are page params, not key fields.
 *
 * Keys: [root, org, project, "session", id, "detail" | live dataset]
 *       [root, org, project, "list", filters]
 *       [root, org, project, "paginated", filters]
 */
export const agentSessionKeys = {
  root: () => ["agentSessions"] as const,
  all: (organizationId: string) =>
    [...agentSessionKeys.root(), organizationId] as const,
  project: (organizationId: string, projectId: string) =>
    [...agentSessionKeys.all(organizationId), projectId] as const,
  session: (organizationId: string, projectId: string, agentSessionId: string) =>
    [
      ...agentSessionKeys.project(organizationId, projectId),
      "session",
      agentSessionId,
    ] as const,
  detail: (organizationId: string, projectId: string, agentSessionId: string) =>
    [
      ...agentSessionKeys.session(organizationId, projectId, agentSessionId),
      "detail",
    ] as const,
  currentState: (
    organizationId: string,
    projectId: string,
    agentSessionId: string
  ) =>
    [
      ...agentSessionKeys.session(organizationId, projectId, agentSessionId),
      "currentState",
    ] as const,
  contextSize: (
    organizationId: string,
    projectId: string,
    agentSessionId: string
  ) =>
    [
      ...agentSessionKeys.session(organizationId, projectId, agentSessionId),
      "contextSize",
    ] as const,
  outputAttention: (
    organizationId: string,
    projectId: string,
    agentSessionId: string
  ) =>
    [
      ...agentSessionKeys.session(organizationId, projectId, agentSessionId),
      "outputAttention",
    ] as const,
  lists: (organizationId: string, projectId: string) =>
    [...agentSessionKeys.project(organizationId, projectId), "list"] as const,
  list: (
    organizationId: string,
    projectId: string,
    filters: AgentSessionsFilters = {}
  ) =>
    [
      ...agentSessionKeys.lists(organizationId, projectId),
      { ...filters, ids: normalizeIds(filters.ids) },
    ] as const,
  paginatedLists: (organizationId: string, projectId: string) =>
    [
      ...agentSessionKeys.project(organizationId, projectId),
      "paginated",
    ] as const,
  paginated: (
    organizationId: string,
    projectId: string,
    filters: PaginatedAgentSessionsFilters = {}
  ) =>
    [
      ...agentSessionKeys.paginatedLists(organizationId, projectId),
      { ...filters, statuses: normalizeStatuses(filters.statuses) },
    ] as const,
};

const requestOptionsWith = (signal: AbortSignal): AxiosRequestConfig => ({
  ...captureRequestOptions(),
  signal,
});

const filterOrder: Array<keyof AgentSessionsFilters> = [
  "ids",
  "userId",
  "conversationId",
  "entityType",
  "entityId",
  "serviceId",
  "type",
];

function normalizeFilters(
  filters: AgentSessionsFilters
): Record<string, string | boolean> {
  const params: Record<string, string | boolean> = {};

  filterOrder.forEach((key) => {
    const value = filters[key];
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return;
      }

      params[key] = value.join(",");
      return;
    }

    params[key] = value;
  });

  return params;
}

async function fetchAgentSession(
  organizationId: string,
  projectId: string,
  agentSessionId: string,
  requestOptions: AxiosRequestConfig
): Promise<AgentSessionDto> {
  logger.info("data_core", "[agentSessions] Fetch agent session", {
    organizationId,
    projectId,
    agentSessionId,
  });

  const response = await dataClient.request<{
    data: AgentSessionDto;
  }>({
    ...requestOptions,
    method: "GET",
    url: `/organizations/${organizationId}/projects/${projectId}/agent-sessions/${agentSessionId}`,
    params: {
      includeService: true,
      includeUser: true,
    },
  });

  const data = response.data?.data;

  if (!data || typeof data !== "object" || !("id" in data)) {
    throw new Error(
      `[agentSessions] Invalid response for session ${agentSessionId}`
    );
  }

  return data;
}

async function fetchAgentSessions(
  organizationId: string,
  projectId: string,
  filters: AgentSessionsFilters,
  requestOptions: AxiosRequestConfig
): Promise<AgentSessionDto[]> {
  logger.info("data_core", "[agentSessions] Fetch agent session list", {
    organizationId,
    projectId,
    filters,
  });

  const params = normalizeFilters(filters);
  params.includeService = true;
  params.includeUser = true;

  const response = await dataClient.request<ListAgentSessions200Response>({
    ...requestOptions,
    method: "GET",
    url: `/organizations/${organizationId}/projects/${projectId}/agent-sessions`,
    params,
  });

  const data = response.data?.data;

  if (!Array.isArray(data)) {
    throw new Error(
      `[agentSessions] Invalid list response for project ${projectId}`
    );
  }

  return data as AgentSessionDto[];
}

export async function fetchPaginatedAgentSessions(
  organizationId: string,
  projectId: string,
  filters: PaginatedAgentSessionsFilters,
  cursor: string | null,
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<PaginatedAgentSessionsPage> {
  const response = await agentSessionsClient.listAgentSessionsPaginated(
    {
      organizationId,
      projectId,
      type: filters.type,
      excludeType: filters.excludeType,
      hasUserMessage: filters.hasUserMessage,
      userId: filters.userId,
      serviceId: filters.serviceId,
      taskId: filters.taskId,
      status: normalizeStatuses(filters.statuses),
      sort: filters.sort,
      limit: filters.limit,
      cursor: cursor?.trim() || undefined,
    },
    requestOptions
  );
  const page = response.data?.data;

  return {
    items: page?.items ?? [],
    nextCursor: page?.nextCursor ?? null,
  };
}

export function agentSessionQueryOptions(
  organizationId: string,
  projectId: string,
  agentSessionId: string
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: agentSessionKeys.detail(organizationId, projectId, agentSessionId),
    queryFn: ({ signal }) =>
      fetchAgentSession(
        organizationId,
        projectId,
        agentSessionId,
        requestOptionsWith(signal)
      ),
  });
}

export function agentSessionListQueryOptions(
  organizationId: string,
  projectId: string,
  filters: AgentSessionsFilters = {}
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: agentSessionKeys.list(organizationId, projectId, filters),
    queryFn: ({ signal }) =>
      fetchAgentSessions(
        organizationId,
        projectId,
        { ...filters, ids: normalizeIds(filters.ids) },
        requestOptionsWith(signal)
      ),
  });
}

export function paginatedAgentSessionsQueryOptions(
  organizationId: string,
  projectId: string,
  filters: PaginatedAgentSessionsFilters = {}
) {
  return infiniteQueryOptions({
    ...dataLayerQueryPolicy,
    queryKey: agentSessionKeys.paginated(organizationId, projectId, filters),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: PaginatedAgentSessionsPage) =>
      lastPage.nextCursor ?? undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchPaginatedAgentSessions(
        organizationId,
        projectId,
        filters,
        pageParam,
        requestOptionsWith(signal)
      ),
  });
}

// Keys are [root, org, project, kind, ...]; see `agentSessionKeys`.
const isListKey = (queryKey: readonly unknown[]): boolean =>
  queryKey[3] === "list";
const isFeedKey = (queryKey: readonly unknown[]): boolean =>
  queryKey[3] === "list" || queryKey[3] === "paginated";

const listContains = (data: unknown, agentSessionId: string): boolean =>
  Array.isArray(data) &&
  data.some((session: AgentSessionDto) => session.id === agentSessionId);

const scopeKey = (organizationId: string, projectId: string | undefined) =>
  projectId === undefined
    ? agentSessionKeys.all(organizationId)
    : agentSessionKeys.project(organizationId, projectId);

/**
 * Session membership or order may have changed in a project (or, without a
 * project, the organization): every list and paginated feed there re-reads.
 * Reads already in flight are restarted so a response from before the change
 * never stands.
 */
export function invalidateAgentSessionFeeds(
  queryClient: QueryClient,
  organizationId: string,
  projectId?: string
): Promise<void> {
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: scopeKey(organizationId, projectId),
    predicate: ({ queryKey }) => isFeedKey(queryKey),
  });
}

/** One session's canonical read changed; its live datasets are untouched. */
export function invalidateAgentSessionDetail(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string | undefined,
  agentSessionId: string
): Promise<void> {
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: scopeKey(organizationId, projectId),
    predicate: ({ queryKey }) =>
      queryKey[3] === "session" &&
      queryKey[4] === agentSessionId &&
      queryKey[5] === "detail",
  });
}

/**
 * Writes a server-returned session into its canonical read and into every
 * cached list row with the same id. Lists that do not hold it are untouched:
 * membership changes only through authoritative reads.
 */
export function writeAgentSession(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  agentSession: AgentSessionDto
): void {
  queryClient.setQueryData<AgentSessionDto>(
    agentSessionKeys.detail(organizationId, projectId, agentSession.id),
    (current) => (current ? { ...current, ...agentSession } : agentSession)
  );
  queryClient.setQueriesData<AgentSessionDto[]>(
    {
      queryKey: agentSessionKeys.lists(organizationId, projectId),
      predicate: ({ state }) => listContains(state.data, agentSession.id),
    },
    (current) =>
      current?.map((row) =>
        row.id === agentSession.id ? { ...row, ...agentSession } : row
      )
  );
}

/**
 * A session was deleted: everything held for it is dropped, rows are removed
 * from cached lists, and lists and feeds in scope re-read.
 */
export function removeAgentSession(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string | undefined,
  agentSessionId: string
): Promise<void> {
  const queryKey = scopeKey(organizationId, projectId);
  queryClient.removeQueries({
    queryKey,
    predicate: ({ queryKey: key }) =>
      key[3] === "session" && key[4] === agentSessionId,
  });
  queryClient.setQueriesData<AgentSessionDto[]>(
    {
      queryKey,
      predicate: ({ queryKey: key, state }) =>
        isListKey(key) && listContains(state.data, agentSessionId),
    },
    (current) => current?.filter((row) => row.id !== agentSessionId)
  );
  return invalidateAgentSessionFeeds(queryClient, organizationId, projectId);
}
