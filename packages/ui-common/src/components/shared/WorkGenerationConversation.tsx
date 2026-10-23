import { Box } from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import type { ConversationResponseDto } from "../../api";
import { useProject } from "../../data/hooks/useProject";
import { log } from "../../utils/logger";
import type { LogCategory } from "../../utils/logger";
import { TrackingProvider } from "../../contexts/TrackingContext";
import {
  ConversationViewer,
  DISABLED_CONVERSATION_SCROLL_POLICY,
  type ConversationViewerSlotProps,
} from "../Conversation/ConversationViewer";

const LOG_CATEGORY: LogCategory = "general";

export interface WorkGenerationConversationProps {
  workType: "workstream" | "workitem";
  projectId: string;
  organizationId: string;
  conversationId?: string; // For workstreams (onboarding context)
  workflowAboutId?: string; // For work items (initiative context)
  /** Conversation passed from parent (when parent manages creation) */
  conversation?: ConversationResponseDto | null;
  onConversationUpdated?: () => void;
  /** Props for slot components (passed to ConversationViewer) */
  slotProps?: ConversationViewerSlotProps;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
}

/**
 * Displays an existing work generation conversation.
 * Does NOT create conversations - that's the parent's responsibility.
 */
export const WorkGenerationConversation: React.FC<
  WorkGenerationConversationProps
> = ({
  workType,
  projectId,
  organizationId,
  conversationId,
  workflowAboutId,
  conversation: conversationProp,
  onConversationUpdated,
  slotProps,
  onCreateNewConversation,
}) => {
  const [showConversation, setShowConversation] = useState(false);

  const conversation = conversationProp ?? null;

  // Load project data for the conversation viewer
  const { data: project, refetch: refetchProject } = useProject(
    organizationId,
    projectId
  );

  // Auto-show conversation when we find one
  useEffect(() => {
    if (conversation && !showConversation) {
      setShowConversation(true);
    }
  }, [conversation, showConversation]);

  // Handle conversation updates
  const handleConversationUpdated = useCallback(async () => {
    log.info(LOG_CATEGORY, "Conversation updated, refreshing data", {
      conversationId: conversation?.id,
      requestedConversationId: conversationId,
      projectId: project?.id,
      workType,
      workflowAboutId,
    });

    try {
      await refetchProject();
      log.info(LOG_CATEGORY, "Project refresh completed", {
        conversationId: conversation?.id,
        projectId: project?.id,
        workType,
      });
    } catch (error) {
      log.error(LOG_CATEGORY, "Failed to refresh project data", {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        projectId: project?.id,
        workType,
      });
    }

    // Notify parent
    onConversationUpdated?.();
  }, [
    conversation?.id,
    project?.id,
    workType,
    workflowAboutId,
    refetchProject,
    onConversationUpdated,
    conversationId,
  ]);

  // Nothing to display if no conversation
  if (!conversation || !project) {
    return null;
  }

  return (
    <Box>
      {showConversation && (
        <TrackingProvider
          context={{
            page: {
              name: `${workType}-generation-assistant`,
              path: `/${workType}-generation/conversation-viewer`,
              section: "conversation-viewer",
            },
            workflow: {
              id: conversation.id,
              name: conversation.workflowName || `${workType}-generation`,
            },
            project: {
              id: project.id,
              name: project.name,
            },
          }}
        >
          <ConversationViewer
            scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
            animationType="minimal"
            conversation={conversation}
            project={project}
            showNavigation={false}
            onConversationUpdated={handleConversationUpdated}
            onCreateNewConversation={
              onCreateNewConversation
                ? async () => {
                    await onCreateNewConversation("");
                  }
                : undefined
            }
            slotProps={slotProps}
          />
        </TrackingProvider>
      )}
    </Box>
  );
};
