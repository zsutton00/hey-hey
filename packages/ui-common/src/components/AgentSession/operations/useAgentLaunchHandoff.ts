import { useEffect } from "react";
import { AgentSessionCurrentState } from "../../../api";
import type { UseAgentSessionCurrentStateReturn } from "../../../data/hooks/useAgentSessionCurrentState";
import type { AgentLaunchScope } from "./AgentLaunchStore";
import { useAgentLaunchProgress } from "./useAgentLaunchProgress";

export function useAgentLaunchHandoff(
  scope: AgentLaunchScope,
  state: UseAgentSessionCurrentStateReturn
): boolean {
  const { progress, launches } = useAgentLaunchProgress(scope);
  const { organizationId, projectId, agentSessionId, conversationId } = scope;
  // A later revisioned transition (including IDLE) is runtime evidence even
  // when the active state happened while this route was unmounted.
  const runtimeObserved =
    Boolean(
      state.currentState && state.currentState !== AgentSessionCurrentState.Idle
    ) ||
    Boolean(
      progress &&
        state.transitionedAt &&
        state.transitionedAt > progress.startedAt
    );
  useEffect(() => {
    if (runtimeObserved)
      launches.observeRuntime({
        organizationId,
        projectId,
        agentSessionId,
        conversationId,
      });
  }, [
    runtimeObserved,
    launches,
    organizationId,
    projectId,
    agentSessionId,
    conversationId,
    progress,
  ]);
  return (
    progress?.phase === "accepted" &&
    !progress.runtimeObserved &&
    !runtimeObserved
  );
}
