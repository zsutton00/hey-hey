import type { SubAgentResult } from '../run/subagent';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { SessionValidationError } from '../session/errors';
import { resolveBaseDir } from '../session/paths';
import type {
  AgenticSession,
  AgenticSessionEvent,
  AgenticSessionStatus,
  AgenticOutputMessagePayload,
  AgenticRunCompletedPayload,
  AgenticRunStartedPayload,
  AppendAgenticEventInput,
  CreateAgenticSessionInput,
  PreviousProviderSession,
  PermissionRequestPresentation,
  ServiceScopeRequestPresentation,
  ServiceScopeContinuation,
  ReviewFileScopeRequestPresentation,
  ProviderSessionHistoryEntry,
  RunMemo,
  TaskSessionProviderPreference,
  TokenUsage,
} from '../session/types';
import type { GatherTrace } from '../jev/trace';
import {
  parseDurableRunEvent,
  DURABLE_RUN_EVENT_SCHEMA_VERSION,
  type DurableRunEvent,
  type DurableRunEventInput,
} from './durable-events';
import {
  projectAgenticEventToDurableEvents,
  type DurableAdmissionContext,
} from '../run/durable-event-admission';
import { hasLegacySessions, migrateSessionsToRuns } from './migrate-sessions';
import { RunEventStore } from './run-event-store';
import { RunIndexStore } from './run-index';
import {
  isRunFamilyManifestFileName,
  isRunMetadataFileName,
  runIdFromFamilyManifestFileName,
  runIdFromMetadataFileName,
  runFamilyFileNames,
} from './run-files';
import type { RunFamilyMember } from './run-files';
import { RunFamilyCompatibilityError, RunFamilyStore } from './run-family';
import type {
  InternalRunPromptRequest,
  LocalToolUsageEntry,
  LocalRunScope,
  LocalWorktreeState,
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../shared/agent-bridge-contract/contract';
import type { ImplementationReadinessDisposition } from '../shared/api/generated/api';
import { parseImplementationReadinessFromSessionContext } from '../agents/implementation-readiness/session-context';
import type { LocalTokenUsage } from '../shared/agent-bridge-contract/generated/api';
import {
  parsePersistedFileChangeFacts,
  projectFileChanges,
  resolveProjectedFilePath,
  type CanonicalFileChangeFact,
} from '../run/file-change-facts';
import type { PersistedRunFileChangeFactsV1 } from './types';
import { persistedRunEntitySchema, sameRunEntity } from '../run/run-entity';
import {
  appendProviderSessionHistoryEntry,
  normalizeProviderSessionHistory,
  reconcileDurableProviderSessionHistory,
} from './provider-session-history';
import {
  parsePersistedRunChangedFilesDiagnostics,
  type PersistedRunChangedFilesDiagnosticsV1,
  type RunChangedFilesDiagnosticEntry,
} from './changed-files-diagnostics';

/**
 * Coerce a persisted run record's services shape. Legacy records carry a
 * singular `serviceId` field at the top level; the new shape carries
 * `services: { id, path }[]` + `launchServiceId`. When only the legacy field
 * is present we lift it into a one-element `services` array with an empty
 * path so downstream `resolveRunWorkspace` can re-resolve through the
 * repoStore — the alternative (failing fast on read) would make a CLI
 * upgrade unrecoverable for any user with persisted runs on disk.
 */
const coerceLegacyServices = (raw: Record<string, unknown>): Record<string, unknown> => {
  if (Array.isArray(raw['services'])) return raw;
  const legacyServiceId = raw['serviceId'];
  if (typeof legacyServiceId === 'string' && legacyServiceId.length > 0) {
    const services: ResolvedServiceBinding[] = [{ id: legacyServiceId, path: '' }];
    return { ...raw, services, launchServiceId: legacyServiceId };
  }
  return { ...raw, services: [] };
};

const isLocalWorktreeState = (value: unknown): value is LocalWorktreeState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['worktreePath'] === 'string' &&
    typeof record['branch'] === 'string' &&
    typeof record['repoPath'] === 'string'
  );
};

const isLocalWorktreeStateByService = (value: unknown): value is LocalWorktreeStateByService => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if ('worktreePath' in record || 'branch' in record || 'repoPath' in record) return false;
  return Object.values(record).every((entry) => isLocalWorktreeState(entry));
};

const resolveLegacyWorktreeStateKey = (
  raw: Record<string, unknown>,
  legacyState: LocalWorktreeState,
): string => {
  const launchServiceId = raw['launchServiceId'];
  if (typeof launchServiceId === 'string' && launchServiceId.trim().length > 0) {
    return launchServiceId;
  }
  return legacyState.repoPath;
};

const coerceLegacyWorktreeState = (raw: Record<string, unknown>): Record<string, unknown> => {
  const persistedState = raw['worktreeState'];
  if (persistedState === undefined || isLocalWorktreeStateByService(persistedState)) return raw;
  if (!isLocalWorktreeState(persistedState)) return raw;
  const key = resolveLegacyWorktreeStateKey(raw, persistedState);
  return { ...raw, worktreeState: { [key]: persistedState } };
};
import type {
  RunFamilyMigrationEntry,
  RunFamilyMigrationOptions,
  RunFamilyMigrationResult,
  RunFamilyMigrationStatus,
  RunIndex,
  RunInitResult,
  RunStorePaths,
  RunStoreOptions,
} from './types';

export interface RunStoreInitializationOptions {
  /** Skip importing the legacy sessions directory during initialization. */
  readonly migrateLegacySessions?: boolean;
  readonly promoteCompatibility?: boolean;
  readonly reconcileIndex?: boolean;
}

const resolveRunStorePaths = (): RunStorePaths => {
  const baseDir = resolveBaseDir();
  const runsDir = path.join(baseDir, 'runs');
  return {
    baseDir,
    runsDir,
    indexPath: path.join(runsDir, 'run-index.json'),
    preferencesPath: path.join(baseDir, 'preferences.json'),
  };
};

const normalizeStringMap = (map: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(map).sort(([left], [right]) => left.localeCompare(right)));

const normalizeStringListMap = (map: Record<string, string[]>): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(map)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, [...value].sort()]),
  );

const indexesMatch = (left: RunIndex, right: RunIndex): boolean =>
  JSON.stringify({
    version: left.version,
    byAgentSessionId: normalizeStringMap(left.byAgentSessionId),
    byProviderSessionId: normalizeStringMap(left.byProviderSessionId),
    byCanonicalRunId: normalizeStringMap(left.byCanonicalRunId),
    byPromptType: normalizeStringListMap(left.byPromptType),
    byConversationId: normalizeStringMap(left.byConversationId),
  }) ===
  JSON.stringify({
    version: right.version,
    byAgentSessionId: normalizeStringMap(right.byAgentSessionId),
    byProviderSessionId: normalizeStringMap(right.byProviderSessionId),
    byCanonicalRunId: normalizeStringMap(right.byCanonicalRunId),
    byPromptType: normalizeStringListMap(right.byPromptType),
    byConversationId: normalizeStringMap(right.byConversationId),
  });

const serializeRunMetadata = (run: AgenticSession): string => {
  const { events: _events, ...metadata } = run;
  return JSON.stringify(metadata, null, 2);
};

const writeRunMetadata = async (
  runFamilies: RunFamilyStore,
  run: AgenticSession,
): Promise<void> => {
  const targetPath = runFamilies.memberPath(run.agentic_session_id, 'metadata');
  await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, serializeRunMetadata(run), 'utf8');
  await fs.rename(tmpPath, targetPath);
};

class RunMetadataMigrationRequiredError extends SessionValidationError {
  public constructor() {
    super('Persisted Run metadata requires the PLAN-to-TASK migration.');
    this.name = 'RunMetadataMigrationRequiredError';
  }
}

const legacyPlanRunEntitySchema = z.object({ entityType: z.literal('PLAN') }).passthrough();

