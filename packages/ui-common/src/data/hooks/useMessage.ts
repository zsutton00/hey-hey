import { useMemo } from "react";
import type { MessageRecordDto } from "../../api";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { messageQueryOptions } from "../collections/messages";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseMessageReturn = DataHookReturn<MessageRecordDto>;

export function useMessage(
  organizationId: string | undefined,
  projectId: string | undefined,
  messageId: string | undefined,
  options: CollectionHookOptions<MessageRecordDto> = {}
): UseMessageReturn {
  const queryOptions = useMemo(
    () =>
      messageQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        messageId ?? "__noop__"
      ),
    [organizationId, projectId, messageId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled:
      (options.enabled ?? true) &&
      !!organizationId &&
      !!projectId &&
      !!messageId,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
  });

  return { ...state, data: result.data ?? null };
}
