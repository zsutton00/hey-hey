import { createHash } from 'node:crypto';
import { CodexCostInput } from './codex-cost-input';
import { ProviderCostReportCache } from './provider-cost-report-cache';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import type { AgentProviderId } from '../../agents/providers/provider-config';
import type { LocalProviderSessionUsageCost } from '../../shared/agent-bridge-contract/contract';
import type { ServerLogger } from '../logger';

export type ProviderSessionCostUnavailableReason =
  | 'unsupported_provider'
  | 'provider_session_id_missing'
  | 'cost_source_unavailable'
  | 'session_not_found'
  | 'malformed_cost_data'
  | 'adapter_error';

export interface ProviderSessionUsageCostInput {
  providerId: AgentProviderId;
  providerSessionId: string | null;
  logger?: ServerLogger;
}

type CcusageCostProviderId = Extract<AgentProviderId, 'claude' | 'codex'>;
export type ProviderCostSourceState = 'available' | 'unavailable' | 'malformed' | 'unsupported';

export interface ProviderSessionCostBatchInput {
  providerId: AgentProviderId;
  providerSessionId: string | null;
}

export interface ProviderSessionCostBatchResult {
  costs: LocalProviderSessionUsageCost[];
  sourceStates: Map<AgentProviderId, ProviderCostSourceState>;
}

export type CcusageSessionJsonReader = (
  providerId: CcusageCostProviderId,
  since?: string,
  scope?: { sessionIds: readonly string[]; logger?: ServerLogger },
) => Promise<string>;

// Codex creates thread IDs with UUIDv7's Unix-millisecond timestamp. Use that
// creation day, never the Run's observedAt (which can describe a later resume).
// Unknown/legacy IDs deliberately retain an unbounded lookup.
const codexSessionCreationDay = (sessionId: string | null): string | undefined => {
  if (
    !sessionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
  ) {
    return undefined;
  }
  const timestamp = Number.parseInt(sessionId.slice(0, 13).replace('-', ''), 16);
  const date = new Date(timestamp).toISOString();
  return /^\d{4}-/.test(date) ? date.slice(0, 10) : undefined;
};

const reportSince = (
  providerId: CcusageCostProviderId,
  inputs: readonly ProviderSessionCostBatchInput[],
): string | undefined => {
  if (providerId !== 'codex') return undefined;
  let earliest: string | undefined;
  for (const input of inputs) {
    if (input.providerId !== providerId) continue;
    const day = codexSessionCreationDay(input.providerSessionId);
    if (!day) return undefined;
    if (!earliest || day < earliest) earliest = day;
  }
  return earliest;
};

type CcusageRuntimeFailureKind = 'resolution' | 'execution';

interface CcusageRuntimeFailureMetadata {
  command: string | null;
  exitCode: string | number | null;
  killed: boolean | null;
  launcherPath: string | null;
  packageManifestPath: string | null;
  signal: NodeJS.Signals | null;
  stderr: string | null;
  timedOut: boolean;
}

type CcusageProcessError = Error & {
  code?: string | number | null;
  cmd?: string;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stderr?: string;
};

const CCUSAGE_COMMAND_TIMEOUT_MS = 10_000;
// Provider-wide Codex reports can exceed 16 MiB even when the selected result is tiny.
// Keep a bounded local-process limit independent of the compact wire response.
const CCUSAGE_REPORT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_DIAGNOSTIC_TEXT_LENGTH = 1_000;
const requireFromCli = createRequire(__filename);

const ccusagePackageManifestSchema = z.object({
  bin: z.union([z.string(), z.record(z.string())]),
});

const isCcusageProcessError = (error: Error): error is CcusageProcessError =>
  'code' in error || 'cmd' in error || 'killed' in error || 'signal' in error || 'stderr' in error;

