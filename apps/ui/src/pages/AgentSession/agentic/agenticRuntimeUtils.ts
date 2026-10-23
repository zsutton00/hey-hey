import type { AgentProvider } from "@hey-hey/ui-common/agent-sessions-runtime";
import {
  ConversationStartRunRequestDtoProviderEnum,
  type AgentSessionDtoProviderEnum,
} from "@hey-hey/ui-common/api";

const PROVIDER_VALUES = new Set<string>(
  Object.values(ConversationStartRunRequestDtoProviderEnum),
);

export type TaskLaunchSource = "plan-step" | "task";

export interface AgenticLaunchContext {
  launchSource: TaskLaunchSource;
  launchPlanId: string | null;
  launchStepId: string | null;
  launchStageId: string | null;
}

export const isProvider = (
  value: AgentSessionDtoProviderEnum | string | undefined,
): value is AgentProvider =>
  typeof value === "string" && PROVIDER_VALUES.has(value);

export const resolveAgenticLaunchContext = (input: {
  planId: string | undefined;
  stepId: string | undefined;
  stageId: string | undefined;
}): AgenticLaunchContext => {
  if (input.planId && input.stepId && input.stageId) {
    return {
      launchSource: "plan-step",
      launchPlanId: input.planId,
      launchStepId: input.stepId,
      launchStageId: input.stageId,
    };
  }

  return {
    launchSource: "task",
    launchPlanId: input.planId ?? null,
    launchStepId: null,
    launchStageId: null,
  };
};
