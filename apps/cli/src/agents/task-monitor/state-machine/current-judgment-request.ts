import type { TaskMonitorMachineContext } from './context';
import { taskMonitorRecoveryRequestText } from '../task-monitor-decision-message';

export interface CurrentJudgmentRequest {
  readonly kind: 'RECOVERY' | 'JUDGMENT';
  readonly request: string;
  /** The posted message an answer must name; null while unposted, or for a request settled before it was recorded. */
  readonly requestMessageId: string | null;
  /** The request exists for the user only once its message is posted. */
  readonly posted: boolean;
}

/**
 * The one request the monitor is waiting on. Display, answer admission and the
 * coordination input all read it here, so they cannot name different questions. A
 * recovery request supersedes an ordinary one; the transitions that record either
 * clear the other, and this precedence only decides if one ever survives.
 */
export const currentJudgmentRequest = (
  context: Pick<TaskMonitorMachineContext, 'coordinatorRecovery' | 'pendingJudgment'>,
): CurrentJudgmentRequest | null => {
  const recovery = context.coordinatorRecovery;
  if (recovery) {
    return {
      kind: 'RECOVERY',
      request: taskMonitorRecoveryRequestText(recovery.failure),
      requestMessageId: recovery.requestMessageId,
      posted: recovery.requestMessageId !== null && recovery.deliveryFailure === null,
    };
  }

  const pending = context.pendingJudgment;
  if (pending) {
    return {
      kind: 'JUDGMENT',
      request: pending.request,
      requestMessageId: pending.requestMessageId,
      posted: true,
    };
  }

  return null;
};
