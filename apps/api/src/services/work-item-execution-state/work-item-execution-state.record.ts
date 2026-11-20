import type { Logger } from '@nestjs/common';
import type { WorkItemExecutionState as StoredExecutionStateModel } from '@prisma/client';
import type { WorkItemExecutionState } from '@hey-hey/contracts/api/models';
import { parseStoredWorkItemExecutionStatePayload } from './work-item-execution-state.boundary';

export type StoredExecutionState = Pick<
  StoredExecutionStateModel,
  | 'workItemId'
  | 'organizationId'
  | 'projectId'
  | 'payload'
  | 'ownerMachineId'
  | 'sourceRevision'
  | 'revision'
  | 'ownerConnected'
  | 'freshnessChangedAt'
  | 'acceptedAt'
>;

/**
 * A retained payload written under an older contract may no longer match
 * it. That state is unavailable to consumers, not silently reshaped.
 */
export function toWorkItemExecutionState(
  row: StoredExecutionState,
  logger: Logger,
): WorkItemExecutionState | undefined {
  const state = parseStoredWorkItemExecutionStatePayload(row.payload);
  if (!state.valid) {
    logger.error('[execution-state] retained state unreadable', {
      code: 'STORED_STATE_INVALID',
      workItemId: row.workItemId,
      ownerMachineId: row.ownerMachineId,
      revision: Number(row.revision),
      failures: state.failures,
    });
    return undefined;
  }

  return {
    workItemId: row.workItemId,
    state: state.value,
    revision: Number(row.revision),
    ownerMachineId: row.ownerMachineId,
    acceptedAt: row.acceptedAt.toISOString(),
    freshness: {
      status: row.ownerConnected ? 'CURRENT' : 'LAST_KNOWN',
      changedAt: row.freshnessChangedAt.toISOString(),
    },
  } satisfies WorkItemExecutionState;
}
