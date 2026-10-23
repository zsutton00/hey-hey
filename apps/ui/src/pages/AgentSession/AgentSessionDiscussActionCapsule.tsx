import {
  TargetEntityType,
  type AgentSessionDto,
} from "@hey-hey/ui-common/api";
import { DiscussCapsuleAction } from "@hey-hey/ui-common/components";

export interface AgentSessionDiscussActionCapsuleProps {
  organizationId: string;
  projectId: string;
  agentSession: Pick<AgentSessionDto, "id" | "title">;
}

export const AgentSessionDiscussActionCapsule = ({
  organizationId,
  projectId,
  agentSession,
}: AgentSessionDiscussActionCapsuleProps) => (
  <DiscussCapsuleAction
    entityId={agentSession.id}
    entityType={TargetEntityType.AgentSession}
    entityTitle={agentSession.title ?? undefined}
    organizationId={organizationId}
    projectId={projectId}
  />
);
