import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgentSessionCurrentState } from 'src/generated/model/agentSessionCurrentState';
import { RedisService } from 'src/core/redis/redis.service';

const TRANSIENT_STATES = new Set<AgentSessionCurrentState>([
  'STARTING',
  'GATHERING_CONTEXT',
  'THINKING',
  'WRITING',
]);

const OBSERVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local incomingState = ARGV[1]
local observedAt = ARGV[2]
local observedAtMs = tonumber(ARGV[3])
local transitionedAt = ARGV[4]
local organizationId = ARGV[5]
local projectId = ARGV[6]
local userId = ARGV[7]
local machineId = ARGV[8]
local connectionId = ARGV[9]
local transient = ARGV[10] == '1'
local leaseExpiresAt = ARGV[11]
local leaseExpiresAtMs = tonumber(ARGV[12])
local agentSessionId = ARGV[13]
local conversationId = ARGV[14]

local entry
if raw then
  entry = cjson.decode(raw)
  if tonumber(entry.schemaVersion) ~= 1 then
    return cjson.encode({ outcome = 'schema_mismatch' })
  end
else
  entry = {
    schemaVersion = 1,
    agentSessionId = agentSessionId,
    organizationId = organizationId,
    projectId = projectId,
    userId = userId,
    machineId = machineId,
    conversationId = conversationId ~= '' and conversationId or nil,
    currentState = incomingState,
    revision = 1,
    transitionedAt = transitionedAt,
    observedAt = observedAt,
    observedAtMs = observedAtMs
  }
  if transient then
    entry.runtimeOwnerMachineId = machineId
    entry.runtimeOwnerUserId = userId
    entry.runtimeOwnerConnectionId = connectionId
    entry.runtimeLeaseExpiresAt = leaseExpiresAt
    entry.runtimeLeaseExpiresAtMs = leaseExpiresAtMs
  end
  local encoded = cjson.encode(entry)
  redis.call('SET', KEYS[1], encoded)
  if transient then
    redis.call('ZADD', KEYS[2], leaseExpiresAtMs, agentSessionId)
  else
    redis.call('ZREM', KEYS[2], agentSessionId)
  end
  return cjson.encode({ outcome = 'transition', entry = entry })
end

local previousObservedAtMs = tonumber(entry.observedAtMs or 0)
if observedAtMs < previousObservedAtMs then
  return cjson.encode({ outcome = 'stale', entry = entry })
end
if observedAtMs == previousObservedAtMs and entry.currentState ~= incomingState then
  return cjson.encode({ outcome = 'stale', entry = entry })
end

if entry.currentState == incomingState then
  entry.organizationId = organizationId
  entry.projectId = projectId
  entry.userId = userId
  entry.machineId = machineId
  entry.conversationId = conversationId ~= '' and conversationId or nil
  entry.observedAt = observedAt
  entry.observedAtMs = observedAtMs
  if transient then
    entry.runtimeOwnerMachineId = machineId
    entry.runtimeOwnerUserId = userId
    entry.runtimeOwnerConnectionId = connectionId
    entry.runtimeLeaseExpiresAt = leaseExpiresAt
    entry.runtimeLeaseExpiresAtMs = leaseExpiresAtMs
  else
    entry.runtimeOwnerMachineId = nil
    entry.runtimeOwnerUserId = nil
    entry.runtimeOwnerConnectionId = nil
    entry.runtimeLeaseExpiresAt = nil
    entry.runtimeLeaseExpiresAtMs = nil
  end
  redis.call('SET', KEYS[1], cjson.encode(entry))
  if transient then
    redis.call('ZADD', KEYS[2], leaseExpiresAtMs, agentSessionId)
  else
    redis.call('ZREM', KEYS[2], agentSessionId)
  end
  return cjson.encode({ outcome = 'duplicate', entry = entry })
end

