import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  ConversationStatus,
  type ConversationResponseDto,
} from "@hey-hey/ui-common/api";
import {
  useConversations,
  useDeleteConversation,
} from "@hey-hey/ui-common/data";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";

const REPOSITORY_IMPORT_STATUSES = [
  ConversationStatus.NotStarted,
  ConversationStatus.Started,
  ConversationStatus.InProgress,
  ConversationStatus.GeneratingResponse,
  ConversationStatus.Completed,
  ConversationStatus.Failed,
  ConversationStatus.Recoverable,
];

const isRepositoryImportConversation = (
  conversation: ConversationResponseDto,
  projectId: string,
) =>
  (conversation.workflowName === "repository-import" ||
    (conversation.workflowName === "onboarding" &&
      conversation.triggerEvent === "services_import")) &&
  conversation.workflowAboutType === "project" &&
  conversation.workflowAboutId === projectId &&
  conversation.projectId === projectId;

const isCompletedImportConversation = (
  conversation: Pick<ConversationResponseDto, "status">,
) => conversation.status === ConversationStatus.Completed;

export interface RepositoryImportConversationsProps {
  organizationId: string;
  projectId: string;
  refreshToken?: number;
  onOpen: (conversationId: string) => void;
}

export const RepositoryImportConversations: React.FC<
  RepositoryImportConversationsProps
> = ({ organizationId, projectId, refreshToken = 0, onOpen }) => {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [conversationPendingDelete, setConversationPendingDelete] =
    useState<ConversationResponseDto | null>(null);
  const { data, isLoading, error, refetch } = useConversations(
    organizationId,
    projectId,
    {
      workflowName: ["repository-import", "onboarding"],
      workflowAboutId: projectId,
      workflowAboutType: "project",
      statuses: REPOSITORY_IMPORT_STATUSES,
    },
  );
  const deleteConversation = useDeleteConversation({
    onSuccess: () => {
      setDeleteError(null);
      setConversationPendingDelete(null);
      void refetch();
    },
    onError: (deleteFailure) => setDeleteError(deleteFailure.message),
  });

  const handleRequestDelete = (conversation: ConversationResponseDto): void => {
    if (deleteConversation.isPending) {
      return;
    }

    setConversationPendingDelete(conversation);
  };

  const handleCloseDeleteDialog = (): void => {
    if (!deleteConversation.isPending) {
      setConversationPendingDelete(null);
    }
  };

  const handleConfirmDelete = (): void => {
    if (!conversationPendingDelete || deleteConversation.isPending) {
      return;
    }

    const currentConversation = (data ?? []).find(
      ({ id }) => id === conversationPendingDelete.id,
    );
    if (
      !currentConversation ||
      !isRepositoryImportConversation(currentConversation, projectId) ||
      isCompletedImportConversation(currentConversation)
    ) {
      setConversationPendingDelete(null);
      return;
    }

    deleteConversation.mutate({
      organizationId,
      projectId,
      conversationId: conversationPendingDelete.id,
    });
  };

  const imports = useMemo(
    () =>
      (data ?? [])
        .filter((conversation) =>
          isRepositoryImportConversation(conversation, projectId),
        )
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        ),
    [data, projectId],
  );
  React.useEffect(() => {
    if (refreshToken > 0) {
      void refetch();
    }
  }, [refreshToken, refetch]);

  if (isLoading && (!data || data.length === 0)) {
    return (
      <Stack alignItems="center" spacing={2} sx={{ py: 6 }}>
        <CircularProgress size={28} />
        <Typography color="text.secondary">Loading imports...</Typography>
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load repository imports</Alert>;
  }

  if (imports.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography variant="h6">No repository imports yet</Typography>
        <Typography color="text.secondary">
          Repository imports you start will appear here.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {deleteError && <Alert severity="error">{deleteError}</Alert>}
      <List disablePadding>
        {imports.map((conversation) => {
          return (
            <RepositoryImportConversationRow
              conversation={conversation}
              isDeletePending={deleteConversation.isPending}
              key={conversation.id}
              onDelete={() => handleRequestDelete(conversation)}
              onOpen={onOpen}
            />
          );
        })}
      </List>
      <Dialog
        open={conversationPendingDelete !== null}
        onClose={handleCloseDeleteDialog}
        aria-labelledby="delete-repository-import-title"
      >
        <DialogTitle id="delete-repository-import-title">
          Delete repository import?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete “{conversationPendingDelete?.title ?? "repository import"}
            ”? This will permanently remove the import conversation and its
            messages.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseDeleteDialog}
            disabled={deleteConversation.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleConfirmDelete}
            disabled={deleteConversation.isPending}
          >
            {deleteConversation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

interface RepositoryImportConversationRowProps {
  conversation: ConversationResponseDto;
  isDeletePending: boolean;
  onDelete: () => void;
  onOpen: (conversationId: string) => void;
}

const RepositoryImportConversationRow: React.FC<
  RepositoryImportConversationRowProps
> = ({ conversation, isDeletePending, onDelete, onOpen }) => {
  const completed = isCompletedImportConversation(conversation);

  return (
    <ListItem
      divider
      secondaryAction={
        !completed ? (
          <IconButton
            aria-label={`Delete ${conversation.title ?? "repository import"}`}
            disabled={isDeletePending}
            onClick={onDelete}
          >
            <DeleteOutlineIcon />
          </IconButton>
        ) : null
      }
    >
      <ListItemText
        primary={
          <Link
            component="button"
            type="button"
            onClick={() => onOpen(conversation.id)}
            sx={{ font: "inherit", textAlign: "left" }}
          >
            {conversation.title ?? "Repository import"}
          </Link>
        }
        secondary={`${conversation.status.replace(/_/g, " ")} · Updated ${new Date(
          conversation.updatedAt,
        ).toLocaleString()} · Started ${new Date(
          conversation.createdAt,
        ).toLocaleString()}`}
      />
    </ListItem>
  );
};
