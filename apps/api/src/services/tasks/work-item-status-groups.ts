import type { WorkItemTypeStatus } from '@hey-hey/contracts/api/models';

export const MCP_STATUS_GROUPS = [
  'BACKLOG',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'CANCELLED',
] as const;

export type McpStatusGroup = (typeof MCP_STATUS_GROUPS)[number];

// Deliberate name check, not meaning-based: the status model has no review
// meaning (Verifying is IN_PROGRESS), yet standard types must keep Verifying
// in IN_REVIEW. Extending the status model is out of scope for this task.
const REVIEW_STATUS_NAME = 'VERIFYING';

/**
 * The simplified agent-facing group a status belongs to, derived from its
 * meaning and completion behavior. Never from the status label.
 */
export function statusGroupOf(status: WorkItemTypeStatus): McpStatusGroup {
  if (status.name === REVIEW_STATUS_NAME) {
    return 'IN_REVIEW';
  }

  switch (status.meaning) {
    case 'FINISHED':
      return status.completionBehavior === 'CANCELLED' ? 'CANCELLED' : 'DONE';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'NOT_STARTED':
    case 'UNFINISHED':
      return 'BACKLOG';
  }
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
