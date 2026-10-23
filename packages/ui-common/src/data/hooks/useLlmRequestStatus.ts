import type { RequestStatusResponseData } from "../../api";
import { llmRequestStatusQueryOptions } from "../collections/llmRequestStatus";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UseLlmRequestStatusReturn =
  DataHookReturn<RequestStatusResponseData>;
export function useLlmRequestStatus(
  requestId: string | undefined,
  options: CollectionHookOptions<RequestStatusResponseData> = {}
): UseLlmRequestStatusReturn {
  const { result, state } = useDataLayerQuery(
    llmRequestStatusQueryOptions(requestId ?? ""),
    { ...options, enabled: options.enabled !== false && Boolean(requestId) }
  );
  return { ...state, data: result.data ?? null };
}
