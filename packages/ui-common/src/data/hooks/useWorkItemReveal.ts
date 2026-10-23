import { useCallback, useState } from "react";
import type { LevelType } from "../../types/workItem";
import { workItemService } from "../../services/workItemService";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export interface UseWorkItemRevealParams {
  organizationId: string;
  projectId: string;
  workItemId: string;
  conversationId?: string;
  currentLevel: LevelType;
  onLevelChange: (level: LevelType) => void;
  onError: (message: string) => void;
}

export interface UseWorkItemRevealReturn {
  isRevealingDetails: boolean;
  isRevealingAcceptanceCriteria: boolean;
  handleRevealDetails: () => Promise<void>;
  handleRevealAcceptanceCriteria: () => Promise<void>;
}

export const useWorkItemReveal = ({
  projectId,
  workItemId,
  conversationId,
  currentLevel,
  onLevelChange,
  onError,
}: UseWorkItemRevealParams): UseWorkItemRevealReturn => {
  const [isRevealingAcceptanceCriteria, setIsRevealingAcceptanceCriteria] =
    useState(false);

  useWebsocketSubscriptions(
    {
      conversationIds: conversationId ? [conversationId] : [],
      projectIds: projectId ? [projectId] : [],
      initiativeIds: [],
    },
    { enabled: !!conversationId }
  );

  const handleRevealDetails = useCallback(async () => {
    // Details section removed (was initiative-only)
  }, []);

  const handleRevealAcceptanceCriteria = useCallback(async () => {
    if (!conversationId || currentLevel !== "description") {
      return;
    }

    setIsRevealingAcceptanceCriteria(true);
    onError("");

    try {
      await workItemService.deepenWorkItem(workItemId, "description");
      onLevelChange("acceptanceCriteria");
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Failed to reveal acceptance criteria"
      );
    } finally {
      setIsRevealingAcceptanceCriteria(false);
    }
  }, [conversationId, currentLevel, onError, onLevelChange, workItemId]);

  return {
    isRevealingDetails: false,
    isRevealingAcceptanceCriteria,
    handleRevealDetails,
    handleRevealAcceptanceCriteria,
  };
};
