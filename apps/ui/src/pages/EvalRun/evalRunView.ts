import {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  EvalAttemptStatus,
  EvalAttemptStopReason,
  type EvalConfiguration,
  type EvalModelSetting,
  type EvalRunSettings,
  type LaunchEvalRunRequestSettings,
} from "@hey-hey/ui-common/api";
import type { EvalAttemptReport } from "@hey-hey/ui-common/data";

/** The judge a new run starts with; the person starting the run can change it. */
export const DEFAULT_JUDGE_SETUP = {
  provider: ConversationStartRunRequestDtoProviderEnum.Claude,
  model: "claude-sonnet-5-5",
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum.Medium,
} satisfies EvalModelSetting;

export const DEFAULT_CONCURRENCY = 3;

/** One step of a per-attempt limit: none, a preset, or a custom value. */
export type LimitChoice =
  | { kind: "none" }
  | { kind: "preset"; value: number }
  | { kind: "custom"; value: number | null };

export const TIME_LIMIT_PRESETS_MINUTES = [15, 30] as const;
export const TOKEN_LIMIT_PRESETS = [200_000] as const;

export interface RunSettingsDraft {
  concurrency: number | null;
  /** Minutes. */
  timeLimit: LimitChoice;
  tokenLimit: LimitChoice;
  /** Whether Project Assistant prepares entity conversation cases, as in real use. */
  projectAssistantEnabled: boolean;
}

export const defaultRunSettings = (): RunSettingsDraft => ({
  concurrency: DEFAULT_CONCURRENCY,
  timeLimit: { kind: "none" },
  tokenLimit: { kind: "none" },
  projectAssistantEnabled: true,
});

const limitValue = (choice: LimitChoice): number | null | undefined =>
  choice.kind === "none" ? undefined : choice.value;

const isPositiveInteger = (value: number | null | undefined): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

/**
 * The settings launch records, or null while the draft is incomplete. An
 * unset limit is left out, which the API reads as no limit.
 */
export const toLaunchSettings = (
  draft: RunSettingsDraft,
): LaunchEvalRunRequestSettings | null => {
  if (!isPositiveInteger(draft.concurrency)) return null;
  const minutes = limitValue(draft.timeLimit);
  const tokens = limitValue(draft.tokenLimit);
  if (minutes !== undefined && !isPositiveInteger(minutes)) return null;
  if (tokens !== undefined && !isPositiveInteger(tokens)) return null;
  return {
    maxConcurrentAttempts: draft.concurrency as number,
    ...(minutes !== undefined
      ? { attemptTimeLimitSeconds: (minutes as number) * 60 }
      : {}),
    ...(tokens !== undefined ? { attemptTokenLimit: tokens as number } : {}),
  };
};

export const setupKey = (setting: EvalModelSetting): string =>
  [setting.provider, setting.model, setting.reasoningEffort ?? ""].join(":");

export const setupLabel = (setting: EvalModelSetting): string =>
  setting.reasoningEffort
    ? `${setting.model} · ${setting.reasoningEffort}`
    : setting.model;

/**
 * Turning Project Assistant off is recorded on the target; leaving it on is
 * left out, which keeps the handler's real-use behavior.
 */
export const toConfiguration = (
  setting: EvalModelSetting,
  projectAssistantEnabled: boolean,
): EvalConfiguration => ({
  id: crypto.randomUUID(),
  target: projectAssistantEnabled
    ? setting
    : { ...setting, handlerConfig: { projectAssistant: { enabled: false } } },
});

/** Every configuration of a run shares the setting, so one turned off means the run's is off. */
export const isProjectAssistantEnabled = (
  configurations: readonly EvalConfiguration[],
): boolean =>
  configurations.every(
    (configuration) =>
      configuration.target.handlerConfig?.projectAssistant?.enabled !== false,
  );

export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
};

/** "15 min", "1h 30m": the time limit as people set it. */
export const formatTimeLimit = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
};

