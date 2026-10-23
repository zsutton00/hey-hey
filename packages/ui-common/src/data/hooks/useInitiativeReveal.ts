import { useState, useCallback } from "react";
import { platformClient } from "../../clients/serviceClients";
import { log } from "../../utils/logger";
import type {
  DeepenInitiativeByConversationRequest,
  DeepenInitiativeByConversationRequestCurrentLevelEnum,
} from "../../api";
import type { LevelType } from "../../types/initiative";

interface UseInitiativeRevealProps {
  organizationId: string;
  projectId: string;
  initiativeId: string;
  conversationId?: string;
  currentLevel: LevelType;
  onLevelChange: (level: LevelType) => void;
  onError: (error: string) => void;
}

interface UseInitiativeRevealReturn {
  isRevealingDetails: boolean;
  isRevealingAcceptanceCriteria: boolean;
  handleRevealDetails: () => Promise<void>;
  handleRevealAcceptanceCriteria: () => Promise<void>;
}

export const useInitiativeReveal = ({
  organizationId,
  projectId,
  initiativeId,
  conversationId,
  currentLevel,
  onLevelChange,
  onError,
}: UseInitiativeRevealProps): UseInitiativeRevealReturn => {
  const [isRevealingDetails, setIsRevealingDetails] = useState(false);
  const [isRevealingAcceptanceCriteria, setIsRevealingAcceptanceCriteria] =
    useState(false);

  const handleRevealDetails = useCallback(async (): Promise<void> => {
    if (isRevealingDetails || !conversationId) {
      return;
    }

    log.uiInteraction("Ready for Details button clicked", {
      currentLevel,
      targetLevel: "details",
    });

    setIsRevealingDetails(true);
    onError(""); // Clear any previous errors

    try {
      const payload: DeepenInitiativeByConversationRequest = {
        currentLevel:
          "description" as DeepenInitiativeByConversationRequestCurrentLevelEnum,
      };

      const response = await platformClient.deepenInitiativeByConversation({
        organizationId: organizationId,
        projectId: projectId,
        conversationId: conversationId,
        initiativeId: initiativeId,
        deepenInitiativeByConversationRequest: payload,
      });

      log.info("api", "Deepen Details API call successful", {
        response: response.data,
      });

      // Update the current level to show the revealed content
      onLevelChange("acceptanceCriteria");

      // WebSocket will handle data updates automatically - no manual refetch needed
    } catch (err) {
      log.error("api", "Failed to deepen initiative to details", err);
      onError(
        err instanceof Error ? err.message : "Failed to reveal details content",
      );
    } finally {
      setIsRevealingDetails(false);
    }
  }, [
    currentLevel,
    isRevealingDetails,
    conversationId,
    organizationId,
    projectId,
    initiativeId,
    onLevelChange,
    onError,
  ]);

  const handleRevealAcceptanceCriteria =
    useCallback(async (): Promise<void> => {
      if (isRevealingAcceptanceCriteria || !conversationId) {
        return;
      }

      log.uiInteraction("Ready for Acceptance Criteria button clicked", {
        currentLevel,
        targetLevel: "acceptanceCriteria",
      });

      setIsRevealingAcceptanceCriteria(true);
      onError(""); // Clear any previous errors

      try {
        // If we're currently at description level, we need to deepen to details first
        const targetLevel =
          currentLevel === "description"
            ? ("description" as DeepenInitiativeByConversationRequestCurrentLevelEnum)
            : ("description" as DeepenInitiativeByConversationRequestCurrentLevelEnum);

        const payload: DeepenInitiativeByConversationRequest = {
          currentLevel: targetLevel,
        };

        const response = await platformClient.deepenInitiativeByConversation({
          organizationId: organizationId,
          projectId: projectId,
          conversationId: conversationId,
          initiativeId: initiativeId,
          deepenInitiativeByConversationRequest: payload,
        });

        log.info("api", "Deepen Acceptance Criteria API call successful", {
          response: response.data,
        });

        // Update the current level to show both details and acceptance criteria
        onLevelChange("acceptanceCriteria");

        // WebSocket will handle data updates automatically - no manual refetch needed
      } catch (err) {
        log.error(
          "api",
          "Failed to deepen initiative to acceptance criteria",
          err,
        );
        onError(
          err instanceof Error
            ? err.message
            : "Failed to reveal acceptance criteria content",
        );
      } finally {
        setIsRevealingAcceptanceCriteria(false);
      }
    }, [
      currentLevel,
      isRevealingAcceptanceCriteria,
      conversationId,
      organizationId,
      projectId,
      initiativeId,
      onLevelChange,
      onError,
    ]);

  return {
    isRevealingDetails,
    isRevealingAcceptanceCriteria,
    handleRevealDetails,
    handleRevealAcceptanceCriteria,
  };
};
