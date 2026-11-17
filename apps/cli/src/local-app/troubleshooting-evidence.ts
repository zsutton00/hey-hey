import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StartupDiagnostics } from './startup-diagnostics';
import { safeStartupCause } from './startup-diagnostic-boundary';

/** Journals are bounded to 1 MiB by retention; reading twice that never needs unbounded memory. */
const MAX_READ_BYTES = 2 * 1024 * 1024;
const JOURNAL_PATTERN = /^startup-\d{13}-[a-f0-9-]{36}\.jsonl$/u;

export interface JournalCause {
  code: string;
  status?: number | undefined;
  exitCode?: number | null | undefined;
  signal?: string | null | undefined;
  cause?: JournalCause | undefined;
  docker?:
    | {
        operation: string;
        service?: string | undefined;
        outcome: string;
        code: string;
        exitCode?: number | null | undefined;
        detail: string;
        truncated?: boolean | undefined;
      }
    | undefined;
}

const causeSchema: z.ZodType<JournalCause> = z.lazy(() =>
  z.object({
    code: z.string(),
    status: z.number().optional(),
    exitCode: z.number().nullable().optional(),
    signal: z.string().nullable().optional(),
    cause: causeSchema.optional(),
    docker: z
      .object({
        operation: z.string(),
        service: z.string().optional(),
        outcome: z.string(),
        code: z.string(),
        exitCode: z.number().nullable().optional(),
        detail: z.string(),
        truncated: z.boolean().optional(),
      })
      .optional(),
  }),
);

const journalRecord = z
  .object({
    event: z.string(),
    level: z.string().optional(),
    sessionId: z.string().optional(),
    attemptId: z.string().optional(),
  })
  .passthrough();
type JournalRecord = z.infer<typeof journalRecord>;

const startedFields = z.object({
  cliVersion: z.string().optional(),
  nodeVersion: z.string().optional(),
  platform: z.string().optional(),
  architecture: z.string().optional(),
  osRelease: z.string().optional(),
  lastFailedAttemptId: z.string().nullable().optional(),
  lastFailedSessionId: z.string().nullable().optional(),
});
const stateFields = z.object({ action: z.string().optional() });
const failureFields = z.object({ action: z.string().optional() });
const prerequisiteFields = z.object({ reasonCode: z.string() });
const readinessFields = z.object({
  observations: z.array(
    z.object({
      service: z.string(),
      present: z.boolean(),
      running: z.boolean(),
      status: z.string(),
      health: z.string(),
    }),
  ),
});
const containerFields = z.object({
  kind: z.string(),
  service: z.string().optional(),
  containerIndex: z.number().optional(),
  reasonCode: z.string().optional(),
  error: causeSchema.optional(),
  evidenceIncomplete: z.boolean().optional(),
  scannedLines: z.number().optional(),
  potentiallyTruncated: z.boolean().optional(),
  unstructuredLines: z.number().optional(),
  unstructuredCauseCodes: z.record(z.string(), z.number()).optional(),
  eventGroups: z
    .array(
      z.object({
        level: z.string(),
        event: z.string().optional(),
        cause: causeSchema.optional(),
        count: z.number(),
      }),
    )
    .optional(),
  omittedEventGroups: z.number().optional(),
  containerCount: z.number().optional(),
  omittedContainers: z.number().optional(),
});

export type ContainerEvidence = z.infer<typeof containerFields>;

export interface RecordedCause {
  event: string;
  cause: JournalCause;
  count: number;
}

export interface RepairStep {
  attempt: number;
  outcome: 'offered' | 'accepted' | 'declined' | 'applied' | 'failed';
}