export const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  }
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}k`;
  return String(tokens);
};

/** A STOPPED attempt's reason, with the limit value it reached when known. */
export interface StopView {
  reason: EvalAttemptStopReason;
  limit: string | null;
}

export const stopView = (
  attempt: EvalAttemptReport,
  settings: EvalRunSettings,
): StopView => {
  const reason = attempt.payload.stopReason ?? EvalAttemptStopReason.User;
  if (
    reason === EvalAttemptStopReason.TimeLimit &&
    settings.attemptTimeLimitSeconds !== undefined
  ) {
    return { reason, limit: formatTimeLimit(settings.attemptTimeLimitSeconds) };
  }
  if (
    reason === EvalAttemptStopReason.TokenLimit &&
    settings.attemptTokenLimit !== undefined
  ) {
    return { reason, limit: formatTokenCount(settings.attemptTokenLimit) };
  }
  return { reason, limit: null };
};

const parseTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

/** Null when the attempt never recorded both ends; shown as unavailable. */
export const elapsedMs = (
  attempt: EvalAttemptReport,
  now: number,
): number | null => {
  const started = parseTime(attempt.payload.startedAt);
  if (started === null) return null;
  const ended = parseTime(attempt.payload.completedAt);
  if (ended !== null) return ended - started;
  return isAttemptEnded(attempt) ? null : now - started;
};

export const attemptErrorMessage = (
  attempt: EvalAttemptReport,
): string | null => {
  const error: unknown = attempt.payload.error;
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }
  const { message } = error;
  return typeof message === "string" && message.length > 0 ? message : null;
};

export const isAttemptEnded = (attempt: EvalAttemptReport): boolean =>
  attempt.payload.status === EvalAttemptStatus.Completed ||
  attempt.payload.status === EvalAttemptStatus.Error ||
  attempt.payload.status === EvalAttemptStatus.Stopped;

export type AttemptCellView =
  | { kind: "queued" }
  | {
      kind: "running";
      elapsedMs: number | null;
      phase: "preparing" | "judging" | null;
    }
  | { kind: "finished"; elapsedMs: number | null }
  | { kind: "stopped"; stop: StopView }
  | { kind: "error"; message: string | null; sessionId: string | null };

export const attemptCellView = (
  attempt: EvalAttemptReport,
  settings: EvalRunSettings,
  now: number,
  coordinatorSessionId: string | null,
): AttemptCellView => {
  switch (attempt.payload.status) {
    case EvalAttemptStatus.Queued:
      return { kind: "queued" };
    case EvalAttemptStatus.Preparing:
    case EvalAttemptStatus.Running:
    case EvalAttemptStatus.Judging:
      return {
        kind: "running",
        elapsedMs: elapsedMs(attempt, now),
        phase:
          attempt.payload.status === EvalAttemptStatus.Preparing
            ? "preparing"
            : attempt.payload.status === EvalAttemptStatus.Judging
              ? "judging"
              : null,
      };
    case EvalAttemptStatus.Completed:
      return { kind: "finished", elapsedMs: elapsedMs(attempt, now) };
    case EvalAttemptStatus.Stopped:
      return { kind: "stopped", stop: stopView(attempt, settings) };
    case EvalAttemptStatus.Error:
      return {
        kind: "error",
        message: attemptErrorMessage(attempt),
        sessionId: attempt.payload.targetSessionId ?? coordinatorSessionId,
      };
  }
};

export type ProgressEntry =
  | { kind: "started"; at: string; attempt: EvalAttemptReport }
  | { kind: "finished"; at: string; attempt: EvalAttemptReport }
  | {
      kind: "error";
      at: string;
      attempt: EvalAttemptReport;
      message: string | null;
    }
  | { kind: "stopped"; at: string; attempt: EvalAttemptReport; stop: StopView };

/**
 * One entry per attempt start and end, oldest first, derived from the
 * attempts' recorded times. An attempt that ended without a recorded end
 * time still gets its end entry, placed just after its start.
 */
export const progressEntries = (
  attempts: readonly EvalAttemptReport[],
  settings: EvalRunSettings,
): ProgressEntry[] => {
  const entries: ProgressEntry[] = [];
  for (const attempt of attempts) {
    const { startedAt, completedAt, status } = attempt.payload;
    if (startedAt) entries.push({ kind: "started", at: startedAt, attempt });
    if (!isAttemptEnded(attempt)) continue;
    const at = completedAt ?? startedAt ?? attempt.createdAt;
    if (status === EvalAttemptStatus.Completed) {
      entries.push({ kind: "finished", at, attempt });
    } else if (status === EvalAttemptStatus.Error) {
      entries.push({
        kind: "error",
        at,
        attempt,
        message: attemptErrorMessage(attempt),
      });
    } else {
      entries.push({
        kind: "stopped",
        at,
        attempt,
        stop: stopView(attempt, settings),
      });
    }
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
};
