import crypto from 'node:crypto';
import { z } from 'zod';
import {
  resolveAgentProviderId,
  type AgentProviderId,
} from '../../agents/providers/provider-config';
import type { RunStore } from '../../run-store/run-store';
import type { AgenticSession } from '../../session';
import type {
  CliReadErrorCode,
  CliReadProjectSessionCostRow,
  CliReadProjectSessionCostsListEnvelopeBody,
  CliReadProjectSessionCostsResult,
} from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../logger';
import {
  SessionCostAdapter,
  type CcusageSessionJsonReader,
  type ProviderCostSourceState,
} from './session-cost-adapter';

const cursorSchema = z
  .object({
    version: z.literal(1),
    filterFingerprint: z.string().length(64),
    latestActivityAt: z.string().datetime(),
    agentSessionId: z.string().uuid(),
  })
  .strict();

type CostsCursor = z.infer<typeof cursorSchema>;

interface NormalizedFilters {
  activityFrom: string | null;
  activityTo: string | null;
  minKnownCostUsd: number | null;
  limit: number;
}

type ProviderSessionHistory = NonNullable<AgenticSession['provider_session_history']>;

interface ScopedRun {
  run: AgenticSession;
  history: ProviderSessionHistory;
}

export class ProjectSessionCostsRequestError extends Error {
  public constructor(
    public readonly code: CliReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectSessionCostsRequestError';
  }
}

const normalizeFilters = (
  request: CliReadProjectSessionCostsListEnvelopeBody,
): NormalizedFilters => {
  const activityFrom = request.activityFrom ? new Date(request.activityFrom).toISOString() : null;
  const activityTo = request.activityTo ? new Date(request.activityTo).toISOString() : null;
  if (activityFrom && activityTo && activityFrom > activityTo) {
    throw new ProjectSessionCostsRequestError(
      'INVALID_REQUEST',
      'activityFrom must be earlier than or equal to activityTo.',
    );
  }
  return {
    activityFrom,
    activityTo,
    minKnownCostUsd: request.minKnownCostUsd ?? null,
    limit: request.limit,
  };
};

const fingerprintFilters = (filters: NormalizedFilters): string =>
  crypto.createHash('sha256').update(JSON.stringify(filters)).digest('hex');

const hasActivityBounds = (filters: NormalizedFilters): boolean =>
  filters.activityFrom !== null || filters.activityTo !== null;

const isWithinActivityBounds = (
  observedAt: string,
  filters: Pick<NormalizedFilters, 'activityFrom' | 'activityTo'>,
): boolean =>
  (!filters.activityFrom || observedAt >= filters.activityFrom) &&
  (!filters.activityTo || observedAt <= filters.activityTo);

const scopeRunHistory = (
  runs: readonly AgenticSession[],
  filters: NormalizedFilters,
): ScopedRun[] => {
  const bounded = hasActivityBounds(filters);
  return runs
    .map<ScopedRun>((run) => {
      const fullHistory = run.provider_session_history ?? [];
      const history = bounded
        ? fullHistory.filter((member) => isWithinActivityBounds(member.observedAt, filters))
        : fullHistory;
      return { run, history };
    })
    .filter(({ history }) => !bounded || history.length > 0);
};

const getLatestActivityAt = (run: AgenticSession, history: ProviderSessionHistory): string =>
  history.reduce<string | null>(
    (latest, member) =>
      latest === null || member.observedAt > latest ? member.observedAt : latest,
    null,
  ) ?? run.updatedAt;

