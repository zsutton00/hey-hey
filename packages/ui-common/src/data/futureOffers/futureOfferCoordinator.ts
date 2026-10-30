import {
  ProposalAction,
  TargetEntityType,
  WorkStatus,
  type FutureApplicationOffer,
  type ProposalResponseDto,
} from "../../api";
import { isWorkItemGraphProposal } from "../../components/ProposalDispatchers/types";

export function reviewedUnappliedOffers(
  offers: readonly FutureApplicationOffer[],
) {
  return offers.filter(
    ({ applicability }) =>
      !applicability.blockers.some(
        (blocker) =>
          blocker === "APPROVAL_REQUIRED" ||
          blocker === "APPLIED" ||
          blocker === "CANCELLED",
      ),
  );
}

/** Read the completion intent already carried by a successfully applied proposal. */
export function futureOfferTaskIds(proposal: ProposalResponseDto): string[] {
  if (
    proposal.action !== ProposalAction.Update ||
    proposal.targetEntityType !== TargetEntityType.Task
  )
    return [];
  if (isWorkItemGraphProposal(proposal)) {
    return [
      ...new Set(
        proposal.updates.operations.flatMap((operation) =>
          operation.op === "workItem.update" &&
          operation.ref.refType === "existing" &&
          (operation.status === WorkStatus.Verifying ||
            operation.status === WorkStatus.Completed)
            ? [operation.ref.id]
            : [],
        ),
      ),
    ];
  }
  const status =
    proposal.updates && "status" in proposal.updates
      ? proposal.updates.status
      : undefined;
  return proposal.targetEntityId &&
    (status === WorkStatus.Verifying || status === WorkStatus.Completed)
    ? [proposal.targetEntityId]
    : [];
}
