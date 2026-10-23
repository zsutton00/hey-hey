import type {
  ActivityDelta,
  ActivityDeltaItemCompletion,
  ActivityDeltaNewSignal,
  ActivityDeltaStatusChange,
  ActivityRecord,
} from './types';

const COMPLETED_STATUSES = new Set(['COMPLETED', 'DONE', 'MERGED', 'CLOSED']);

/**
 * Computes a structured delta between current activity records and
 * a previous snapshot. Identifies status changes, item completions,
 * and new signals (entities not present in the previous snapshot).
 *
 * When no previous snapshot exists (first session), all current
 * activity is treated as new signals.
 */
export function computeActivityDelta(
  current: ActivityRecord[],
  previous: ActivityRecord[] | undefined,
): ActivityDelta {
  const now = new Date().toISOString();

  if (!previous?.length) {
    return {
      statusChanges: [],
      itemCompletions: [],
      newSignals: current.map((record) => toNewSignal(record, now)),
      computedAt: now,
    };
  }

  const previousByEntityId = new Map(previous.map((r) => [r.entityId, r]));

  const statusChanges: ActivityDeltaStatusChange[] = [];
  const itemCompletions: ActivityDeltaItemCompletion[] = [];
  const newSignals: ActivityDeltaNewSignal[] = [];

  for (const record of current) {
    const prev = previousByEntityId.get(record.entityId);

    if (!prev) {
      newSignals.push(toNewSignal(record, now));
      continue;
    }

    if (record.status && prev.status && record.status !== prev.status) {
      statusChanges.push({
        entityId: record.entityId,
        entityType: record.entityType,
        title: record.title,
        previousStatus: prev.status,
        currentStatus: record.status,
        changedAt: record.updatedAt ?? now,
      });

      if (isCompletedStatus(record.status)) {
        itemCompletions.push({
          entityId: record.entityId,
          entityType: record.entityType,
          title: record.title,
          completedAt: record.updatedAt ?? now,
        });
      }
    }
  }

  return {
    statusChanges,
    itemCompletions,
    newSignals,
    computedAt: now,
  };
}

function toNewSignal(record: ActivityRecord, receivedAt: string): ActivityDeltaNewSignal {
  return {
    entityId: record.entityId,
    entityType: record.entityType,
    title: record.title,
    signalType: inferSignalType(record),
    receivedAt,
  };
}

function inferSignalType(record: ActivityRecord): string {
  const entityType = (record.entityType as string)?.toLowerCase() ?? '';
  if (entityType.includes('message')) return 'new_message';
  if (entityType.includes('review')) return 'review_request';
  return 'new_activity';
}

function isCompletedStatus(status: string): boolean {
  return COMPLETED_STATUSES.has(status.toUpperCase());
}
