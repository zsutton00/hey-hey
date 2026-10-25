import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { RuntimeModelSelectorProps } from "../../AgentSession/RuntimeModelSelector";

type CodingPlanRuntimeChoice = Pick<
  RuntimeModelSelectorProps,
  "provider" | "model" | "reasoningEffort"
> & {
  fastMode: boolean;
};

export const currentCodingPlanRuntime: CodingPlanRuntimeChoice = {
  provider: null,
  model: null,
  reasoningEffort: null,
  fastMode: false,
};

// A new context card must retain the user's choice from earlier planning replies.
export const codingPlanRuntimeChoice = atomFamily((_conversationId: string) =>
  atom<CodingPlanRuntimeChoice>(currentCodingPlanRuntime),
);
