import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { version as applicationVersion } from '../../package.json';
import {
  DurableDataCompatibilityReader,
  type CompatibilityDiagnostic,
  type DurableDataSource,
  type JsonValue,
} from '../durable-data';
import {
  RUN_FAMILY_MANIFEST_SUFFIX,
  RUN_FAMILY_MEMBERS,
  legacyRunFamilyMemberFileName,
  type RunFamilyMember,
} from './run-files';
import {
  hasLegacyRunChangedFilesDiffDiagnostics,
  migratePersistedRunChangedFilesDiagnostics,
} from './changed-files-diagnostics';
import type { RunStoreInitializationProgress } from './types';
import { mapCodexEvent } from '../agents/providers/codex/codex-event-mapper';
import {
  normalizeProviderEventPayload,
  type NormalizeProviderEventInput,
} from '../agents/providers/provider-event-normalization';
import {
  projectAgenticEventToDurableEvents,
  type DurableAdmissionContext,
  type DurableAdmissionEventInput,
} from '../run/durable-event-admission';
import {
  DURABLE_RUN_EVENT_SCHEMA_VERSION,
  parseDurableRunEvent,
  type DurableProvider,
} from './durable-events';
import type { RunEntityReference } from '../shared/agent-bridge-contract/generated/api';

const RUN_FAMILY_SCHEMA_VERSION = 2;

const legacyPlanRunMetadataSchema = z
  .object({
    entity: z.object({
      entityType: z.literal('PLAN'),
      entityId: z.string().uuid(),
    }),
  })
  .passthrough();

const memberSchema = z.object({
  schemaVersion: z.number().int().positive(),
  writerApplicationVersion: z.string().min(1),
  relativePath: z
    .string()
    .min(1)
    .refine(
      (value) => !path.isAbsolute(value) && !value.split(/[\\/]/u).includes('..'),
      'Run family member path must stay within the Run store.',
    ),
});

const manifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  writerApplicationVersion: z.string().min(1),
  generationId: z
    .string()
    .min(1)
    .refine(
      (value) => value !== '.' && value !== '..' && !/[\\/]/u.test(value),
      'Run family generation id must be one path segment.',
    ),
  members: z.record(z.enum(RUN_FAMILY_MEMBERS), memberSchema),
});

export type PersistedRunFamilyManifest = z.infer<typeof manifestSchema>;

export const parsePersistedRunFamilyManifest = (
  runId: string,
  text: string,
): PersistedRunFamilyManifest => {
  const manifest = manifestSchema.parse(JSON.parse(text));
  for (const member of RUN_FAMILY_MEMBERS) {
    const expectedRelativePath = path.join(
      '.run-families',
      runId,
      manifest.generationId,
      `${member}.data`,
    );
    if (manifest.members[member].relativePath !== expectedRelativePath) {
      throw new Error(
        `Run family member ${member} is not bound to Run ${runId} generation ${manifest.generationId}.`,
      );
    }
  }
  return manifest;
};

export interface RunFamilyValidation {
  readonly validate: (member: RunFamilyMember, bytes: Uint8Array) => void;
}

export type RunFamilyCompatibilityDiagnostic = CompatibilityDiagnostic & {
  readonly member?: RunFamilyMember;
};

export class RunFamilyCompatibilityError extends Error {
  public constructor(
    readonly runId: string,
    readonly diagnostic: RunFamilyCompatibilityDiagnostic,
  ) {
    super(
      `Run ${runId}${diagnostic.member ? ` member ${diagnostic.member}` : ''} is incompatible (${diagnostic.reason}); source schema ${String(diagnostic.sourceSchemaVersion)}, current schema ${String(diagnostic.currentSchemaVersion)}, writer ${diagnostic.writerApplicationVersion ?? 'unknown'}, reader ${diagnostic.readerApplicationVersion}: ${diagnostic.errorMessage ?? 'compatibility could not be established'}.`,
    );
    this.name = 'RunFamilyCompatibilityError';
  }
}

