import { useMemo } from "react";
import type { MessageRecordDto } from "../../api";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { messageRead } from "../collections/messages";
import { useGraphQLRead } from "../graphql/useGraphQLRead";

import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

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

  const message = useGraphQLRead(spec, {
    enabled:
      (options.enabled ?? true) &&
      !!organizationId &&
      !!projectId &&
      !!messageId,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
  });
  const conversationId = message.data?.conversationId;
  useWebsocketSubscriptions(
    { conversationIds: conversationId ? [conversationId] : [] },
    { enabled: options.enabled !== false && !!messageId },
  );
  return message;
}