export interface TroubleshootingEvidence {
  attemptId: string;
  sessionId: string;
  directory: string;
  /** Absolute path of the journal this evidence came from; null when no saved file was readable. */
  journalPath: string | null;
  versions: z.infer<typeof startedFields>;
  lastStage: string | null;
  causes: RecordedCause[];
  prerequisite: string | null;
  readiness: z.infer<typeof readinessFields>['observations'] | null;
  /** Docker share repair steps across this attempt and the retries before it, in order. */
  repairs: RepairStep[];
  /** Earlier attempts in the same journal that failed, with the causes recorded for each. */
  earlierFailures: Array<{ attempt: number; causes: RecordedCause[] }>;
  /** This attempt's position in its journal, counting from 1. */
  attemptNumber: number;
  /** Attempts earlier in the same journal, which are retries of this one. */
  earlierAttempts: number;
  lastFailedAttempt: { attemptId: string; sessionId: string } | null;
  laterSuccessAttemptId: string | null;
  container: ContainerEvidence[];
  containerCollected: boolean;
  /** Everything the reader or the journal could not provide. Disclosed verbatim in the prompt. */
  gaps: string[];
}

export interface JournalStatus {
  storageFailure: unknown;
  truncated: boolean;
}

interface ParsedJournal {
  records: JournalRecord[];
  gaps: string[];
}

function errorCode(error: unknown): string {
  return safeStartupCause(error).code;
}

async function readJournal(path: string): Promise<ParsedJournal> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const gaps: string[] = [];
  let text: string;
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, MAX_READ_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    text = buffer.subarray(0, bytesRead).toString('utf8');
    if (size > MAX_READ_BYTES) {
      gaps.push(
        `The journal is larger than ${String(MAX_READ_BYTES)} bytes; only the start was read.`,
      );
    }
  } finally {
    await handle.close();
  }
  const parsed = parseJournalText(text);
  return { records: parsed.records, gaps: [...gaps, ...parsed.gaps] };
}

function parseJournalText(text: string, source = 'journal'): ParsedJournal {
  const records: JournalRecord[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = journalRecord.safeParse(JSON.parse(line));
      if (parsed.success) {
        records.push(parsed.data);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return {
    records,
    gaps:
      skipped > 0
        ? [
            `${String(skipped)} line(s) in the ${source} were partial or malformed and were skipped; readable attempts are still listed.`,
          ]
        : [],
  };
}

interface AttemptSummary {
  attemptId: string;
  sessionId: string;
  failed: boolean;
  succeeded: boolean;
}

function summarizeAttempts(records: JournalRecord[]): AttemptSummary[] {
  const attempts = new Map<string, AttemptSummary>();
  for (const record of records) {
    if (!record.attemptId) {
      continue;
    }
    const attempt = attempts.get(record.attemptId) ?? {
      attemptId: record.attemptId,
      sessionId: record.sessionId ?? '',
      failed: false,
      succeeded: false,
    };
    attempts.set(record.attemptId, attempt);
    if (record.event === 'attempt.failure' || record.event === 'attempt.interrupted') {
      attempt.failed = true;
    }
    if (record.event === 'attempt.finished') {
      const outcome = (record as { outcome?: unknown }).outcome;
      attempt.failed ||= outcome === 'failed' || outcome === 'cancelled';
      attempt.succeeded = outcome === 'success' && !attempt.failed;
    }
  }
  return [...attempts.values()];
}

function causesOf(attempt: JournalRecord[]): RecordedCause[] {
  const grouped = new Map<string, RecordedCause>();
  for (const record of attempt) {
    const parsed = causeSchema.safeParse((record as { error?: unknown }).error);
    if (!parsed.success || record.event === 'container.evidence') {
      continue;
    }
    const key = JSON.stringify([record.event, parsed.data]);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { event: record.event, cause: parsed.data, count: 1 });
    }
  }
  return [...grouped.values()];
}

function lastWith<T>(records: JournalRecord[], event: string, schema: z.ZodType<T>): T | undefined {
  for (const record of [...records].reverse()) {
    if (record.event === event) {
      const parsed = schema.safeParse(record);
      if (parsed.success) {
        return parsed.data;
      }
    }
  }
  return undefined;
}

