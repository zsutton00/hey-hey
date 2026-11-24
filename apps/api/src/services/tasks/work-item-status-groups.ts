import type {
  WorkItemStatusMeaning,
  WorkItemTypeStatus,
} from '@hey-hey/contracts/api/models';

export const MCP_STATUS_GROUPS = [
  'BACKLOG',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'CANCELLED',
] as const;

export type McpStatusGroup = (typeof MCP_STATUS_GROUPS)[number];

// Deliberate name check, not meaning-based: the status model has no review
// meaning (Verifying is In progress), yet standard types must keep Verifying
// in IN_REVIEW. Extending the status model is out of scope for this task.
const REVIEW_STATUS_NAME = 'VERIFYING';

/**
 * The simplified agent-facing group a status belongs to, derived from its
 * meaning. Never from the status label.
 */
export function statusGroupOf(status: WorkItemTypeStatus): McpStatusGroup {
  if (status.name === REVIEW_STATUS_NAME) {
    return 'IN_REVIEW';
  }

  switch (status.meaning.kind) {
    case 'COMPLETED':
      return 'DONE';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'CUSTOM':
      return 'BACKLOG';
  }
}

/** Finished means Completed or Cancelled; every other meaning is not finished. */
export function isFinishedMeaning(
  meaning: WorkItemStatusMeaning | undefined,
): boolean {
  return meaning?.kind === 'COMPLETED' || meaning?.kind === 'CANCELLED';
}

/** Work is underway only for the built-in In progress meaning. */
export function isInProgressMeaning(
  meaning: WorkItemStatusMeaning | undefined,
): boolean {
  return meaning?.kind === 'IN_PROGRESS';
}

/**
 * Names of the statuses in `group` for one type definition. A status that was
 * removed from the type is in no group, so it never counts as done.
 */
export function statusNamesInGroup(
  statuses: readonly WorkItemTypeStatus[],
  group: McpStatusGroup,
): string[] {
  return statuses
    .filter((status) => statusGroupOf(status) === group)
    .map((status) => status.name);
}
