import type { AgentSessionContinuation, Prisma } from '@prisma/client';
import {
  AgentSessionContinuationMode,
  AgentSessionContinuationStartupOutcome,
  AgentSessionContinuationState,
  type AgentSessionContinuationStartupReport,
  type ControllerStartInputs,
} from '@hey-hey/contracts/api/models';

type Data = Prisma.AgentSessionContinuationUpdateManyMutationInput;

export type StartupTransition =
  /** The report applies; `data` is the attempt's next state. */
  | {
      kind: 'apply';
      data: (now: Date, row: AgentSessionContinuation) => Data;
    }
  /** The same report was already applied; answer it again unchanged. */
  | { kind: 'replay' }
  /** The report no longer applies and changes nothing. */
  | { kind: 'ignored'; reason: string };

const MAX_DETAIL = 500;

/** The state an applied report leaves the attempt in. */
const resultingState = (
  outcome: AgentSessionContinuationStartupOutcome,
): AgentSessionContinuationState => {
  switch (outcome) {
    case AgentSessionContinuationStartupOutcome.Resumed:
    case AgentSessionContinuationStartupOutcome.PreparedFromHistory:
      return AgentSessionContinuationState.Succeeded;
    case AgentSessionContinuationStartupOutcome.NativeResumeRejected:
      return AgentSessionContinuationState.AwaitingHistoryConfirmation;
    case AgentSessionContinuationStartupOutcome.Failed:
      return AgentSessionContinuationState.Failed;
  }
};

/** The mode a report's outcome confirms; a mismatch is a contract breach. */
const expectedMode = (
  outcome: AgentSessionContinuationStartupOutcome,
): AgentSessionContinuationMode | null => {
  switch (outcome) {
    case AgentSessionContinuationStartupOutcome.Resumed:
    case AgentSessionContinuationStartupOutcome.NativeResumeRejected:
      return AgentSessionContinuationMode.NativeResume;
    case AgentSessionContinuationStartupOutcome.PreparedFromHistory:
      return AgentSessionContinuationMode.SavedHistory;
    case AgentSessionContinuationStartupOutcome.Failed:
      return null;
  }
};

/** The same start inputs, now continuing from saved history. */
const savedHistoryInputs = (
  inputs: ControllerStartInputs,
  continuationId: string,
): Prisma.InputJsonValue =>
  ({
    ...inputs,
    payload: {
      ...inputs.payload,
      continuation: {
        continuationId,
        mode: AgentSessionContinuationMode.SavedHistory,
      },
    },
  }) as unknown as Prisma.InputJsonValue;

/**
 * Decides what one startup report does to its attempt. Pure: the caller
 * applies `data` conditioned on the same state and delivery operation it read.
 */
export function startupTransition(
  row: AgentSessionContinuation,
  report: AgentSessionContinuationStartupReport,
): StartupTransition {
  const isCurrentDelivery =
    row.deliveryOperationId === report.deliveryOperationId;
  if (isCurrentDelivery && row.state === resultingState(report.outcome)) {
    return { kind: 'replay' };
  }
  if (!isCurrentDelivery) {
    return { kind: 'ignored', reason: 'STALE_DELIVERY' };
  }
  const awaitingStartup =
    row.state === AgentSessionContinuationState.Pending ||
    row.state === AgentSessionContinuationState.Uncertain;
  if (!awaitingStartup) {
    return { kind: 'ignored', reason: 'ATTEMPT_RESOLVED' };
  }
  const mode = expectedMode(report.outcome);
  if (mode !== null && mode !== row.mode) {
    return { kind: 'ignored', reason: 'MODE_MISMATCH' };
  }

  const outcomeCode = report.reasonCode ?? null;
  const outcomeDetail = report.detail?.slice(0, MAX_DETAIL) ?? null;
  switch (report.outcome) {
    case AgentSessionContinuationStartupOutcome.Resumed:
    case AgentSessionContinuationStartupOutcome.PreparedFromHistory:
      return {
        kind: 'apply',
        data: (now) => ({
          state: AgentSessionContinuationState.Succeeded,
          providerStartedAt: now,
          terminalAt: now,
          outcomeCode: null,
          outcomeDetail: null,
        }),
      };
    case AgentSessionContinuationStartupOutcome.NativeResumeRejected:
      // The same attempt continues, from saved history, once the person
      // confirms; nothing started on the destination.
      return {
        kind: 'apply',
        data: (now, current) => ({
          state: AgentSessionContinuationState.AwaitingHistoryConfirmation,
          mode: AgentSessionContinuationMode.SavedHistory,
          nativeResumeRejectedAt: now,
          startRunInputs: savedHistoryInputs(
            current.startRunInputs as unknown as ControllerStartInputs,
            current.id,
          ),
          outcomeCode,
          outcomeDetail,
        }),
      };
    case AgentSessionContinuationStartupOutcome.Failed:
      return {
        kind: 'apply',
        data: () => ({
          state: AgentSessionContinuationState.Failed,
          outcomeCode,
          outcomeDetail,
        }),
      };
  }
}