function repairSteps(records: JournalRecord[], attempts: string[]): RepairStep[] {
  const steps: RepairStep[] = [];
  for (const record of records) {
    const attempt = attempts.indexOf(record.attemptId ?? '') + 1;
    if (attempt === 0) {
      continue;
    }
    const decision = (record as { decision?: unknown }).decision;
    if (
      record.event === 'local.application.state' &&
      (record as { state?: unknown }).state === 'docker-repair'
    ) {
      steps.push({ attempt, outcome: 'offered' });
    } else if (record.event === 'local.docker.repair_failed') {
      steps.push({ attempt, outcome: 'failed' });
    } else if (
      record.event === 'local.docker.repair_decision' &&
      (decision === 'accepted' || decision === 'declined' || decision === 'applied')
    ) {
      steps.push({ attempt, outcome: decision });
    }
  }
  return steps;
}

function evidenceFor(
  parsed: ParsedJournal,
  target: { attemptId: string; sessionId: string },
  location: { directory: string; journalPath: string | null },
): TroubleshootingEvidence {
  const { records } = parsed;
  const attempt = records.filter((record) => record.attemptId === target.attemptId);
  const attemptOrder = summarizeAttempts(records);
  const index = attemptOrder.findIndex((item) => item.attemptId === target.attemptId);
  const startedRecords = records.filter((record) => record.event === 'attempt.started');
  const started = startedRecords.find((record) => record.attemptId === target.attemptId);
  const first = startedFields.safeParse(startedRecords[0] ?? {});
  const own = startedFields.safeParse(started ?? {});
  const gaps = [...parsed.gaps];
  if (!first.success || !first.data.cliVersion) {
    gaps.push('The journal has no attempt.started record with version details.');
  }
  if (records.some((record) => record.event === 'evidence.truncated')) {
    gaps.push(
      'The journal hit its size limit; later events of this attempt were not saved (evidence.truncated).',
    );
  }
  const finished = attempt.find((record) => record.event === 'attempt.finished') as
    | { evidenceComplete?: unknown }
    | undefined;
  if (finished?.evidenceComplete === false) {
    gaps.push('The journal marked its evidence incomplete (evidenceComplete: false).');
  }
  if (attempt.some((record) => record.event === 'attempt.interrupted')) {
    gaps.push(
      'The process exited before this attempt completed (attempt.interrupted); evidence may stop early.',
    );
  }

  const containerRecords = attempt
    .filter((record) => record.event === 'container.evidence')
    .flatMap((record) => {
      const result = containerFields.safeParse(record);
      return result.success ? [result.data] : [];
    });
  const failureStage = lastWith(attempt, 'local.application.failure', failureFields)?.action;
  const stage =
    failureStage ??
    [...attempt]
      .reverse()
      .map((record) => stateFields.safeParse(record))
      .find((result) => result.success && result.data.action)?.data?.action ??
    null;
  const inScope = attemptOrder.slice(0, index + 1).map((item) => item.attemptId);
  for (const item of containerRecords) {
    if (item.potentiallyTruncated) {
      gaps.push(
        `Container logs for ${item.service ?? 'a service'} were read only as a bounded tail; earlier lines were not read.`,
      );
    }
    if (item.evidenceIncomplete) {
      gaps.push(`Container evidence for ${item.service ?? 'a service'} is incomplete.`);
    }
  }
  const laterSuccess = attemptOrder.slice(index + 1).find((item) => item.succeeded);

  return {
    attemptId: target.attemptId,
    sessionId: target.sessionId,
    directory: location.directory,
    journalPath: location.journalPath,
    versions: first.success ? first.data : {},
    lastStage: stage,
    causes: causesOf(attempt),
    prerequisite:
      lastWith(attempt, 'local.docker.prerequisite', prerequisiteFields)?.reasonCode ?? null,
    readiness:
      lastWith(attempt, 'local.docker.readiness.waiting', readinessFields)?.observations ?? null,
    repairs: repairSteps(records, inScope),
    earlierFailures: attemptOrder.slice(0, Math.max(0, index)).flatMap((earlier, position) =>
      earlier.failed
        ? [
            {
              attempt: position + 1,
              causes: causesOf(records.filter((record) => record.attemptId === earlier.attemptId)),
            },
          ]
        : [],
    ),
    attemptNumber: index + 1,
    earlierAttempts: Math.max(0, index),
    lastFailedAttempt:
      own.data?.lastFailedAttemptId && own.data.lastFailedSessionId
        ? { attemptId: own.data.lastFailedAttemptId, sessionId: own.data.lastFailedSessionId }
        : null,
    laterSuccessAttemptId: laterSuccess?.attemptId ?? null,
    container: containerRecords,
    containerCollected: containerRecords.length > 0,
    gaps,
  };
}

