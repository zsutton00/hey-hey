import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  WorkflowName,
  type ConversationResponseDto,
} from "@hey-hey/ui-common/api";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import { useDeleteConversation } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import React, { useCallback, useMemo, useState } from "react";
import { CardHeader } from "../../components/CardHeader";

export interface GoalConversationTocProps {
  organizationId: string;
  projectId: string;
  conversations: ConversationResponseDto[];
  activeConversationId: string | null;
  isLoading: boolean;
  scrollOwner?: "toc" | "parent";
  onConversationSelect: (conversationId: string) => void;
  onConversationArchived: (conversationId: string) => void;
}

const conversationLabel = (
  conversation: ConversationResponseDto,
  index: number,
): string => {
  const title = conversation.title?.trim();
  if (title) return title;

  const timestamp = conversation.updatedAt || conversation.createdAt;
  const date = new Date(timestamp);
  if (!Number.isNaN(date.getTime())) {
    return `Conversation from ${date.toLocaleDateString()}`;
  }

  return `Conversation ${index + 1}`;
};

export const GoalConversationToc: React.FC<GoalConversationTocProps> = ({
  organizationId,
  projectId,
  conversations,
  activeConversationId,
  isLoading,
  scrollOwner = "toc",
  onConversationSelect,
  onConversationArchived,
}) => {
  const currentUserId = useUserIdentity()?.userId;
  const [conversationToArchive, setConversationToArchive] =
    useState<ConversationResponseDto | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const deleteConversation = useDeleteConversation();

  const orderedConversations = useMemo(() => {
    const sorted = conversations
      .slice()
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      );
    const root = sorted.find(
      (conversation) => conversation.workflowName === WorkflowName.GoalPm,
    );
    return root
      ? [root, ...sorted.filter((conversation) => conversation.id !== root.id)]
      : sorted;
  }, [conversations]);

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

  const handleConfirmArchive = useCallback(async () => {
    if (!conversationToArchive || deleteConversation.isPending) return;

    try {
      await deleteConversation.mutate({
        organizationId,
        projectId,
        conversationId: conversationToArchive.id,
        deleteRequest: { hardDelete: false },
      });
      const archivedConversationId = conversationToArchive.id;
      setConversationToArchive(null);
      setArchiveError(null);
      onConversationArchived(archivedConversationId);
    } catch (error) {
      setArchiveError(
        error instanceof Error
          ? error.message
          : "Could not archive conversation.",
      );
    }
  }, [
    conversationToArchive,
    deleteConversation,
    onConversationArchived,
    organizationId,
    projectId,
  ]);

  const archivedTitle =
    conversationToArchive?.title?.trim() || "Untitled Conversation";

  return (
    <Box
      data-testid="goal-conversation-toc"
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        p: 2,
        ...(scrollOwner === "toc"
          ? { maxHeight: "50%" }
          : { flex: "0 0 auto" }),
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
      >
        <CardHeader title="Conversations" />
      </Stack>

      <Box
        data-testid="goal-conversation-toc-scrollport"
        sx={{
          minHeight: 0,
          overflowY: scrollOwner === "toc" ? "auto" : "visible",
          mt: 1,
        }}
      >
        {isLoading ? (
          <Box
            sx={{ display: "flex", justifyContent: "center", py: 2 }}
            data-testid="goal-conversation-toc-loading"
          >
            <CircularProgress size={24} />
          </Box>
        ) : orderedConversations.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            fontStyle="italic"
            sx={{ py: 1 }}
            data-testid="goal-conversation-toc-empty"
          >
            No conversations yet.
          </Typography>
        ) : (
          <List dense disablePadding aria-label="Goal conversations">
            {orderedConversations.map((conversation, index) => {
              const isActive = conversation.id === activeConversationId;
              const isGoalPm =
                conversation.workflowName === WorkflowName.GoalPm;
              const canArchive = Boolean(
                !isGoalPm &&
                currentUserId &&
                conversation.createdBy === currentUserId,
              );
              return (
                <ListItemButton
                  key={conversation.id}
                  selected={isActive}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onConversationSelect(conversation.id)}
                  data-testid={`goal-conversation-toc-row-${conversation.id}`}
                  sx={{ pl: isGoalPm ? 2 : 4 }}
                >
                  <ListItemText
                    primary={
                      isGoalPm
                        ? "Goal PM Conversation"
                        : conversationLabel(conversation, index)
                    }
                    secondary={new Date(
                      conversation.updatedAt || conversation.createdAt,
                    ).toLocaleString()}
                    primaryTypographyProps={{ noWrap: true }}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                  {canArchive && (
                    <IconButton
                      aria-label={`Archive ${conversationLabel(conversation, index)}`}
                      title="Archive conversation"
                      size="small"
                      disabled={deleteConversation.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenArchive(conversation);
                      }}
                    >
                      <ArchiveOutlinedIcon fontSize="small" />
                    </IconButton>
                  )}
                </ListItemButton>
              );
            })}
          </List>
        )}
      </Box>

      <Dialog
        open={Boolean(conversationToArchive)}
        onClose={handleCloseArchive}
        aria-labelledby="goal-archive-conversation-title"
      >
        <DialogTitle id="goal-archive-conversation-title">
          Archive conversation?
        </DialogTitle>
        <DialogContent>
          <Typography>
            “{archivedTitle}” will be removed from this goal’s conversation
            list. You can restore it later. No messages will be deleted.
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
            onClick={() => void handleConfirmArchive()}
            disabled={deleteConversation.isPending}
            variant="contained"
          >
            {deleteConversation.isPending ? "Archiving…" : "Archive"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