const encodeCursor = (cursor: CostsCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decodeCursor = (encoded: string, expectedFingerprint: string): CostsCursor => {
  let candidate: string;
  try {
    candidate = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    throw new ProjectSessionCostsRequestError('INVALID_CURSOR', 'The Costs cursor is malformed.');
  }
  let parsed: ReturnType<typeof cursorSchema.safeParse>;
  try {
    parsed = cursorSchema.safeParse(JSON.parse(candidate));
  } catch {
    throw new ProjectSessionCostsRequestError('INVALID_CURSOR', 'The Costs cursor is malformed.');
  }
  if (!parsed.success || parsed.data.filterFingerprint !== expectedFingerprint) {
    throw new ProjectSessionCostsRequestError(
      'INVALID_CURSOR',
      'The Costs cursor does not match the active filters.',
    );
  }
  return parsed.data;
};

const toContext = (run: AgenticSession): CliReadProjectSessionCostRow['context'] => {
  const task = run.contextMetadata.task;
  const entityTitle = run.entity && task?.id === run.entity.entityId ? task.name : null;
  return {
    entityType: run.entity?.entityType ?? null,
    entityId: run.entity?.entityId ?? null,
    entityTitle,
    promptType: run.promptType ?? null,
  };
};

const compareRowsDescending = (
  left: CliReadProjectSessionCostRow,
  right: CliReadProjectSessionCostRow,
): number =>
  right.latestActivityAt.localeCompare(left.latestActivityAt) ||
  right.agentSessionId.localeCompare(left.agentSessionId);

const isAfterCursor = (row: CliReadProjectSessionCostRow, cursor: CostsCursor): boolean =>
  row.latestActivityAt < cursor.latestActivityAt ||
  (row.latestActivityAt === cursor.latestActivityAt && row.agentSessionId < cursor.agentSessionId);

const deriveSourceAvailability = (
  sourceStates: ReadonlyMap<AgentProviderId, ProviderCostSourceState>,
): CliReadProjectSessionCostsResult['sourceAvailability'] => {
  const supportedStates = [...sourceStates.values()].filter((state) => state !== 'unsupported');
  const availableCount = supportedStates.filter((state) => state === 'available').length;
  if (supportedStates.length === 0 || availableCount === 0) return 'unavailable';
  return availableCount === supportedStates.length ? 'available' : 'partial';
};

export interface ProjectSessionCostsServiceDependencies {
  runStore: RunStore;
  logger: ServerLogger;
  readCcusageSessionJson?: CcusageSessionJsonReader;
  now?: () => Date;
}

export class ProjectSessionCostsService {
  private readonly sessionCostAdapter: SessionCostAdapter;
  private readonly now: () => Date;

  public constructor(private readonly dependencies: ProjectSessionCostsServiceDependencies) {
    this.sessionCostAdapter = new SessionCostAdapter(dependencies.readCcusageSessionJson);
    this.now = dependencies.now ?? (() => new Date());
  }

  public async list(
    request: CliReadProjectSessionCostsListEnvelopeBody,
    organizationId: string,
  ): Promise<CliReadProjectSessionCostsResult> {
    const filters = normalizeFilters(request);
    const filterFingerprint = fingerprintFilters(filters);
    const cursor = request.cursor ? decodeCursor(request.cursor, filterFingerprint) : null;
    const costReadAt = this.now().toISOString();
    this.dependencies.logger.info('cli-read.project_session_costs.collection_started', {
      requestId: request.requestId,
      projectId: request.projectId,
      filters,
      hasCursor: cursor !== null,
    });

    const allRuns = await this.dependencies.runStore.listRuns();
    const runs = allRuns.filter(
      (run) =>
        run.contextMetadata.organizationId === organizationId &&
        run.contextMetadata.projectId === request.projectId,
    );
    const scopedRuns = scopeRunHistory(runs, filters);
    const batchInputs = scopedRuns.flatMap(({ run, history }) => {
      const providerId = resolveAgentProviderId(run.provider);
      return history.map((member) => ({
        providerId,
        providerSessionId: member.providerSessionId,
      }));
    });
    this.dependencies.logger.debug('cli-read.project_session_costs.membership_loaded', {
      requestId: request.requestId,
      projectId: request.projectId,
      totalRunCount: allRuns.length,
      projectRunCount: runs.length,
      scopedRunCount: scopedRuns.length,
      providerSessionCount: batchInputs.length,
    });

    const batch = await this.sessionCostAdapter.readBatch(batchInputs, this.dependencies.logger);
    let costIndex = 0;
    const rows = scopedRuns.map<CliReadProjectSessionCostRow>(({ run, history }) => {
      const providerId = resolveAgentProviderId(run.provider);
      const providerSessions = history.map((member) => {
        const cost = batch.costs[costIndex];
        costIndex += 1;
        if (!cost) {
          throw new Error('The cost adapter returned fewer results than requested.');
        }
        return {
          providerId,
          providerSessionId: member.providerSessionId,
          providerConversationId: member.providerConversationId,
          providerSessionAgentId: member.providerSessionAgentId,
          observedAt: member.observedAt,
          cost,
        };
      });
      const availableCosts = providerSessions.flatMap(({ cost }) =>
        cost.state === 'available' ? [cost.amountUsd] : [],
      );
      const knownCostUsd =
        availableCosts.length === 0
          ? null
          : availableCosts.reduce((total, amount) => total + amount, 0);
      const completeness =
        availableCosts.length === 0
          ? 'unavailable'
          : availableCosts.length === providerSessions.length
            ? 'complete'
            : 'partial';
      this.dependencies.logger.debug('cli-read.project_session_costs.row_aggregated', {
        requestId: request.requestId,
        agentSessionId: run.agentic_session_id,
        memberCount: providerSessions.length,
        availableMemberCount: availableCosts.length,
        completeness,
      });
      return {
        agentSessionId: run.agentic_session_id,
        conversationId: run.conversationId,
        context: toContext(run),
        providerSessions,
        knownCostUsd,
        completeness,
        latestActivityAt: getLatestActivityAt(run, history),
        costReadAt,
      };
    });

    const filteredRows = rows
      .filter(
        (row) =>
          filters.minKnownCostUsd === null ||
          (row.knownCostUsd !== null && row.knownCostUsd >= filters.minKnownCostUsd),
      )
      .sort(compareRowsDescending);
    const continuedRows = cursor
      ? filteredRows.filter((row) => isAfterCursor(row, cursor))
      : filteredRows;
    const items = continuedRows.slice(0, filters.limit);
    const lastItem = items.at(-1);
    const nextCursor =
      continuedRows.length > items.length && lastItem
        ? encodeCursor({
            version: 1,
            filterFingerprint,
            latestActivityAt: lastItem.latestActivityAt,
            agentSessionId: lastItem.agentSessionId,
          })
        : null;
    const sourceAvailability = deriveSourceAvailability(batch.sourceStates);
    this.dependencies.logger.info('cli-read.project_session_costs.collection_completed', {
      requestId: request.requestId,
      projectId: request.projectId,
      matchedRunCount: rows.length,
      filteredRunCount: filteredRows.length,
      returnedRunCount: items.length,
      sourceAvailability,
      hasNextCursor: nextCursor !== null,
    });
    return { items, nextCursor, sourceAvailability, costReadAt };
  }
}
