import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  type AgentSessionConfigV2,
  type AgentSessionDto,
} from "@hey-hey/ui-common/api";
import type { SurfaceSelection } from "@hey-hey/ui-common/components";

/** Browser-memory key for the runtime a fresh local onboarding setup starts from. */
export const LOCAL_ONBOARDING_SURFACE_ID = "onboarding";

function isEffort(
  value: string,
): value is ConversationStartRunRequestDtoReasoningEffortEnum {
  return Object.values(ConversationStartRunRequestDtoReasoningEffortEnum).some(
    (effort) => effort === value,
  );
}

/** The versioned coding configuration persisted on the onboarding session. */
export const toOnboardingSessionConfig = (
  runtime: SurfaceSelection,
): AgentSessionConfigV2 => ({
  type: AgentSessionConfigV2TypeEnum.CodingSession,
  version: AgentSessionConfigV2VersionEnum.V2,
  model: runtime.model,
  ...(runtime.reasoningEffort ? { effort: runtime.reasoningEffort } : {}),
  ...(runtime.fastMode !== undefined ? { fastMode: runtime.fastMode } : {}),
});

/**
 * The runtime saved on an onboarding session. Once a session exists its saved
 * choice is authoritative: the platform reuses that session for the onboarding
 * workflow only when a launch repeats exactly the same provider and config.
 */
export const savedOnboardingRuntime = (
  session: AgentSessionDto,
): SurfaceSelection | null => {
  const config = session.config;
  if (
    !session.provider ||
    config?.type !== AgentSessionConfigV2TypeEnum.CodingSession ||
    config.version !== AgentSessionConfigV2VersionEnum.V2
  ) {
    return null;
  }

  return {
    provider: session.provider,
    model: config.model,
    reasoningEffort:
      config.effort && isEffort(config.effort) ? config.effort : null,
    ...(config.fastMode !== undefined ? { fastMode: config.fastMode } : {}),
  };
};
