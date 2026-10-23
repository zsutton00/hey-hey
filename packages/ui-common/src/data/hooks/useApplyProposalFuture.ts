import type {
  FutureApplyResponse,
  ProposalsApiApplyProposalFutureRequest,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import {
  useMutation,
  type MutationOptions,
  type MutationResult,
} from "../core/useMutation";
import { useInvalidateProposalReview } from "./useInvalidateProposalReview";

export type UseApplyProposalFutureReturn = MutationResult<
  ProposalsApiApplyProposalFutureRequest,
  FutureApplyResponse
>;

/** Each call supplies the reviewed revision and, when confirmed, the API's
 * confirmation. No confirmation is retained or automatically reused by this hook.
 * Mutation success means a response was received; inspect its status for application.
 */
export function useApplyProposalFuture(
  options: MutationOptions<FutureApplyResponse> = {},
): UseApplyProposalFutureReturn {
  const invalidateReview = useInvalidateProposalReview();
  return useMutation(
    async (request: ProposalsApiApplyProposalFutureRequest) => {
      try {
        const response = await proposalsClient.applyProposalFuture(request);
        if (!response.data.data) {
          throw new Error("Future application completed without a result");
        }
        return response.data.data;
      } finally {
        // Blocked/confirmation responses and uncertain failures also require fresh reads.
        invalidateReview(request.organizationId, request.projectId);
      }
    },
    options,
  );
}