const normalizeDiagnosticText = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > MAX_DIAGNOSTIC_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)}…`
    : normalized;
};

const emptyRuntimeFailureMetadata = (): CcusageRuntimeFailureMetadata => ({
  command: null,
  exitCode: null,
  killed: null,
  launcherPath: null,
  packageManifestPath: null,
  signal: null,
  stderr: null,
  timedOut: false,
});

const normalizeProcessFailureMetadata = (error: Error): CcusageRuntimeFailureMetadata => {
  if (!isCcusageProcessError(error)) {
    return emptyRuntimeFailureMetadata();
  }
  const signal = error.signal ?? null;
  const killed = error.killed ?? null;
  const exitCode = error.code ?? null;
  return {
    ...emptyRuntimeFailureMetadata(),
    command: error.cmd ?? null,
    exitCode,
    killed,
    signal,
    stderr: normalizeDiagnosticText(error.stderr ?? null),
    timedOut: exitCode === 'ETIMEDOUT' || (killed === true && signal === 'SIGTERM'),
  };
};

class CcusageRuntimeError extends Error {
  public constructor(
    public readonly kind: CcusageRuntimeFailureKind,
    message: string,
    public readonly metadata: CcusageRuntimeFailureMetadata,
  ) {
    super(message);
    this.name = 'CcusageRuntimeError';
  }
}

const toRuntimeFailure = (error: Error): CcusageRuntimeError => {
  if (error instanceof CcusageRuntimeError) {
    return error;
  }
  return new CcusageRuntimeError(
    'execution',
    error.message,
    normalizeProcessFailureMetadata(error),
  );
};

export const resolveCcusageLauncher = (
  resolvePackage: (request: string) => string = (request) => requireFromCli.resolve(request),
): string => {
  let packageManifestPath: string | null = null;
  try {
    packageManifestPath = resolvePackage('ccusage/package.json');
    const packageManifest = ccusagePackageManifestSchema.parse(
      JSON.parse(readFileSync(packageManifestPath, 'utf8')),
    );
    const launcher =
      typeof packageManifest.bin === 'string'
        ? packageManifest.bin
        : packageManifest.bin['ccusage'];
    if (!launcher) {
      throw new Error('The installed ccusage package does not expose a ccusage launcher.');
    }
    return path.resolve(path.dirname(packageManifestPath), launcher);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown ccusage package resolution failure.';
    const metadata = emptyRuntimeFailureMetadata();
    metadata.packageManifestPath = packageManifestPath;
    throw new CcusageRuntimeError(
      'resolution',
      `The installed ccusage package could not be resolved: ${message}`,
      metadata,
    );
  }
};

export const unavailableProviderSessionCost = (
  reason: ProviderSessionCostUnavailableReason,
  message?: string,
): LocalProviderSessionUsageCost => ({
  state: 'unavailable',
  reason,
  ...(message ? { message } : {}),
});

const ccusageSessionRecordSchema = z
  .object({
    id: z.string().optional(),
    sessionId: z.string().optional(),
    session_id: z.string().optional(),
    totalCost: z.number().nonnegative().optional(),
    totalCostUsd: z.number().nonnegative().optional(),
    totalCostUSD: z.number().nonnegative().optional(),
    total_cost_usd: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    costUSD: z.number().nonnegative().optional(),
  })
  .passthrough();

const ccusageSessionOutputSchema = z.union([
  z.array(ccusageSessionRecordSchema),
  z
    .object({
      sessions: z.array(ccusageSessionRecordSchema).optional(),
      data: z.array(ccusageSessionRecordSchema).optional(),
    })
    .passthrough(),
]);

type CcusageSessionRecord = z.infer<typeof ccusageSessionRecordSchema>;

const getRecordSessionId = (record: CcusageSessionRecord): string | null =>
  record.sessionId ?? record.session_id ?? record.id ?? null;

const matchesProviderSession = (
  providerId: CcusageCostProviderId,
  record: CcusageSessionRecord,
  providerSessionId: string,
): boolean => {
  const recordSessionId = getRecordSessionId(record);
  if (recordSessionId === null) {
    return false;
  }
  if (providerId === 'claude') {
    return recordSessionId === providerSessionId;
  }
  return recordSessionId === providerSessionId || recordSessionId.endsWith(`-${providerSessionId}`);
};

const getRecordCostUsd = (record: CcusageSessionRecord): number | null =>
  record.totalCostUsd ??
  record.totalCostUSD ??
  record.total_cost_usd ??
  record.totalCost ??
  record.costUsd ??
  record.costUSD ??
  record.cost ??
  null;

const extractSessionRecords = (
  output: z.infer<typeof ccusageSessionOutputSchema>,
): CcusageSessionRecord[] => {
  if (Array.isArray(output)) {
    return output;
  }
  return output.sessions ?? output.data ?? [];
};

export const createCcusageSessionJsonReader = (
  resolveLauncher: () => string = resolveCcusageLauncher,
): CcusageSessionJsonReader => {
  const codexInput = new CodexCostInput();
  return async (providerId, since, scope) => {
    const env = { ...process.env };
    const cwd = process.cwd();
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    let launcherPath: string;
    try {
      launcherPath = resolveLauncher();
    } catch (error) {
      if (error instanceof CcusageRuntimeError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown ccusage resolution failure.';
      throw new CcusageRuntimeError(
        'resolution',
        `The installed ccusage package could not be resolved: ${message}`,
        emptyRuntimeFailureMetadata(),
      );
    }

    const execute = async (sourceEnv: NodeJS.ProcessEnv, restricted: boolean): Promise<string> => {
      try {
        const result = await execFileAsync(
          process.execPath,
          [
            launcherPath,
            providerId,
            'session',
            '--json',
            ...(!restricted && since ? ['--since', since, '--timezone', 'UTC'] : []),
          ],
          {
            env: sourceEnv,
            cwd,
            timeout: CCUSAGE_COMMAND_TIMEOUT_MS,
            maxBuffer: CCUSAGE_REPORT_MAX_BYTES,
          },
        );
        return result.stdout;
      } catch (error) {
        const runtimeError = toRuntimeFailure(
          error instanceof Error ? error : new Error('Unknown ccusage execution failure.'),
        );
        runtimeError.metadata.launcherPath = launcherPath;
        runtimeError.metadata.command ??= `${process.execPath} ${launcherPath} ${providerId} session --json`;
        throw runtimeError;
      }
    };
    return providerId === 'codex' && scope?.sessionIds.length
      ? codexInput.read(scope.sessionIds, env, execute, scope.logger)
      : execute(env, false);
  };
};

const runCcusageSessionJson = createCcusageSessionJsonReader();

class InvalidCostReport extends Error {
  public constructor(public readonly parseStage: 'json' | 'schema') {
    super('Invalid cost report');
  }
}

// Reader identity separates injected sources/launchers. The default reader inherits
// the entire environment and cwd (including provider roots and config discovery).
// Hash those actual inputs so no private paths or credentials become cache keys.
const reportCaches = new WeakMap<
  CcusageSessionJsonReader,
  ProviderCostReportCache<CcusageSessionRecord[]>
>();
const sourceIdentity = (
  providerId: CcusageCostProviderId,
  since: string | undefined,
  sessionIds: readonly string[],
): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        providerId,
        since ?? null,
        sessionIds,
        process.execPath,
        process.cwd(),
        Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest('hex');

export class SessionCostAdapter {
  private readonly reportCache: ProviderCostReportCache<CcusageSessionRecord[]>;
  public constructor(
    private readonly readCcusageSessionJson: CcusageSessionJsonReader = runCcusageSessionJson,
  ) {
    const existing = reportCaches.get(readCcusageSessionJson);
    this.reportCache =
      existing ??
      new ProviderCostReportCache<CcusageSessionRecord[]>((records) =>
        records.every(
          (record) => getRecordSessionId(record) !== null && getRecordCostUsd(record) !== null,
        ),
      );
    reportCaches.set(readCcusageSessionJson, this.reportCache);
  }

  private async loadReport(
    providerId: CcusageCostProviderId,
    since: string | undefined,
    sessionIds: readonly string[],
    logger?: ServerLogger,
  ): Promise<CcusageSessionRecord[]> {
    const stdout = sessionIds.length
      ? await this.readCcusageSessionJson(providerId, since, {
          sessionIds,
          ...(logger ? { logger } : {}),
        })
      : since
        ? await this.readCcusageSessionJson(providerId, since)
        : await this.readCcusageSessionJson(providerId);
    let parsed: ReturnType<typeof ccusageSessionOutputSchema.safeParse>;
    try {
      parsed = ccusageSessionOutputSchema.safeParse(JSON.parse(stdout));
    } catch {
      throw new InvalidCostReport('json');
    }
    if (!parsed.success) throw new InvalidCostReport('schema');
    return extractSessionRecords(parsed.data);
  }

  public async read({
    providerId,
    providerSessionId,
    logger,
  }: ProviderSessionUsageCostInput): Promise<LocalProviderSessionUsageCost> {
    const batch = await this.readBatch([{ providerId, providerSessionId }], logger);
    const cost = batch.costs[0];
    if (!cost) {
      return unavailableProviderSessionCost(
        'adapter_error',
        'The local cost adapter did not return a result for the selected provider session.',
      );
    }
    return cost;
  }

  public async readBatch(
    inputs: readonly ProviderSessionCostBatchInput[],
    logger?: ServerLogger,
  ): Promise<ProviderSessionCostBatchResult> {
    const sourceStates = new Map<AgentProviderId, ProviderCostSourceState>();
    const recordsByProvider = new Map<CcusageCostProviderId, CcusageSessionRecord[]>();
    const malformedJsonProviders = new Set<CcusageCostProviderId>();
    const representedProviders = new Set(inputs.map(({ providerId }) => providerId));

    await Promise.all(
      [...representedProviders].map(async (providerId) => {
        if (providerId === 'opencode') {
          sourceStates.set(providerId, 'unsupported');
          logger?.debug('local.service.session_cost_batch.source_unsupported', { providerId });
          return;
        }
        const since = reportSince(providerId, inputs);
        const sessionIds =
          providerId === 'codex'
            ? [
                ...new Set(
                  inputs
                    .filter((input) => input.providerId === providerId)
                    .map((input) => input.providerSessionId)
                    .filter((id): id is string => id !== null),
                ),
              ].sort()
            : [];
        logger?.debug('local.service.session_cost_batch.source_read_started', {
          providerId,
          dateFiltered: since !== undefined,
        });
        let records: CcusageSessionRecord[];
        try {
          records = await this.reportCache.read(
            sourceIdentity(providerId, since, sessionIds),
            () => this.loadReport(providerId, since, sessionIds, logger),
            logger,
          );
        } catch (error) {
          if (error instanceof InvalidCostReport) {
            sourceStates.set(providerId, 'malformed');
            if (error.parseStage === 'json') malformedJsonProviders.add(providerId);
            logger?.debug('local.service.session_cost_batch.source_output_invalid', {
              providerId,
              parseStage: error.parseStage,
            });
          } else {
            sourceStates.set(providerId, 'unavailable');
            const runtimeError = toRuntimeFailure(
              error instanceof Error ? error : new Error('Unknown ccusage failure.'),
            );
            logger?.debug('local.service.session_cost_batch.source_read_failed', {
              providerId,
              failureKind: runtimeError.kind,
              exitCode: runtimeError.metadata.exitCode,
              killed: runtimeError.metadata.killed,
              signal: runtimeError.metadata.signal,
              timedOut: runtimeError.metadata.timedOut,
            });
          }
          return;
        }
        recordsByProvider.set(providerId, records);
        sourceStates.set(providerId, 'available');
        logger?.debug('local.service.session_cost_batch.source_read_completed', {
          providerId,
          recordCount: records.length,
        });
      }),
    );

    const costs = inputs.map(({ providerId, providerSessionId }) =>
      this.resolveCost({
        providerId,
        providerSessionId,
        sourceState: sourceStates.get(providerId),
        records: providerId === 'opencode' ? undefined : recordsByProvider.get(providerId),
        malformedJson: providerId === 'opencode' ? false : malformedJsonProviders.has(providerId),
        logger,
      }),
    );
    return { costs, sourceStates };
  }

  private resolveCost(input: {
    providerId: AgentProviderId;
    providerSessionId: string | null;
    sourceState: ProviderCostSourceState | undefined;
    records: CcusageSessionRecord[] | undefined;
    malformedJson: boolean;
    logger: ServerLogger | undefined;
  }): LocalProviderSessionUsageCost {
    const { providerId, providerSessionId, sourceState, records, malformedJson, logger } = input;
    const unavailable = (
      reason: ProviderSessionCostUnavailableReason,
      message: string,
      extra: Record<string, string | number | boolean | null> = {},
    ): LocalProviderSessionUsageCost => {
      logger?.debug('local.service.context_usage.cost_unavailable', {
        providerId,
        providerSessionId,
        reason,
        ...extra,
      });
      return unavailableProviderSessionCost(reason, message);
    };

    if (providerId === 'opencode') {
      return unavailable(
        'unsupported_provider',
        `Provider ${providerId} does not expose local session cost data through ccusage.`,
      );
    }

    if (!providerSessionId) {
      return unavailable(
        'provider_session_id_missing',
        'Cannot read session cost without a provider session id.',
      );
    }
    if (sourceState === 'malformed') {
      return unavailable(
        'malformed_cost_data',
        malformedJson
          ? 'ccusage returned output that was not valid JSON.'
          : 'ccusage returned JSON that did not match the expected session format.',
      );
    }
    if (sourceState !== 'available' || !records) {
      return unavailable(
        'cost_source_unavailable',
        'Local cost data is unavailable because ccusage could not be loaded or executed.',
      );
    }
    const matchingSession = records.find((record) =>
      matchesProviderSession(providerId, record, providerSessionId),
    );
    if (!matchingSession) {
      return unavailable(
        'session_not_found',
        'No local cost history was found for the selected provider session.',
        { recordCount: records.length },
      );
    }

    const amountUsd = getRecordCostUsd(matchingSession);
    if (amountUsd === null) {
      return unavailable(
        'malformed_cost_data',
        'The selected provider session did not include a valid cost amount.',
        { parseStage: 'amount' },
      );
    }

    return {
      state: 'available',
      amountUsd,
      currency: 'USD',
      source: 'ccusage',
    };
  }
}
