import type { AgentProvider } from "./runtime";
import { type AgentSessionDtoProviderEnum } from "../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../api";

const PROVIDER_VALUES = new Set<string>(
  Object.values(ConversationStartRunRequestDtoProviderEnum),
);

export interface AgenticLaunchContext {
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
}): AgenticLaunchContext => ({
  launchPlanId: input.planId ?? null,
  launchStepId: input.stepId ?? null,
  launchStageId: input.stageId ?? null,
});

export const isLocalRuntimeUnavailable = (
  error: string | null | undefined,
): boolean => {
  if (!error) {
    return false;
  }

  return (
    /failed to fetch/i.test(error) ||
    /network\s*error/i.test(error) ||
    /request failed with status 404/i.test(error) ||
    /request failed with status 502/i.test(error) ||
    /econnrefused/i.test(error)
  );
};
