import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConversationPhase } from 'src/generated/model/conversationPhase';
import { RedisService } from 'src/core/redis/redis.service';

export interface ConversationPhaseObservationContext {
  connectionId: string;
  userId: string;
  machineId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
}

export interface ConversationPhaseProjectionEntry {
  schemaVersion: 1;
  conversationId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  machineId: string;
  connectionId: string;
  phase: ConversationPhase;
  revision: number;
  transitionedAt: string;
  observedAt: string;
  observedAtMs: number;
  runtimeLeaseExpiresAt?: string;
  runtimeLeaseExpiresAtMs?: number;
}

export interface ConversationPhaseTransition {
  entry: ConversationPhaseProjectionEntry;
  reason: 'observation' | 'disconnect' | 'lease_expiry';
}

export interface ConversationPhaseProjectionResult {
  outcome: 'transition' | 'duplicate' | 'stale' | 'missing';
  entry?: ConversationPhaseProjectionEntry;
}

const OBSERVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local phase = ARGV[1]
local observedAt = ARGV[2]
local observedAtMs = tonumber(ARGV[3])
local transitionedAt = ARGV[4]
local organizationId = ARGV[5]
local projectId = ARGV[6]
local userId = ARGV[7]
local machineId = ARGV[8]
local connectionId = ARGV[9]
local conversationId = ARGV[10]
local leaseExpiresAt = ARGV[11]
local leaseExpiresAtMs = tonumber(ARGV[12])
local cacheTtlMs = ARGV[13]

local entry
if raw then
  entry = cjson.decode(raw)
  local previousObservedAtMs = tonumber(entry.observedAtMs or 0)
  if observedAtMs < previousObservedAtMs then
    return cjson.encode({ outcome = 'stale', entry = entry })
  end
  if observedAtMs == previousObservedAtMs and entry.phase ~= phase then
    return cjson.encode({ outcome = 'stale', entry = entry })
  end
else
  entry = {
    schemaVersion = 1,
    conversationId = conversationId,
    organizationId = organizationId,
    projectId = projectId,
    userId = userId,
    machineId = machineId,
    connectionId = connectionId,
    phase = phase,
    revision = 1,
    transitionedAt = transitionedAt,
    observedAt = observedAt,
    observedAtMs = observedAtMs
  }
end

local duplicate = entry.phase == phase
if not duplicate then
  entry.revision = tonumber(entry.revision) + 1
  entry.transitionedAt = transitionedAt
end
entry.organizationId = organizationId
entry.projectId = projectId
entry.userId = userId
entry.machineId = machineId
entry.connectionId = connectionId
entry.observedAt = observedAt
entry.observedAtMs = observedAtMs
entry.phase = phase
if phase == 'idle' or phase == 'awaiting_approval' then
  entry.runtimeLeaseExpiresAt = nil
  entry.runtimeLeaseExpiresAtMs = nil
  redis.call('SET', KEYS[1], cjson.encode(entry))
  redis.call('ZREM', KEYS[2], conversationId)
else
  entry.runtimeLeaseExpiresAt = leaseExpiresAt
  entry.runtimeLeaseExpiresAtMs = leaseExpiresAtMs
  redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', cacheTtlMs)
  redis.call('ZADD', KEYS[2], leaseExpiresAtMs, conversationId)
end
return cjson.encode({ outcome = duplicate and 'duplicate' or 'transition', entry = entry })
`;

const SETTLE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[2])
  return cjson.encode({ outcome = 'missing' })
end
local entry = cjson.decode(raw)
if entry.connectionId ~= ARGV[1] then
  return cjson.encode({ outcome = 'missing' })
end
if entry.phase == 'idle' then
  redis.call('ZREM', KEYS[2], ARGV[2])
  return cjson.encode({ outcome = 'duplicate', entry = entry })
end
entry.phase = 'idle'
entry.revision = tonumber(entry.revision) + 1
entry.transitionedAt = ARGV[3]
entry.observedAt = ARGV[3]
entry.observedAtMs = tonumber(ARGV[4])
entry.runtimeLeaseExpiresAt = nil
entry.runtimeLeaseExpiresAtMs = nil
redis.call('SET', KEYS[1], cjson.encode(entry))
redis.call('ZREM', KEYS[2], ARGV[2])
return cjson.encode({ outcome = 'transition', entry = entry })
`;

const CLAIM_DUE_SCRIPT = `
local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
for _, member in ipairs(members) do
  redis.call('ZREM', KEYS[1], member)
end
if #members == 0 then
  return '[]'
end
return cjson.encode(members)
`;

const EXPIRE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ outcome = 'missing' })
end
local entry = cjson.decode(raw)
if entry.phase == 'idle' or entry.phase == 'awaiting_approval' then
  return cjson.encode({ outcome = 'missing' })
end
if tonumber(entry.runtimeLeaseExpiresAtMs or 0) > tonumber(ARGV[1]) then
  return cjson.encode({ outcome = 'missing' })
