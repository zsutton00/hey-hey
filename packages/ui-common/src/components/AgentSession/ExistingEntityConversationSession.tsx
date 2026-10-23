import { EntityType } from "../../api";
import { CanonicalPageBoundary, TrackingProvider } from "../../contexts";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { AgentConversationView } from "./AgentConversationView";
import type { ExistingEntityConversationAgentSession } from "./existingEntityConversationAgentSession";
import { resolveFileReferenceScope } from "../SmarterTextAreaCard/fileReferences/types";

export interface ExistingEntityConversationSessionProps {
  organizationId: string;
  projectId: string;
  agentSession: ExistingEntityConversationAgentSession;
}

export const ExistingEntityConversationSession = ({
  organizationId,
  projectId,
  agentSession,
}: ExistingEntityConversationSessionProps) => {
  const isGenericTaskEntity = agentSession.entityType === EntityType.Task;
  const { workItem: loadedWorkItem } = useWorkItem(
    organizationId,
    "task",
    agentSession.entityId ?? "",
    {
      projectId,
      enabled: isGenericTaskEntity && Boolean(agentSession.entityId),
    }
  );
  const fileReferenceScope = resolveFileReferenceScope(
    isGenericTaskEntity ? loadedWorkItem?.type : agentSession.entityType,
    agentSession.entityId ?? ""
  );

  return (
    <TrackingProvider
      context={{
        page: {
          name: "entity-conversation-preview",
          path: `/projects/${projectId}/agent-sessions/${agentSession.id}/preview`,
          section: "preview",
        },
        workflow: {
          id: agentSession.id,
          name: "entity-conversation",
        },
        attentionEntity: undefined,
      }}
    >
      <CanonicalPageBoundary composition={{ kind: "observational" }}>
        <AgentConversationView
          organizationId={organizationId}
          projectId={projectId}
          agentSessionId={agentSession.id}
          conversationId={agentSession.conversationId}
          sessionResumability={
            agentSession.machineId
              ? "resumable"
              : "legacy_non_resumable"
          }
          scrollable
          fileReferenceScope={fileReferenceScope ?? undefined}
        />
      </CanonicalPageBoundary>
    </TrackingProvider>
  );
};