const parseRunMetadata = (text: string): AgenticSession => {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed['inert'] !== undefined && typeof parsed['inert'] !== 'boolean') {
    throw new SessionValidationError('Persisted Run inertness must be boolean.');
  }
  if (!Object.hasOwn(parsed, 'entity')) {
    throw new SessionValidationError('Persisted Run metadata is missing entity.');
  }
  if (legacyPlanRunEntitySchema.safeParse(parsed['entity']).success) {
    throw new RunMetadataMigrationRequiredError();
  }
  if (parsed['latestTurn'] !== undefined) {
    z.discriminatedUnion('state', [
      z.object({ turnId: z.string(), state: z.literal('running') }),
      z.object({
        turnId: z.string(),
        state: z.literal('settled'),
        outcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
      }),
    ]).parse(parsed['latestTurn']);
  }
  const parsedEntity = persistedRunEntitySchema.safeParse(parsed['entity']);
  if (!parsedEntity.success) {
    throw new SessionValidationError('Persisted Run metadata has an invalid entity.');
  }
  const coerced = coerceLegacyWorktreeState(coerceLegacyServices(parsed));
  return {
    ...coerced,
    entity: parsedEntity.data,
    provider_session_agent_id:
      typeof coerced['provider_session_agent_id'] === 'string'
        ? coerced['provider_session_agent_id']
        : null,
    provider_session_history: normalizeProviderSessionHistory(coerced['provider_session_history']),
    events: [],
  } as unknown as AgenticSession;
};

