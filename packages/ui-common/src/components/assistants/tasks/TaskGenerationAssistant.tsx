import { useModalState } from "../../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../../Modals/FunctionalDialog";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import AssistantIcon from "@mui/icons-material/AutoAwesome";
import {
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import type {
  ConversationResponseDto,
  CreateConversationDto,
} from "../../../api";
import {
  WorkflowName,
  InitiationType as InitiationTypeEnum,
  ConversationStatus as ConversationStatusEnum,
} from "../../../api";
import { useUserIdentity } from "../../../hooks/useUserIdentity";
import { useConversation } from "../../../data/hooks/useConversation";
import { useCreateConversation } from "../../../data/hooks/useCreateConversation";
import { useDeleteConversation } from "../../../data/hooks/useDeleteConversation";
import { useProject } from "../../../data/hooks/useProject";
import { KEYS } from "../../../i18n/keys";
import { log } from "../../../utils/logger";
import type { LogCategory } from "../../../utils/logger";
import { WorkGenerationConversation } from "../../shared/WorkGenerationConversation";

const LOG_CATEGORY: LogCategory = "general";

interface TaskGenerationAssistantProps {
  parentTaskId?: string;
  projectId: string;
  initiativeId: string;
  initiativeName: string;
  onConversationCreated?: (conversation: ConversationResponseDto) => void;
  onError?: (error: unknown) => void;
}

export const TaskGenerationAssistant: React.FC<
  TaskGenerationAssistantProps
> = ({
  parentTaskId,
  projectId,
  initiativeId,
  initiativeName: _initiativeName,
  onConversationCreated,
  onError,
}) => {
  const { t } = useTranslation();
  const userIdentity = useUserIdentity();
  const organizationId = userIdentity?.currentOrgId || "";
  const [deleteDialogOpen, setDeleteDialogOpen, deleteDialogOpenOwnerKey] =
    useModalState(false);
  const [activeConversation, setActiveConversation] =
    useState<ConversationResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWaitingForWorkflow, setIsWaitingForWorkflow] = useState(false);
  const [showConversation, setShowConversation] = useState(false);

  // Get project for conversation title
  const { data: project } = useProject(organizationId, projectId);

  // Get existing conversation for this initiative
  const { data: existingConversation } = useConversation(
    organizationId,
    projectId,
    {
      workflowName: "task-generation",
      workflowAboutId: parentTaskId || initiativeId,
      // TODO need statuses
      // status: "IN_PROGRESS",
    },
    {
      enablePolling: isWaitingForWorkflow,
      pollingInterval: 2000,
      maxRetries: 10,
      includeSuggestionDecisions: true,
      enabled: !!organizationId && !!projectId,
    },
  );

  // Effective conversation to display
  let conversation: ConversationResponseDto | null = null;

  if (
    existingConversation &&
    !["COMPLETED", "FAILED", "DELETED"].includes(existingConversation.status)
  ) {
    conversation = existingConversation;
  } else {
    conversation = activeConversation;
  }

  // Build conversation DTO
  const buildConversationDto = useCallback((): CreateConversationDto => {
    if (!parentTaskId && !initiativeId) {
      throw new Error("Missing parent id");
    }
    return {
      projectId,
      organizationId,
      initiatedBy: InitiationTypeEnum.User,
      status: ConversationStatusEnum.Started,
      workflowName: WorkflowName.TaskGeneration,
      triggerEvent: "task_generation_requested",
      title: `Task Generation: ${project?.name || "Initiative"}`,
      workflowAboutId: parentTaskId || initiativeId,
      workflowAboutType: parentTaskId ? "task" : "initiative",
      context: {
        aboutId: parentTaskId || initiativeId,
        aboutType: parentTaskId ? "task" : "initiative",
      },
    };
  }, [projectId, organizationId, parentTaskId, project?.name, initiativeId]);

  // Create conversation mutation
  const createConversationMutation = useCreateConversation({
    onSuccess: (conv: ConversationResponseDto) => {
      setIsWaitingForWorkflow(false);
      setActiveConversation(conv);
      setShowConversation(true);
      log.info(LOG_CATEGORY, "Task generation conversation created", {
        conversationId: conv.id,
        initiativeId,
      });
      onConversationCreated?.(conv);
    },
    onError: (err: unknown) => {
      setIsWaitingForWorkflow(false);
      const message =
        err instanceof Error
          ? err.message
          : t(KEYS.tasks.assistant.error) || "Failed to start task generation";
      setError(message);
      log.error(LOG_CATEGORY, "Failed to create task generation conversation", {
        error: err instanceof Error ? err.message : String(err),
        initiativeId,
      });
      onError?.(err);
    },
  });

  // Handle start button click
  const handleStartAssistant = useCallback(() => {
    setError(null);

    // If we already have an existing conversation, just show it
    if (existingConversation) {
      setActiveConversation(existingConversation);
      setShowConversation(true);
      onConversationCreated?.(existingConversation);
      return;
    }

    // Create new conversation
    if (!organizationId || !projectId) {
      log.error(
        LOG_CATEGORY,
        "Missing required data for conversation creation",
        {
          hasOrgId: !!organizationId,
          hasProjectId: !!projectId,
        },
      );
      return;
    }

    setIsWaitingForWorkflow(true);
    log.info(LOG_CATEGORY, "Starting task generation conversation", {
      initiativeId,
      projectId,
      organizationId,
    });

    createConversationMutation.mutate({
      organizationId,
      projectId,
      conversationDto: buildConversationDto(),
    });
  }, [
    existingConversation,
    organizationId,
    projectId,
    initiativeId,
    createConversationMutation,
    buildConversationDto,
    onConversationCreated,
  ]);

  // Toggle conversation visibility
  const handleToggleConversation = useCallback(() => {
    setShowConversation((prev) => !prev);
  }, []);

  const { mutate: deleteConversation } = useDeleteConversation({
    onSuccess: () => {
      setDeleteDialogOpen(false);
      setActiveConversation(null);
      setShowConversation(false);
    },
    onError: (deleteError) => {
      setDeleteDialogOpen(false);
      onError?.(deleteError);
    },
  });

  const handleDeleteConfirm = () => {
    if (conversation && organizationId) {
      deleteConversation({
        organizationId,
        projectId,
        conversationId: conversation.id,
      });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  const handleCreateNewConversation = useCallback(async () => {
    setActiveConversation(null);
    setIsWaitingForWorkflow(true);
    createConversationMutation.mutate({
      organizationId,
      projectId,
      conversationDto: buildConversationDto(),
    });
  }, [
    createConversationMutation,
    buildConversationDto,
    organizationId,
    projectId,
  ]);

  const isLoading =
    isWaitingForWorkflow || createConversationMutation.isPending;

  return (
    <Box>
      {/* Start/Toggle Button */}
      <Button
        variant="outlined"
        startIcon={<AssistantIcon />}
        onClick={conversation ? handleToggleConversation : handleStartAssistant}
        fullWidth
        disabled={isLoading}
        sx={{
          mt: 2,
          color: "heyhey.main",
          borderColor: "heyhey.main",
          "&:hover": {
            borderColor: "heyhey.dark",
            backgroundColor: "heyhey.light",
          },
        }}
        data-testid="workitem-generation-assistant-button"
      >
        {isLoading ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={16} color="inherit" />
            <span>
              {createConversationMutation.isPending
                ? "Starting..."
                : "Waiting for workflow..."}
            </span>
          </Box>
        ) : conversation ? (
          showConversation ? (
            "Hide Work Item Generation"
          ) : (
            "Show Work Item Generation"
          )
        ) : (
          t(KEYS.tasks.assistant.button)
        )}
      </Button>

      {/* Error display */}
      {error && (
        <Box sx={{ mt: 2 }}>
          <Box
            sx={{
              p: 2,
              backgroundColor: "error.light",
              borderRadius: 1,
              color: "error.contrastText",
            }}
          >
            {error}
          </Box>
        </Box>
      )}

      {/* Conversation viewer */}
      {conversation && showConversation && (
        <Box
          sx={{ mt: 2, border: 1, borderColor: "grey.300", borderRadius: 1 }}
        >
          <WorkGenerationConversation
            workType="workitem"
            projectId={projectId}
            organizationId={organizationId}
            workflowAboutId={initiativeId}
            conversation={conversation}
            onCreateNewConversation={handleCreateNewConversation}
          />
        </Box>
      )}

      <Dialog
        ownerKey={deleteDialogOpenOwnerKey}
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-conversation-dialog-title"
        aria-describedby="delete-conversation-dialog-description"
      >
        <DialogTitle id="delete-conversation-dialog-title">
          Delete Conversation
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-conversation-dialog-description">
            Are you sure you want to delete this conversation? This action
            cannot be undone and will terminate the associated workflow.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button
            onClick={handleDeleteConfirm}
            color="warning"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
