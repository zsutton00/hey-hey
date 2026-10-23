import type { PrivateBetaAccessRequestReviewDto } from "../../api";
import { privateBetaAccessRequestQueryOptions } from "../collections/privateBetaAccessRequests";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UsePrivateBetaAccessRequestReturn =
  DataHookReturn<PrivateBetaAccessRequestReviewDto>;
export function usePrivateBetaAccessRequest(
  requestId: string | undefined,
  options: CollectionHookOptions<PrivateBetaAccessRequestReviewDto> = {}
): UsePrivateBetaAccessRequestReturn {
  const { result, state } = useDataLayerQuery(
    privateBetaAccessRequestQueryOptions(requestId ?? ""),
    { ...options, enabled: options.enabled !== false && Boolean(requestId) }
  );
  return { ...state, data: result.data ?? null };
}
