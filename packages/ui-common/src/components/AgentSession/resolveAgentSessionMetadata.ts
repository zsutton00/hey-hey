import {
  AgentSessionServicePlaceKind,
  type AgentSessionConfig,
  type AgentSessionDto,
  type AgentSessionServicePlace,
  type ServiceDto,
} from "../../api";
import type {
  AgentSessionMetadataValues,
  AgentSessionServicePlaceView,
} from "./AgentSessionMetadata";
import { describeServiceLocation } from "./describeServiceLocation";
import type { ReasoningEffort } from "./runtime/types";

type DurableSessionConfig = Extract<AgentSessionConfig, { model: string }>;

const isDurableSessionConfig = (
  config: AgentSessionConfig | null | undefined,
): config is DurableSessionConfig =>
  config !== null &&
  config !== undefined &&
  "model" in config &&
  typeof config.model === "string";

const isReasoningEffort = (
  effort: string | undefined,
): effort is ReasoningEffort =>
  effort === "low" ||
  effort === "medium" ||
  effort === "high" ||
  effort === "xhigh" ||
  effort === "max";

const toPlace = (
  record: AgentSessionServicePlace | undefined,
): AgentSessionServicePlaceView => {
  if (record === undefined) {
    return { kind: "not-recorded" };
  }

  if (record.kind === AgentSessionServicePlaceKind.Worktree) {
    return { kind: "worktree", branch: record.branch ?? "" };
  }

  return { kind: "main-folder", branch: record.branch };
};

const toChange = (record: AgentSessionServicePlace | undefined) => {
  if (!record?.changedDuringSession) {
    return {};
  }

  // A Service attached before any place was reported has no known start.
  const startedIn = record.launchPlace
    ? describeServiceLocation(record.launchPlace)
    : null;

  return { change: { startedIn } };
};

const hasFastMode = (config: DurableSessionConfig): boolean =>
  "fastMode" in config && config.fastMode === true;

export const resolveAgentSessionMetadata = (
  agentSession: Pick<
    AgentSessionDto,
    "config" | "provider" | "serviceIds" | "servicePlaces"
  >,
  services: readonly Pick<ServiceDto, "id" | "name">[] = [],
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

  const fastMode = hasFastMode(agentSession.config);

  const servicesById = new Map(
    services.map((service) => [service.id, service.name]),
  );
  const placesByServiceId = new Map(
    (agentSession.servicePlaces ?? []).map((place) => [place.serviceId, place]),
  );
  const servicePlaces = [...new Set(agentSession.serviceIds ?? [])].flatMap(
    (id) => {
      const serviceName = servicesById.get(id)?.trim();
      const record = placesByServiceId.get(id);
      return serviceName
        ? [{ serviceName, place: toPlace(record), ...toChange(record) }]
        : [];
    },
  );

  return {
    ...(servicePlaces.length > 0 ? { servicePlaces } : {}),
    provider: agentSession.provider,
    model,
    ...(isReasoningEffort(agentSession.config.effort)
      ? { effort: agentSession.config.effort }
      : {}),
    ...(fastMode ? { fastMode: true } : {}),
  };
};