/** What a prompt can still say when no journal evidence could be read at all. */
export function evidenceUnavailable(
  target: { attemptId: string; sessionId: string },
  directory: string,
  reason: string,
): TroubleshootingEvidence {
  return evidenceFor({ records: [], gaps: [reason] }, target, { directory, journalPath: null });
}

function memoryJournal(diagnostics: StartupDiagnostics): ParsedJournal {
  const logs = diagnostics.feed
    .snapshot()
    .records.flatMap((item) => (item.kind === 'log' ? [item.text] : []));
  return parseJournalText(logs.join('\n'), 'in-memory records');
}

/** Evidence for the attempt this process is running now, read from its own saved journal. */
export async function readCurrentAttemptEvidence(
  diagnostics: StartupDiagnostics,
): Promise<TroubleshootingEvidence> {
  await diagnostics.settled();
  const status = diagnostics.status();
  const target = { attemptId: diagnostics.attemptId, sessionId: diagnostics.sessionId };
  let parsed: ParsedJournal | undefined;
  let journalPath: string | null = diagnostics.path;
  const gaps: string[] = [];
  try {
    parsed = await readJournal(diagnostics.path);
  } catch (error) {
    gaps.push(
      `The saved journal ${diagnostics.path} could not be read (${errorCode(error)}); this prompt uses in-memory records of this run, which are not saved on disk.`,
    );
    journalPath = null;
  }
  if (status.storageFailure !== undefined) {
    gaps.push(
      `Diagnostic storage failed (${errorCode(status.storageFailure)}); the journal is missing or incomplete.`,
    );
  }
  if (status.truncated && !parsed) {
    gaps.push('The journal hit its size limit and later events were not saved.');
  }
  const source = parsed ?? memoryJournal(diagnostics);
  const evidence = evidenceFor(source, target, { directory: diagnostics.directory, journalPath });
  return { ...evidence, gaps: [...gaps, ...evidence.gaps] };
}

/** The newest attempt on disk that did not succeed, for use after the terminal has closed. */
export async function readNewestFailureEvidence(
  directory: string,
): Promise<TroubleshootingEvidence | { missing: string }> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => JOURNAL_PATTERN.test(name)).sort();
  } catch (error) {
    return {
      missing: `The diagnostics directory ${directory} could not be read (${errorCode(error)}).`,
    };
  }
  const unreadable: string[] = [];
  for (const name of [...names].reverse()) {
    const path = join(directory, name);
    try {
      const parsed = await readJournal(path);
      const failed = [...summarizeAttempts(parsed.records)].reverse().find((item) => item.failed);
      if (failed) {
        const evidence = evidenceFor(parsed, failed, { directory, journalPath: path });
        return { ...evidence, gaps: [...unreadable, ...evidence.gaps] };
      }
    } catch (error) {
      unreadable.push(`Journal ${path} could not be read (${errorCode(error)}).`);
    }
  }
  return {
    missing: [
      names.length === 0
        ? `No startup journals exist in ${directory}.`
        : `No failed attempt was found in ${String(names.length)} journal(s) in ${directory}.`,
      ...unreadable,
    ].join(' '),
  };
}
