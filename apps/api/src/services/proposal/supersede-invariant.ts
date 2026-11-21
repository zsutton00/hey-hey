import type { CreateProposalDto } from '@hey-hey/contracts/api/models';
import { ProposalEdgeEndpointMode } from '@hey-hey/contracts/api/models';

/**
 * A proposal that violates the supersede invariant, with the directive
 * message the caller needs to fix it.
 */
export interface SupersedeInvariantViolation {
  /** Code surfaced on the structural validation issue. */
  code: 'forbidden_status' | 'orphan_supersedes_edge' | 'ambiguous_successor';
  /** Offending field, relative to the proposal (no `proposals[i]` prefix). */
  field: 'updates.status' | 'edges';
  reason: string;
  suggestion: string;
}

const SUPERSEDE_TRANSITION_HINT =
  'Declare the SUPERSEDES relationship in the work-item proposal edges field; ' +
  'approval materializes the predecessor status change and successor edge ' +
  'through the supersede transition.';

/**
 * The supersede invariant.
 *
 * Only successor approval may set the predecessor's `SUPERSEDED` status and
 * record the lineage together. Ordinary proposal status assignments cannot.
 *
 * This is the single rule both the create boundary (`ProposalService`) and
 * the advisory validator (`ProposalValidationEngine`) enforce, so the plain
 * status-edit path can never produce a `SUPERSEDED` task.
 *
 * Returns `null` when the proposal satisfies the invariant — including the
 * common case where neither half is present.
 */
export function evaluateSupersedeInvariant(
  dto: Pick<CreateProposalDto, 'targetEntityType' | 'updates' | 'edges'>,
): SupersedeInvariantViolation | null {
  if (dto.targetEntityType !== 'TASK') {
    return null;
  }

  const status =
    dto.updates !== null && typeof dto.updates === 'object'
      ? (dto.updates as Record<string, unknown>).status
      : undefined;
  const wantsSuperseded = status === 'SUPERSEDED';

  if (wantsSuperseded) {
    return {
      code: 'forbidden_status',
      field: 'updates.status',
      reason:
        'A task cannot be moved to SUPERSEDED through a status assignment.',
      suggestion: SUPERSEDE_TRANSITION_HINT,
    };
  }
  return null;
}
