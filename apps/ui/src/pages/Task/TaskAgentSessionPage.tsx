import React from "react";
import { DataStateLoadingProvider } from "@hey-hey/ui-common/components";
import { AgenticAgentSessionPage } from "../AgentSession/agentic/AgenticAgentSessionPage";

export const TaskAgentSessionPage: React.FC = () => {
  return (
    <DataStateLoadingProvider>
      <AgenticAgentSessionPage routeFamily="task" />
    </DataStateLoadingProvider>
  );
};
