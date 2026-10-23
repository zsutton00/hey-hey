import { Injectable, Logger } from '@nestjs/common';
import {
  AgentSessionOutputAttentionState,
  AgentSessionOutputAttentionBatchItemDto,
} from 'src/generated';
import { RedisService } from 'src/core/redis/redis.service';

const TRANSITION_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
local current = nil
if currentRaw then
  current = cjson.decode(currentRaw)
  if tonumber(current.schemaVersion) ~= 1 then
    return cjson.encode({ outcome = 'schema_mismatch' })
  end
  if current.state == ARGV[1] then
    return cjson.encode({ outcome = 'duplicate', entry = current })
  end
end

if not current and ARGV[1] == 'NONE' then
  return cjson.encode({
    outcome = 'duplicate',
    entry = {
      schemaVersion = 1,
      agentSessionId = ARGV[2],
      organizationId = ARGV[3],
      projectId = ARGV[4],
      userId = ARGV[5],
      state = ARGV[1],
      revision = 0,
      changedAt = ARGV[6]
    }
  })
end

local revision = current and (tonumber(current.revision) + 1) or 1
local entry = {
  schemaVersion = 1,
  agentSessionId = ARGV[2],
  organizationId = ARGV[3],
  projectId = ARGV[4],
  userId = ARGV[5],
  state = ARGV[1],
  revision = revision,
  changedAt = ARGV[6]
}
redis.call('SET', KEYS[1], cjson.encode(entry))
return cjson.encode({ outcome = 'transition', entry = entry })
`;

export type AgentSessionOutputAttentionProjectionEntry = {
  schemaVersion: 1;
  agentSessionId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  state: AgentSessionOutputAttentionState;
  revision: number;
  changedAt: string;
};

export type AgentSessionOutputAttentionTransition = {
  entry: AgentSessionOutputAttentionProjectionEntry;
};

export type AgentSessionOutputAttentionProjectionResult =
  | { outcome: 'transition'; transition: AgentSessionOutputAttentionTransition }
  | { outcome: 'duplicate'; entry: AgentSessionOutputAttentionProjectionEntry }
  | { outcome: 'schema_mismatch' };

type TransitionSink = (
  transition: AgentSessionOutputAttentionTransition,
) => void | Promise<void>;

type ScriptResult = {
  outcome: 'transition' | 'duplicate' | 'schema_mismatch';
  entry?: AgentSessionOutputAttentionProjectionEntry;
};

@Injectable()
export class AgentSessionOutputAttentionProjection {
  static readonly KEY_PREFIX = 'heyhey:agent-session:output-attention:v1';

  private readonly logger = new Logger(
    AgentSessionOutputAttentionProjection.name,
  );
  private transitionSink?: TransitionSink;

  constructor(private readonly redisService: RedisService) {}

  setTransitionSink(sink: TransitionSink): void {
    this.transitionSink = sink;
  }

  async readMany(
    identities: readonly { agentSessionId: string; userId: string }[],
  ): Promise<Map<string, AgentSessionOutputAttentionProjectionEntry>> {
    if (identities.length === 0) return new Map();
    const values = await this.redisService
      .getClient()
      .mget(
        ...identities.map(({ agentSessionId, userId }) =>
          this.key(agentSessionId, userId),
        ),
      );
    const entries = new Map<string, AgentSessionOutputAttentionProjectionEntry>();
    values.forEach((raw, index) => {
      const identity = identities[index];
      if (raw === null || identity === undefined) return;
      const entry = this.parseEntry(raw);
      if (
        entry.agentSessionId === identity.agentSessionId &&
        entry.userId === identity.userId
      ) {
        entries.set(identity.agentSessionId, entry);
      }
    });
    this.logger.debug('[output-attention] redis batch read', {
      requested: identities.length,
      returned: entries.size,
    });
    return entries;
  }

  async transition(input: {
    agentSessionId: string;
    organizationId: string;
    projectId: string;
    userId: string;
    state: AgentSessionOutputAttentionState;
  }): Promise<AgentSessionOutputAttentionProjectionResult> {
    const changedAt = new Date().toISOString();
    const raw = await this.redisService.getClient().eval(
      TRANSITION_SCRIPT,
      1,
      this.key(input.agentSessionId, input.userId),
      input.state,
      input.agentSessionId,
      input.organizationId,
      input.projectId,
      input.userId,
      changedAt,
    );
    const result = JSON.parse(String(raw)) as ScriptResult;
    this.logger.debug('[output-attention] redis transition', {
      agentSessionId: input.agentSessionId,
      userId: input.userId,
      requestedState: input.state,
      outcome: result.outcome,
      revision: result.entry?.revision,
    });

    if (result.outcome === 'transition' && result.entry) {
      const transition = { entry: result.entry };
      await this.transitionSink?.(transition);
      return { outcome: 'transition', transition };
    }
    if (result.outcome === 'duplicate' && result.entry) {
      return { outcome: 'duplicate', entry: result.entry };
    }
    return { outcome: 'schema_mismatch' };
  }

  toItem(
    entry: AgentSessionOutputAttentionProjectionEntry,
  ): AgentSessionOutputAttentionBatchItemDto {
    return {
      agentSessionId: entry.agentSessionId,
      state: entry.state,
      revision: entry.revision,
      changedAt: entry.changedAt,
    } satisfies AgentSessionOutputAttentionBatchItemDto;
  }

  private key(agentSessionId: string, userId: string): string {
    return `${AgentSessionOutputAttentionProjection.KEY_PREFIX}:${agentSessionId}:${userId}`;
  }

  private parseEntry(raw: string): AgentSessionOutputAttentionProjectionEntry {
    const entry = JSON.parse(raw) as AgentSessionOutputAttentionProjectionEntry;
    if (
      entry.schemaVersion !== 1 ||
      typeof entry.agentSessionId !== 'string' ||
      typeof entry.organizationId !== 'string' ||
      typeof entry.projectId !== 'string' ||
      typeof entry.userId !== 'string' ||
      !Object.values(AgentSessionOutputAttentionState).includes(entry.state) ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 0 ||
      Number.isNaN(Date.parse(entry.changedAt))
    ) {
      throw new Error('Invalid Agent Session output-attention projection entry');
    }
    return entry;
  }
}