const readRunMetadata = async (
  runFamilies: RunFamilyStore,
  runId: string,
): Promise<AgenticSession | null> => {
  try {
    return parseRunMetadata(await fs.readFile(runFamilies.memberPath(runId, 'metadata'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

const toAgenticSessionEvent = (event: DurableRunEvent): AgenticSessionEvent => {
  const base = {
    seq: event.seq,
    ts: event.ts,
    app_session_id: event.app_session_id,
    run_id: event.run_id,
    actor: event.actor,
    state_version: event.state_version,
  };
  const payload = event.payload;

  if (payload.kind === 'run_started') {
    const started: AgenticRunStartedPayload = {
      mode: payload.mode,
      prompt: payload.prompt,
      adapterId: payload.adapterId,
      repositoryPath: payload.repositoryPath,
      ...(payload.providerSessionId !== null
        ? { provider_session_id: payload.providerSessionId }
        : {}),
      provider_conversation_id: payload.providerConversationId,
    };
    return { ...base, event_type: 'run_started', payload: started };
  }

  if (payload.kind === 'run_completed') {
    const completed: AgenticRunCompletedPayload = {
      mode: payload.mode,
      provider_session_id: payload.providerSessionId,
      provider_conversation_id: payload.providerConversationId,
      errorCount: payload.errorCount,
      ...(payload.errorCode !== null ? { code: payload.errorCode } : {}),
    };
    return { ...base, event_type: 'run_completed', payload: completed };
  }

  if (payload.kind === 'task_monitor_turn_settled') {
    const terminalOutcome =
      payload.terminalOutcome === 'succeeded'
        ? 'COMPLETED'
        : payload.terminalOutcome === 'failed'
          ? 'FAILED'
          : 'ABORTED';
    const receipt: AgenticOutputMessagePayload = {
      summary: 'task-monitor-conversation-turn-receipt',
      taskMonitorConversationReceipt: {
        sourceMessageId: payload.sourceMessageId,
        turnId: payload.turnId,
        terminalOutcome,
        completedAssistantMessageId: payload.completedAssistantMessageId,
        reportIds: [...payload.reportIds],
      },
      messageType: 'canonical_event',
      subtype: payload.kind,
    };
    return { ...base, event_type: 'post_processed', payload: receipt };
  }

  const canonical: AgenticOutputMessagePayload = {
    messageType: 'canonical_event',
    subtype: payload.kind,
    eventType: event.event_type,
  };
  switch (payload.kind) {
    case 'provider_identity_observed':
      canonical['provider'] = payload.provider;
      canonical['providerSessionId'] = payload.providerSessionId;
      canonical['providerConversationId'] = payload.providerConversationId;
      canonical['providerSessionAgentId'] = payload.providerSessionAgentId;
      canonical['providerThreadId'] = payload.providerThreadId;
      canonical['providerTurnId'] = payload.providerTurnId;
      canonical['observedAt'] = payload.observedAt;
      break;
    case 'tool_use':
      canonical['provider'] = payload.provider;
      canonical['providerSessionId'] = payload.providerSessionId;
      canonical['routing'] = payload.routing;
      canonical['blocks'] = [...payload.blocks];
      canonical['commandLifecycle'] = payload.commandLifecycle;
      break;
    case 'tool_result':
      canonical['provider'] = payload.provider;
      canonical['providerSessionId'] = payload.providerSessionId;
      canonical['routing'] = payload.routing;
      canonical['results'] = [...payload.results];
      canonical['commandLifecycle'] = payload.commandLifecycle;
      break;
    case 'permission_requested':
      canonical['provider'] = payload.provider;
      canonical['providerSessionId'] = payload.providerSessionId;
      canonical['routing'] = payload.routing;
      canonical['permissionRequest'] = payload.request;
      break;
    case 'permission_decision_recorded':
      canonical['requestId'] = payload.requestId;
      canonical['decision'] = payload.decision;
      canonical['decidedAt'] = payload.decidedAt;
      canonical['userId'] = payload.userId;
      break;
    case 'diff':
      canonical['diff'] = payload.diff;
      break;
    case 'committed_outcome':
      canonical['effectId'] = payload.effectId;
      canonical['idempotencyKey'] = payload.idempotencyKey;
      canonical['outcomeType'] = payload.outcomeType;
      canonical['status'] = payload.status;
      canonical['recoveryState'] = payload.recoveryState;
      canonical['canonicalArtifactRefs'] = [...payload.canonicalArtifactRefs];
      canonical['committedAt'] = payload.committedAt;
      canonical['settledAt'] = payload.settledAt;
      break;
  }
  return { ...base, event_type: event.event_type, payload: canonical };
};

const toTransientAgenticSessionEvent = (
  input: AppendAgenticEventInput,
  runId: string,
  seq: number,
  ts: string,
): AgenticSessionEvent => ({
  seq,
  ts,
  app_session_id: runId,
  run_id: input.run_id,
  actor: input.actor,
  event_type: input.event_type,
  state_version: input.state_version,
  ...(input.payload !== undefined ? { payload: input.payload } : {}),
  ...(input.payload_ref !== undefined ? { payload_ref: input.payload_ref } : {}),
});

export class RunStore {
  private static readonly MAX_CHANGED_FILES_DIAGNOSTICS = 200;

  private static readonly VALID_PROVIDER_PREFERENCES = new Set<string>([
    'claude',
    'codex',
    'opencode',
  ]);

  private readonly paths: RunStorePaths;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly runFamilies: RunFamilyStore;
  private readonly eventStore: RunEventStore;
  private readonly indexStore = new RunIndexStore();
  private readonly appendLocks = new Map<string, Promise<AgenticSessionEvent>>();
  private readonly transientEventSeqs = new Map<string, number>();
  private readonly touchedFilesLocks = new Map<string, Promise<void>>();
  private readonly fileChangeFactsLocks = new Map<string, Promise<void>>();
  private readonly changedFilesDiagnosticsLocks = new Map<string, Promise<void>>();
  private readonly metadataLocks = new Map<string, Promise<void>>();
  private readonly toolUsageLocks = new Map<string, Promise<void>>();
  private index: RunIndex | null = null;
  private readonly incompatibleRuns = new Map<string, RunFamilyCompatibilityError>();

  public constructor(private readonly options: RunStoreOptions = {}) {
    this.paths = options.paths ?? resolveRunStorePaths();
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.runFamilies = new RunFamilyStore(
      this.paths.runsDir,
      this.randomId,
      options.readerApplicationVersion,
      options.onCompatibilityDiagnostic,
      options.onInitializationProgress,
    );
    this.eventStore = new RunEventStore(
      (runId) => this.runFamilies.memberPath(runId, 'events'),
      options.onEventLogRead,
    );
  }

  // Collection reads represent discoverable Runs, so invalid historical
  // records are absent from the collection. Direct reads remain strict so a
  // selected/reused Run can never proceed with missing canonical state.
  private async readRunMetadataForCollection(runId: string): Promise<AgenticSession | null> {
    if (this.incompatibleRuns.has(runId)) return null;
    try {
      return await readRunMetadata(this.runFamilies, runId);
    } catch (error) {
      if (error instanceof RunMetadataMigrationRequiredError) {
        try {
          await this.prepareRun(runId);
          return await readRunMetadata(this.runFamilies, runId);
        } catch (migrationError) {
          if (!(migrationError instanceof RunFamilyCompatibilityError)) throw migrationError;
          return null;
        }
      }
      if (!(error instanceof SessionValidationError) && !(error instanceof SyntaxError)) {
        throw error;
      }
      this.options.onInvalidRunMetadata?.({ runId, error });
      return null;
    }
  }

  // Serialize read-modify-write cycles on a run's metadata file so
  // concurrent updateRun* calls cannot clobber each other's fields.
  private async withMetadataLock<T>(
    runId: string,
    operation: () => Promise<T>,
    prepare = true,
  ): Promise<T> {
    if (prepare) await this.prepareRun(runId);
    const previous = this.metadataLocks.get(runId) ?? Promise.resolve();
    const operationPromise = previous.catch(() => undefined).then(operation);
    const tail = operationPromise.then(
      () => undefined,
      () => undefined,
    );
    this.metadataLocks.set(runId, tail);
    try {
      return await operationPromise;
    } finally {
      if (this.metadataLocks.get(runId) === tail) this.metadataLocks.delete(runId);
    }
  }

  private requireCompatibleRun(runId: string): void {
    const incompatibility = this.incompatibleRuns.get(runId);
    if (incompatibility) throw incompatibility;
  }

  private async prepareRun(runId: string, promote = true): Promise<boolean> {
    this.requireCompatibleRun(runId);
    try {
      const migrated = await this.runFamilies.prepare(
        runId,
        { validate: (member, bytes) => this.validateRunFamilyMember(runId, member, bytes) },
        promote,
      );
      this.incompatibleRuns.delete(runId);
      return migrated;
    } catch (error) {
      if (!(error instanceof RunFamilyCompatibilityError)) throw error;
      this.incompatibleRuns.set(runId, error);
      throw error;
    }
  }

  private getIndex(): RunIndex {
    if (!this.index) throw new Error('RunStore not initialized. Call initialize() first.');
    return this.index;
  }

  private async persistIndex(): Promise<void> {
    await this.indexStore.save(this.paths.indexPath, this.getIndex());
  }

  public async initialize(options: RunStoreInitializationOptions = {}): Promise<RunInitResult> {
    const startedAt = Date.now();
    await fs.mkdir(this.paths.runsDir, { recursive: true });

    let hasRuns = await this.hasAnyRunFiles();
    const sessionsDir = path.join(this.paths.baseDir, 'sessions');
    let migrated = false;

    if (
      options.migrateLegacySessions !== false &&
      !hasRuns &&
      (await hasLegacySessions(this.paths.baseDir))
    ) {
      const migrationResult = await migrateSessionsToRuns(sessionsDir, this.paths);
      migrated = migrationResult.migratedRunCount > 0;
      hasRuns = await this.hasAnyRunFiles();
    }

    if (hasRuns) await this.discoverRunFamilies();

    this.index = await this.indexStore.load(this.paths.indexPath);

    // The index is a derived cache. A prior process can leave a valid-looking
    // but incomplete index after an interrupted or concurrent write, so an
    // index that is merely non-empty is not sufficient evidence that it is
    // usable. Reconcile every persisted Run at startup so conversation and
    // agent-session lookups work after a restart even when only some entries
    // were lost.
    if (hasRuns) {
      this.options.onInitializationProgress?.({
        operation: 'index_reconciliation',
        status: 'started',
        elapsedMs: Date.now() - startedAt,
      });
      const runs = await this.listRunsInternal();
      const rebuiltIndex = this.indexStore.rebuildFromRuns(runs);
      if (!indexesMatch(this.index, rebuiltIndex)) {
        this.index = rebuiltIndex;
        if (options.reconcileIndex ?? true) {
          await this.persistIndex();
          this.options.onIndexReconciled?.({ runCount: runs.length });
          this.options.onInitializationProgress?.({
            operation: 'index_reconciliation',
            status: 'completed',
            elapsedMs: Date.now() - startedAt,
            compatibleRunCount: runs.length,
            migrated: true,
          });
          return { migrated: true };
        }
      }
      this.options.onInitializationProgress?.({
        operation: 'index_reconciliation',
        status: 'completed',
        elapsedMs: Date.now() - startedAt,
        compatibleRunCount: runs.length,
        migrated: false,
      });
    }

    return { migrated };
  }

  private async discoverRunFamilies(): Promise<void> {
    const startedAt = Date.now();
    const entries = await fs.readdir(this.paths.runsDir);
    const runIds = [
      ...new Set([
        ...entries.filter(isRunMetadataFileName).map(runIdFromMetadataFileName),
        ...entries.filter(isRunFamilyManifestFileName).map(runIdFromFamilyManifestFileName),
      ]),
    ];
    this.options.onInitializationProgress?.({
      operation: 'run_family_scan',
      status: 'started',
      elapsedMs: 0,
      familyCount: runIds.length,
    });
    for (const [index, runId] of runIds.entries()) {
      const familyStartedAt = Date.now();
      this.options.onInitializationProgress?.({
        operation: 'run_family',
        status: 'started',
        elapsedMs: Date.now() - startedAt,
        runId,
        familyIndex: index + 1,
        familyCount: runIds.length,
      });
      try {
        await this.runFamilies.discoverManifest(runId);
        this.incompatibleRuns.delete(runId);
        this.options.onInitializationProgress?.({
          operation: 'run_family',
          status: 'completed',
          elapsedMs: Date.now() - familyStartedAt,
          runId,
          familyIndex: index + 1,
          familyCount: runIds.length,
          migrated: false,
        });
      } catch (error) {
        if (error instanceof Error) this.options.onInvalidRunMetadata?.({ runId, error });
        this.options.onInitializationProgress?.({
          operation: 'run_family',
          status: 'incompatible',
          elapsedMs: Date.now() - familyStartedAt,
          runId,
          familyIndex: index + 1,
          familyCount: runIds.length,
        });
      }
    }
    this.options.onInitializationProgress?.({
      operation: 'run_family_scan',
      status: 'completed',
      elapsedMs: Date.now() - startedAt,
      familyCount: runIds.length,
      migrated: false,
    });
  }

  private validateRunFamilyMember(runId: string, member: RunFamilyMember, bytes: Uint8Array): void {
    const text = new TextDecoder().decode(bytes);
    switch (member) {
      case 'metadata':
        parseRunMetadata(text);
        return;
      case 'events': {
        let expectedSeq = 1;
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          const event = parseDurableRunEvent(JSON.parse(line) as unknown);
          if (event.run_id !== runId) {
            throw new Error(`Durable event belongs to Run ${event.run_id}, not Run ${runId}.`);
          }
          if (event.seq !== expectedSeq) {
            throw new Error(`Run ${runId} durable event sequence is not contiguous.`);
          }
          expectedSeq += 1;
        }
        return;
      }
      case 'toolUsage':
        z.array(z.json()).parse(JSON.parse(text));
        return;
      case 'touchedFiles':
      case 'idempotency':
        z.array(z.string()).parse(JSON.parse(text));
        return;
      case 'fileChangeFacts':
        parsePersistedFileChangeFacts(JSON.parse(text));
        return;
      case 'changedFilesDiagnostics':
        parsePersistedRunChangedFilesDiagnostics(JSON.parse(text));
        return;
    }
  }

  private async hasAnyRunFiles(): Promise<boolean> {
    try {
      const entries = await fs.readdir(this.paths.runsDir);
      return entries.some(
        (entry) => isRunMetadataFileName(entry) || isRunFamilyManifestFileName(entry),
      );
    } catch {
      return false;
    }
  }

  private async listRunsInternal(): Promise<AgenticSession[]> {
    const runFiles = await this.listPersistedRunIds();

    const runs: AgenticSession[] = [];
    for (const runId of runFiles) {
      const run = await this.readRunMetadataForCollection(runId);
      if (run) runs.push(run);
    }
    return runs;
  }

  private async listPersistedRunIds(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.paths.runsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    return [
      ...new Set([
        ...entries.filter(isRunMetadataFileName).map(runIdFromMetadataFileName),
        ...entries.filter(isRunFamilyManifestFileName).map(runIdFromFamilyManifestFileName),
      ]),
    ].sort();
  }

  public async listRuns(): Promise<AgenticSession[]> {
    return this.listRunsInternal();
  }

  /**
   * Validate and optionally promote every persisted Run family in a stable,
   * one-family-at-a-time pass. Compatibility failures are isolated so a
   * single historical Run cannot prevent other Runs from being migrated.
   */
  public async migrateAllRunFamilies(
    options: RunFamilyMigrationOptions = {},
  ): Promise<RunFamilyMigrationResult> {
    const promote = options.promote ?? true;
    const runIds = await this.listPersistedRunIds();
    const entries: RunFamilyMigrationEntry[] = [];
    const startedAt = Date.now();

    this.options.onInitializationProgress?.({
      operation: 'run_family_scan',
      status: 'started',
      elapsedMs: 0,
      familyCount: runIds.length,
    });

    for (const [index, runId] of runIds.entries()) {
      const familyStartedAt = Date.now();
      this.options.onInitializationProgress?.({
        operation: 'run_family',
        status: 'started',
        elapsedMs: Date.now() - startedAt,
        runId,
        familyIndex: index + 1,
        familyCount: runIds.length,
      });

      let status: RunFamilyMigrationStatus;
      let diagnostic: RunFamilyMigrationEntry['diagnostic'];
      let migrated = false;
      try {
        migrated = await this.prepareRun(runId, promote);
        if (migrated) {
          status = 'migrated';
        } else {
          status = (await readRunMetadata(this.runFamilies, runId)) ? 'current' : 'absent';
        }
      } catch (error) {
        if (!(error instanceof RunFamilyCompatibilityError)) throw error;
        status = 'incompatible';
        diagnostic = error.diagnostic;
      }

      const entry: RunFamilyMigrationEntry = {
        runId,
        status,
        ...(diagnostic ? { diagnostic } : {}),
      };
      entries.push(entry);
      this.options.onInitializationProgress?.({
        operation: 'run_family',
        status: status === 'incompatible' ? 'incompatible' : 'completed',
        elapsedMs: Date.now() - familyStartedAt,
        runId,
        familyIndex: index + 1,
        familyCount: runIds.length,
        migrated,
      });
    }

    const result: RunFamilyMigrationResult = {
      scannedRunCount: entries.length,
      migratedRunCount: entries.filter((entry) => entry.status === 'migrated').length,
      currentRunCount: entries.filter((entry) => entry.status === 'current').length,
      absentRunCount: entries.filter((entry) => entry.status === 'absent').length,
      incompatibleRunCount: entries.filter((entry) => entry.status === 'incompatible').length,
      entries,
    };

    this.options.onInitializationProgress?.({
      operation: 'run_family_scan',
      status: 'completed',
      elapsedMs: Date.now() - startedAt,
      familyCount: runIds.length,
      migrated: result.migratedRunCount > 0,
      compatibleRunCount: result.currentRunCount + result.migratedRunCount,
    });
    return result;
  }

  /** Validates a complete family for maintenance without changing its authority pointer. */
  public async inspectRunFamily(runId: string): Promise<AgenticSession | null> {
    await this.prepareRun(runId, false);
    return readRunMetadata(this.runFamilies, runId);
  }

  public async scanRunMetadataForRetention(): Promise<{
    readonly runs: readonly AgenticSession[];
    readonly preservedRunIds: ReadonlySet<string>;
  }> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.paths.runsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { runs: [], preservedRunIds: new Set() };
      }
      throw error;
    }
    const runIds = [
      ...new Set(entries.filter(isRunFamilyManifestFileName).map(runIdFromFamilyManifestFileName)),
    ];
    const manifestRunIds = new Set(runIds);
    const runs: AgenticSession[] = [];
    const preservedRunIds = new Set<string>(
      entries
        .filter(isRunMetadataFileName)
        .map(runIdFromMetadataFileName)
        .filter((runId) => !manifestRunIds.has(runId)),
    );
    for (const runId of runIds) {
      if (this.incompatibleRuns.has(runId)) {
        preservedRunIds.add(runId);
        continue;
      }
      try {
        if (!(await this.runFamilies.discoverManifest(runId))) {
          preservedRunIds.add(runId);
          continue;
        }
        const run = await readRunMetadata(this.runFamilies, runId);
        if (run) runs.push(run);
        else preservedRunIds.add(runId);
      } catch (error) {
        preservedRunIds.add(runId);
        if (error instanceof Error) this.options.onInvalidRunMetadata?.({ runId, error });
      }
    }
    return { runs, preservedRunIds };
  }

  public async deleteCompletedFamiliesForRetention(input: {
    readonly runIds: readonly string[];
    readonly completedBefore: Date;
  }): Promise<{
    readonly deletedRunCount: number;
    readonly logicalBytes: number;
    readonly pathCount: number;
  }> {
    let deletedRunCount = 0;
    let logicalBytes = 0;
    let pathCount = 0;
    for (const [index, runId] of input.runIds.entries()) {
      if (this.incompatibleRuns.has(runId)) continue;
      const deletion = await this.withMetadataLock(
        runId,
        async () => {
          try {
            await this.prepareRun(runId, false);
            this.incompatibleRuns.delete(runId);
          } catch (error) {
            if (error instanceof RunFamilyCompatibilityError) {
              this.incompatibleRuns.set(runId, error);
              return { deleted: false, logicalBytes: 0, pathCount: 0 };
            }
            throw error;
          }
          const run = await readRunMetadata(this.runFamilies, runId);
          if (
            !run ||
            run.status !== 'complete' ||
            Date.parse(run.updatedAt) >= input.completedBefore.getTime()
          ) {
            return { deleted: false, logicalBytes: 0, pathCount: 0 };
          }
          const targets = [
            path.join(this.paths.baseDir, 'run-attachments', runId),
            path.join(this.paths.runsDir, `${runId}.family.json`),
            path.join(this.paths.runsDir, '.run-families', runId),
            ...runFamilyFileNames(runId).map((fileName) => path.join(this.paths.runsDir, fileName)),
          ];
          let deletedLogicalBytes = 0;
          let deletedPathCount = 0;
          for (const target of targets) {
            try {
              const stat = await fs.lstat(target);
              deletedPathCount += 1;
              deletedLogicalBytes += stat.isFile()
                ? stat.size
                : await this.directoryLogicalBytes(target);
              await fs.rm(target, { recursive: true, force: true });
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }
          return {
            deleted: true,
            logicalBytes: deletedLogicalBytes,
            pathCount: deletedPathCount,
          };
        },
        false,
      ).catch(() => {
        console.error('run.retention.failed', { runId });
        return { deleted: false, logicalBytes: 0, pathCount: 0 };
      });
      if (deletion.deleted) {
        deletedRunCount += 1;
        logicalBytes += deletion.logicalBytes;
        pathCount += deletion.pathCount;
      }
      this.options.onInitializationProgress?.({
        operation: 'run_family',
        status: this.incompatibleRuns.has(runId) ? 'incompatible' : 'completed',
        elapsedMs: 0,
        runId,
        familyIndex: index + 1,
        familyCount: input.runIds.length,
      });
    }
    if (deletedRunCount > 0) {
      this.index = this.indexStore.rebuildFromRuns(await this.listRunsInternal());
      await this.persistIndex();
    }
    return { deletedRunCount, logicalBytes, pathCount };
  }

  private async directoryLogicalBytes(directory: string): Promise<number> {
    let total = 0;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      total += entry.isDirectory()
        ? await this.directoryLogicalBytes(target)
        : (await fs.lstat(target)).size;
    }
    return total;
  }

  public async findRunsByPromptType(promptType: string): Promise<AgenticSession[]> {
    const runIds = this.getIndex().byPromptType[promptType] ?? [];
    const runs: AgenticSession[] = [];
    for (const runId of runIds) {
      const run = await this.readRunMetadataForCollection(runId);
      if (run) runs.push(run);
    }
    return runs;
  }

  private readCompatibleMember(runId: string, member: RunFamilyMember): Promise<Uint8Array | null> {
    return this.runFamilies.readMember(runId, member, {
      validate: (candidate, bytes) => this.validateRunFamilyMember(runId, candidate, bytes),
    });
  }

  /** Metadata-only access never reconciles provider history or promotes a partial family. */
  public async getRunMetadata(runId: string): Promise<AgenticSession | null> {
    const bytes = await this.readCompatibleMember(runId, 'metadata');
    return bytes ? parseRunMetadata(new TextDecoder().decode(bytes)) : null;
  }

  /** Reads retained evidence without preparing, promoting, or rewriting the Run. */
  public async getRunResult(
    runId: string,
  ): Promise<Pick<SubAgentResult, 'assistantCompleted' | 'outputText' | 'usage'> | null> {
    const run = await this.getRunMetadata(runId);
    if (!run) {
      return null;
    }

    const bytes = await this.readCompatibleMember(runId, 'toolUsage');
    const tools = bytes ? z.array(z.json()).parse(JSON.parse(new TextDecoder().decode(bytes))) : [];
    const latest = run.latestTurn;
    const assistantCompleted = latest?.state === 'settled' && latest.outcome === 'COMPLETED';
    const answer = run.finalAssistantMessage;
    return {
      assistantCompleted,
      ...(assistantCompleted && answer?.turnId === latest.turnId
        ? { outputText: answer.text }
        : {}),
      usage: {
        ...(run.tokenUsage
          ? { inputTokens: run.tokenUsage.inputTokens, outputTokens: run.tokenUsage.outputTokens }
          : {}),
        ...(tools.length > 0 ? { toolCalls: tools.length } : {}),
      },
    };
  }

  public updateRunLatestTurn(
    runId: string,
    latestTurn: NonNullable<AgenticSession['latestTurn']>,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }
      run.latestTurn = latestTurn;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public async getRun(runId: string): Promise<AgenticSession | null> {
    return this.readAndReconcileRun(runId, false);
  }

  public async getRunWithEvents(runId: string): Promise<AgenticSession | null> {
    return this.readAndReconcileRun(runId, true);
  }

  private async readAndReconcileRun(
    runId: string,
    includeEvents: boolean,
  ): Promise<AgenticSession | null> {
    const incompatibility = this.incompatibleRuns.get(runId);
    if (incompatibility) throw incompatibility;
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) return null;
      const durableEvents = await this.eventStore.readEvents(runId);
      const events = durableEvents.map(toAgenticSessionEvent);
      const currentHistory = run.provider_session_history ?? [];
      const history = reconcileDurableProviderSessionHistory(currentHistory, durableEvents);
      if (history.length !== currentHistory.length) {
        run.provider_session_history = history;
        run.updatedAt = this.now().toISOString();
        await writeRunMetadata(this.runFamilies, run);
      }
      return { ...run, events: includeEvents ? events : [] };
    });
  }

  public readRunEvents(runId: string): Promise<AgenticSessionEvent[]> {
    return this.readDurableRunEvents(runId).then((events) => events.map(toAgenticSessionEvent));
  }

  /** Read the canonical Run history for typed recovery and reconciliation consumers. */
  public async readDurableRunEvents(runId: string): Promise<DurableRunEvent[]> {
    const bytes = await this.readCompatibleMember(runId, 'events');
    if (!bytes) return [];
    return new TextDecoder()
      .decode(bytes)
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => parseDurableRunEvent(JSON.parse(line)));
  }

  public hasRunEvents(runId: string): Promise<boolean> {
    return this.readDurableRunEvents(runId).then((events) => events.length > 0);
  }

  public async createRun(input: CreateAgenticSessionInput): Promise<AgenticSession> {
    const ts = this.now().toISOString();

    const parsedEntity = persistedRunEntitySchema.safeParse(input.entity);
    if (!parsedEntity.success) {
      throw new SessionValidationError('Run entity is invalid.');
    }

    const requestedId = input.agentic_session_id?.trim();
    if (input.agentic_session_id !== undefined && !requestedId) {
      throw new SessionValidationError(
        'Agentic coding session id must be a non-empty string when provided.',
      );
    }

    const agenticSessionId = requestedId ?? this.randomId();

    // Serialize the existence-check and write for a given id so two concurrent
    // createRun calls cannot both pass the existence check and double-write.
    return this.withMetadataLock(agenticSessionId, async () => {
      const existing = await readRunMetadata(this.runFamilies, agenticSessionId);
      if (existing) {
        if (input.inert !== undefined && input.inert !== (existing.inert ?? false)) {
          throw new SessionValidationError('Run inertness cannot change after creation.');
        }
        if (!sameRunEntity(existing.entity, parsedEntity.data)) {
          throw new SessionValidationError(
            'A Run with this agent session id already exists with a different entity.',
          );
        }
        // Idempotent: a duplicate id resolves to the run that already exists.
        // Re-index it so a stale or missing run-index.json entry self-heals.
        this.indexStore.addRun(this.getIndex(), existing);
        await this.persistIndex();
        return existing;
      }

      const providerConversationId =
        input.provider_conversation_id === undefined || input.provider_conversation_id === null
          ? null
          : (() => {
              const trimmed = input.provider_conversation_id.trim();
              return trimmed.length > 0 ? trimmed : null;
            })();

      const baseEntry = {
        agentic_session_id: agenticSessionId,
        inert: input.inert ?? false,
        entity: parsedEntity.data,
        services: input.services,
        ...(input.launchServiceId ? { launchServiceId: input.launchServiceId } : {}),
        provider: input.provider,
        provider_session_id: input.provider_session_id,
        provider_conversation_id: providerConversationId,
        provider_session_agent_id: input.provider_session_agent_id ?? null,
        provider_session_history: [],
        status: input.status ?? ('idle' as const),
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.worktree?.enabled
          ? {
              worktree: {
                enabled: true as const,
                ...(input.worktree.branch ? { branch: input.worktree.branch } : {}),
              },
            }
          : {}),
        conversationId: input.conversationId,
        ...(input.promptType ? { promptType: input.promptType } : {}),
        ...(input.config !== undefined ? { config: input.config } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
        createdAt: ts,
        updatedAt: ts,
        events: [] as AgenticSessionEvent[],
      };

      if (!input.contextMetadata) {
        throw new SessionValidationError('contextMetadata is required.');
      }

      const entry: AgenticSession = {
        ...baseEntry,
        contextMetadata: input.contextMetadata,
      };

      await this.runFamilies.create(
        agenticSessionId,
        new Map([['metadata', Buffer.from(serializeRunMetadata(entry))]]),
      );
      this.indexStore.addRun(this.getIndex(), entry);
      await this.persistIndex();

      return entry;
    });
  }

  public async reindexRun(run: AgenticSession): Promise<void> {
    // Re-index an already-persisted run so a stale or missing run-index.json
    // entry self-heals. Mirrors the idempotent self-heal block inside
    // createRun, but is callable for a run that already exists on disk.
    this.indexStore.addRun(this.getIndex(), run);
    await this.persistIndex();
  }

  public updateRunStatus(runId: string, status: AgenticSessionStatus): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.status = status;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunProviderIdentity(
    runId: string,
    input: {
      providerSessionId: string | null;
      providerConversationId?: string | null;
      providerSessionAgentId?: string | null;
    },
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const requestedProviderSessionId =
        input.providerSessionId === null ? null : input.providerSessionId.trim();
      if (requestedProviderSessionId !== null && requestedProviderSessionId.length === 0) {
        throw new SessionValidationError('Provider session id must be null or a non-empty string.');
      }

      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      const providerConversationIdProvided = input.providerConversationId !== undefined;
      const providerSessionAgentIdProvided = input.providerSessionAgentId !== undefined;
      const normalizedAgentId =
        input.providerSessionAgentId === undefined || input.providerSessionAgentId === null
          ? null
          : input.providerSessionAgentId.trim().length > 0
            ? input.providerSessionAgentId.trim()
            : null;
      if (
        input.providerSessionAgentId !== undefined &&
        input.providerSessionAgentId !== null &&
        !normalizedAgentId
      ) {
        throw new SessionValidationError(
          'Provider session agent id must be null or a non-empty string.',
        );
      }
      const normalizedConversationId =
        input.providerConversationId === undefined || input.providerConversationId === null
          ? null
          : input.providerConversationId.trim().length > 0
            ? input.providerConversationId.trim()
            : null;

      // Clearing the provider session id also clears the conversation id —
      // a conversation cannot outlive the session that produced it. Callers
      // pass null to clear and don't need to supply both.
      const requestedConversationId =
        requestedProviderSessionId === null
          ? null
          : providerConversationIdProvided
            ? normalizedConversationId
            : run.provider_conversation_id;
      const requestedAgentId =
        requestedProviderSessionId === null
          ? null
          : providerSessionAgentIdProvided
            ? normalizedAgentId
            : (run.provider_session_agent_id ?? null);

      if (
        requestedProviderSessionId !== null &&
        !requestedProviderSessionId.startsWith('pending_') &&
        requestedAgentId === null
      ) {
        throw new SessionValidationError(
          'A real provider session id requires a provider session agent id.',
        );
      }

      const currentIndex = this.getIndex();

      if (requestedProviderSessionId !== null) {
        const conflictByProviderSession =
          currentIndex.byProviderSessionId[requestedProviderSessionId];
        if (conflictByProviderSession && conflictByProviderSession !== runId) {
          throw new SessionValidationError(
            `Provider session id already exists: ${requestedProviderSessionId} (owned by ${conflictByProviderSession}).`,
          );
        }
      }

      if (requestedConversationId) {
        const conflictByConversation = currentIndex.byProviderSessionId[requestedConversationId];
        if (conflictByConversation && conflictByConversation !== runId) {
          throw new SessionValidationError(
            `Provider conversation id already exists: ${requestedConversationId} (owned by ${conflictByConversation}).`,
          );
        }
      }

      const requestedCanonical = requestedConversationId ?? requestedProviderSessionId;
      if (requestedCanonical !== null) {
        const conflictByCanonical = currentIndex.byCanonicalRunId[requestedCanonical];
        if (conflictByCanonical && conflictByCanonical !== runId) {
          throw new SessionValidationError(
            `Provider canonical identity already exists: ${requestedCanonical} (owned by ${conflictByCanonical}).`,
          );
        }
      }

      const previous = { ...run };
      // run.provider_session_id is declared as non-null string in the type,
      // but the live runtime carries null between mint and the first
      // updateProviderIdentity write (and after an explicit discard). Cast
      // to satisfy the type without forcing every consumer to widen.
      run.provider_session_id = requestedProviderSessionId as unknown as string;
      run.provider_conversation_id = requestedConversationId;
      run.provider_session_agent_id = requestedAgentId;
      run.updatedAt = this.now().toISOString();

      await writeRunMetadata(this.runFamilies, run);
      this.indexStore.updateProviderIdentity(currentIndex, previous, run);
      await this.persistIndex();

      return run;
    });
  }

  public appendRunProviderSessionHistory(
    runId: string,
    entry: ProviderSessionHistoryEntry,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }
      const currentHistory = run.provider_session_history ?? [];
      const history = appendProviderSessionHistoryEntry(currentHistory, entry);
      if (history.length === currentHistory.length) return run;
      run.provider_session_history = history;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunWorktreeState(
    runId: string,
    worktreeState: LocalWorktreeStateByService,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.worktreeState = worktreeState;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunServices(
    runId: string,
    input: { services: ResolvedServiceBinding[]; launchServiceId: string },
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }
      if (input.services.length === 0) {
        throw new SessionValidationError('Run service scope must contain at least one Service.');
      }

      const serviceIds = new Set<string>();
      for (const service of input.services) {
        if (service.id.trim().length === 0 || service.path.trim().length === 0) {
          throw new SessionValidationError(
            'Run service scope entries require non-empty Service IDs and paths.',
          );
        }
        if (serviceIds.has(service.id)) {
          throw new SessionValidationError(
            `Run service scope contains duplicate Service ${service.id}.`,
          );
        }
        serviceIds.add(service.id);
      }
      if (!serviceIds.has(input.launchServiceId)) {
        throw new SessionValidationError(
          `Run launch Service ${input.launchServiceId} is not in the service scope.`,
        );
      }

      run.services = input.services.map(({ id, path: servicePath }) => ({
        id,
        path: servicePath,
      }));
      run.launchServiceId = input.launchServiceId;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunScope(runId: string, scope: LocalRunScope): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.scope = scope;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunSessionContext(
    runId: string,
    context: Record<string, unknown>,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.sessionContext = { ...run.sessionContext, ...context };
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunImplementRuntime(
    runId: string,
    runtime: import('../shared/api/generated/api').ImplementRuntimeSelection,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) throw new SessionValidationError(`Unknown Run: ${runId}`);
      // A provider switch stays inside this Run; the Run rotates its provider session.
      run.provider = runtime.provider;
      run.model = runtime.model;
      if (runtime.reasoningEffort === undefined) delete run.reasoningEffort;
      else run.reasoningEffort = runtime.reasoningEffort;
      if (runtime.fastMode === undefined) delete run.fastMode;
      else run.fastMode = runtime.fastMode;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunImplementationReadiness(
    runId: string,
    disposition: ImplementationReadinessDisposition,
  ): Promise<AgenticSession> {
    return this.updateRunSessionContext(runId, { implementationReadiness: disposition });
  }

  public async getRunImplementationReadiness(
    runId: string,
  ): Promise<ImplementationReadinessDisposition | null> {
    const run = await this.getRunMetadata(runId);
    return run ? parseImplementationReadinessFromSessionContext(run.sessionContext) : null;
  }

  public updateRunFinalAssistantMessage(
    runId: string,
    message: NonNullable<AgenticSession['finalAssistantMessage']>,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.finalAssistantMessage = message;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunPreviousProviderSession(
    runId: string,
    previous: PreviousProviderSession | null,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.previousProviderSession = previous;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public appendRunMemo(runId: string, memo: RunMemo): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.memos = [...(run.memos ?? []), memo];
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  /** Appends a hand-in's trace, numbering it as the next round of its turn. */
  public appendRunGatherTrace(
    runId: string,
    trace: Omit<GatherTrace, 'round'>,
  ): Promise<GatherTrace> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      const earlier = (run.gatherTraces ?? []).filter(({ turnId }) => turnId === trace.turnId);
      const stored: GatherTrace = { ...trace, round: earlier.length + 1 };
      run.gatherTraces = [...(run.gatherTraces ?? []), stored];
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return stored;
    });
  }

  public updateRunPermissionRequestPresentations(
    runId: string,
    presentations: readonly PermissionRequestPresentation[],
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.permissionRequestPresentations = [...presentations];
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunServiceScopeRequestPresentations(
    runId: string,
    presentations: readonly ServiceScopeRequestPresentation[],
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      run.serviceScopeRequestPresentations = [...presentations];
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunServiceScopeContinuationInput(
    runId: string,
    input: InternalRunPromptRequest | null,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      if (input) {
        run.serviceScopeContinuationInput = input;
      } else {
        delete run.serviceScopeContinuationInput;
      }
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunServiceScopeContinuation(
    runId: string,
    continuation: ServiceScopeContinuation | null,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      if (continuation) {
        run.serviceScopeContinuation = continuation;
      } else {
        delete run.serviceScopeContinuation;
        delete run.serviceScopeContinuationInput;
      }
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunReviewFileScopeReconciliations(
    runId: string,
    records: NonNullable<AgenticSession['reviewFileScopeReconciliations']>,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      run.reviewFileScopeReconciliations = records;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunReviewFileScopeRequestPresentations(
    runId: string,
    presentations: readonly ReviewFileScopeRequestPresentation[],
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      run.reviewFileScopeRequestPresentations = [...presentations];
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunReviewFileScopeContinuation(
    runId: string,
    continuation: AgenticSession['reviewFileScopeContinuation'] | null,
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      if (continuation) run.reviewFileScopeContinuation = continuation;
      else delete run.reviewFileScopeContinuation;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunTriggerContext(
    runId: string,
    context: { externalAgentNodeId: string | null; triggerMessageId: string | null },
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.triggerExternalAgentNodeId = context.externalAgentNodeId;
      run.triggerMessageId = context.triggerMessageId;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunProjectAssistantDone(runId: string, done: boolean): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      run.projectAssistantDone = done;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public recordRunStartedPromptType(runId: string, promptType: string): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      const started = run.startedPromptTypes ?? [];
      if (started.includes(promptType)) return run;

      run.startedPromptTypes = [...started, promptType];
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public updateRunPromptType(runId: string, promptType: string): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      if (run.promptType === promptType) return run;

      // Maintain the promptType secondary index alongside the run body.
      const index = this.getIndex();
      if (run.promptType) {
        const bucket = index.byPromptType[run.promptType];
        if (bucket) {
          const next = bucket.filter((id) => id !== runId);
          if (next.length === 0) {
            delete index.byPromptType[run.promptType];
          } else {
            index.byPromptType[run.promptType] = next;
          }
        }
      }
      const bucket = index.byPromptType[promptType] ?? [];
      if (!bucket.includes(runId)) {
        index.byPromptType[promptType] = [...bucket, runId];
      }

      run.promptType = promptType;
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      await this.persistIndex();
      return run;
    });
  }

  public updateRunTokenUsage(
    runId: string,
    delta: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
      cacheAvailability?: LocalTokenUsage['cacheAvailability'];
    },
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }

      const existing: TokenUsage = run.tokenUsage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheAvailability: 'unsupported',
      };
      run.tokenUsage = {
        inputTokens: existing.inputTokens + delta.inputTokens,
        outputTokens: existing.outputTokens + delta.outputTokens,
        cacheCreationInputTokens:
          (existing.cacheCreationInputTokens ?? 0) + (delta.cacheCreationInputTokens ?? 0),
        cacheReadInputTokens:
          (existing.cacheReadInputTokens ?? 0) + (delta.cacheReadInputTokens ?? 0),
        cacheAvailability: delta.cacheAvailability ?? existing.cacheAvailability ?? 'unsupported',
      };
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  public setRunTokenUsage(
    runId: string,
    total: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
      cacheAvailability?: LocalTokenUsage['cacheAvailability'];
    },
  ): Promise<AgenticSession> {
    return this.withMetadataLock(runId, async () => {
      const run = await readRunMetadata(this.runFamilies, runId);
      if (!run) {
        throw new SessionValidationError(`Unknown agentic session: ${runId}`);
      }
      run.tokenUsage = {
        inputTokens: total.inputTokens,
        outputTokens: total.outputTokens,
        cacheCreationInputTokens: total.cacheCreationInputTokens ?? 0,
        cacheReadInputTokens: total.cacheReadInputTokens ?? 0,
        cacheAvailability: total.cacheAvailability ?? 'unsupported',
      };
      run.updatedAt = this.now().toISOString();
      await writeRunMetadata(this.runFamilies, run);
      return run;
    });
  }

  private async admissionContext(runId: string): Promise<DurableAdmissionContext> {
    const run = await readRunMetadata(this.runFamilies, runId);
    const launchService = run?.services.find((service) => service.id === run.launchServiceId);
    const firstService = run?.services[0];
    return {
      runId,
      provider: run?.provider ?? 'legacy',
      providerSessionId: run?.provider_session_id ?? null,
      providerConversationId: run?.provider_conversation_id ?? null,
      providerSessionAgentId: run?.provider_session_agent_id ?? null,
      repositoryPath: launchService?.path ?? firstService?.path ?? null,
    };
  }

  private queueEventAppend(
    runId: string,
    operation: () => Promise<AgenticSessionEvent>,
  ): Promise<AgenticSessionEvent> {
    const previous = this.appendLocks.get(runId);
    const next = (previous ?? Promise.resolve(undefined)).catch(() => undefined).then(operation);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.appendLocks.set(runId, next);
    void tail.finally(() => {
      if (this.appendLocks.get(runId) === next) this.appendLocks.delete(runId);
    });
    return next;
  }

  /** Append a record that has already crossed the typed canonical admission boundary. */
  public async appendDurableEvent(
    runId: string,
    input: DurableRunEventInput,
  ): Promise<AgenticSessionEvent> {
    await this.prepareRun(runId);
    if (input.run_id !== runId) {
      throw new SessionValidationError('Durable Run event is bound to a different Run.');
    }
    return this.queueEventAppend(runId, async () => {
      const event = await this.eventStore.appendNextEvent(runId, (seq) =>
        parseDurableRunEvent({
          schema_version: DURABLE_RUN_EVENT_SCHEMA_VERSION,
          seq,
          ts: this.now().toISOString(),
          app_session_id: runId,
          ...input,
          run_id: runId,
        }),
      );
      return toAgenticSessionEvent(event);
    });
  }

  /**
   * Compatibility adapter for existing live callers. Only canonical
   * projections are persisted; ordinary provider output remains transient.
   */
  public async appendEvent(
    runId: string,
    input: AppendAgenticEventInput,
  ): Promise<AgenticSessionEvent> {
    await this.prepareRun(runId);
    return this.queueEventAppend(runId, async () => {
      const observedAt = this.now().toISOString();
      const context = await this.admissionContext(runId);
      const projected = projectAgenticEventToDurableEvents(input, context, observedAt);
      if (projected.length === 0) {
        const lastSeq = await this.eventStore.getLastSeq(runId);
        const previousTransientSeq = this.transientEventSeqs.get(runId) ?? 0;
        const seq = Math.max(lastSeq, previousTransientSeq) + 1;
        this.transientEventSeqs.set(runId, seq);
        return toTransientAgenticSessionEvent(input, runId, seq, observedAt);
      }

      let lastEvent: AgenticSessionEvent | null = null;
      for (const candidate of projected) {
        const event = await this.eventStore.appendNextEvent(runId, (seq) =>
          parseDurableRunEvent({
            schema_version: DURABLE_RUN_EVENT_SCHEMA_VERSION,
            seq,
            ts: observedAt,
            app_session_id: runId,
            ...candidate,
            run_id: runId,
          }),
        );
        lastEvent = toAgenticSessionEvent(event);
      }
      if (!lastEvent) throw new Error('Canonical event projection produced no event.');
      if (input.payload_ref !== undefined) lastEvent.payload_ref = input.payload_ref;
      return lastEvent;
    });
  }

  private idempotencyTokenPath(runId: string): string {
    return this.runFamilies.memberPath(runId, 'idempotency');
  }

  private async readIdempotencyTokens(runId: string): Promise<string[]> {
    try {
      const text = await fs.readFile(this.idempotencyTokenPath(runId), 'utf8');
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  public async hasIdempotencyToken(runId: string, token: string): Promise<boolean> {
    await this.prepareRun(runId);
    const tokens = await this.readIdempotencyTokens(runId);
    return tokens.includes(token);
  }

  public async persistIdempotencyToken(runId: string, token: string): Promise<void> {
    await this.prepareRun(runId);
    const tokens = await this.readIdempotencyTokens(runId);
    if (!tokens.includes(token)) {
      tokens.push(token);
      const targetPath = this.idempotencyTokenPath(runId);
      const tmpPath = `${targetPath}.${this.randomId()}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(tokens), 'utf8');
      await fs.rename(tmpPath, targetPath);
    }
  }

  private touchedFilesPath(runId: string): string {
    return this.runFamilies.memberPath(runId, 'touchedFiles');
  }

  private async readTouchedFiles(runId: string): Promise<string[]> {
    try {
      const text = await fs.readFile(this.touchedFilesPath(runId), 'utf8');
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  public async addTouchedFiles(runId: string, newPaths: string[]): Promise<void> {
    await this.prepareRun(runId);
    if (newPaths.length === 0) return;
    const prev = this.touchedFilesLocks.get(runId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.readTouchedFiles(runId);
        const merged = Array.from(new Set([...existing, ...newPaths]));
        const targetPath = this.touchedFilesPath(runId);
        const tmpPath = `${targetPath}.${this.randomId()}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(merged), 'utf8');
        await fs.rename(tmpPath, targetPath);
      });
    this.touchedFilesLocks.set(runId, next);
    await next;
  }

  private fileChangeFactsPath(runId: string): string {
    return this.runFamilies.memberPath(runId, 'fileChangeFacts');
  }

  private async readFileChangeFacts(runId: string): Promise<CanonicalFileChangeFact[]> {
    try {
      const text = await fs.readFile(this.fileChangeFactsPath(runId), 'utf8');
      const parsed: unknown = JSON.parse(text);
      return parsePersistedFileChangeFacts(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async writeFileChangeFacts(
    runId: string,
    facts: CanonicalFileChangeFact[],
  ): Promise<void> {
    const payload: PersistedRunFileChangeFactsV1 = { version: 1, facts };
    const targetPath = this.fileChangeFactsPath(runId);
    const tmpPath = `${targetPath}.${this.randomId()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await fs.rename(tmpPath, targetPath);
  }

  private async withFileChangeFactsLock(
    runId: string,
    operation: (
      existing: CanonicalFileChangeFact[],
    ) => CanonicalFileChangeFact[] | Promise<CanonicalFileChangeFact[]>,
  ): Promise<void> {
    const previous = this.fileChangeFactsLocks.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.readFileChangeFacts(runId);
        const updated = await operation(existing);
        await this.writeFileChangeFacts(runId, updated);
      })
      .finally(() => {
        if (this.fileChangeFactsLocks.get(runId) === next) {
          this.fileChangeFactsLocks.delete(runId);
        }
      });
    this.fileChangeFactsLocks.set(runId, next);
    await next;
  }

  public async appendFileChangeFacts(
    runId: string,
    facts: CanonicalFileChangeFact[],
  ): Promise<void> {
    await this.prepareRun(runId);
    if (facts.length === 0) return;
    await this.withFileChangeFactsLock(runId, (existing) => [...existing, ...facts]);
  }

  public async replaceFileChangeFacts(
    runId: string,
    facts: CanonicalFileChangeFact[],
  ): Promise<void> {
    await this.prepareRun(runId);
    await this.withFileChangeFactsLock(runId, () => facts);
  }

  public async getFileChangeFacts(runId: string): Promise<CanonicalFileChangeFact[]> {
    const bytes = await this.readCompatibleMember(runId, 'fileChangeFacts');
    return bytes ? parsePersistedFileChangeFacts(JSON.parse(new TextDecoder().decode(bytes))) : [];
  }

  public async getTouchedFiles(runId: string): Promise<string[]> {
    const facts = await this.getFileChangeFacts(runId);
    if (facts.length === 0) {
      // Legacy sidecars are read-only compatibility input. New writes go only
      // through appendFileChangeFacts, so they can never become a competing
      // authority once canonical evidence exists.
      const bytes = await this.readCompatibleMember(runId, 'touchedFiles');
      return bytes ? z.array(z.string()).parse(JSON.parse(new TextDecoder().decode(bytes))) : [];
    }
    const run = await this.getRunMetadata(runId);
    if (!run) return [];
    return projectFileChanges(facts).flatMap((entry) => {
      const absolutePath = resolveProjectedFilePath(run, entry);
      return absolutePath ? [absolutePath] : [];
    });
  }

  private changedFilesDiagnosticsPath(runId: string): string {
    return this.runFamilies.memberPath(runId, 'changedFilesDiagnostics');
  }

  public async getChangedFilesDiagnostics(
    runId: string,
  ): Promise<RunChangedFilesDiagnosticEntry[]> {
    await this.prepareRun(runId);
    try {
      const text = await fs.readFile(this.changedFilesDiagnosticsPath(runId), 'utf8');
      const parsed: unknown = JSON.parse(text);
      return parsePersistedRunChangedFilesDiagnostics(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  public async appendChangedFilesDiagnostic(
    runId: string,
    entry: RunChangedFilesDiagnosticEntry,
    prepareFamily = true,
  ): Promise<void> {
    if (!prepareFamily && !this.runFamilies.hasPreparedFamily(runId)) {
      throw new Error('Diagnostic persistence requires a fully prepared Run family.');
    }
    await this.prepareRun(runId);
    const previous = this.changedFilesDiagnosticsLocks.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.getChangedFilesDiagnostics(runId);
        const entries = [...existing, entry].slice(-RunStore.MAX_CHANGED_FILES_DIAGNOSTICS);
        const payload = {
          version: 1,
          entries,
        } satisfies PersistedRunChangedFilesDiagnosticsV1;
        const targetPath = this.changedFilesDiagnosticsPath(runId);
        const tmpPath = `${targetPath}.${this.randomId()}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
        await fs.rename(tmpPath, targetPath);
      })
      .finally(() => {
        if (this.changedFilesDiagnosticsLocks.get(runId) === next) {
          this.changedFilesDiagnosticsLocks.delete(runId);
        }
      });
    this.changedFilesDiagnosticsLocks.set(runId, next);
    await next;
  }

  private toolUsagePath(runId: string): string {
    return this.runFamilies.memberPath(runId, 'toolUsage');
  }

  private async readToolUsage(runId: string): Promise<LocalToolUsageEntry[]> {
    try {
      const text = await fs.readFile(this.toolUsagePath(runId), 'utf8');
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as LocalToolUsageEntry[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  public async addToolUsage(runId: string, newEntries: LocalToolUsageEntry[]): Promise<void> {
    await this.prepareRun(runId);
    if (newEntries.length === 0) return;
    const prev = this.toolUsageLocks.get(runId) ?? Promise.resolve();
    const next: Promise<void> = prev
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.readToolUsage(runId);
        const merged = [...existing, ...newEntries];
        const targetPath = this.toolUsagePath(runId);
        const tmpPath = `${targetPath}.${this.randomId()}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(merged), 'utf8');
        await fs.rename(tmpPath, targetPath);
      })
      .catch((error) => {
        console.error(`addToolUsage write failed for run ${runId}:`, error);
      })
      .finally(() => {
        if (this.toolUsageLocks.get(runId) === next) {
          this.toolUsageLocks.delete(runId);
        }
      });
    this.toolUsageLocks.set(runId, next);
    await next;
  }

  public async getToolUsage(runId: string): Promise<LocalToolUsageEntry[]> {
    await this.prepareRun(runId);
    return this.readToolUsage(runId);
  }

  public async getProviderPreference(): Promise<TaskSessionProviderPreference | null> {
    try {
      const text = await fs.readFile(this.paths.preferencesPath, 'utf8');
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const provider = parsed['providerPreference'];
      if (typeof provider === 'string' && RunStore.VALID_PROVIDER_PREFERENCES.has(provider)) {
        return provider as TaskSessionProviderPreference;
      }
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  public async setProviderPreference(provider: string): Promise<void> {
    let existing: Record<string, unknown> = {};
    try {
      const text = await fs.readFile(this.paths.preferencesPath, 'utf8');
      existing = JSON.parse(text) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    existing['providerPreference'] = provider;
    await fs.writeFile(this.paths.preferencesPath, JSON.stringify(existing, null, 2), 'utf8');
  }

  public lookupByAgentSessionId(agentSessionId: string): string | null {
    return this.indexStore.lookupByAgentSessionId(this.getIndex(), agentSessionId);
  }

  public lookupByProviderSessionId(providerSessionId: string): string | null {
    return this.indexStore.lookupByProviderSessionId(this.getIndex(), providerSessionId);
  }

  public lookupByCanonicalRunId(canonicalRunId: string): string | null {
    return this.indexStore.lookupByCanonicalRunId(this.getIndex(), canonicalRunId);
  }

  public lookupByConversationId(conversationId: string): string | null {
    return this.indexStore.lookupByConversationId(this.getIndex(), conversationId);
  }
}
