import { z } from 'zod';
import { ReportType, WorkStatus } from '../../shared/api/generated/api';
import type {
  LocalTaskMonitorCoordinatorDecision,
  TaskMonitorLifecycleCause,
} from '../../shared/agent-bridge-contract/generated/api';
import type { TaskMonitorCanonicalEvidence } from './task-monitor-evidence';

const reportTypeSchema = z.enum(
  Object.values(ReportType) as [ReportType, ...ReportType[]],
);

export interface TaskMonitorCoordinationSettledRun {
  readonly runId: string;
  readonly settledAt: string;
  readonly outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly turnId: string;
  readonly promptType: string;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  readonly completedAssistantMessageId: string | null;
  readonly reports: readonly { readonly reportId: string; readonly reportType: ReportType }[];
}

/** Causes that are allowed to enter the shared Task Monitor coordinator. */
export type TaskMonitorCoordinationCause = Extract<
  TaskMonitorLifecycleCause,
  'START' | 'RESUME' | 'CONTINUE' | 'JUDGMENT_RESOLVED'
>;

export interface TaskMonitorCoordinationLocalState {
  readonly control: 'ACTIVE' | 'PAUSING' | 'PAUSED' | 'RESUMING';
  readonly work: string;
  readonly userGuidance: string | null;
  readonly selectedTaskId: string | null;
  readonly activeRunAgentSessionId: string | null;
  readonly activeRunId: string | null;
  readonly conversationId: string | null;
  readonly reviewRequestId: string | null;
  readonly pendingJudgmentReason: string | null;
  readonly committedEffectId: string | null;
  readonly settledRun: TaskMonitorCoordinationSettledRun | null;
}

export interface TaskMonitorCoordinationSnapshot {
  readonly cause: TaskMonitorCoordinationCause;
  readonly correlationId: string;
  readonly evidence: TaskMonitorCanonicalEvidence;
  readonly localState: TaskMonitorCoordinationLocalState | null;
}

export const taskMonitorCoordinationLocalStateFromContext = (
  context: {
    readonly userGuidance: string | null;
    readonly selectedTaskId: string | null;
    readonly activeRunAgentSessionId: string | null;
    readonly conversationId: string | null;
    readonly reviewRequest: { readonly requestId: string } | null;
    readonly settledRun: TaskMonitorCoordinationSettledRun | null;
    readonly failureReason?: string | null;
  },
  control: TaskMonitorCoordinationLocalState['control'],
  work: string,
): TaskMonitorCoordinationLocalState => ({
  control,
  work,
  userGuidance: context.userGuidance,
  selectedTaskId: context.selectedTaskId,
  activeRunAgentSessionId: context.activeRunAgentSessionId,
  activeRunId: context.settledRun?.runId ?? null,
  conversationId: context.conversationId,
  reviewRequestId: context.reviewRequest?.requestId ?? null,
  pendingJudgmentReason: context.failureReason ?? null,
  committedEffectId: null,
  settledRun: context.settledRun
    ? {
        runId: context.settledRun.runId,
        settledAt: context.settledRun.settledAt,
        outcome: context.settledRun.outcome,
        turnId: context.settledRun.turnId,
        promptType: context.settledRun.promptType,
        terminalOutcome: context.settledRun.terminalOutcome,
        completedAssistantMessageId: context.settledRun.completedAssistantMessageId,
        reports: context.settledRun.reports,
      }
    : null,
});

export type TaskMonitorAcceptedTransition =
  | { readonly action: 'REQUEST_REVIEW'; readonly rationale: string }
  | { readonly action: 'REQUEST_CHANGES'; readonly rationale: string; readonly guidance: string }
  | { readonly action: 'ACCEPT_TASK'; readonly rationale: string }
  | { readonly action: 'WAIT'; readonly rationale: string }
  | { readonly action: 'REQUEST_JUDGMENT'; readonly rationale: string; readonly guidance: string }
  | { readonly action: 'HALT'; readonly rationale: string; readonly failureContext: string };

export type TaskMonitorDecisionValidationResult =
  | { readonly ok: true; readonly value: TaskMonitorAcceptedTransition }
  | { readonly ok: false; readonly reason: string };

