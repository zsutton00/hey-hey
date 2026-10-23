import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { MessageRecordDto } from "../../api";
import type { SearchEntity } from "../../components/SmarterTextAreaCard/types";
import { extractMentions } from "../../utils/mentionFormatting";
import {
  readSystemMessageDisplayText,
  readUserMessageDisplayText,
} from "../../utils/conversationMessageText";
import {
  getCachedMessagesForConversation,
  messageKeys,
} from "../collections/messages";

const readMessageText = (message: MessageRecordDto): string | null =>
  message.type === "USER"
    ? readUserMessageDisplayText(message.data)
    : readSystemMessageDisplayText(message.data);

export const readCachedConversationMentionOptions = (
  messages: readonly MessageRecordDto[]
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
  conversationId: string | null
): SearchEntity[] => {
  const queryClient = useQueryClient();
  const read = useCallback(
    (): SearchEntity[] =>
      conversationId
        ? readCachedConversationMentionOptions(
            getCachedMessagesForConversation(queryClient, conversationId)
          )
        : [],
    [conversationId, queryClient]
  );
  const [options, setOptions] = useState(read);

  useEffect(() => {
    setOptions(read());
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== messageKeys.root()[0]) return;
      if (event.type === "updated" && event.action.type !== "success") return;
      setOptions(read());
    });
  }, [queryClient, read]);

  return options;
};
