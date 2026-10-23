import {
  createNavigationLineageEntry,
  type NavigationLineage,
} from "@hey-hey/ui-common";
import {
  createCanonicalPageDescriptor,
  type AgentSessionPresentationSnapshot,
  type CanonicalPageComposition,
} from "@hey-hey/ui-common/context";

const buildEntityConversationLineage = (
  entityType: string,
  entityId: string,
): NavigationLineage | null => {
  switch (entityType.toLowerCase()) {
    case "plan":
      return [createNavigationLineageEntry("plan", entityId)];
    case "task":
      return [createNavigationLineageEntry("task", entityId)];
    default:
      return null;
  }
};

export const buildEntityConversationPageComposition = ({
  preview,
  agentSessionId,
  entityType,
  entityId,
  presentation,
}: {
  preview: boolean;
  agentSessionId: string;
  entityType: string;
  entityId: string;
  presentation: AgentSessionPresentationSnapshot;
}): CanonicalPageComposition => {
  if (preview) {
    return { kind: "observational" };
  }

  return {
    kind: "canonical",
    descriptor: createCanonicalPageDescriptor(
      "agent_session",
      agentSessionId,
      entityId ? buildEntityConversationLineage(entityType, entityId) : null,
      presentation,
    ),
  };
};
