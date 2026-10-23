import { useMemo } from "react";
import type { ConversationCliStatusResponseDto } from "../../api";
import { conversationCliStatusQueryOptions } from "../collections/conversationCliStatus";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseConversationCliStatusReturn =
  DataHookReturn<ConversationCliStatusResponseDto>;

export function useConversationCliStatus(
  organizationId: string | undefined,
  projectId: string | undefined,
  conversationId: string | undefined,
  options: CollectionHookOptions<ConversationCliStatusResponseDto> = {}
): UseConversationCliStatusReturn {
  const enabled =
    (options.enabled ?? true) &&
    !!organizationId &&
    !!projectId &&
    !!conversationId;

  const queryOptions = useMemo(
    () =>
      conversationCliStatusQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        conversationId ?? "__noop__"
      ),
    [organizationId, projectId, conversationId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
  });

  return {
    data: enabled ? result.data ?? null : null,
    ...state,
  };
}