entry.organizationId = organizationId
entry.projectId = projectId
entry.userId = userId
entry.machineId = machineId
entry.conversationId = conversationId ~= '' and conversationId or nil
entry.currentState = incomingState
entry.revision = tonumber(entry.revision) + 1
entry.transitionedAt = transitionedAt
entry.observedAt = observedAt
entry.observedAtMs = observedAtMs
if transient then
  entry.runtimeOwnerMachineId = machineId
  entry.runtimeOwnerUserId = userId
  entry.runtimeOwnerConnectionId = connectionId
  entry.runtimeLeaseExpiresAt = leaseExpiresAt
  entry.runtimeLeaseExpiresAtMs = leaseExpiresAtMs
else
  entry.runtimeOwnerMachineId = nil
  entry.runtimeOwnerUserId = nil
  entry.runtimeOwnerConnectionId = nil
  entry.runtimeLeaseExpiresAt = nil
  entry.runtimeLeaseExpiresAtMs = nil
end
redis.call('SET', KEYS[1], cjson.encode(entry))
if transient then
  redis.call('ZADD', KEYS[2], leaseExpiresAtMs, agentSessionId)
else
  redis.call('ZREM', KEYS[2], agentSessionId)
end
return cjson.encode({ outcome = 'transition', entry = entry })
`;

const DISCONNECT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[6])
  return cjson.encode({ outcome = 'missing' })
end
local entry = cjson.decode(raw)
if tonumber(entry.schemaVersion) ~= 1 then
  redis.call('ZREM', KEYS[2], ARGV[6])
  return cjson.encode({ outcome = 'schema_mismatch' })
end
if entry.currentState ~= 'STARTING' and entry.currentState ~= 'GATHERING_CONTEXT' and entry.currentState ~= 'THINKING' and entry.currentState ~= 'WRITING' then
  redis.call('ZREM', KEYS[2], ARGV[6])
  return cjson.encode({ outcome = 'unchanged', entry = entry })
end
if entry.organizationId ~= ARGV[4] or entry.runtimeOwnerMachineId ~= ARGV[1] or entry.runtimeOwnerUserId ~= ARGV[2] or entry.runtimeOwnerConnectionId ~= ARGV[3] then
  return cjson.encode({ outcome = 'unchanged', entry = entry })
end
entry.currentState = 'IDLE'
entry.revision = tonumber(entry.revision) + 1
entry.transitionedAt = ARGV[5]
entry.runtimeOwnerMachineId = nil
entry.runtimeOwnerUserId = nil
entry.runtimeOwnerConnectionId = nil
entry.runtimeLeaseExpiresAt = nil
entry.runtimeLeaseExpiresAtMs = nil
redis.call('SET', KEYS[1], cjson.encode(entry))
redis.call('ZREM', KEYS[2], ARGV[6])
return cjson.encode({ outcome = 'transition', entry = entry })
`;

const EXPIRE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[3])
  return cjson.encode({ outcome = 'missing' })
end
local entry = cjson.decode(raw)
if tonumber(entry.schemaVersion) ~= 1 then
  redis.call('ZREM', KEYS[2], ARGV[3])
  return cjson.encode({ outcome = 'schema_mismatch' })
end
if entry.currentState ~= 'STARTING' and entry.currentState ~= 'GATHERING_CONTEXT' and entry.currentState ~= 'THINKING' and entry.currentState ~= 'WRITING' then
  redis.call('ZREM', KEYS[2], ARGV[3])
  return cjson.encode({ outcome = 'unchanged', entry = entry })
end
if tonumber(entry.runtimeLeaseExpiresAtMs or 0) > tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[2], entry.runtimeLeaseExpiresAtMs, ARGV[3])
  return cjson.encode({ outcome = 'unchanged', entry = entry })
end
entry.currentState = 'IDLE'
entry.revision = tonumber(entry.revision) + 1
entry.transitionedAt = ARGV[2]
entry.runtimeOwnerMachineId = nil
entry.runtimeOwnerUserId = nil
entry.runtimeOwnerConnectionId = nil
entry.runtimeLeaseExpiresAt = nil
entry.runtimeLeaseExpiresAtMs = nil
redis.call('SET', KEYS[1], cjson.encode(entry))
redis.call('ZREM', KEYS[2], ARGV[3])
return cjson.encode({ outcome = 'transition', entry = entry })
`;

const CLAIM_DUE_SCRIPT = `
local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, member in ipairs(members) do
  redis.call('ZREM', KEYS[1], member)
