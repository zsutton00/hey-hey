import { validateProjectModeConfig } from '../agents/project-mode';
import type { AgentProviderId } from '../agents/providers/provider-config';
import type { AgenticSessionEvent } from '../session';
import type { AgentSessionConfig } from '../shared/agent-bridge-contract/generated/api';
import {
  parseProjectModeLaunchResumeProbeArgs,
  type ProjectModeLaunchResumeProbeArgs,
} from './probe-project-mode-launch-resume-args';

export interface CapturedProjectModeSession {
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly config: AgentSessionConfig;
}

export interface CanonicalModeEdit {
  readonly restoreToken: string;
  readonly editedSentinel: string;
}

export interface ProjectModeLaunchResumeProbeDependencies {
  captureSession(args: ProjectModeLaunchResumeProbeArgs): Promise<CapturedProjectModeSession>;
  startRun(
    args: ProjectModeLaunchResumeProbeArgs,
    session: CapturedProjectModeSession,
  ): Promise<string>;
  readDurableEvents(runId: string): Promise<readonly AgenticSessionEvent[]>;
  editCanonicalMode(args: ProjectModeLaunchResumeProbeArgs): Promise<CanonicalModeEdit>;
  resumeRun(args: ProjectModeLaunchResumeProbeArgs, runId: string): Promise<void>;
  restoreCanonicalMode(
    args: ProjectModeLaunchResumeProbeArgs,
    restoreToken: string | null,
  ): Promise<void>;
  dispose(): Promise<void>;
}

interface TurnEvidence {
  readonly providerSessionId: string;
  readonly logicalHandlerId: string;
  readonly snapshotDigest: string;
  readonly materializedBundleLocation: string;
  readonly startupInstructionsPresent: boolean;
  readonly checklistRead: boolean;
  readonly completed: boolean;
  readonly editedSentinelAbsent: boolean;
}

export interface ProjectModeLaunchResumeSummary {
  readonly provider: AgentProviderId;
  readonly runId: string | null;
  readonly selectedModeId: string;
  readonly snapshotDigest: string | null;
  readonly materializedBundleLocation: string | null;
  readonly firstTurn: Pick<
    TurnEvidence,
    'startupInstructionsPresent' | 'checklistRead' | 'completed'
  >;
  readonly resumedTurn: Pick<
    TurnEvidence,
    'startupInstructionsPresent' | 'checklistRead' | 'completed' | 'editedSentinelAbsent'
  >;
  readonly continuity: {
    readonly run: boolean;
    readonly providerSession: boolean;
    readonly logicalHandler: boolean;
    readonly snapshot: boolean;
    readonly materializedBundle: boolean;
  };
  readonly restoration: 'not-required' | 'succeeded' | 'failed';
}

export interface ProjectModeLaunchResumeOutcome {
  readonly exitCode: 0 | 1;
  readonly summary: ProjectModeLaunchResumeSummary;
  readonly error: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const payload = (event: AgenticSessionEvent): Record<string, unknown> | null =>
  isRecord(event.payload) ? event.payload : null;

const stringField = (value: Record<string, unknown>, key: string): string => {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`Durable project MODE evidence is missing ${key}.`);
  }
  return field;
};

