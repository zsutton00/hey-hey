import type { AgentSessionDto } from "../../api";
import { resolveHasSentInitialPrompt } from "./runtime/coding/agent-session-helpers";
import type { AgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import type {
  AgentSessionInteractionAccess,
  AgentSessionInteractions,
} from "./operations/AgentOperationCoordinator";
import type { SubagentCommandIntent } from "../SmarterTextAreaCard/slashCommands/subagentCommand";
import type { SubagentServiceScope } from "../SmarterTextAreaCard/slashCommands/SubagentServicesContext";

export type SubagentComposerCapability =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      services: SubagentServiceScope;
      submit: (
        intent: SubagentCommandIntent,
        interactionId: string
      ) => Promise<void>;
    };

export interface SubagentReadinessInput {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  session: AgentSessionDto | null;
  recoveryState: AgentBridgeRecoveryState;
  interactionAccess: AgentSessionInteractionAccess;
  readOnly: boolean;
}

export type SubagentReadiness =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      runId: string;
      /** Controller-authorized submission bound to the source session's machine. */
      requestSubagent: AgentSessionInteractions["requestSubagent"];
    };

export function resolveSubagentReadiness(
  input: SubagentReadinessInput
): SubagentReadiness {
  const { session, recoveryState, interactionAccess } = input;
  if (input.readOnly)
    return { kind: "unavailable", reason: "This conversation is read-only." };
  if (!session)
    return {
      kind: "unavailable",
      reason: "Agent Session readiness is unavailable.",
    };
  if (
    !input.conversationId ||
    session.id !== input.agentSessionId ||
    session.organizationId !== input.organizationId ||
    session.projectId !== input.projectId ||
    session.conversationId !== input.conversationId
  ) {
    return {
      kind: "unavailable",
      reason: "The conversation does not match this Agent Session.",
    };
  }
  if (
    !resolveHasSentInitialPrompt({ agentSessionStatus: session.status }) ||
    !session.machineId
  ) {
    return {
      kind: "unavailable",
      reason: "Start this Agent Session before requesting a child.",
    };
  }
  if (
    recoveryState.type !== "ready" ||
    recoveryState.machine.machineId !== session.machineId
  ) {
    return {
      kind: "unavailable",
      reason: "The Agent Session's owning machine is unavailable.",
    };
  }
  if (!interactionAccess.isDeviceEnabled)
    return {
      kind: "unavailable",
      reason: interactionAccess.unavailable.message,
    };
  // CLI runs use the durable session identity; provider-session IDs are unrelated.
  return {
    kind: "ready",
    runId: session.id,
    requestSubagent: interactionAccess.interactions.requestSubagent,
  };
}
