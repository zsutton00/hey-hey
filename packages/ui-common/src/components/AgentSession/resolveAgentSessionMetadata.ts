import type { AgentSessionConfig, AgentSessionDto, ServiceDto } from "../../api";
import type { AgentSessionMetadataValues } from "./AgentSessionMetadata";
import type { ReasoningEffort } from "./runtime/types";

type DurableSessionConfig = Extract<AgentSessionConfig, { model: string }>;

const isDurableSessionConfig = (
  config: AgentSessionConfig | null | undefined
): config is DurableSessionConfig =>
  config !== null &&
  config !== undefined &&
  "model" in config &&
  typeof config.model === "string";

const isReasoningEffort = (
  effort: string | undefined
): effort is ReasoningEffort =>
  effort === "low" ||
  effort === "medium" ||
  effort === "high" ||
  effort === "xhigh" ||
  effort === "max";

const getWorktree = (
  config: DurableSessionConfig
): string | undefined => {
  if (!("worktree" in config) || typeof config.worktree !== "string") {
    return undefined;
  }

  const worktree = config.worktree.trim();
  return worktree.length > 0 ? worktree : undefined;
};

const hasFastMode = (config: DurableSessionConfig): boolean =>
  "fastMode" in config && config.fastMode === true;

export const resolveAgentSessionMetadata = (
  agentSession: Pick<AgentSessionDto, "config" | "provider" | "serviceIds">,
  services: readonly Pick<ServiceDto, "id" | "name">[] = []
): AgentSessionMetadataValues | undefined => {
  if (
    !isDurableSessionConfig(agentSession.config) ||
    agentSession.provider === undefined
  ) {
    return undefined;
  }

  const model = agentSession.config.model.trim();
  if (model.length === 0) {
    return undefined;
  }

  const worktree = getWorktree(agentSession.config);
  const fastMode = hasFastMode(agentSession.config);

  const servicesById = new Map(
    services.map((service) => [service.id, service.name])
  );
  const serviceNames = [...new Set(agentSession.serviceIds ?? [])].flatMap((id) => {
    const name = servicesById.get(id)?.trim();
    return name ? [name] : [];
  });

  return {
    ...(serviceNames.length > 0 ? { serviceNames } : {}),
    provider: agentSession.provider,
    model,
    ...(isReasoningEffort(agentSession.config.effort)
      ? { effort: agentSession.config.effort }
      : {}),
    ...(fastMode ? { fastMode: true } : {}),
    ...(worktree ? { worktree } : {}),
  };
};
