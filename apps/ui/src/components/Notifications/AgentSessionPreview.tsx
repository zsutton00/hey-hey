import React from "react";
import { AgentSessionContent } from "../../pages/AgentSession/AgentSessionContent";

export interface AgentSessionPreviewProps {
  organizationId: string;
  projectId: string;
  sessionId: string;
}

export const AgentSessionPreview: React.FC<AgentSessionPreviewProps> = ({
  organizationId,
  projectId,
  sessionId,
}) => (
  <AgentSessionContent
    organizationId={organizationId}
    projectId={projectId}
    agentSessionId={sessionId}
    preview
  />
);
