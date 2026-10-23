import type { ProposalResponseDto } from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";

export function proposalReviewPath(
  projectId: string,
  proposal: ProposalResponseDto,
): string {
  if (proposal.groupMembership) {
    return WebPathService.proposalGroup({
      projectId,
      groupId: proposal.groupMembership.groupId,
    });
  }

  return WebPathService.proposal({
    projectId,
    proposalId: proposal.id,
  });
}
