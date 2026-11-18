import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  AgentSessionContextSize,
  AgentSessionCurrentStateBatchItemDto,
  AgentSessionOutputAttentionBatchItemDto,
  BatchReadAgentSessionCurrentState200Response,
  BatchReadAgentSessionOutputAttention200Response,
  SetAgentSessionOutputAttentionReady200Response,
} from "../../api";
import { dataClient } from "../../clients";
import {
  BATCH_LIMIT,
  createPacedBatchReadCoordinator,
  normalizeBatchIds,
  type HydrationClock,
} from "../query/pacedBatchRead";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { agentSessionKeys } from "./agentSessions";

/**
 * Live per-session datasets: current state, output attention and context
 * size. Each is one query per session under `agentSessionKeys`. Realtime
 * events write their carried value straight into the key; a newer value
 * always wins and an older one is ignored. Current state and output attention
 * are read through bounded batch endpoints: every query needing a read in the
 * same tick joins one paced batch per project (see
 * `createAgentSessionBatchReadCoordinator`). Context size has no read; it is
 * seeded from the canonical session and updated by events.
 */

export type AgentSessionCurrentStateValue = Pick<
  AgentSessionCurrentStateBatchItemDto,
  "currentState" | "revision" | "transitionedAt"
>;

export type AgentSessionCurrentStateMap = Readonly<
  Record<string, AgentSessionCurrentStateValue>
>;

export type AgentSessionOutputAttentionValue = Pick<
  AgentSessionOutputAttentionBatchItemDto,
  "state" | "revision" | "changedAt"
>;

export type AgentSessionOutputAttentionMap = Readonly<
  Record<string, AgentSessionOutputAttentionValue>
>;

/** A revisioned value replaces the current one only when strictly newer. */
export const pickNewerRevision = <T extends { revision: number }>(
  current: T | null | undefined,
  incoming: T,
): T => (current && current.revision >= incoming.revision ? current : incoming);

/** A reading wins only when it was observed strictly after the other. */
export const pickNewerContextSize = (
  a: AgentSessionContextSize | null | undefined,
  b: AgentSessionContextSize | null | undefined,
): AgentSessionContextSize | undefined => {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return Date.parse(b.observedAt) > Date.parse(a.observedAt) ? b : a;
};

const toCurrentStateValue = (
  entry: AgentSessionCurrentStateValue,
): AgentSessionCurrentStateValue => ({
  currentState: entry.currentState,
  revision: entry.revision,
  transitionedAt: entry.transitionedAt,
});

const toOutputAttentionValue = (
  entry: AgentSessionOutputAttentionValue,
): AgentSessionOutputAttentionValue => ({
  state: entry.state,
  revision: entry.revision,
  changedAt: entry.changedAt,
});

export const normalizeAgentSessionIds = normalizeBatchIds;

const postBatch = async <TResponse extends { data?: { items?: unknown[] } }>(
  organizationId: string,
  projectId: string,
  operation: "current-state:batch" | "output-attention:batch",
  agentSessionIds: readonly string[],
) => {
  const ids = normalizeAgentSessionIds(agentSessionIds);
  if (ids.length === 0) return [];
  if (ids.length > BATCH_LIMIT) {
    throw new Error(
      `Agent Session ${operation} reads cannot exceed ${BATCH_LIMIT} IDs`,
    );
  }
  const response = await dataClient.request<TResponse>({
    method: "POST",
    url: `/organizations/${organizationId}/projects/${projectId}/agent-sessions/${operation}`,
    data: { agentSessionIds: ids },
  });
  return response.data.data?.items ?? [];
};

export const fetchAgentSessionCurrentStateBatch = (
  organizationId: string,
  projectId: string,
  agentSessionIds: readonly string[],
): Promise<AgentSessionCurrentStateBatchItemDto[]> =>
  postBatch<BatchReadAgentSessionCurrentState200Response>(
    organizationId,
    projectId,
    "current-state:batch",
    agentSessionIds,
  ) as Promise<AgentSessionCurrentStateBatchItemDto[]>;

const fetchAgentSessionOutputAttentionBatch = (
  organizationId: string,
  projectId: string,
  agentSessionIds: readonly string[],
): Promise<AgentSessionOutputAttentionBatchItemDto[]> =>
  postBatch<BatchReadAgentSessionOutputAttention200Response>(
    organizationId,
    projectId,
    "output-attention:batch",
    agentSessionIds,
  ) as Promise<AgentSessionOutputAttentionBatchItemDto[]>;

export const acknowledgeAgentSessionOutputAttention = async (
  organizationId: string,
  projectId: string,
  agentSessionId: string,
): Promise<AgentSessionOutputAttentionBatchItemDto> => {
  const response =
    await dataClient.request<SetAgentSessionOutputAttentionReady200Response>({
      method: "POST",
      url: `/organizations/${organizationId}/projects/${projectId}/agent-sessions/${agentSessionId}/output-attention:acknowledge`,
    });
  if (!response.data.data) {
    throw new Error("Output-attention acknowledgment returned no entry");
  }
  return response.data.data;
};

// ---------------------------------------------------------------------------
// Cache writes

export function writeAgentSessionCurrentState(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  entry: AgentSessionCurrentStateValue & { agentSessionId: string },
): void {
  queryClient.setQueryData<AgentSessionCurrentStateValue | null>(
    agentSessionKeys.currentState(
      organizationId,
      projectId,
      entry.agentSessionId,
    ),
    (current) => pickNewerRevision(current, toCurrentStateValue(entry)),
  );
}

