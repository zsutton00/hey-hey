import { useCallback, useContext, useSyncExternalStore } from "react";
import {
  AgentOperationContext,
  defaultAgentOperationCoordinator,
} from "./AgentOperationProvider";
import type { AgentLaunchScope } from "./AgentLaunchStore";

export function useAgentLaunchProgress(scope: AgentLaunchScope) {
  const context = useContext(AgentOperationContext);
  const coordinator = context ?? defaultAgentOperationCoordinator;
  const { organizationId, projectId, agentSessionId, conversationId } = scope;
  const getSnapshot = useCallback(
    () =>
      coordinator.launches.get({
        organizationId,
        projectId,
        agentSessionId,
        conversationId,
      }),
    [coordinator, organizationId, projectId, agentSessionId, conversationId]
  );
  const progress = useSyncExternalStore(
    coordinator.launches.subscribe,
    getSnapshot,
    getSnapshot
  );
  return { progress, launches: coordinator.launches };
}
