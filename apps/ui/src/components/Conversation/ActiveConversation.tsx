import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  ConversationStatus as ConversationStatusEnum,
  InitiationType,
} from "@hey-hey/ui-common/api";
import type { CreateConversationDto } from "@hey-hey/ui-common/api";
import {
  ConversationViewer,
  DISABLED_CONVERSATION_SCROLL_POLICY,
  type OnboardingReplySubmission,
} from "@hey-hey/ui-common/components";
import {
  useConversation,
  useCreateConversation,
  useDeleteConversation,
  useProject,
  useSubmitOnboardingReply,
} from "@hey-hey/ui-common/data";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getWorkflowLabel } from "../../utils/conversationLabels";

export interface ActiveConversationProps {
  organizationId: string;
  projectId: string;
  conversationId: string | null;
  onBack: () => void;
  onDeleted?: () => void;
  onPresentationLoaded?: (label: string) => void;
}

export const ActiveConversation: React.FC<ActiveConversationProps> = ({
  organizationId,
  projectId,
  conversationId,
  onBack,
  onDeleted,
  onPresentationLoaded,
}) => {
  const [
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isDeleteDialogOpenOwnerKey,
  ] = useModalState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const { data: project } = useProject(organizationId, projectId, {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  const {
    data: conversation,
    isLoading,
    error,
  } = useConversation(
    organizationId,
    projectId,
    { conversationId: conversationId ?? "" },
    {
      enabled: !!organizationId && !!projectId && !!conversationId,
    },
  );

  const { mutate: submitOnboardingReply } = useSubmitOnboardingReply();
  const handleSubmitOnboardingReply = useCallback(
    async (submission: OnboardingReplySubmission): Promise<void> => {
      if (!conversation || conversation.workflowName !== "onboarding") {
        throw new Error(
          "The onboarding reply cannot be submitted for this conversation.",
        );
      }

      await submitOnboardingReply({
        organizationId,
        projectId,
        conversationId: conversation.id,
        ...submission,
      });
    },
    [conversation, organizationId, projectId, submitOnboardingReply],
  );

  const deleteConversation = useDeleteConversation({
    onSuccess: () => {
      setIsDeleteDialogOpen(false);
      setDeleteError(null);
      onDeleted?.();
      onBack();
    },
    onError: (err) => {
      setIsDeleteDialogOpen(false);
      setDeleteError(err.message || "Failed to delete conversation");
    },
  });

  useEffect(() => {
    if (!conversation) return;
    onPresentationLoaded?.(
      conversation.title || getWorkflowLabel(conversation.workflowName),
    );
  }, [conversation, onPresentationLoaded]);

  const handleOpenDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    if (!deleteConversation.isPending) {
      setIsDeleteDialogOpen(false);
    }
  }, [deleteConversation.isPending]);

  const handleConfirmDelete = useCallback(() => {
    if (!conversation) return;
    deleteConversation.mutate({
      organizationId,
      projectId,
      conversationId: conversation.id,
    });
  }, [conversation, deleteConversation, organizationId, projectId]);

  const createConversation = useCreateConversation({
    onSuccess: () => {
      onBackRef.current();
    },
  });

  const handleCreateNewConversation = useCallback(async () => {
    if (!conversation) return;

    const dto = {
      organizationId,
      projectId,
      initiatedBy: InitiationType.User,
      status: ConversationStatusEnum.Started,
      workflowName: conversation.workflowName,
      workflowAboutId: conversation.workflowAboutId,
      workflowAboutType: conversation.workflowAboutType,
    } as CreateConversationDto;

    createConversation.mutate({
      organizationId,
      projectId,
      conversationDto: dto,
    });
  }, [conversation, createConversation, organizationId, projectId]);

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Button variant="text" onClick={onBack}>
          Back to conversations
        </Button>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {conversation && (
            <Typography variant="subtitle1" color="text.secondary">
              {conversation.title ||
                getWorkflowLabel(conversation.workflowName)}
            </Typography>
          )}
          <Button
            color="error"
            variant="outlined"
            onClick={handleOpenDeleteDialog}
            disabled={!conversation || deleteConversation.isPending}
          >
            {deleteConversation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </Stack>
      </Box>

      {deleteError && <Alert severity="error">{deleteError}</Alert>}

      {error && (
        <Alert severity="error">
          Failed to load conversation. Please try again later.
        </Alert>
      )}

      {isLoading && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 240,
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Loading conversation...
          </Typography>
        </Box>
      )}

      {conversation && project && !isLoading && (
        <Box
          sx={{
            width: "100%",
            "& [data-conversation-content]": {
              width: "100% !important",
              maxWidth: "100% !important",
            },
            "& .initiative-conversation-viewer": {
              width: "100%",
              maxWidth: "100%",
            },
          }}
        >
          <ConversationViewer
            animationType="minimal"
            conversation={conversation}
            project={project}
            scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
            showNavigation={false}
            enableHistory={false}
            onCreateNewConversation={handleCreateNewConversation}
            onSubmitOnboardingReply={
              conversation.workflowName === "onboarding"
                ? handleSubmitOnboardingReply
                : undefined
            }
          />
        </Box>
      )}

      <Dialog
        ownerKey={isDeleteDialogOpenOwnerKey}
        open={isDeleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        aria-labelledby="delete-conversation-title"
      >
        <DialogTitle id="delete-conversation-title">
          Delete conversation?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will permanently remove the conversation and its messages.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog}>Cancel</Button>
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