end
if #members == 0 then
  return '[]'
end
return cjson.encode(members)
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const REBUILD_LEASE_INDEX_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 0
end
local entry = cjson.decode(raw)
if tonumber(entry.schemaVersion) ~= 1 then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 0
end
if (entry.currentState == 'STARTING' or entry.currentState == 'GATHERING_CONTEXT' or entry.currentState == 'THINKING' or entry.currentState == 'WRITING') and tonumber(entry.runtimeLeaseExpiresAtMs or 0) > 0 then
  redis.call('ZADD', KEYS[2], entry.runtimeLeaseExpiresAtMs, ARGV[1])
  return 1
end
redis.call('ZREM', KEYS[2], ARGV[1])
return 0
`;

export type AgentSessionCurrentStateProjectionEntry = {
  schemaVersion: 1;
  agentSessionId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  machineId: string;
  currentState: AgentSessionCurrentState;
  revision: number;
  transitionedAt: string;
  observedAt: string;
  observedAtMs: number;
  runtimeOwnerMachineId?: string;
  runtimeOwnerUserId?: string;
  runtimeOwnerConnectionId?: string;
  runtimeLeaseExpiresAt?: string;
  runtimeLeaseExpiresAtMs?: number;
  conversationId?: string | null;
};

export type AgentSessionCurrentStateObservationContext = {
  agentSessionId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  machineId: string;
  connectionId: string;
  conversationId?: string | null;
};

export type AgentSessionCurrentStateTransition = {
  entry: AgentSessionCurrentStateProjectionEntry;
  reason: 'observation' | 'disconnect' | 'lease_expiry';
};

export type AgentSessionCurrentStateProjectionResult =
  | { outcome: 'transition'; transition: AgentSessionCurrentStateTransition }
  | { outcome: 'duplicate'; entry: AgentSessionCurrentStateProjectionEntry }
  | { outcome: 'stale'; entry: AgentSessionCurrentStateProjectionEntry }
  | { outcome: 'unchanged'; entry?: AgentSessionCurrentStateProjectionEntry }
  | { outcome: 'missing' }
  | { outcome: 'schema_mismatch' };

export type AgentSessionCurrentStateWrite = {
  context: AgentSessionCurrentStateObservationContext;
  currentState: AgentSessionCurrentState;
  observedAt: string;
};

type TransitionSink = (
  transition: AgentSessionCurrentStateTransition,
) => void | Promise<void>;

type ScriptResult = {
  outcome: AgentSessionCurrentStateProjectionResult['outcome'];
  entry?: AgentSessionCurrentStateProjectionEntry;
};

@Injectable()
export class AgentSessionCurrentStateProjection
  implements OnModuleInit, OnModuleDestroy
{
  static readonly KEY_PREFIX = 'heyhey:agent-session:current-state:v1';
  static readonly LEASE_INDEX_KEY = `${AgentSessionCurrentStateProjection.KEY_PREFIX}:lease-expiry-index`;
  static readonly LEASE_SWEEP_LOCK_KEY = `${AgentSessionCurrentStateProjection.KEY_PREFIX}:lease-sweep-lock`;
  static readonly LEASE_TTL_MS = 25_000;
  static readonly LEASE_SWEEP_INTERVAL_MS = 5_000;
  static readonly LEASE_SWEEP_LOCK_TTL_MS = 15_000;
  static readonly LEASE_SWEEP_BATCH_SIZE = 100;

  private readonly logger = new Logger(AgentSessionCurrentStateProjection.name);
  private transitionSink?: TransitionSink;
  private leaseSweepTimer?: ReturnType<typeof setInterval>;
  private readonly counters = {
    reads: 0,
    writes: 0,
    acceptedTransitions: 0,
    duplicateObservations: 0,
    staleObservations: 0,
    leaseExpiries: 0,
    redisErrors: 0,
    authorizationAccepted: 0,
    authorizationRejected: 0,
    fanoutEmissions: 0,
    fanoutErrors: 0,
    redisLatencyMs: 0,
  };

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    void this.rebuildLeaseIndex().catch((error) => {
      this.logger.error('[current-state] lease index rebuild failed', error);
    });
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.leaseSweepTimer = setInterval(() => {
      void this.sweepExpiredLeases().catch((error) => {
        this.logger.error('[current-state] lease sweep failed', error);
      });
    }, AgentSessionCurrentStateProjection.LEASE_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.leaseSweepTimer) {
      clearInterval(this.leaseSweepTimer);
      this.leaseSweepTimer = undefined;
    }
  }

  setTransitionSink(sink: TransitionSink): void {
    this.transitionSink = sink;
  }

  getMetrics(): Readonly<typeof this.counters> {
    return { ...this.counters };
  }

  async read(
    agentSessionId: string,
  ): Promise<AgentSessionCurrentStateProjectionEntry | null> {
    const startedAt = Date.now();
    this.counters.reads += 1;
    try {
      const raw = await this.redisService
        .getClient()
        .get(this.key(agentSessionId));
      this.logger.debug('[current-state] redis read', {
        agentSessionId,
        hit: raw !== null,
        latencyMs: Date.now() - startedAt,
      });
      this.counters.redisLatencyMs += Date.now() - startedAt;
      return raw === null ? null : this.parseEntry(raw);
    } catch (error) {
      this.counters.redisErrors += 1;
      this.logger.error('[current-state] redis read failed', {
        agentSessionId,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async readMany(
    agentSessionIds: readonly string[],
  ): Promise<Map<string, AgentSessionCurrentStateProjectionEntry>> {
    if (agentSessionIds.length === 0) {
      return new Map();
    }
    const startedAt = Date.now();
    this.counters.reads += agentSessionIds.length;
    try {
      const values = await this.redisService
        .getClient()
        .mget(...agentSessionIds.map((id) => this.key(id)));
      const entries = new Map<
        string,
        AgentSessionCurrentStateProjectionEntry
      >();
      values.forEach((raw, index) => {
        const agentSessionId = agentSessionIds[index];
        if (raw !== null && agentSessionId !== undefined) {
          const entry = this.parseEntry(raw);
          entries.set(agentSessionId, entry);
        }
      });
      this.logger.debug('[current-state] redis batch read', {
        requested: agentSessionIds.length,
        returned: entries.size,
        latencyMs: Date.now() - startedAt,
      });
      this.counters.redisLatencyMs += Date.now() - startedAt;
      return entries;
    } catch (error) {
      this.counters.redisErrors += 1;
      this.logger.error('[current-state] redis batch read failed', {
        requested: agentSessionIds.length,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async observe(
    context: AgentSessionCurrentStateObservationContext,
    currentState: AgentSessionCurrentState,
    observedAt: string,
  ): Promise<AgentSessionCurrentStateProjectionResult> {
    const observedAtDate = this.parseTimestamp(observedAt, 'observedAt');
    const now = new Date();
    const transient = TRANSIENT_STATES.has(currentState);
    const leaseExpiresAt = new Date(
      now.getTime() + AgentSessionCurrentStateProjection.LEASE_TTL_MS,
    );
    const result = await this.eval(
      OBSERVE_SCRIPT,
      [
        this.key(context.agentSessionId),
        AgentSessionCurrentStateProjection.LEASE_INDEX_KEY,
      ],
      [
        currentState,
        observedAt,
        String(observedAtDate.getTime()),
        now.toISOString(),
        context.organizationId,
        context.projectId,
        context.userId,
        context.machineId,
        context.connectionId,
        transient ? '1' : '0',
        transient ? leaseExpiresAt.toISOString() : '',
        transient ? String(leaseExpiresAt.getTime()) : '0',
        context.agentSessionId,
        context.conversationId ?? '',
      ],
    );
    const normalized = this.withConversationId(result, context.conversationId);
    if (normalized.outcome === 'transition') {
      this.counters.acceptedTransitions += 1;
      await this.publishTransition(normalized.transition);
    } else if (normalized.outcome === 'duplicate') {
      this.counters.duplicateObservations += 1;
    } else if (normalized.outcome === 'stale') {
      this.counters.staleObservations += 1;
    }
    return normalized;
  }

  async observeMany(
    writes: readonly AgentSessionCurrentStateWrite[],
  ): Promise<AgentSessionCurrentStateProjectionResult[]> {
    return Promise.all(
      writes.map(({ context, currentState, observedAt }) =>
        this.observe(context, currentState, observedAt),
      ),
    );
  }

  recordAuthorizationDecision(authorized: boolean): void {
    if (authorized) {
      this.counters.authorizationAccepted += 1;
    } else {
      this.counters.authorizationRejected += 1;
    }
  }

  async disconnect(
    context: Pick<
      AgentSessionCurrentStateObservationContext,
      'organizationId' | 'userId' | 'machineId' | 'connectionId'
    >,
  ): Promise<number> {
    return this.transitionRuntimeOwnedEntries(
      context,
      DISCONNECT_SCRIPT,
      'disconnect',
      [
        context.machineId,
        context.userId,
        context.connectionId,
        context.organizationId,
        new Date().toISOString(),
      ],
    );
  }

  async sweepExpiredLeases(now = new Date()): Promise<number> {
    const redis = this.redisService.getClient();
    const lockToken = randomUUID();
    const lockResult = await redis.set(
      AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_KEY,
      lockToken,
      'PX',
      AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_TTL_MS,
      'NX',
    );
    if (lockResult !== 'OK') {
      return 0;
    }

    let transitioned = 0;
    try {
      while (true) {
        const claimedAgentSessionIds = await this.eval<string[]>(
          CLAIM_DUE_SCRIPT,
          [AgentSessionCurrentStateProjection.LEASE_INDEX_KEY],
          [
            String(now.getTime()),
            String(AgentSessionCurrentStateProjection.LEASE_SWEEP_BATCH_SIZE),
          ],
        );
        if (claimedAgentSessionIds.length === 0) {
          break;
        }

        for (const agentSessionId of claimedAgentSessionIds) {
          const result = await this.eval<ScriptResult>(
            EXPIRE_SCRIPT,
            [
              this.key(agentSessionId),
              AgentSessionCurrentStateProjection.LEASE_INDEX_KEY,
            ],
            [String(now.getTime()), now.toISOString(), agentSessionId],
          );
          if (result.outcome === 'transition' && result.entry) {
            transitioned += 1;
            this.counters.leaseExpiries += 1;
            await this.publishTransition({
              entry: result.entry,
              reason: 'lease_expiry',
            });
          }
        }
      }
      if (transitioned > 0) {
        this.logger.log('[current-state] lease sweep transitioned entries', {
          transitioned,
        });
      }
      return transitioned;
    } finally {
      await this.eval<number>(
        RELEASE_LOCK_SCRIPT,
        [AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_KEY],
        [lockToken],
      );
    }
  }

  private async rebuildLeaseIndex(): Promise<void> {
    const redis = this.redisService.getClient();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${AgentSessionCurrentStateProjection.KEY_PREFIX}:*`,
        'COUNT',
        '100',
      );
      cursor = nextCursor;
      for (const key of keys) {
        if (
          key === AgentSessionCurrentStateProjection.LEASE_INDEX_KEY ||
          key === AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_KEY
        ) {
          continue;
        }
        await this.eval<number>(
          REBUILD_LEASE_INDEX_SCRIPT,
          [key, AgentSessionCurrentStateProjection.LEASE_INDEX_KEY],
          [this.agentSessionIdFromKey(key)],
        );
      }
    } while (cursor !== '0');
  }

  private async transitionRuntimeOwnedEntries(
    context: Pick<
      AgentSessionCurrentStateObservationContext,
      'organizationId' | 'userId' | 'machineId' | 'connectionId'
    >,
    script: string,
    reason: 'disconnect',
    args: string[],
  ): Promise<number> {
    const redis = this.redisService.getClient();
    let cursor = '0';
    let transitioned = 0;
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${AgentSessionCurrentStateProjection.KEY_PREFIX}:*`,
        'COUNT',
        '100',
      );
      cursor = nextCursor;
      for (const key of keys) {
        if (
          key === AgentSessionCurrentStateProjection.LEASE_INDEX_KEY ||
          key === AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_KEY
        ) {
          continue;
        }
        const result = await this.eval<ScriptResult>(
          script,
          [key, AgentSessionCurrentStateProjection.LEASE_INDEX_KEY],
          [...args, this.agentSessionIdFromKey(key)],
        );
        if (result.outcome === 'transition' && result.entry) {
          if (
            result.entry.organizationId !== context.organizationId ||
            result.entry.userId !== context.userId ||
            result.entry.machineId !== context.machineId
          ) {
            this.logger.warn('[current-state] ignored cross-scope transition', {
              key,
              reason,
              organizationId: context.organizationId,
            });
            continue;
          }
          transitioned += 1;
          this.counters.acceptedTransitions += 1;
          await this.publishTransition({ entry: result.entry, reason });
        }
      }
    } while (cursor !== '0');
    return transitioned;
  }

  private async publishTransition(
    transition: AgentSessionCurrentStateTransition,
  ): Promise<void> {
    if (!this.transitionSink) {
      this.logger.warn('[current-state] transition has no fan-out sink', {
        agentSessionId: transition.entry.agentSessionId,
        reason: transition.reason,
      });
      return;
    }
    try {
      await this.transitionSink(transition);
      this.counters.fanoutEmissions += 1;
    } catch (error) {
      this.counters.fanoutErrors += 1;
      this.logger.error('[current-state] fan-out sink failed', {
        agentSessionId: transition.entry.agentSessionId,
        revision: transition.entry.revision,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async eval<T = ScriptResult>(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<T> {
    this.counters.writes += 1;
    const startedAt = Date.now();
    try {
      const raw = await this.redisService
        .getClient()
        .eval(script, keys.length, ...keys, ...args);
      this.logger.verbose('[current-state] redis CAS', {
        latencyMs: Date.now() - startedAt,
        outcome: typeof raw === 'string' ? JSON.parse(raw).outcome : 'unknown',
      });
      this.counters.redisLatencyMs += Date.now() - startedAt;
      return JSON.parse(String(raw)) as T;
    } catch (error) {
      this.counters.redisErrors += 1;
      this.logger.error('[current-state] redis CAS failed', {
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private withConversationId(
    result: ScriptResult,
    conversationId: string | null | undefined,
  ): AgentSessionCurrentStateProjectionResult {
    if (!result.entry) {
      return {
        outcome: result.outcome,
      } as AgentSessionCurrentStateProjectionResult;
    }
    const entry = {
      ...result.entry,
      conversationId,
    };
    if (result.outcome === 'transition') {
      return {
        outcome: 'transition',
        transition: { entry, reason: 'observation' },
      };
    }
    if (result.outcome === 'duplicate' || result.outcome === 'stale') {
      return { outcome: result.outcome, entry };
    }
    return { outcome: result.outcome, entry };
  }

  private parseEntry(raw: string): AgentSessionCurrentStateProjectionEntry {
    const entry = JSON.parse(raw) as AgentSessionCurrentStateProjectionEntry;
    if (entry.schemaVersion !== 1 || !entry.agentSessionId) {
      throw new Error('Invalid Agent Session current-state projection schema');
    }
    return entry;
  }

  private parseTimestamp(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new Error(`${field} must be an ISO timestamp`);
    }
    return parsed;
  }

  private key(agentSessionId: string): string {
    return `${AgentSessionCurrentStateProjection.KEY_PREFIX}:${agentSessionId}`;
  }

  private agentSessionIdFromKey(key: string): string {
    const prefix = `${AgentSessionCurrentStateProjection.KEY_PREFIX}:`;
    if (!key.startsWith(prefix)) {
      throw new Error(`Invalid Agent Session current-state key: ${key}`);
    }
    return key.slice(prefix.length);
  }
}
