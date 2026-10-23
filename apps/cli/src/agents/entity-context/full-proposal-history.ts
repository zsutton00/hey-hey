import type {
  EntityContextDtoProposalsInner,
  ProposalResponseDto,
} from '../../shared/api/generated/api';

export function assertFullProposalHistory(
  proposals: EntityContextDtoProposalsInner[],
): asserts proposals is ProposalResponseDto[] {
  if (proposals.some((proposal) => !('updates' in proposal))) {
    throw new Error('Context full proposal detail returned a summary payload.');
  }
}
