import { AdrStatus } from 'src/generated/model/adrStatus';
import { formatWorkItemStatusNotAllowedMessage } from '../../services/tasks/work-item-status-policy';

// Subset of WorkStatus that an agent can set on a TASK/FEATURE proposal via the
// MCP edit_work_item / update_proposal surface. Mirrors the literal list embedded in
// proposal-tools.provider.ts (updateWorkItemFields.status). The create tools no
// longer expose `status` — a new task's initial status is decided per type by
// WorkItemTypeRegistryService.getInitialStatusPolicy, not chosen by the caller.
const TASK_USER_SETTABLE_STATUSES = [
  'BACKLOG',
  'ACTIVE',
  'ON_HOLD',
  'VERIFYING',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
] as const;

const DESIGN_DOC_STATUSES: ReadonlyArray<AdrStatus> = Object.values(AdrStatus);
const ALLOWED_STATUSES_BY_TARGET: Record<string, ReadonlyArray<string>> = {
  TASK: TASK_USER_SETTABLE_STATUSES,
  FEATURE: TASK_USER_SETTABLE_STATUSES,
  DESIGN_DOC: DESIGN_DOC_STATUSES,
};

export function getAllowedProposalUpdateStatuses(
  targetEntityType: string,
  configuredStatuses?: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined {
  if (configuredStatuses !== undefined) return configuredStatuses;
  return ALLOWED_STATUSES_BY_TARGET[targetEntityType];
}

export type ProposalUpdateStatusValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validateProposalUpdateStatus(
  targetEntityType: string,
  status: string,
  configuredStatuses?: ReadonlyArray<string>,
): ProposalUpdateStatusValidation {
  // SUPERSEDED is reachable only through proposal-declared supersession, never
  // a plain status edit. Surface a directive error rather than letting it fall
  // through to the generic "invalid status" message below.
  if (
    (targetEntityType === 'TASK' || targetEntityType === 'FEATURE') &&
    status === 'SUPERSEDED'
  ) {
    return {
      ok: false,
      error:
        'A task cannot be moved to SUPERSEDED through a status edit. Declare ' +
        'the SUPERSEDES relationship in the work-item proposal edges field; ' +
        'approval atomically sets SUPERSEDED on the predecessor and writes ' +
        'the successor edge.',
    };
  }

  const allowed = getAllowedProposalUpdateStatuses(
    targetEntityType,
    configuredStatuses,
  );
  // Unsupported target types pass through — the new check exists to constrain
  // the polymorphic shapes we know about, not to block proposal types this
  // module hasn't enumerated.
  if (!allowed) return { ok: true };
  if (allowed.includes(status)) return { ok: true };
  return {
    ok: false,
    error: formatWorkItemStatusNotAllowedMessage(
      status,
      targetEntityType,
      allowed,
    ),
  };
}
