import type { PathService } from "../services";
import { resolvePreviewEntityType } from "./mentionFormatting";

export interface EntityHrefTarget {
  entityType: string;
  entityId: string;
}

export const buildEntityHref = (
  pathService: PathService,
  projectId: string,
  target: EntityHrefTarget,
): string | undefined => {
  switch (target.entityType.toLowerCase()) {
    case "feature":
      return pathService.feature({ projectId, featureId: target.entityId });
    case "initiative":
      return pathService.onboardingInitiative({
        projectId,
        initiativeId: target.entityId,
      });
    case "plan":
      return pathService.plan({ projectId, planId: target.entityId });
    case "design_doc":
      return pathService.designDoc({ projectId, designDocId: target.entityId });
    case "agent_session":
      return pathService.agentSession({
        projectId,
        agentSessionId: target.entityId,
      });
    case "conversation":
      return pathService.resolveAgentSession({
        projectId,
        conversationId: target.entityId,
      });
    case "message":
      return pathService.resolveMessageById({
        projectId,
        messageId: target.entityId,
      });
    case "report":
      return pathService.report({
        projectId,
        reportId: target.entityId,
      });
    case "proposal":
      return pathService.proposal({
        projectId,
        proposalId: target.entityId,
      });
    default:
      // Any other mention kind is a registry-backed work-item type key.
      return resolvePreviewEntityType(target.entityType) === "task"
        ? pathService.task({ projectId, taskId: target.entityId })
        : undefined;
  }
};