export const taskMonitorCoordinationLocalStateSchema = z
  .object({
    control: z.enum(['ACTIVE', 'PAUSING', 'PAUSED', 'RESUMING']),
    work: z.string().min(1),
    userGuidance: z.string().nullable(),
    selectedTaskId: z.string().nullable(),
    activeRunAgentSessionId: z.string().nullable(),
    activeRunId: z.string().nullable(),
    conversationId: z.string().nullable(),
    reviewRequestId: z.string().nullable(),
    pendingJudgmentReason: z.string().nullable(),
    committedEffectId: z.string().nullable(),
    settledRun: z
      .object({
        runId: z.string(),
        settledAt: z.string(),
        outcome: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
        turnId: z.string(),
        promptType: z.string(),
        terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
        completedAssistantMessageId: z.string().nullable(),
        reports: z.array(z.object({ reportId: z.string(), reportType: reportTypeSchema }).strict()),
      })
      .nullable(),
  })
  .strict() satisfies z.ZodType<TaskMonitorCoordinationLocalState>;

/** Narrow the persisted Run session context before it reaches coordination logic. */
export const parseTaskMonitorCoordinationLocalState = (
  value: unknown,
): TaskMonitorCoordinationLocalState | null => {
  const parsed = taskMonitorCoordinationLocalStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const hasCompletedReleasedTurn = (snapshot: TaskMonitorCoordinationSnapshot): boolean =>
  snapshot.evidence.releasedTurn?.terminalOutcome === 'COMPLETED';

const hasCurrentSession = (snapshot: TaskMonitorCoordinationSnapshot): boolean =>
  snapshot.evidence.selectedSession !== null;

/**
 * Deterministic policy for the closed coordinator vocabulary. The provider can
 * recommend an outcome, but canonical evidence decides whether that outcome is
 * applicable before any owner is allowed to mutate state.
 */
export const validateTaskMonitorDecision = (
  snapshot: TaskMonitorCoordinationSnapshot,
  decision: LocalTaskMonitorCoordinatorDecision,
): TaskMonitorDecisionValidationResult => {
  const { evidence } = snapshot;
  const localState = snapshot.localState;
  if (evidence.monitor.status !== WorkStatus.Active) {
    return {
      ok: false,
      reason: `Task Monitor coordination requires an active monitor, not ${evidence.monitor.status}.`,
    };
  }
  if (localState && !['ACTIVE', 'RESUMING'].includes(localState.control)) {
    return {
      ok: false,
      reason: `Task Monitor coordination is not executable while control is ${localState.control}.`,
    };
  }
  if (localState?.selectedTaskId && localState.selectedTaskId !== evidence.selectedTask.id) {
    return {
      ok: false,
      reason: 'Task Monitor selected Task changed while coordination was paused.',
    };
  }
  if (
    localState?.activeRunAgentSessionId &&
    evidence.selectedSession &&
    localState.activeRunAgentSessionId !== evidence.selectedSession.id
  ) {
    return {
      ok: false,
      reason: 'Task Monitor selected Agent Session changed while coordination was paused.',
    };
  }
  switch (decision.action) {
    case 'REQUEST_REVIEW':
      if (snapshot.cause === 'START') {
        return { ok: false, reason: 'A fresh Task Monitor start cannot request Review.' };
      }
      if (!hasCurrentSession(snapshot) || !hasCompletedReleasedTurn(snapshot)) {
        return {
          ok: false,
          reason: 'Review requires the current selected session and a completed released Turn.',
        };
      }
      if (evidence.releasedTurn?.promptType === 'code_review') {
        return { ok: false, reason: 'A code Review Turn cannot request another Review.' };
      }
      return { ok: true, value: decision };
    case 'REQUEST_CHANGES':
      if (!hasCurrentSession(snapshot)) {
        return { ok: false, reason: 'Changes guidance requires a current selected session.' };
      }
      return { ok: true, value: decision };
    case 'REQUEST_JUDGMENT':
      if (!hasCurrentSession(snapshot)) {
        return { ok: false, reason: 'Judgment requires a current selected session.' };
      }
      return { ok: true, value: decision };
    case 'ACCEPT_TASK': {
      if (evidence.selectedTask.status !== 'COMPLETED') {
        return { ok: false, reason: 'Task acceptance requires a canonically completed Task.' };
      }
      if (
        evidence.monitor.reviewMode === 'REQUIRE_REVIEW' &&
        (!hasCompletedReleasedTurn(snapshot) || evidence.releasedTurn?.promptType !== 'code_review')
      ) {
        return {
          ok: false,
          reason:
            'Task acceptance requires a successful Review bound to the current selected work.',
        };
      }
      return { ok: true, value: decision };
    }
    case 'WAIT':
      return { ok: true, value: decision };
    case 'HALT':
      return { ok: true, value: decision };
  }
};
