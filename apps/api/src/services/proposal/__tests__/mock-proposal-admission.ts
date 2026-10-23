import type { ValidateProposalAuthoringCandidatesInput } from '../proposal-validation.types';
import { storeTracksAttachmentAsProposalEdge } from '../proposal-tracking-attachment';
import {
  assertProposalEdgeTargetsResolvable,
  collectProposalReferences,
  loadProposalReferenceMetadata,
  proposalReferenceKey,
} from '../proposal-title-snapshot';

// Service unit tests stub semantic admission; retain real reference enrichment
// so their persisted title, subtype, and endpoint assertions remain meaningful.
export async function mockProposalAdmission(
  input: ValidateProposalAuthoringCandidatesInput,
) {
  const candidates = input.proposals.map(storeTracksAttachmentAsProposalEdge);
  const metadata = await loadProposalReferenceMetadata(
    input.context.db!,
    input.context.organizationId,
    collectProposalReferences(candidates),
    input.context.projectId,
  );
  for (const candidate of candidates) {
    assertProposalEdgeTargetsResolvable(
      candidate.edges,
      metadata,
      input.context.projectId,
      new Set(
        (input.context.group?.reservedEntities ?? []).map(proposalReferenceKey),
      ),
    );
  }
  return {
    candidates: candidates.map((candidate) => ({ candidate })),
    metadata,
  };
}
