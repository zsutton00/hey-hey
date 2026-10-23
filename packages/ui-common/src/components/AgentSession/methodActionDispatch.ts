import type { SuggestedAgentActionMethod } from "../../api";
import { log } from "../../utils/logger";
import {
  buildDirectTriggerInput,
  buildAgentInput,
} from "./runtime/hooks/directTriggerInput";
import type { AgentSessionInteractions } from "./operations/AgentOperationCoordinator";

interface FinalAssessmentMethodContext {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
}

export type MethodActionContext = FinalAssessmentMethodContext;

type MethodHandler = (
  interactions: AgentSessionInteractions,
  runId: string,
  context: MethodActionContext,
) => Promise<void>;

const METHOD_HANDLERS: Record<SuggestedAgentActionMethod, MethodHandler> = {
  final_assessment: async (interactions, _runId, context) => {
    const result = await interactions.submitMessage(
      buildDirectTriggerInput({
        organizationId: context.organizationId,
        projectId: context.projectId,
        agentSessionId: context.agentSessionId,
        conversationId: context.conversationId,
        data: {
          // `final_assessment` is a payload-free arm of the dispatch union: the
          // CLI rides on its already-loaded run state, so the dispatch carries
          // only the routing `promptType`, not the bootstrap context.
          agentInput: buildAgentInput({ promptType: "final_assessment" }),
          references: { resolved: [], unresolved: [] },
        },
      }),
    );
    if (result.state !== "succeeded" && result.state !== "accepted") {
      throw new Error(
        result.state === "cancelled"
          ? "The operation was cancelled."
          : result.message,
      );
    }
  },
};

const isKnownMethod = (method: string): method is SuggestedAgentActionMethod =>
  method in METHOD_HANDLERS;

export const dispatchMethodAction = async (
  method: string,
  interactions: AgentSessionInteractions,
  runId: string,
  context: MethodActionContext,
): Promise<void> => {
  if (!isKnownMethod(method)) {
    throw new Error(`Unknown method action: ${method}`);
  }

  log.info("dynamic_form", `Dispatching method action: ${method}`, {
    method,
    runId,
  });

  await METHOD_HANDLERS[method](interactions, runId, context);
};
