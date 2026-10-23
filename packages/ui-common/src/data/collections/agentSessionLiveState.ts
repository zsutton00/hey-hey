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

const BATCH_LIMIT = 100;
const DISPATCH_INTERVAL_MS = 1_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 30_000;

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

export const normalizeAgentSessionIds = (
  agentSessionIds: readonly string[],
): string[] =>
  Array.from(
    new Set(
      agentSessionIds
        .map((agentSessionId) => agentSessionId.trim())
        .filter((agentSessionId) => agentSessionId.length > 0),
    ),
  );

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

interface AgentSessionBatchReadRequest {
  organizationId: string;
  projectId: string;
  agentSessionIds: readonly string[];
}

export interface AgentSessionBatchReadCoordinator {
  /** Resolves once a batch read started after this call covered every id. */
  request(input: AgentSessionBatchReadRequest): Promise<void>;
}

export interface HydrationClock {
  now(): number;
  setTimeout(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout>;
  random(): number;
}

const systemHydrationClock: HydrationClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  random: () => Math.random(),
};

interface BatchWaiter {
  requiredDispatch: number;
  pendingIds: Set<string>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface BatchScope {
  organizationId: string;
  projectId: string;
  pendingIds: Set<string>;
  dispatchGeneration: number;
  activeRequest: boolean;
  nextPermittedDispatchAt: number;
  consecutiveRateLimits: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  waiters: Set<BatchWaiter>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRetryAfterMs = (error: unknown, now: number): number | undefined => {
  if (
    !isRecord(error) ||
    !isRecord(error.response) ||
    !isRecord(error.response.headers)
  ) {
    return undefined;
  }

  const retryAfter =
    error.response.headers["retry-after"] ??
    error.response.headers["Retry-After"];
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    return Math.max(0, retryAfter * 1_000);
  }
  if (typeof retryAfter !== "string") return undefined;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const retryAt = Date.parse(retryAfter);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now);
};

const isRateLimitError = (error: unknown): boolean =>
  isRecord(error) && isRecord(error.response) && error.response.status === 429;

const getBoundedJitteredBackoffMs = (
  consecutiveRateLimits: number,
  random: () => number,
): number => {
  const exponentialDelay = Math.min(
    MAX_RATE_LIMIT_BACKOFF_MS,
    DISPATCH_INTERVAL_MS * 2 ** (consecutiveRateLimits - 1),
  );
  const jitterFactor = 0.5 + random();
  return Math.min(
    MAX_RATE_LIMIT_BACKOFF_MS,
    Math.round(exponentialDelay * jitterFactor),
  );
};

const settleWaitersForIds = (
  scope: BatchScope,
  agentSessionIds: ReadonlySet<string>,
  dispatchGeneration: number,
): void => {
  scope.waiters.forEach((waiter) => {
    if (waiter.requiredDispatch > dispatchGeneration) return;
    agentSessionIds.forEach((agentSessionId) =>
      waiter.pendingIds.delete(agentSessionId),
    );
    if (waiter.pendingIds.size === 0) {
      scope.waiters.delete(waiter);
      waiter.resolve();
    }
  });
};

/**
 * Coordinates one batch endpoint across every consumer. Ids requested in the
 * same tick join one request per project scope; at most one request runs per
 * scope, and requests start at least one second apart, so at most one
 * trailing batch waits behind the active one. An HTTP 429 requeues its ids and
 * holds the whole scope until `Retry-After` or a bounded, jittered
 * exponential backoff has passed; waiters stay pending meanwhile rather than
 * failing. Any other failure rejects only waiters requiring IDs from that
 * batch; independent queued reads retain their pacing and continue.
 */
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
  clock: HydrationClock = systemHydrationClock,
): AgentSessionBatchReadCoordinator => {
  const scopes = new Map<string, BatchScope>();

  const getOrCreateScope = (
    organizationId: string,
    projectId: string,
  ): BatchScope => {
    const key = `${organizationId}\u0000${projectId}`;
    const existing = scopes.get(key);
    if (existing) return existing;

    const scope: BatchScope = {
      organizationId,
      projectId,
      pendingIds: new Set(),
      dispatchGeneration: 0,
      activeRequest: false,
      nextPermittedDispatchAt: 0,
      consecutiveRateLimits: 0,
      timer: undefined,
      waiters: new Set(),
    };
    scopes.set(key, scope);
    return scope;
  };

  const scheduleScope = (scope: BatchScope): void => {
    if (scope.activeRequest || scope.pendingIds.size === 0 || scope.timer) {
      return;
    }

    const delay = Math.max(0, scope.nextPermittedDispatchAt - clock.now());
    scope.timer = clock.setTimeout(() => {
      scope.timer = undefined;
      void readScope(scope);
    }, delay);
  };

  const readScope = async (scope: BatchScope): Promise<void> => {
    if (scope.activeRequest || scope.pendingIds.size === 0) return;

    const now = clock.now();
    if (now < scope.nextPermittedDispatchAt) {
      scheduleScope(scope);
      return;
    }

    const ids = [...scope.pendingIds].slice(0, BATCH_LIMIT);
    ids.forEach((agentSessionId) => scope.pendingIds.delete(agentSessionId));
    scope.activeRequest = true;
    const dispatchGeneration = ++scope.dispatchGeneration;
    scope.nextPermittedDispatchAt = now + DISPATCH_INTERVAL_MS;

    try {
      const entries = await readBatch(
        scope.organizationId,
        scope.projectId,
        ids,
      );
      applyEntries(scope.organizationId, scope.projectId, entries);
      scope.consecutiveRateLimits = 0;
      settleWaitersForIds(scope, new Set(ids), dispatchGeneration);
    } catch (error: unknown) {
      if (isRateLimitError(error)) {
        scope.consecutiveRateLimits += 1;
        ids.forEach((agentSessionId) => scope.pendingIds.add(agentSessionId));
        const retryAfterMs = getRetryAfterMs(error, now) ?? 0;
        const backoffMs = getBoundedJitteredBackoffMs(
          scope.consecutiveRateLimits,
          clock.random,
        );
        scope.nextPermittedDispatchAt = Math.max(
          scope.nextPermittedDispatchAt,
          now + retryAfterMs,
          now + backoffMs,
        );
      } else {
        scope.waiters.forEach((waiter) => {
          if (waiter.requiredDispatch > dispatchGeneration) return;
          if (
            !ids.some((agentSessionId) => waiter.pendingIds.has(agentSessionId))
          ) {
            return;
          }
          scope.waiters.delete(waiter);
          waiter.reject(error);
        });
      }
    } finally {
      scope.activeRequest = false;
      scheduleScope(scope);
    }
  };

  return {
    request: ({ organizationId, projectId, agentSessionIds }) => {
      const ids = normalizeAgentSessionIds(agentSessionIds);
      if (ids.length === 0) return Promise.resolve();

      const scope = getOrCreateScope(organizationId, projectId);
      const promise = new Promise<void>((resolve, reject) => {
        scope.waiters.add({
          requiredDispatch: scope.dispatchGeneration + 1,
          pendingIds: new Set(ids),
          resolve,
          reject,
        });
      });

      // Active transport work predates this request and cannot satisfy it.
      ids.forEach((agentSessionId) => scope.pendingIds.add(agentSessionId));
      scheduleScope(scope);
      return promise;
    },
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