const compatibilityDescriptorFromSource = (source: DurableDataSource): JsonValue => ({
  sourcePathCount: source.bytesByPath.size,
  sourceByteCount: [...source.bytesByPath.values()].reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  ),
});

const sourceByteCount = (source: DurableDataSource | null): number =>
  source
    ? [...source.bytesByPath.values()].reduce((total, bytes) => total + bytes.byteLength, 0)
    : 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const readNestedRecord = (
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null => {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return null;
};

const readNestedString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return null;
};

const legacyEventSchema = z
  .object({
    seq: z.number().int().positive(),
    ts: z.string().min(1),
    app_session_id: z.string().min(1),
    run_id: z.string().min(1),
    actor: z.enum(['app', 'agent', 'system']),
    event_type: z.enum([
      'run_started',
      'prompt_sent',
      'agent_output',
      'run_completed',
      'post_processed',
    ]),
    state_version: z.number().int().nonnegative(),
    payload: z.unknown().optional(),
  })
  .passthrough();

type LegacyRunEvent = z.infer<typeof legacyEventSchema>;

const parseLegacyRunEvent = (value: unknown, runId: string): LegacyRunEvent => {
  const event = legacyEventSchema.parse(value);
  // Legacy runners used a per-provider-invocation id in this field while the
  // JSONL path was owned by the Agent Session Run. Compaction rebinds the
  // durable envelope to the owning Run, so the legacy value is retained only
  // as transient source metadata and is not a membership check.
  if (!Number.isFinite(Date.parse(event.ts))) {
    throw new Error(`Run ${runId} event timestamp is invalid.`);
  }
  return event;
};

const isSupportedProvider = (value: string | null): value is 'claude' | 'codex' | 'opencode' =>
  value === 'claude' || value === 'codex' || value === 'opencode';

const providerHintFromLegacyPayload = (
  payload: Record<string, unknown>,
  fallback: DurableProvider,
): DurableProvider => {
  const provider = readString(payload['provider']);
  if (provider) return provider;
  const adapterId = readString(payload['adapterId'])?.toLowerCase();
  if (adapterId?.startsWith('claude')) return 'claude';
  if (adapterId?.startsWith('codex')) return 'codex';
  if (adapterId?.startsWith('opencode')) return 'opencode';
  return fallback;
};

const legacyProviderInput = (
  event: LegacyRunEvent,
  payload: Record<string, unknown>,
  runId: string,
): { input: NormalizeProviderEventInput; context: DurableAdmissionContext } | null => {
  const providerValue = readString(payload['provider']);
  const rawEvent = isRecord(payload['raw_event']) ? payload['raw_event'] : null;
  if (!rawEvent || !providerValue) return null;
  if (!isSupportedProvider(providerValue)) {
    throw new Error(`Run ${runId} has an unsupported provider event source.`);
  }
  const sessionId =
    readNestedString(payload, ['session_id', 'sessionId', 'provider_session_id']) ?? null;
  const agentId = readNestedString(payload, ['agent_id', 'agentId']) ?? null;
  const conversationId =
    readNestedString(payload, ['provider_conversation_id', 'providerConversationId']) ?? null;
  return {
    input: {
      provider: providerValue,
      runId,
      eventType: readString(payload['eventType']) ?? event.event_type,
      timestamp: event.ts,
      sessionId,
      agentId,
      rawEvent,
    },
    context: {
      runId,
      provider: providerValue,
      providerSessionId: sessionId,
      providerConversationId: conversationId,
      providerSessionAgentId: agentId,
      repositoryPath: readNestedString(payload, ['repositoryPath', 'repository_path']),
    },
  };
};

