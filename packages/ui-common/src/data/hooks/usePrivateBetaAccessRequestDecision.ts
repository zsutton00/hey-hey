import { useQueryClient } from "@tanstack/react-query";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import type {
  PrivateBetaAccessRequestDecisionInputDto,
  PrivateBetaAccessRequestDecisionResultDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  privateBetaAccessRequestKeys,
  privateBetaAccessRequestQueryOptions,
} from "../collections/privateBetaAccessRequests";
import {
  useMutation,
  type MutationOptions,
  type MutationResult,
} from "../core/useMutation";

export interface PrivateBetaAccessRequestDecisionVariables {
  requestId: string;
  decision: PrivateBetaAccessRequestDecisionInputDto["decision"];
}

export type UsePrivateBetaAccessRequestDecisionOptions =
  MutationOptions<PrivateBetaAccessRequestDecisionResultDto>;

export type UsePrivateBetaAccessRequestDecisionReturn = MutationResult<
  PrivateBetaAccessRequestDecisionVariables,
  PrivateBetaAccessRequestDecisionResultDto
>;

export function usePrivateBetaAccessRequestDecision(
  options: UsePrivateBetaAccessRequestDecisionOptions = {}
): UsePrivateBetaAccessRequestDecisionReturn {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    requestId,
    decision,
  }: PrivateBetaAccessRequestDecisionVariables): Promise<PrivateBetaAccessRequestDecisionResultDto> => {
    const response = await unifiedApiClient.decidePrivateBetaAccessRequest({
      requestId,
      privateBetaAccessRequestDecisionInputDto: { decision },
    });
    const result = response.data?.data;

    if (!result) {
      throw new Error("No decision result returned for private-beta request");
    }

    const detailKey = privateBetaAccessRequestKeys.detail(requestId);
    // The decision DTO is partial; obtain the complete authoritative review.
    void queryClient
      .cancelQueries({ queryKey: detailKey, exact: true })
      .then(() =>
        queryClient.fetchQuery({
          ...privateBetaAccessRequestQueryOptions(requestId),
          staleTime: 0,
        })
      )
      .catch(() => {
        // fetchQuery owns the failed detail read. A refresh failure must not
        // change the outcome or delay reporting a successful durable decision.
      });
    void invalidateWithFollowUpRead(queryClient, {
      queryKey: privateBetaAccessRequestKeys.list(),
      exact: true,
    });

    return result;
  };

  return useMutation(mutationFn, options);
}
