import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { proposalKeys } from "../collections/proposals";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";

/** A refinement can change every projection of the same future, including lists and groups. */
export function useInvalidateProposalReview() {
  const queryClient = useQueryClient();
  return useCallback(
    (organizationId: string, projectId: string): Promise<void> =>
      invalidateWithFollowUpRead(queryClient, {
        queryKey: proposalKeys.project(organizationId, projectId),
      }),
    [queryClient],
  );
}