const projectLegacyRunEvent = (
  event: LegacyRunEvent,
  runId: string,
  providerHint: DurableProvider = 'legacy',
): ReturnType<typeof projectAgenticEventToDurableEvents> => {
  const payload = isRecord(event.payload) ? event.payload : {};

  // A partially completed upgrade may already contain a canonical payload in
  // an otherwise legacy envelope. Preserve that typed record while the
  // compaction pass assigns the new contiguous sequence instead of treating
  // it as an unrelated provider message.
  if (typeof payload['kind'] === 'string') {
    try {
      const existing = parseDurableRunEvent({
        schema_version: DURABLE_RUN_EVENT_SCHEMA_VERSION,
        seq: event.seq,
        ts: event.ts,
        app_session_id: event.app_session_id,
        run_id: event.run_id,
        actor: event.actor,
        state_version: event.state_version,
        event_type: event.event_type,
        payload,
      });
      return [
        {
          run_id: runId,
          actor: existing.actor,
          event_type: existing.event_type,
          state_version: existing.state_version,
          payload: existing.payload,
        },
      ];
    } catch {
      // The legacy payload may use an unrelated `kind` field. Continue with
      // provider normalization before deciding whether it is transient.
    }
  }

  const providerInput = legacyProviderInput(event, payload, runId);
  if (providerInput) {
    const normalized =
      providerInput.input.provider === 'codex'
        ? mapCodexEvent(providerInput.input)
        : normalizeProviderEventPayload(providerInput.input);
    const normalizedEvent: DurableAdmissionEventInput = {
      ...event,
      payload: normalized.payload,
    };
    return projectAgenticEventToDurableEvents(normalizedEvent, providerInput.context, event.ts);
  }

  const provider = providerHintFromLegacyPayload(payload, providerHint);
  const context: DurableAdmissionContext = {
    runId,
    provider,
    providerSessionId:
      readNestedString(payload, ['provider_session_id', 'providerSessionId', 'session_id']) ?? null,
    providerConversationId:
      readNestedString(payload, ['provider_conversation_id', 'providerConversationId']) ?? null,
    providerSessionAgentId: readNestedString(payload, ['provider_session_agent_id', 'agent_id']),
    repositoryPath: readNestedString(payload, ['repositoryPath', 'repository_path']),
  };
  return projectAgenticEventToDurableEvents(event, context, event.ts);
};

const canonicalEventTypeFrom = (payload: Record<string, unknown>): string | null =>
  readString(payload['canonical_event_type'] ?? payload['canonicalEventType']);

const hasAuthoritativeProviderFacts = (payload: Record<string, unknown>): boolean => {
  const canonicalType = canonicalEventTypeFrom(payload);
  const facts = readNestedRecord(payload, ['normalized_facts', 'normalizedFacts']);
  const permissionRequest = facts
    ? readNestedRecord(facts, ['permissionRequest', 'permission_request'])
    : null;
  const diff = facts ? readNestedRecord(facts, ['diff']) : null;
  const canonical = readNestedRecord(payload, ['canonical_event', 'canonicalEvent']);
  const canonicalDiff = canonical ? readNestedRecord(canonical, ['diff']) : null;
  const canonicalAuthority = canonicalDiff
    ? readString(canonicalDiff['authority'] ?? canonicalDiff['attribution_authority'])
    : null;
  const factsAuthority = diff
    ? readString(diff['authority'] ?? diff['attribution_authority'])
    : null;
  return (
    canonicalType === 'permission_request' ||
    (canonicalType === 'diff' && canonicalAuthority !== 'diagnostic') ||
    permissionRequest !== null ||
    (diff !== null && factsAuthority !== 'diagnostic') ||
    (facts !== null &&
      ((Array.isArray(facts['toolUses']) && facts['toolUses'].length > 0) ||
        (Array.isArray(facts['toolResults']) && facts['toolResults'].length > 0))) ||
    (Array.isArray(payload['all_tool_use_blocks']) && payload['all_tool_use_blocks'].length > 0) ||
    (Array.isArray(payload['all_tool_result_blocks']) &&
      payload['all_tool_result_blocks'].length > 0)
  );
};

