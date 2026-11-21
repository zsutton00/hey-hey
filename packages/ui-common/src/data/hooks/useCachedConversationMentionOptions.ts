import { useApolloClient, useQuery } from "@apollo/client/react";
import { useMemo } from "react";
import type { MessageRecordDto } from "../../api";
import type { SearchEntity } from "../../components/SmarterTextAreaCard/types";
import { extractMentions } from "../../utils/mentionFormatting";
import {
  readSystemMessageDisplayText,
  readUserMessageDisplayText,
} from "../../utils/conversationMessageText";
import { GetConversationMessageHistoryDocument } from "../../graphql/generated/graphql";
import { MESSAGE_PAGE_SIZE } from "../collections/messages";
import { getProjectGraphQLClient } from "../graphql/client";
import { toMessageResponse } from "../graphql/records";

const readMessageText = (message: MessageRecordDto): string | null =>
  message.type === "USER"
    ? readUserMessageDisplayText(message.data)
    : readSystemMessageDisplayText(message.data);

export const readCachedConversationMentionOptions = (
  messages: readonly MessageRecordDto[],
): SearchEntity[] => {
  const options = new Map<string, SearchEntity>();
  for (const message of messages) {
    const text = readMessageText(message);
    if (!text) continue;

    for (const mention of extractMentions(text, {
      allowMentionEscapes: true,
    })) {
      const type = mention.entityType.toLowerCase();
      options.set(`${type}:${mention.entityId}`, {
        id: mention.entityId,
        type,
        name: mention.entityName,
      });
    }
  }
  return [...options.values()];
};

/** Reactive, cache-only projection. This hook never starts a read. */
export const useCachedConversationMentionOptions = (
  organizationId: string | null,
  projectId: string | null,
  conversationId: string | null,
): SearchEntity[] => {
  const root = useApolloClient();
  const client =
    organizationId && projectId
      ? getProjectGraphQLClient(root, { organizationId, projectId })
      : root;
  const thread = useQuery(GetConversationMessageHistoryDocument, {
    client,
    variables: { id: conversationId ?? "__noop__", last: MESSAGE_PAGE_SIZE },
    fetchPolicy: "cache-only",
    skip: !organizationId || !projectId || !conversationId,
  });
  const loaded = thread.data?.conversation.messages.nodes;

  return useMemo(
    () =>
      readCachedConversationMentionOptions(
        loaded?.map(toMessageResponse) ?? [],
      ),
    [loaded],
  );
};