export function writeAgentSessionOutputAttention(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  entry: AgentSessionOutputAttentionValue & { agentSessionId: string },
): void {
  queryClient.setQueryData<AgentSessionOutputAttentionValue | null>(
    agentSessionKeys.outputAttention(
      organizationId,
      projectId,
      entry.agentSessionId,
    ),
    (current) => pickNewerRevision(current, toOutputAttentionValue(entry)),
  );
}

export function writeAgentSessionContextSize(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  agentSessionId: string,
  contextSize: AgentSessionContextSize,
): void {
  queryClient.setQueryData<AgentSessionContextSize | null>(
    agentSessionKeys.contextSize(organizationId, projectId, agentSessionId),
    (current) => pickNewerContextSize(current, contextSize) ?? null,
  );
}

// ---------------------------------------------------------------------------
// Paced batch reads

export type AgentSessionBatchReadCoordinator = {
  /** Resolves once a batch read started after this call covered every id. */
  request(input: {
    organizationId: string;
    projectId: string;
    agentSessionIds: readonly string[];
  }): Promise<void>;
};

/** The shared paced batch read, addressed by Agent Session identity. */
export const createAgentSessionBatchReadCoordinator = <TEntry>(
  readBatch: (
    organizationId: string,
    projectId: string,
    agentSessionIds: string[],
  ) => Promise<readonly TEntry[]>,
  applyEntries: (
    organizationId: string,
    projectId: string,
    entries: readonly TEntry[],
  ) => void,
  clock?: HydrationClock,
): AgentSessionBatchReadCoordinator => {
  const coordinator = createPacedBatchReadCoordinator(
    readBatch,
    applyEntries,
    clock,
  );

  return {
    request: ({ organizationId, projectId, agentSessionIds }) =>
      coordinator.request({ organizationId, projectId, ids: agentSessionIds }),
  };
};

export const createAgentSessionCurrentStateCoordinator = (
  queryClient: QueryClient,
  clock?: HydrationClock,
): AgentSessionBatchReadCoordinator =>
  createAgentSessionBatchReadCoordinator(
    fetchAgentSessionCurrentStateBatch,
    (organizationId, projectId, entries) =>
      entries.forEach((entry) =>
        writeAgentSessionCurrentState(
          queryClient,
          organizationId,
          projectId,
          entry,
        ),
      ),
    clock,
  );

export const createAgentSessionOutputAttentionCoordinator = (
  queryClient: QueryClient,
  clock?: HydrationClock,
): AgentSessionBatchReadCoordinator =>
  createAgentSessionBatchReadCoordinator(
    fetchAgentSessionOutputAttentionBatch,
    (organizationId, projectId, entries) =>
      entries.forEach((entry) =>
        writeAgentSessionOutputAttention(
          queryClient,
          organizationId,
          projectId,
          entry,
        ),
      ),
    clock,
  );

const currentStateCoordinators = new WeakMap<
  QueryClient,
  AgentSessionBatchReadCoordinator
>();
const outputAttentionCoordinators = new WeakMap<
  QueryClient,
  AgentSessionBatchReadCoordinator
>();

const coordinatorFor = (
  registry: WeakMap<QueryClient, AgentSessionBatchReadCoordinator>,
  queryClient: QueryClient,
  create: (queryClient: QueryClient) => AgentSessionBatchReadCoordinator,
): AgentSessionBatchReadCoordinator => {
  const existing = registry.get(queryClient);
  if (existing) return existing;
  const coordinator = create(queryClient);
  registry.set(queryClient, coordinator);
  return coordinator;
};

const getAgentSessionCurrentStateCoordinator = (
  queryClient: QueryClient,
): AgentSessionBatchReadCoordinator =>
  coordinatorFor(
    currentStateCoordinators,
    queryClient,
    createAgentSessionCurrentStateCoordinator,
  );

const getAgentSessionOutputAttentionCoordinator = (
  queryClient: QueryClient,
): AgentSessionBatchReadCoordinator =>
  coordinatorFor(
    outputAttentionCoordinators,
    queryClient,
    createAgentSessionOutputAttentionCoordinator,
  );

// ---------------------------------------------------------------------------
// Query options

/**
 * Live current state for one session. `null` means the server holds no
 * revision for it; consumers then fall back to the canonical `currentState`
 * carried on the session itself.
 */
export function agentSessionCurrentStateQueryOptions(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  agentSessionId: string,
) {
  const queryKey = agentSessionKeys.currentState(
    organizationId,
    projectId,
    agentSessionId,
  );
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async (): Promise<AgentSessionCurrentStateValue | null> => {
      await getAgentSessionCurrentStateCoordinator(queryClient).request({
        organizationId,
        projectId,
        agentSessionIds: [agentSessionId],
      });
      return (
        queryClient.getQueryData<AgentSessionCurrentStateValue | null>(
          queryKey,
        ) ?? null
      );
    },
  });
}

/**
 * Output attention for one session. Reading is observational: it never
 * acknowledges; see `acknowledgeAgentSessionOutputAttention`.
 */
export function agentSessionOutputAttentionQueryOptions(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  agentSessionId: string,
) {
  const queryKey = agentSessionKeys.outputAttention(
    organizationId,
    projectId,
    agentSessionId,
  );
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async (): Promise<AgentSessionOutputAttentionValue | null> => {
      await getAgentSessionOutputAttentionCoordinator(queryClient).request({
        organizationId,
        projectId,
        agentSessionIds: [agentSessionId],
      });
      return (
        queryClient.getQueryData<AgentSessionOutputAttentionValue | null>(
          queryKey,
        ) ?? null
      );
    },
  });
}