const compactRunEventMember = (
  runId: string,
  eventPath: string,
  source: DurableDataSource,
): DurableDataSource => {
  const bytes = source.bytesByPath.get(eventPath);
  if (!bytes) return source;
  const text = new TextDecoder().decode(bytes);
  const compacted: string[] = [];
  let nextSeq = 1;
  let previousSourceSeq = 0;
  let providerHint: DurableProvider = 'legacy';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const event = parseLegacyRunEvent(JSON.parse(line) as unknown, runId);
    if (event.seq !== previousSourceSeq + 1) {
      throw new Error(`Run ${runId} legacy event sequence is not contiguous.`);
    }
    previousSourceSeq = event.seq;
    const payload = isRecord(event.payload) ? event.payload : {};
    const projected = projectLegacyRunEvent(event, runId, providerHint);
    providerHint = providerHintFromLegacyPayload(payload, providerHint);
    if (projected.length === 0) {
      if (event.event_type === 'agent_output' && hasAuthoritativeProviderFacts(payload)) {
        throw new Error(
          `Run ${runId} contains authoritative provider facts that cannot be normalized.`,
        );
      }
      continue;
    }
    for (const candidate of projected) {
      const durable = parseDurableRunEvent({
        schema_version: DURABLE_RUN_EVENT_SCHEMA_VERSION,
        seq: nextSeq,
        ts: event.ts,
        app_session_id: event.app_session_id,
        ...candidate,
        run_id: runId,
      });
      compacted.push(JSON.stringify(durable));
      nextSeq += 1;
    }
  }
  const bytesByPath = new Map(source.bytesByPath);
  bytesByPath.set(eventPath, Buffer.from(compacted.length > 0 ? `${compacted.join('\n')}\n` : ''));
  return { paths: source.paths, bytesByPath };
};

/** Owns the single authority pointer for every retained file in a persisted Run family. */
export class RunFamilyStore {
  private readonly preparedFamilies = new Set<string>();
  private readonly manifests = new Map<string, PersistedRunFamilyManifest>();
  private readonly preparation = new Map<string, Promise<boolean>>();

  public constructor(
    private readonly runsDir: string,
    private readonly randomId: () => string = () => crypto.randomUUID(),
    private readonly readerApplicationVersion: string = applicationVersion,
    private readonly report: (diagnostic: CompatibilityDiagnostic) => void = () => undefined,
    private readonly reportProgress: (progress: RunStoreInitializationProgress) => void = () =>
      undefined,
  ) {}

  public manifestPath(runId: string): string {
    return path.join(this.runsDir, `${runId}${RUN_FAMILY_MANIFEST_SUFFIX}`);
  }

  public memberPath(runId: string, member: RunFamilyMember): string {
    const manifest = this.manifests.get(runId);
    if (!manifest) return path.join(this.runsDir, legacyRunFamilyMemberFileName(runId, member));
    return path.join(this.runsDir, manifest.members[member].relativePath);
  }

  public hasPreparedFamily(runId: string): boolean {
    return this.preparedFamilies.has(runId);
  }

  /**
   * Selects a current manifest without reading large Run sidecars. The small
   * diagnostics member is inspected only to preserve its required migration.
   * Legacy and version-skewed families remain unprepared for the compatibility
   * reader.
   */
  public async discoverManifest(runId: string): Promise<boolean> {
    const manifest = await this.readManifest(runId);
    if (!manifest) return false;
    this.manifests.set(runId, manifest);
    return true;
  }

  public async create(
    runId: string,
    initialMembers: ReadonlyMap<RunFamilyMember, Uint8Array> = new Map(),
  ): Promise<void> {
    if (this.manifests.has(runId)) return;
    const manifest = this.createManifest(runId);
    for (const [member, bytes] of initialMembers) {
      await this.writeDurableFile(this.memberPathFromManifest(manifest, member), bytes);
    }
    await this.promoteManifest(runId, manifest);
    this.manifests.set(runId, manifest);
    this.preparation.set(runId, Promise.resolve(false));
    this.preparedFamilies.add(runId);
  }

