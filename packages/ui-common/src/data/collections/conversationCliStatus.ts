import { queryOptions } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

/**
 * CLI status for one conversation. Keys: [root, org, project, conversationId].
 * It has no realtime event; reconnect refreshes it through
 * `dataLayerQueryRoots()`.
 */
export const conversationCliStatusKeys = {
  root: () => ["conversationCliStatus"] as const,
  conversation: (
    organizationId: string,
    projectId: string,
    conversationId: string
  ) =>
    [
      ...conversationCliStatusKeys.root(),
      organizationId,
      projectId,
      conversationId,
    ] as const,
};

export function conversationCliStatusQueryOptions(
  organizationId: string,
  projectId: string,
  conversationId: string
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: conversationCliStatusKeys.conversation(
      organizationId,
      projectId,
      conversationId
    ),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getConversationCliStatus(
        { organizationId, projectId, conversationId },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data ?? null;
    },
  });
}
