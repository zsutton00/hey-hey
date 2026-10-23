/**
 * Task Generation Content Component
 *
 * Auto-creates and manages task generation conversations for any entity type
 * (design docs, tasks, initiatives). Handles conversation lifecycle:
 * - Auto-create if doesn't exist
 * - Poll for readiness
 * - Render conversation viewer or task links based on menu selection
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import type {
  ConversationResponseDto,
  CreateConversationDto,
} from "../../../api";
import {
  ConversationStatus as ConversationStatusEnum,
  InitiationType as InitiationTypeEnum,
} from "../../../api";
import { useConversation } from "../../../data/hooks/useConversation";
import { useCreateConversation } from "../../../data/hooks/useCreateConversation";
import { log } from "../../../utils/logger";
import type { LogCategory } from "../../../utils/logger";
import { WorkGenerationConversation } from "../../shared/WorkGenerationConversation";
import { FeatureSelector } from "../../Selectors/FeatureSelector";

const LOG_CATEGORY: LogCategory = "general";

/**
 * Type of entity that tasks are being generated for
 */
export type TaskGenerationAboutType = "design-doc" | "task" | "initiative";

/**
 * Props for the TaskGenerationContent component
 */
export interface TaskGenerationContentProps {
  /** ID of the item to generate tasks for */
  aboutId: string;
  /** Type of item (design-doc, task, initiative) */
  aboutType: TaskGenerationAboutType;
  /** Optional title for context */
  aboutTitle?: string;
  /** Project ID */
  projectId: string;
  /** Organization ID */
  organizationId: string;
  /** Optional status for conditional behavior */
  status?: string;
}

/**
 * Component that manages task generation workflow
 *
 * Responsibilities:
 * - Auto-create conversation if doesn't exist
 * - Poll for conversation readiness
 * - Switch between "Create Tasks" workflow and "View Related Tasks" views
 * - Handle loading and error states
 */
export const TaskGenerationContent: React.FC<TaskGenerationContentProps> = ({
  aboutId,
  aboutType,
  aboutTitle,
  projectId,
  organizationId,
  status: _status,
}) => {
  const hasStartedRef = useRef(false);
  const [activeConversation, setActiveConversation] =
    useState<ConversationResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWaitingForWorkflow, setIsWaitingForWorkflow] = useState(false);
  const [selectedInitiativeId, setSelectedInitiativeId] = useState<
    string | null
  >(null);

  const workflowAboutId =
    aboutType === "design-doc" ? selectedInitiativeId ?? undefined : aboutId;
  const workflowAboutType = aboutType === "task" ? "task" : "initiative";
  const canStartWorkflow = Boolean(
    organizationId && projectId && workflowAboutId
  );

  // Check for existing conversation
  const { data: existingConversation, isFetched } = useConversation(
    organizationId,
    projectId,
    {
      workflowName: "task-generation",
      workflowAboutId,
    },
    {
      enablePolling: isWaitingForWorkflow,
      pollingInterval: 2000,
      maxRetries: 10,
      includeSuggestionDecisions: true,
      enabled: canStartWorkflow,
    }
  );

  // Build conversation DTO
  const buildConversationDto = useCallback((): CreateConversationDto => {
    if (!workflowAboutId) {
      throw new Error("Task generation requires workflowAboutId");
    }

    return {
      projectId,
      organizationId,
      initiatedBy: InitiationTypeEnum.User,
      status: ConversationStatusEnum.Started,
      workflowName: "task-generation",
      triggerEvent: "task_generation_requested",
      title: `Task Generation: ${aboutTitle || "Work Item"}`,
      workflowAboutId,
      workflowAboutType,
      context: {
        aboutId: workflowAboutId,
        aboutType: workflowAboutType,
      },
    };
  }, [
    projectId,
    organizationId,
    aboutTitle,
    workflowAboutId,
    workflowAboutType,
  ]);

  // Create conversation mutation
  const createConversationMutation = useCreateConversation({
    onSuccess: (conversation: ConversationResponseDto) => {
      setIsWaitingForWorkflow(false);
      setActiveConversation(conversation);
      log.info(LOG_CATEGORY, "Task generation conversation created", {
        conversationId: conversation.id,
        aboutId,
        aboutType,
      });
    },
    onError: (err: unknown) => {
      setIsWaitingForWorkflow(false);
      const message =
        err instanceof Error
          ? err.message
          : "Failed to start task generation workflow";
      setError(message);
      log.error(LOG_CATEGORY, "Failed to create task generation conversation", {
        error: err instanceof Error ? err.message : String(err),
        aboutId,
        aboutType,
      });
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
      canStartWorkflow
    ) {
      hasStartedRef.current = true;
      setIsWaitingForWorkflow(true);

      log.info(LOG_CATEGORY, "Auto-starting task generation conversation", {
        aboutId,
        aboutType,
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
    canStartWorkflow,
    aboutId,
    aboutType,
    organizationId,
    projectId,
  ]);

  useEffect(() => {
    hasStartedRef.current = false;
    setActiveConversation(null);
    setError(null);
    setIsWaitingForWorkflow(false);

    if (aboutType !== "design-doc") {
      setSelectedInitiativeId(null);
    }
  }, [aboutType, workflowAboutId]);

  // Effective conversation to display
  const conversation = existingConversation || activeConversation;

  const handleCreateNewConversation = useCallback(
    async (_draftText: string) => {
      hasStartedRef.current = false;
      setActiveConversation(null);
      setIsWaitingForWorkflow(true);
      createConversationMutation.mutate({
        organizationId,
        projectId,
        conversationDto: buildConversationDto(),
      });
    },
    [
      createConversationMutation,
      buildConversationDto,
      organizationId,
      projectId,
    ]
  );

  if (aboutType === "design-doc" && !selectedInitiativeId) {
    return (
      <Box
        data-testid="task-generation-content"
        sx={{
          height: 500,
          width: "calc(100% - 40px)",
          p: 2,
        }}
      >
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Choose an initiative to generate tasks
        </Typography>
        <FeatureSelector
          organizationId={organizationId}
          projectId={projectId}
          value={selectedInitiativeId}
          onChange={(initiativeId) => setSelectedInitiativeId(initiativeId)}
        />
      </Box>
    );
  }

  // Show loading while waiting for conversation
  if (!conversation && !error) {
    return (
      <Box
        data-testid="task-generation-content"
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
        data-testid="task-generation-content"
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

  // Create tasks - show workflow
  if (!conversation) {
    return null;
  }

  return (
    <Box
      data-testid="task-generation-content"
      sx={{
        height: 800,
        width: "calc(100% - 40px)",
      }}
    >
      <WorkGenerationConversation
        workType="workitem"
        projectId={projectId}
        organizationId={organizationId}
        workflowAboutId={workflowAboutId}
        conversation={conversation}
        onCreateNewConversation={handleCreateNewConversation}
      />
    </Box>
  );
};
