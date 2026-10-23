import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  type AgentSessionConfig,
  type AgentSessionConfigEntityConversationV1,
  type AgentSessionDto,
} from "../../api";
import type { SurfaceSelection } from "./surfaceSelectionMemory";

export const readEntityConversationSessionConfig = (
  config: AgentSessionConfig | null | undefined,
): AgentSessionConfigEntityConversationV1 | null =>
  config?.type ===
  AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation
    ? config
    : null;

export const buildEntityConversationSessionConfig = (
  selection: Pick<SurfaceSelection, "model" | "reasoningEffort">,
): AgentSessionConfigEntityConversationV1 => ({
  type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
  version: "v1",
  model: selection.model,
  ...(selection.reasoningEffort ? { effort: selection.reasoningEffort } : {}),
});

/**
 * The provider/model/effort a conversation runs with: the session's own durable
 * choice, completed from the surface's remembered selection. Null when the two
 * together do not name both a provider and a model, so nothing is invented
 * before the CLI's catalog has said what it can launch.
 */
export const resolveEntityConversationRuntimeSelection = (
  agentSession: Pick<AgentSessionDto, "config" | "provider">,
  rememberedSelection: SurfaceSelection | null,
): SurfaceSelection | null => {
  const config = readEntityConversationSessionConfig(agentSession.config);
  const provider = agentSession.provider ?? rememberedSelection?.provider;
  const model = config?.model ?? rememberedSelection?.model;
  if (!provider || !model) {
    return null;
  }

  return {
    provider,
    model,
    reasoningEffort: config
      ? (config.effort ?? null)
      : (rememberedSelection?.reasoningEffort ?? null),
    ...(rememberedSelection?.fastMode === undefined
      ? {}
      : { fastMode: rememberedSelection.fastMode }),
  };
};
