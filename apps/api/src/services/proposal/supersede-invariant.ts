import type { CreateProposalDto } from 'src/generated';
import { ProposalEdgeEndpointMode } from 'src/generated/model/proposalEdgeEndpointMode';

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
 * `SUPERSEDED` status and a `SUPERSEDES` edge are inseparable halves of the
 * supersede transition. A task proposal may not set status to `SUPERSEDED`
 * directly; the status-edit compatibility path remains valid only for the
 * older transition wrapper that pairs it with exactly one `SUPERSEDES` edge to
 * the successor. A proposal may also declare `SUPERSEDES` without setting its
 * own status; approval treats the target as the predecessor and routes that
 * declaration through the same transition semantics.
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

  const supersedesEdges = (dto.edges ?? []).filter(
    (edge) =>
      edge.edgeType === 'SUPERSEDES' &&
      edge.endpointMode !== ProposalEdgeEndpointMode.Proposal,
  );
  const declaresSupersedes = supersedesEdges.length > 0;

  if (wantsSuperseded && !declaresSupersedes) {
    return {
      code: 'forbidden_status',
      field: 'updates.status',
      reason:
        'A task cannot be moved to SUPERSEDED through a plain status edit — ' +
        'the proposal must also declare the SUPERSEDES edge to the successor.',
      suggestion: SUPERSEDE_TRANSITION_HINT,
    };
  }
  if (wantsSuperseded && supersedesEdges.length > 1) {
    return {
      code: 'ambiguous_successor',
      field: 'edges',
      reason:
        'A supersede proposal must declare exactly one SUPERSEDES edge — a ' +
        'task is superseded by a single named successor.',
      suggestion: 'Declare exactly one SUPERSEDES edge to the successor task.',
    };
  }
  return null;
}
