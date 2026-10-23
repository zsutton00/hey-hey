import { getPathService, type PathService } from "../../services";
import { resolvePreviewEntityType } from "../../utils/mentionFormatting";
import type { SearchEntity } from "../SmarterTextAreaCard";

export const navigateToEntity = async ({
  entity,
  navigate,
  projectId,
  pathService = getPathService(),
}: {
  entity: SearchEntity;
  navigate: (url: string) => void;
  projectId: string;
  pathService?: PathService;
}): Promise<void> => {
  try {
    let url: string;
    const entityType = entity.type.trim().toLowerCase();

    switch (entityType) {
      case "feature":
        url = pathService.feature({
          projectId,
          featureId: entity.id,
        });
        break;

      case "initiative":
        url = pathService.initiativeDetail({
          projectId,
          initiativeId: entity.id,
        });
        break;

      case "design_doc":
        url = pathService.designDoc({ projectId, designDocId: entity.id });
        break;

      case "agent_session":
        url = pathService.agentSession({
          projectId,
          agentSessionId: entity.id,
        });
        break;

      case "conversation":
        url = pathService.resolveAgentSession({
          projectId,
          conversationId: entity.id,
        });
        break;

      case "message":
        url = pathService.resolveMessageById({
          projectId,
          messageId: entity.id,
        });
        break;

      case "report":
        url = pathService.report({
          projectId,
          reportId: entity.id,
        });
        break;

      case "user":
        url = pathService.user({
          projectId,
          userId: entity.id,
        });
        break;

      case "proposal":
        url = pathService.proposal({
          projectId,
          proposalId: entity.id,
        });
        break;

      default:
        // Any other entity type is a registry-backed work-item type key.
        if (resolvePreviewEntityType(entityType) !== "task") {
          console.warn("Unknown entity type:", entity.type);
          return;
        }
        url = pathService.task({
          projectId,
          taskId: entity.id,
        });
    }

    // Navigate and collapse capsule
    navigate(url);
  } catch (error: unknown) {
    console.error("Navigation failed:", error);
  }
};
