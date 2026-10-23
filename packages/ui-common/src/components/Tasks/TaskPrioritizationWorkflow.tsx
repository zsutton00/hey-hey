/**
 * Task Prioritization Workflow Component
 *
 * Renders inside ActionsCapsule when "Prioritize Tasks" action is expanded.
 * Automatically starts/resumes task prioritization workflow for the initiative.
 */

import { Box, CircularProgress, Typography } from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationResponseDto, CreateConversationDto } from "../../api";
import {
  ConversationStatus as ConversationStatusEnum,
  InitiationType as InitiationTypeEnum,
} from "../../api";
import { useConversationByWorkflow } from "../../data/hooks/useConversationByWorkflow";
import { useCreateConversation } from "../../data/hooks/useCreateConversation";
import type { LogCategory } from "../../utils/logger";
import { log } from "../../utils/logger";
import { WorkGenerationConversation } from "../shared/WorkGenerationConversation";

const LOG_CATEGORY: LogCategory = "general";

export interface TaskPrioritizationWorkflowProps {
  /** Project ID */
  projectId: string;
  /** Organization ID */
  organizationId: string;
}

/**
 * Workflow component for prioritizing tasks in an initiative.
 * Used as the renderContent in TasksCapsule CapsuleAction.
 * Handles conversation creation - auto-starts when mounted.
 */
export const TaskPrioritizationWorkflow: React.FC<
  TaskPrioritizationWorkflowProps
> = ({ projectId, organizationId }) => {
  const hasStartedRef = useRef(false);
  const [activeConversation, setActiveConversation] =
    useState<ConversationResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check for existing conversation by workflow name
  const {
    data: existingConversation,
    isFetched,
    error: fetchError,
  } = useConversationByWorkflow(
    organizationId,
    projectId,
    "task-prioritization",
    {
      enabled: !!organizationId && !!projectId,
    }
  );

  // Update error state if fetch fails
  React.useEffect(() => {
    if (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to fetch existing conversation"
      );
    }
  }, [fetchError]);

  // Build conversation DTO
  const buildConversationDto = useCallback(
    (): CreateConversationDto => ({
      projectId,
      organizationId,
      initiatedBy: InitiationTypeEnum.User,
      status: ConversationStatusEnum.Started,
      workflowName: "task-prioritization",
      triggerEvent: "task_prioritization_requested",
      title: `Task Prioritization`,
      context: {},
    }),
    [projectId, organizationId]
  );

  // Create conversation mutation
  const createConversationMutation = useCreateConversation({
    onSuccess: (conversation: ConversationResponseDto) => {
      setActiveConversation(conversation);
      log.info(LOG_CATEGORY, "Task prioritization conversation created", {
        conversationId: conversation.id,
      });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to start task prioritization";
      setError(message);
      log.error(
        LOG_CATEGORY,
        "Failed to create task prioritization conversation",
        {
          error: err instanceof Error ? err.message : String(err),
        }
      );
    },
  });

  // Auto-start conversation when ready
  useEffect(() => {
    if (
      isFetched &&
      !existingConversation &&
      !activeConversation &&
      !hasStartedRef.current &&
      !createConversationMutation.isPending &&
      organizationId &&
      projectId
    ) {
      hasStartedRef.current = true;

      log.info(LOG_CATEGORY, "Auto-starting task prioritization conversation", {
        projectId,
        organizationId,
      });

      createConversationMutation.mutate({
        organizationId,
        projectId,
        conversationDto: buildConversationDto(),
      });
    }
  }, [
    isFetched,
    existingConversation,
    activeConversation,
    createConversationMutation,
    buildConversationDto,
    organizationId,
    projectId,
  ]);

  // Effective conversation to display
  const conversation = existingConversation || activeConversation;

  const handleCreateNewConversation = useCallback(async () => {
    hasStartedRef.current = false;
    setActiveConversation(null);
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

  // Show loading while waiting
  if (!conversation && !error) {
    return (
      <Box
        data-testid="task-prioritization-workflow"
        sx={{
          height: 500,
          width: "calc(100% - 40px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  // Show error if any
  if (error) {
    return (
      <Box
        data-testid="task-prioritization-workflow"
        sx={{
          height: 500,
          width: "calc(100% - 40px)",
          p: 2,
        }}
      >
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box
      data-testid="task-prioritization-workflow"
      sx={{
        height: 800,
        width: "calc(100% - 40px)",
      }}
    >
      <WorkGenerationConversation
        workType="workitem"
        projectId={projectId}
        organizationId={organizationId}
        conversation={conversation}
        slotProps={{
          paper: { elevation: 0, sx: { p: 0, border: "none" } },
        }}
        onCreateNewConversation={handleCreateNewConversation}
      />
    </Box>
  );
};