  public async prepare(
    runId: string,
    validation: RunFamilyValidation,
    promote = true,
  ): Promise<boolean> {
    // Validation-only maintenance reads must not become the durable owner's
    // prepared state. A later direct access still needs to promote a migrated
    // candidate before using the family paths.
    if (!promote) return (await this.prepareOnce(runId, validation, false)).migrated;
    const existing = this.preparation.get(runId);
    if (existing) return existing;
    const preparation = this.prepareOnce(runId, validation, true).then((result) => {
      this.preparedFamilies.add(runId);
      return result.migrated;
    });
    this.preparation.set(runId, preparation);
    return preparation;
  }

  /** Read a complete member through its migrations and codec without changing family authority. */
  public async readMember(
    runId: string,
    member: RunFamilyMember,
    validation: RunFamilyValidation,
  ): Promise<Uint8Array | null> {
    const result = await this.prepareOnce(runId, validation, false, member);
    return result.source?.bytesByPath.values().next().value ?? null;
  }

  private async prepareOnce(
    runId: string,
    validation: RunFamilyValidation,
    promote: boolean,
    selectedMember?: RunFamilyMember,
  ): Promise<{ migrated: boolean; source: DurableDataSource | null }> {
    const members = selectedMember ? [selectedMember] : RUN_FAMILY_MEMBERS;
    let affectedMember = selectedMember;
    const startedAt = Date.now();
    this.reportProgress({
      operation: 'manifest_read',
      status: 'started',
      elapsedMs: 0,
      runId,
    });
    let manifest: PersistedRunFamilyManifest | null;
    const manifestTiming = { fileReadMs: 0, parseMs: 0 };
    try {
      manifest = await this.readManifest(runId, manifestTiming);
    } catch (error) {
      const diagnostic: CompatibilityDiagnostic = {
        familyId: `run:${runId}`,
        sourcePaths: [this.manifestPath(runId)],
        reason: 'production_codec_rejected',
        readerApplicationVersion: this.readerApplicationVersion,
        writerApplicationVersion: null,
        sourceSchemaVersion: 0,
        currentSchemaVersion: RUN_FAMILY_SCHEMA_VERSION,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      this.report(diagnostic);
      throw new RunFamilyCompatibilityError(runId, diagnostic);
    }
    this.reportProgress({
      operation: 'manifest_read',
      status: 'completed',
      elapsedMs: Date.now() - startedAt,
      runId,
      sourceKind: manifest ? 'manifest' : 'legacy',
      fileReadMs: manifestTiming.fileReadMs,
      parseMs: manifestTiming.parseMs,
    });
    const sourceKind = manifest ? 'manifest' : 'legacy';
    this.reportProgress({
      operation: 'source_read',
      status: 'started',
      elapsedMs: Date.now() - startedAt,
      runId,
      sourceKind,
    });
    const source = selectedMember
      ? await this.readPaths([this.sourceMemberPath(runId, manifest, selectedMember)])
      : manifest
        ? await this.readManifestSource(manifest)
        : await this.readLegacySource(runId);
    this.reportProgress({
      operation: 'source_read',
      status: 'completed',
      elapsedMs: Date.now() - startedAt,
      runId,
      sourceKind,
      ...(selectedMember ? { member: selectedMember } : {}),
      readOnly: !promote,
      sourcePathCount: source?.bytesByPath.size ?? 0,
      sourceByteCount: sourceByteCount(source),
    });
    if (selectedMember && !manifest && source?.bytesByPath.size === 0) {
      return { migrated: false, source: null };
    }
    let candidateSource = source;
    const manifestSourceSchemaVersion =
      selectedMember && manifest && manifest.schemaVersion <= RUN_FAMILY_SCHEMA_VERSION
        ? manifest.members[selectedMember].schemaVersion
        : manifest
          ? Math.max(
              manifest.schemaVersion,
              ...members.map((member) => manifest.members[member].schemaVersion),
            )
          : 0;
    if (manifest && manifest.schemaVersion <= RUN_FAMILY_SCHEMA_VERSION) {
      affectedMember =
        members.find(
          (member) => manifest.members[member].schemaVersion > RUN_FAMILY_SCHEMA_VERSION,
        ) ?? affectedMember;
    }
    const sourceSchemaVersion =
      manifestSourceSchemaVersion <= RUN_FAMILY_SCHEMA_VERSION &&
      this.containsLegacyChangedFilesDiff(runId, manifest, source)
        ? 0
        : manifestSourceSchemaVersion;
    const scopedDiagnostic = (
      diagnostic: CompatibilityDiagnostic,
    ): RunFamilyCompatibilityDiagnostic =>
      affectedMember
        ? {
            ...diagnostic,
            member: affectedMember,
            sourcePaths: [this.sourceMemberPath(runId, manifest, affectedMember)],
          }
        : diagnostic;
    const reader = new DurableDataCompatibilityReader(this.readerApplicationVersion, (diagnostic) =>
      this.report(scopedDiagnostic(diagnostic)),
    );
    const opened = await reader.open({
      familyId: `run:${runId}`,
      currentSchemaVersion: RUN_FAMILY_SCHEMA_VERSION,
      readSource: async () => source,
      decodeSource: (candidate) => ({
        source: candidate,
        sourceSchemaVersion,
        writerApplicationVersion: manifest?.writerApplicationVersion ?? null,
        payload: compatibilityDescriptorFromSource(candidate),
      }),
      migrations: new Map([
        [
          0,
          (payload: JsonValue) => {
            affectedMember = selectedMember ?? 'changedFilesDiagnostics';
            candidateSource = this.migrateLegacyRunFamily(runId, manifest, candidateSource);
            return payload;
          },
        ],
        [
          1,
          (payload: JsonValue) => {
            affectedMember = selectedMember ?? 'events';
            candidateSource = this.migrateRunFamilyV1ToV2(runId, manifest, candidateSource);
            return payload;
          },
        ],
      ]),
      validateCurrent: () => {
        this.reportProgress({
          operation: 'production_validation',
          status: 'started',
          elapsedMs: Date.now() - startedAt,
          runId,
          sourceKind,
          sourcePathCount: candidateSource?.bytesByPath.size ?? 0,
          sourceByteCount: sourceByteCount(candidateSource),
        });
        for (const member of members) {
          affectedMember = member;
          const memberPath = manifest
            ? this.memberPathFromManifest(manifest, member)
            : path.join(this.runsDir, legacyRunFamilyMemberFileName(runId, member));
          const bytes = candidateSource?.bytesByPath.get(memberPath);
          if (member === 'metadata' && !bytes) {
            throw new Error('Persisted Run metadata is missing.');
          }
          if (bytes) validation.validate(member, bytes);
        }
        this.reportProgress({
          operation: 'production_validation',
          status: 'completed',
          elapsedMs: Date.now() - startedAt,
          runId,
          sourceKind,
          sourcePathCount: candidateSource?.bytesByPath.size ?? 0,
          sourceByteCount: sourceByteCount(candidateSource),
        });
        return candidateSource;
      },
      promoteAtomically: async ({ value }) => {
        if (!promote) return;
        affectedMember = undefined;
        if (!value) throw new Error('Run family source disappeared during migration.');
        this.reportProgress({
          operation: 'generation_promotion',
          status: 'started',
          elapsedMs: Date.now() - startedAt,
          runId,
          sourceKind,
          sourcePathCount: value.bytesByPath.size,
          sourceByteCount: sourceByteCount(value),
        });
        const nextManifest = this.createManifest(runId);
        const generationDirectory = path.dirname(
          this.memberPathFromManifest(nextManifest, 'metadata'),
        );
        await fs.mkdir(generationDirectory, { recursive: true, mode: 0o700 });
        for (const member of RUN_FAMILY_MEMBERS) {
          const sourcePath = this.sourceMemberPath(runId, manifest, member);
          const bytes = value.bytesByPath.get(sourcePath);
          if (bytes) {
            const targetPath = this.memberPathFromManifest(nextManifest, member);
            this.reportProgress({
              operation: 'generation_member_promotion',
              status: 'started',
              elapsedMs: Date.now() - startedAt,
              runId,
              sourceKind,
              member,
              targetPath,
              sourceByteCount: bytes.byteLength,
            });
            await this.writeDurableFile(targetPath, bytes);
            this.reportProgress({
              operation: 'generation_member_promotion',
              status: 'completed',
              elapsedMs: Date.now() - startedAt,
              runId,
              sourceKind,
              member,
              targetPath,
              sourceByteCount: bytes.byteLength,
            });
          }
        }
        await this.promoteManifest(runId, nextManifest);
        this.manifests.set(runId, nextManifest);
        this.reportProgress({
          operation: 'generation_promotion',
          status: 'completed',
          elapsedMs: Date.now() - startedAt,
          runId,
          sourceKind,
          sourcePathCount: value.bytesByPath.size,
          sourceByteCount: sourceByteCount(value),
        });
      },
    });
    if (opened.status === 'incompatible') {
      throw new RunFamilyCompatibilityError(runId, scopedDiagnostic(opened.diagnostic));
    }
    if (opened.status === 'absent') return { migrated: false, source: null };
    if (!selectedMember && manifest && !opened.migrated) this.manifests.set(runId, manifest);
    return { migrated: opened.migrated, source: opened.value };
  }

  private sourceMemberPath(
    runId: string,
    manifest: PersistedRunFamilyManifest | null,
    member: RunFamilyMember,
  ): string {
    return manifest
      ? this.memberPathFromManifest(manifest, member)
      : path.join(this.runsDir, legacyRunFamilyMemberFileName(runId, member));
  }

  private containsLegacyChangedFilesDiff(
    runId: string,
    manifest: PersistedRunFamilyManifest | null,
    source: DurableDataSource | null,
  ): boolean {
    const bytes = source?.bytesByPath.get(
      this.sourceMemberPath(runId, manifest, 'changedFilesDiagnostics'),
    );
    if (!bytes) return false;
    try {
      return hasLegacyRunChangedFilesDiffDiagnostics(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      return false;
    }
  }

  private migrateLegacyRunFamily(
    runId: string,
    manifest: PersistedRunFamilyManifest | null,
    source: DurableDataSource | null,
  ): DurableDataSource | null {
    if (!source) return null;
    const diagnosticPath = this.sourceMemberPath(runId, manifest, 'changedFilesDiagnostics');
    const diagnosticBytes = source.bytesByPath.get(diagnosticPath);
    if (!diagnosticBytes) return source;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(diagnosticBytes));
    if (!hasLegacyRunChangedFilesDiffDiagnostics(parsed)) return source;
    const migrated = migratePersistedRunChangedFilesDiagnostics(parsed);
    const bytesByPath = new Map(source.bytesByPath);
    bytesByPath.set(diagnosticPath, Buffer.from(JSON.stringify(migrated)));
    return { paths: source.paths, bytesByPath };
  }

  private migrateRunFamilyV1ToV2(
    runId: string,
    manifest: PersistedRunFamilyManifest | null,
    source: DurableDataSource | null,
  ): DurableDataSource | null {
    if (!source) return null;
    const eventPath = this.sourceMemberPath(runId, manifest, 'events');
    const eventMigratedSource = compactRunEventMember(runId, eventPath, source);
    const metadataPath = this.sourceMemberPath(runId, manifest, 'metadata');
    const metadataBytes = eventMigratedSource.bytesByPath.get(metadataPath);
    if (!metadataBytes) return eventMigratedSource;
    const legacyPlanMetadata = legacyPlanRunMetadataSchema.safeParse(
      JSON.parse(new TextDecoder().decode(metadataBytes)),
    );
    if (!legacyPlanMetadata.success) return eventMigratedSource;
    const entity = {
      entityType: 'TASK',
      entityId: legacyPlanMetadata.data.entity.entityId,
    } satisfies RunEntityReference;
    const bytesByPath = new Map(eventMigratedSource.bytesByPath);
    bytesByPath.set(
      metadataPath,
      Buffer.from(JSON.stringify({ ...legacyPlanMetadata.data, entity })),
    );
    return { paths: eventMigratedSource.paths, bytesByPath };
  }

  private createManifest(runId: string): PersistedRunFamilyManifest {
    const generationId = this.randomId();
    const members = Object.fromEntries(
      RUN_FAMILY_MEMBERS.map((member) => [
        member,
        {
          schemaVersion: RUN_FAMILY_SCHEMA_VERSION,
          writerApplicationVersion: this.readerApplicationVersion,
          relativePath: path.join('.run-families', runId, generationId, `${member}.data`),
        },
      ]),
    );
    return manifestSchema.parse({
      schemaVersion: RUN_FAMILY_SCHEMA_VERSION,
      writerApplicationVersion: this.readerApplicationVersion,
      generationId,
      members,
    });
  }

  private memberPathFromManifest(
    manifest: PersistedRunFamilyManifest,
    member: RunFamilyMember,
  ): string {
    return path.join(this.runsDir, manifest.members[member].relativePath);
  }

  /** `timing` separates the file await from JSON and schema validation. */
  private async readManifest(
    runId: string,
    timing = { fileReadMs: 0, parseMs: 0 },
  ): Promise<PersistedRunFamilyManifest | null> {
    try {
      const readStarted = performance.now();
      let text: string;
      try {
        text = await fs.readFile(this.manifestPath(runId), 'utf8');
      } finally {
        timing.fileReadMs = performance.now() - readStarted;
      }
      const parseStarted = performance.now();
      try {
        return parsePersistedRunFamilyManifest(runId, text);
      } finally {
        timing.parseMs = performance.now() - parseStarted;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readManifestSource(
    manifest: PersistedRunFamilyManifest,
  ): Promise<DurableDataSource> {
    const paths = RUN_FAMILY_MEMBERS.map((member) => this.memberPathFromManifest(manifest, member));
    return this.readPaths(paths);
  }

  private async readLegacySource(runId: string): Promise<DurableDataSource | null> {
    const paths = RUN_FAMILY_MEMBERS.map((member) =>
      path.join(this.runsDir, legacyRunFamilyMemberFileName(runId, member)),
    );
    const source = await this.readPaths(paths);
    return source.bytesByPath.size === 0 ? null : source;
  }

  private async readPaths(paths: readonly string[]): Promise<DurableDataSource> {
    const bytesByPath = new Map<string, Uint8Array>();
    await Promise.all(
      paths.map(async (sourcePath) => {
        try {
          bytesByPath.set(sourcePath, await fs.readFile(sourcePath));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }),
    );
    return { paths: [...bytesByPath.keys()], bytesByPath };
  }

  private async promoteManifest(
    runId: string,
    manifest: PersistedRunFamilyManifest,
  ): Promise<void> {
    await this.writeDurableFile(
      this.manifestPath(runId),
      Buffer.from(JSON.stringify(manifest, null, 2)),
    );
  }

  private async writeDurableFile(targetPath: string, bytes: Uint8Array): Promise<void> {
    const directoryPath = path.dirname(targetPath);
    await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
    const temporaryPath = `${targetPath}.${this.randomId()}.tmp`;
    const handle = await fs.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, targetPath);
    if (process.platform !== 'win32') {
      const directory = await fs.open(directoryPath, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
}
