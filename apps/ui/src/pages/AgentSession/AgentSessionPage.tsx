import React from "react";
import { DataStateLoadingProvider } from "@hey-hey/ui-common/components";
import { useParams } from "react-router-dom";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { AgentSessionContent } from "./AgentSessionContent";

export const AgentSessionPage: React.FC = () => {
  const { projectId, agentSessionId } = useParams<{
    projectId: string;
    agentSessionId: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  return (
    <DataStateLoadingProvider>
      <AgentSessionContent
        organizationId={organizationId}
        projectId={projectId ?? ""}
        agentSessionId={agentSessionId ?? ""}
      />
    </DataStateLoadingProvider>
  );
};
