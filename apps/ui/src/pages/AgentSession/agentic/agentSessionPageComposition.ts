import {
  createCanonicalPageDescriptor,
  type AgentSessionPresentationSnapshot,
  type CanonicalPageComposition,
} from "@hey-hey/ui-common/context";
import { buildAgentSessionNavigationLineage } from "./agentSessionNavigationLineage";

export const buildAgentSessionPageComposition = ({
  preview,
  routeFamily,
  agentSessionId,
  planId,
  stageId,
  stepId,
  taskId,
  presentation,
}: {
  preview: boolean;
  routeFamily: "project" | "plan" | "task";
  agentSessionId: string;
  planId?: string;
  stageId?: string;
  stepId?: string;
  taskId?: string;
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
      buildAgentSessionNavigationLineage({
        routeFamily,
        planId,
        stageId,
        stepId,
        taskId,
      }),
      presentation,
    ),
  };
};
