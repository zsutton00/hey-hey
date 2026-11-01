import { useCallback } from "react";
import { ProposalStatus, type ProposalResponseDto } from "../../api";
import { getProposalMaterializationStatus } from "../../components/ProposalDispatchers/types";
import { futureOfferTaskIds } from "../futureOffers/futureOfferCoordinator";
import { useFutureOffers } from "../futureOffers/FutureOfferContext";

/** Check only the response to the user's approval; no polling or background triggers. */
export function useFutureOfferCheck() {
  const offers = useFutureOffers();
  return useCallback(
    (proposal: ProposalResponseDto) => {
      if (proposal.status !== ProposalStatus.Approved) return;
      const materialization = getProposalMaterializationStatus(proposal);
      if (materialization && materialization.state !== "applied") return;
      for (const taskId of futureOfferTaskIds(proposal))
        offers?.checkTask(taskId);
    },
    [offers],
  );
}
