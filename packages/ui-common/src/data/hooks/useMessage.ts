import { useMemo } from "react";
import type { MessageRecordDto } from "../../api";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { messageRead } from "../collections/messages";
import { useGraphQLRead } from "../graphql/useGraphQLRead";

export type UseMessageReturn = DataHookReturn<MessageRecordDto>;

export function useMessage(
  organizationId: string | undefined,
  projectId: string | undefined,
  messageId: string | undefined,
  options: CollectionHookOptions<MessageRecordDto> = {},
): UseMessageReturn {
  const spec = useMemo(
    () =>
      messageRead(
        {
          organizationId: organizationId ?? "__noop__",
          projectId: projectId ?? "__noop__",
        },
        messageId ?? "__noop__",
      ),
    [organizationId, projectId, messageId],
  );

  return useGraphQLRead(spec, {
    enabled:
      (options.enabled ?? true) &&
      !!organizationId &&
      !!projectId &&
      !!messageId,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
  });
}
