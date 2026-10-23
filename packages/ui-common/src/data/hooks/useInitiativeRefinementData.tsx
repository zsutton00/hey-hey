import { useCallback, useState, useEffect, useRef } from "react";
import { useProject } from "./useProject";
import { useConversation } from "./useConversation";
import { useInitiative } from "./useInitiative";
import { useInitiatives } from "./useInitiatives";
import { useConversationPolling } from "./useConversationPolling";
import { platformClient } from "../../clients/serviceClients";
import type {
  ConversationResponseDto,
  InitiativeResponseDto,
  StartInitiativeRefinementRequest,
} from "../../api";

interface UseInitiativeRefinementDataParams {
  organizationId: string;
  projectId: string;
  initiativeId: string;
}

interface UseInitiativeRefinementDataReturn {
  // Project data
  project: ReturnType<typeof useProject>["data"];
  isProjectLoading: boolean;
  projectError: ReturnType<typeof useProject>["error"];

  // Initiative data (from new Jotai system)
  initiativeData: ReturnType<typeof useInitiative>["data"];
  isInitiativeLoading: boolean;
  initiativeError: ReturnType<typeof useInitiative>["error"];
  refetchInitiative: ReturnType<typeof useInitiative>["refetch"];

  // Refinement data (using simple state management)
  refinementData: { conversationId: string; workflowId?: string } | null;
  isStartingRefinement: boolean;
  refinementError: Error | null;

  // Conversation data (using new data layer)
  conversation: ConversationResponseDto | null;
  isConversationLoading: boolean;
  conversationError: ReturnType<typeof useConversation>["error"];
  refetchConversation: () => Promise<void>;

  // Conversation initiatives data (using Jotai collection system)
  conversationInitiatives: InitiativeResponseDto[];
  isConversationInitiativesLoading: boolean;
  conversationInitiativesError: Error | null;
  refetchConversationInitiatives: () => Promise<InitiativeResponseDto[] | null>;

  // Computed states
  isWaitingForFirstMessage: boolean;
  isLoading: boolean;
  hasError: boolean;
}

/**
 * Custom hook that consolidates all data fetching for the InitiativeEditor.
 * Removed TanStack Query dependencies and uses simpler state management.
 */
export const useInitiativeRefinementData = ({
  organizationId,
  projectId,
  initiativeId,
}: UseInitiativeRefinementDataParams): UseInitiativeRefinementDataReturn => {
  // Load project data (still uses old hook for now)
  const {
    data: project,
    isLoading: isProjectLoading,
    error: projectError,
  } = useProject(organizationId, projectId);

  // Load initiative data using NEW Jotai collection system
  const {
    data: initiativeData,
    isLoading: isInitiativeLoading,
    error: initiativeError,
    refetch: refetchInitiative,
  } = useInitiative(organizationId, initiativeId, {
    enabled: !!organizationId && !!initiativeId,
  });

  // Simple state management for refinement data
  const [refinementData, setRefinementData] = useState<{
    conversationId: string;
    workflowId?: string;
  } | null>(null);
  const isStartingRefinementRef = useRef(false);
  const [refinementError, setRefinementError] = useState<Error | null>(null);

  // Start initiative refinement to get conversation ID
  useEffect(() => {
    if (
      !organizationId ||
      !initiativeId ||
      !projectId ||
      refinementData ||
      isStartingRefinementRef.current
    ) {
      return;
    }

    const startRefinement = async () => {
      isStartingRefinementRef.current = true;
      setRefinementError(null);

      try {
        const request: StartInitiativeRefinementRequest = {
          projectId: projectId,
        };

        const response = await platformClient.startInitiativeRefinement({
          organizationId: organizationId,
          initiativeId: initiativeId,
          startInitiativeRefinementRequest: request,
        });

        const data = response.data.data;
        if (data?.conversationId) {
          setRefinementData({
            conversationId: data.conversationId,
            workflowId: data.workflowId,
          });
        } else {
          throw new Error("No conversation ID returned from refinement API");
        }
      } catch (error) {
        setRefinementError(
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        isStartingRefinementRef.current = false;
      }
    };

    startRefinement();
  }, [organizationId, initiativeId, projectId, refinementData]);

  // Load conversation by ID using the new collection system
  const {
    data: conversation,
    isLoading: isConversationLoading,
    error: conversationError,
    refetch: originalRefetchConversation,
  } = useConversation(
    organizationId,
    projectId,
    { conversationId: refinementData?.conversationId as string },
    { enabled: !!refinementData?.conversationId },
  );

  const refetchConversation = useCallback(async (): Promise<void> => {
    await originalRefetchConversation();
  }, [originalRefetchConversation]);

  // Load conversation initiatives using the extended useInitiatives hook
  const {
    initiatives: conversationInitiatives,
    isLoading: isConversationInitiativesLoading,
    error: conversationInitiativesError,
    refetch: refetchConversationInitiatives,
  } = useInitiatives(
    organizationId,
    projectId,
    refinementData?.conversationId,
    { enabled: !!refinementData?.conversationId },
  );

  // Handle polling for conversation messages using custom polling hook
  const handlePoll = useCallback(async () => {
    if (conversation && refetchConversation) {
      await refetchConversation();
    }
  }, [conversation, refetchConversation]);

  const { isWaitingForFirstMessage } = useConversationPolling(conversation, {
    enabled:
      !!conversation &&
      !!organizationId &&
      !!projectId &&
      !!refinementData?.conversationId,
    interval: 3000,
    onPoll: handlePoll,
  });

  // Computed loading and error states
  const isLoading =
    isProjectLoading ||
    isInitiativeLoading ||
    isStartingRefinementRef.current ||
    isConversationLoading ||
    isConversationInitiativesLoading;

  const hasError = !!(
    projectError ||
    initiativeError ||
    refinementError ||
    conversationError ||
    conversationInitiativesError
  );

  return {
    // Project data
    project,
    isProjectLoading,
    projectError,

    // Initiative data (from new Jotai system)
    initiativeData,
    isInitiativeLoading,
    initiativeError,
    refetchInitiative,

    // Refinement data (using new data layer)
    refinementData,
    isStartingRefinement: isStartingRefinementRef.current,
    refinementError,

    // Conversation data (using new data layer)
    conversation: conversation ?? null,
    isConversationLoading,
    conversationError,
    refetchConversation,

    // Conversation initiatives data (using Jotai collection system)
    conversationInitiatives: conversationInitiatives ?? [],
    isConversationInitiativesLoading,
    conversationInitiativesError,
    refetchConversationInitiatives,

    // Computed states
    isWaitingForFirstMessage,
    isLoading,
    hasError,
  };
};
