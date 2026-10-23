import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type { ConversationResponseDto } from "@hey-hey/ui-common/api";
import {
  conversationAdapter,
  EntityGrid,
  EntityListItem,
} from "@hey-hey/ui-common/components";
import { useDeleteConversation } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { TERMS } from "@hey-hey/ui-common/i18n";
import { useTranslation } from "react-i18next";
import React, { useCallback, useState } from "react";

export interface ConversationArchiveListProps {
  organizationId: string;
  projectId: string;
  conversations: ConversationResponseDto[];
  /** Name of the entity the conversations are about; titles untitled rows. */
  entityName?: string;
  activeConversationId: string;
  onConversationSelect: (conversation: ConversationResponseDto) => void;
  isLoading: boolean;
  markStale: () => void;
}

export const ConversationArchiveList: React.FC<
  ConversationArchiveListProps
> = ({
  organizationId,
  projectId,
  conversations,
  entityName,
  activeConversationId,
  onConversationSelect,
  isLoading,
  markStale,
}) => {
  const { t } = useTranslation();
  const currentUserId = useUserIdentity()?.userId;
  const [conversationToArchive, setConversationToArchive] =
    useState<ConversationResponseDto | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const deleteConversation = useDeleteConversation({
    onSuccess: () => {
      setConversationToArchive(null);
      setArchiveError(null);
      markStale();
    },
    onError: (error) => setArchiveError(error.message),
  });

  const handleOpenArchive = useCallback(
    (conversation: ConversationResponseDto) => {
      setArchiveError(null);
      setConversationToArchive(conversation);
    },
    [],
  );

  const handleCloseArchive = useCallback(() => {
    if (deleteConversation.isPending) return;
    setArchiveError(null);
    setConversationToArchive(null);
  }, [deleteConversation.isPending]);

  const handleConfirmArchive = useCallback(() => {
    if (!conversationToArchive || deleteConversation.isPending) return;

    deleteConversation.mutate({
      organizationId,
      projectId,
      conversationId: conversationToArchive.id,
      deleteRequest: { hardDelete: false },
    });
  }, [conversationToArchive, deleteConversation, organizationId, projectId]);

  const fallbackTitle = entityName
    ? `${entityName} ${TERMS.Conversation}`
    : undefined;
  const archivedTitle =
    conversationToArchive?.title || fallbackTitle || "Untitled Conversation";

  return (
    <>
      <EntityGrid
        items={conversations}
        loading={isLoading}
        renderItem={(conversation) => {
          const itemProps = conversationAdapter.toEntityListItemProps(
            conversation,
            {
              onClick: () => onConversationSelect(conversation),
              fallbackTitle,
            },
          );
          const title = itemProps.title;
          const canArchive = Boolean(
            currentUserId && conversation.createdBy === currentUserId,
          );

          return (
            <EntityListItem
              key={conversation.id}
              {...itemProps}
              contentSlot={
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                  sx={{ minWidth: 0, width: "100%" }}
                >
                  <Box
                    aria-current={
                      conversation.id === activeConversationId
                        ? "page"
                        : undefined
                    }
                    sx={{ minWidth: 0, flex: 1 }}
                  >
                    <Typography variant="subtitle1" noWrap>
                      {title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {itemProps.status}
                    </Typography>
                  </Box>
                  {canArchive && (
                    <IconButton
                      aria-label={`Archive ${title}`}
                      title="Archive conversation"
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenArchive(conversation);
                      }}
                    >
                      <ArchiveOutlinedIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              }
            />
          );
        }}
        keyExtractor={(conversation) => conversation.id}
        emptyMessage={t("conversation.history.empty")}
        spacing={2}
      />

      <Dialog
        open={Boolean(conversationToArchive)}
        onClose={handleCloseArchive}
        aria-labelledby="archive-conversation-title"
      >
        <DialogTitle id="archive-conversation-title">
          Archive conversation?
        </DialogTitle>
        <DialogContent>
          <Typography>
            “{archivedTitle}” will be archived and its messages will no longer
            appear in search results. You can restore the conversation later.
          </Typography>
          {archiveError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {archiveError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseArchive}
            disabled={deleteConversation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmArchive}
            disabled={deleteConversation.isPending}
            variant="contained"
          >
            {deleteConversation.isPending ? "Archiving…" : "Archive"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