end
entry.phase = 'idle'
entry.revision = tonumber(entry.revision) + 1
entry.transitionedAt = ARGV[2]
entry.observedAt = ARGV[2]
entry.observedAtMs = tonumber(ARGV[3])
entry.runtimeLeaseExpiresAt = nil
entry.runtimeLeaseExpiresAtMs = nil
redis.call('SET', KEYS[1], cjson.encode(entry))
return cjson.encode({ outcome = 'transition', entry = entry })
`;

@Injectable()
export class ConversationPhaseProjection implements OnModuleInit, OnModuleDestroy {
  static readonly KEY_PREFIX = 'heyhey:conversation:phase:v1';
  static readonly LEASE_INDEX_KEY = `${ConversationPhaseProjection.KEY_PREFIX}:lease-expiry-index`;
  static readonly LEASE_TTL_MS = 25_000;
  static readonly CACHE_TTL_MS = 30_000;
  static readonly SWEEP_INTERVAL_MS = 5_000;
  static readonly SWEEP_BATCH_SIZE = 100;

  private readonly logger = new Logger(ConversationPhaseProjection.name);
  private transitionSink?: (transition: ConversationPhaseTransition) => Promise<void> | void;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.sweepTimer = setInterval(() => {
      void this.sweepExpiredLeases().catch((error) => {
        this.logger.error('[conversation-phase] lease sweep failed', error);
      });
    }, ConversationPhaseProjection.SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  setTransitionSink(
    sink: (transition: ConversationPhaseTransition) => Promise<void> | void,
  ): void {
    this.transitionSink = sink;
  }

  async read(conversationId: string): Promise<ConversationPhaseProjectionEntry | null> {
    const raw = await this.redisService.getClient().get(this.key(conversationId));
    return raw === null ? null : (JSON.parse(raw) as ConversationPhaseProjectionEntry);
  }

  async observe(
    context: ConversationPhaseObservationContext,
    phase: ConversationPhase,
    observedAt: string,
  ): Promise<ConversationPhaseProjectionResult> {
    const observedAtDate = new Date(observedAt);
    if (Number.isNaN(observedAtDate.getTime())) {
      throw new Error('Invalid conversation phase observedAt timestamp.');
    }
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + ConversationPhaseProjection.LEASE_TTL_MS,
    );
    const result = await this.eval<ConversationPhaseProjectionResult>(
      OBSERVE_SCRIPT,
      [this.key(context.conversationId), ConversationPhaseProjection.LEASE_INDEX_KEY],
      [
        phase,
        observedAt,
        String(observedAtDate.getTime()),
        now.toISOString(),
        context.organizationId,
        context.projectId,
        context.userId,
        context.machineId,
        context.connectionId,
        context.conversationId,
        leaseExpiresAt.toISOString(),
        String(leaseExpiresAt.getTime()),
        String(ConversationPhaseProjection.CACHE_TTL_MS),
      ],
    );
    if (result.outcome === 'transition' && result.entry) {
      await this.publishTransition({ entry: result.entry, reason: 'observation' });
    }
    return result;
  }

  async disconnect(
    context: Pick<ConversationPhaseObservationContext, 'connectionId'>,
  ): Promise<number> {
    const redis = this.redisService.getClient();
    const keys = await redis.keys(`${ConversationPhaseProjection.KEY_PREFIX}:*`);
    let transitioned = 0;
    for (const key of keys) {
      if (key === ConversationPhaseProjection.LEASE_INDEX_KEY) continue;
      const result = await this.eval<ConversationPhaseProjectionResult>(
        SETTLE_SCRIPT,
        [key, ConversationPhaseProjection.LEASE_INDEX_KEY],
        [
          context.connectionId,
          key.slice(`${ConversationPhaseProjection.KEY_PREFIX}:`.length),
          new Date().toISOString(),
          String(Date.now()),
        ],
      );
      if (result.outcome === 'transition' && result.entry) {
        transitioned += 1;
        await this.publishTransition({ entry: result.entry, reason: 'disconnect' });
      }
    }
    return transitioned;
  }

  async sweepExpiredLeases(now = new Date()): Promise<number> {
    const conversationIds = await this.eval<string[]>(
      CLAIM_DUE_SCRIPT,
      [ConversationPhaseProjection.LEASE_INDEX_KEY],
      [String(now.getTime()), String(ConversationPhaseProjection.SWEEP_BATCH_SIZE)],
    );
    let transitioned = 0;
    for (const conversationId of conversationIds) {
      const result = await this.eval<ConversationPhaseProjectionResult>(
        EXPIRE_SCRIPT,
        [this.key(conversationId)],
        [String(now.getTime()), now.toISOString(), String(now.getTime())],
      );
      if (result.outcome === 'transition' && result.entry) {
        transitioned += 1;
        await this.publishTransition({ entry: result.entry, reason: 'lease_expiry' });
      }
    }
    return transitioned;
  }

  private key(conversationId: string): string {
    return `${ConversationPhaseProjection.KEY_PREFIX}:${conversationId}`;
  }

  private async publishTransition(transition: ConversationPhaseTransition): Promise<void> {
    if (!this.transitionSink) {
      this.logger.warn('[conversation-phase] transition has no fan-out sink', {
        conversationId: transition.entry.conversationId,
        phase: transition.entry.phase,
        reason: transition.reason,
      });
      return;
    }
    await this.transitionSink(transition);
  }

  private async eval<T>(script: string, keys: string[], args: string[]): Promise<T> {
    const raw = await this.redisService.getClient().eval(script, keys.length, ...keys, ...args);
    return JSON.parse(String(raw)) as T;
  }
}
