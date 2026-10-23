import type { PrivateBetaAccessRequestReviewDto } from "../../api";
import { privateBetaAccessRequestsQueryOptions } from "../collections/privateBetaAccessRequests";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UsePrivateBetaAccessRequestsReturn =
  DataCollectionHookReturn<PrivateBetaAccessRequestReviewDto>;
export function usePrivateBetaAccessRequests(
  options: CollectionHookOptions<PrivateBetaAccessRequestReviewDto> = {}
): UsePrivateBetaAccessRequestsReturn {
  const { result, state } = useDataLayerQuery(
    privateBetaAccessRequestsQueryOptions(),
    { ...options, enabled: options.enabled !== false }
  );
  return { ...state, data: result.data ?? [] };
}
