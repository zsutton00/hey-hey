import { AgentSessionCurrentState } from "../../api";
import { getAgentSessionCurrentStatePresentation } from "../AgentSession/agentSessionCurrentStatePresentation";

export type TaskMonitorSessionActivityPhase =
  | typeof AgentSessionCurrentState.Thinking
  | typeof AgentSessionCurrentState.Writing;

export const getTaskMonitorSessionActivityPhase = (
  currentState: AgentSessionCurrentState | undefined,
): TaskMonitorSessionActivityPhase | null => {
  if (!currentState) {
    return null;
  }

  switch (getAgentSessionCurrentStatePresentation(currentState).activity) {
    case "thinking":
      return AgentSessionCurrentState.Thinking;
    case "writing":
      return AgentSessionCurrentState.Writing;
    default:
      return null;
  }
};