const readTurnEvidence = (
  events: readonly AgenticSessionEvent[],
  turnIndex: number,
  provider: AgentProviderId,
  modeEntry: string,
  snapshotDigest: string,
  editedSentinel: string | null,
): TurnEvidence => {
  const starts = events.filter((event) => event.event_type === 'run_started');
  const startup = starts[turnIndex];
  const nextStartup = starts[turnIndex + 1];
  const matching = startup
    ? events.filter(
        (event) => event.seq >= startup.seq && (!nextStartup || event.seq < nextStartup.seq),
      )
    : [];
  const startupPayload = startup ? payload(startup) : null;
  if (
    !startupPayload ||
    startupPayload['kind'] !== 'run_started' ||
    startupPayload['provider'] !== provider
  ) {
    throw new Error(`Turn ${String(turnIndex)} is missing startup evidence for ${provider}.`);
  }
  const startupInput = stringField(startupPayload, 'prompt');
  const bundleMatch = startupInput.match(/^Bundle location: (.+)$/mu);
  const bundle = bundleMatch?.[1]?.trim();
  if (!bundle) throw new Error(`Turn ${String(turnIndex)} is missing its bundle location.`);
  const checklistPath = `${bundle.replace(/\/$/u, '')}/references/checklist.md`;
  const checklistRead = matching.some((event) => {
    const value = payload(event);
    if (value?.['kind'] !== 'tool_use' || !Array.isArray(value['blocks'])) return false;
    return value['blocks'].some((candidate) => {
      if (!isRecord(candidate) || typeof candidate['toolName'] !== 'string') return false;
      const serializedInput = JSON.stringify(candidate['input'] ?? null);
      const readsFile = /^(read|read_file|readfile|filesystem\/read_file)$/iu.test(
        candidate['toolName'],
      );
      const readsThroughShell =
        /^(shell|bash|exec|exec_command)$/iu.test(candidate['toolName']) &&
        /\b(?:cat|sed|head|tail|less|more|rg)\s/iu.test(serializedInput);
      return serializedInput.includes(checklistPath) && (readsFile || readsThroughShell);
    });
  });
  const completed = matching.some((event) => {
    const value = payload(event);
    return value?.['kind'] === 'run_completed' && value['outcome'] === 'succeeded';
  });
  return {
    providerSessionId: stringField(startupPayload, 'providerSessionId'),
    logicalHandlerId: stringField(startupPayload, 'providerSessionAgentId'),
    snapshotDigest,
    materializedBundleLocation: bundle,
    startupInstructionsPresent: startupInput.includes(modeEntry),
    checklistRead,
    completed,
    editedSentinelAbsent: editedSentinel === null || !startupInput.includes(editedSentinel),
  };
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const emptySummary = (args: ProjectModeLaunchResumeProbeArgs): ProjectModeLaunchResumeSummary => ({
  provider: args.provider,
  runId: null,
  selectedModeId: args.modeId,
  snapshotDigest: null,
  materializedBundleLocation: null,
  firstTurn: { startupInstructionsPresent: false, checklistRead: false, completed: false },
  resumedTurn: {
    startupInstructionsPresent: false,
    checklistRead: false,
    completed: false,
    editedSentinelAbsent: false,
  },
  continuity: {
    run: false,
    providerSession: false,
    logicalHandler: false,
    snapshot: false,
    materializedBundle: false,
  },
  restoration: 'not-required',
});

const evidenceError = (summary: ProjectModeLaunchResumeSummary): string | null => {
  const checks = {
    firstStartup: summary.firstTurn.startupInstructionsPresent,
    firstChecklistRead: summary.firstTurn.checklistRead,
    firstCompletion: summary.firstTurn.completed,
    resumedStartup: summary.resumedTurn.startupInstructionsPresent,
    resumedChecklistRead: summary.resumedTurn.checklistRead,
    resumedCompletion: summary.resumedTurn.completed,
    editedContentExcluded: summary.resumedTurn.editedSentinelAbsent,
    sameRun: summary.continuity.run,
    sameProviderSession: summary.continuity.providerSession,
    sameLogicalHandler: summary.continuity.logicalHandler,
    sameSnapshot: summary.continuity.snapshot,
    sameMaterializedBundle: summary.continuity.materializedBundle,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return failed.length === 0 ? null : `Project MODE evidence failed: ${failed.join(', ')}.`;
};

export const runProjectModeLaunchResumeProbe = async (
  args: ProjectModeLaunchResumeProbeArgs,
  dependencies: ProjectModeLaunchResumeProbeDependencies,
): Promise<ProjectModeLaunchResumeOutcome> => {
  let summary = emptySummary(args);
  let error: string | null = null;
  let restoreToken: string | null = null;
  let canonicalEditAttempted = false;
  try {
    const captured = await withTimeout(
      dependencies.captureSession(args),
      args.timeoutMs,
      'Capture',
    );
    const validated = validateProjectModeConfig(captured.config);
    if (!validated.ok || validated.value.selection.modeId !== args.modeId) {
      throw new Error('The API did not return the requested captured project MODE configuration.');
    }
    const modeEntry = validated.value.snapshot.files.files['MODE.md'];
    const runId = await withTimeout(
      dependencies.startRun(args, captured),
      args.timeoutMs,
      'Launch',
    );
    const firstEvents = await dependencies.readDurableEvents(runId);
    const first = readTurnEvidence(
      firstEvents,
      0,
      args.provider,
      modeEntry,
      validated.value.snapshot.snapshotHash,
      null,
    );

    canonicalEditAttempted = true;
    const edit = await withTimeout(
      dependencies.editCanonicalMode(args),
      args.timeoutMs,
      'Canonical MODE edit',
    );
    restoreToken = edit.restoreToken;
    await withTimeout(dependencies.resumeRun(args, runId), args.timeoutMs, 'Resume');
    const resumedEvents = await dependencies.readDurableEvents(runId);
    const resumed = readTurnEvidence(
      resumedEvents,
      1,
      args.provider,
      modeEntry,
      validated.value.snapshot.snapshotHash,
      edit.editedSentinel,
    );
    summary = {
      provider: args.provider,
      runId,
      selectedModeId: args.modeId,
      snapshotDigest: first.snapshotDigest,
      materializedBundleLocation: first.materializedBundleLocation,
      firstTurn: {
        startupInstructionsPresent: first.startupInstructionsPresent,
        checklistRead: first.checklistRead,
        completed: first.completed,
      },
      resumedTurn: {
        startupInstructionsPresent: resumed.startupInstructionsPresent,
        checklistRead: resumed.checklistRead,
        completed: resumed.completed,
        editedSentinelAbsent: resumed.editedSentinelAbsent,
      },
      continuity: {
        run: resumedEvents.every((event) => event.run_id === runId),
        providerSession: first.providerSessionId === resumed.providerSessionId,
        logicalHandler: first.logicalHandlerId === resumed.logicalHandlerId,
        snapshot: first.snapshotDigest === resumed.snapshotDigest,
        materializedBundle: first.materializedBundleLocation === resumed.materializedBundleLocation,
      },
      restoration: 'not-required',
    };
    error = evidenceError(summary);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (canonicalEditAttempted) {
      try {
        await withTimeout(
          dependencies.restoreCanonicalMode(args, restoreToken),
          args.timeoutMs,
          'Canonical MODE restoration',
        );
        summary = { ...summary, restoration: 'succeeded' };
      } catch (caught) {
        summary = { ...summary, restoration: 'failed' };
        const restoreError = caught instanceof Error ? caught.message : String(caught);
        error = error
          ? `${error} Restoration failed: ${restoreError}`
          : `Restoration failed: ${restoreError}`;
      }
    }
    try {
      await dependencies.dispose();
    } catch (caught) {
      const disposalError = caught instanceof Error ? caught.message : String(caught);
      error = error
        ? `${error} Disposal failed: ${disposalError}`
        : `Disposal failed: ${disposalError}`;
    }
  }
  return { exitCode: error ? 1 : 0, summary, error };
};

export const serializeProjectModeLaunchResumeOutcome = (
  outcome: ProjectModeLaunchResumeOutcome,
  maxOutputBytes: number,
): string => {
  const serialized = JSON.stringify(outcome.summary);
  if (Buffer.byteLength(serialized, 'utf8') > maxOutputBytes) {
    throw new Error('Project MODE evidence exceeds --max-output-bytes.');
  }
  return serialized;
};

const runCommandLine = async (): Promise<void> => {
  const args = parseProjectModeLaunchResumeProbeArgs(process.argv.slice(2));
  const { createProjectModeLaunchResumeProbeDependencies } =
    await import('./probe-project-mode-runtime');
  const dependencies = await createProjectModeLaunchResumeProbeDependencies(args);
  const outcome = await runProjectModeLaunchResumeProbe(args, dependencies);
  process.stdout.write(
    `${serializeProjectModeLaunchResumeOutcome(outcome, args.maxOutputBytes)}\n`,
  );
  if (outcome.error) process.stderr.write(`${outcome.error}\n`);
  process.exitCode = outcome.exitCode;
};

if (require.main === module) {
  void runCommandLine().catch((caught: Error) => {
    process.stderr.write(`${caught.message}\n`);
    process.exitCode = 1;
  });
}
