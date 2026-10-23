import React from "react";
import { useTranslation } from "react-i18next";
import type { ConversationResponseDto } from "../../../api";
import { usePathService } from "../../../contexts";
import { EntityGrid, EntityListItem, conversationAdapter } from "../../Entity";

export interface ConversationHistoryListProps {
  /** List of conversations to display */
  conversations: ConversationResponseDto[];

  /** ID of the currently active conversation */
  activeConversationId: string;

  /** Callback when a conversation is selected */
  onConversationSelect: (conversation: ConversationResponseDto) => void;

  /** Whether conversations are loading */
  isLoading?: boolean;

  /** Project ID for generating conversation links */
  useWebLinks?: boolean;

  /** Project ID for generating conversation links, required if useWebLinks is true */
  projectId?: string;
}

/**
 * Displays a list of historical conversations with metadata.
 * Used in the ConversationViewer history tab.
 */
export const ConversationHistoryList: React.FC<
  ConversationHistoryListProps
> = ({
  conversations,
  onConversationSelect,
  isLoading = false,
  projectId,
  useWebLinks,
}) => {
  const { t } = useTranslation();
  const pathService = usePathService();

  return (
    <EntityGrid
      items={conversations}
      loading={isLoading}
      linkForItem={(conversation) =>
        projectId && useWebLinks
          ? pathService.conversation({
              projectId,
              conversationId: conversation.id,
            })
          : undefined
      }
      renderItem={(conversation) => {
        const props = conversationAdapter.toEntityListItemProps(conversation, {
          onClick: () => onConversationSelect(conversation),
        });

        return <EntityListItem {...props} />;
      }}
      keyExtractor={(conversation) => conversation.id}
      emptyMessage={t("conversation.history.empty")}
      spacing={2}
    />
  );
};
