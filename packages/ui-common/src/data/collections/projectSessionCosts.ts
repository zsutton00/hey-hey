import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type {
  CliReadProjectSessionCostsListErrorResponseDto,
  CliReadProjectSessionCostsListSuccessResponseDto,
  AgentSessionDto,
} from "../../api";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from "../../api";
import { agentSessionsClient, dataClient, machinesClient } from "../../clients";
import { executeControllerAuthorizedAction } from "../hooks/useControllerAuthorizedAction";
import { queryOptions } from "@tanstack/react-query";
import { projectKeys } from "./projects";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export interface ProjectSessionCostsFilters {
  activityFrom?: string;
  activityTo?: string;
  minKnownCostUsd?: number;
  limit?: number;
  cursor?: string;
}

type ProjectSessionCostsResponse =
  | CliReadProjectSessionCostsListSuccessResponseDto
  | CliReadProjectSessionCostsListErrorResponseDto;

export interface ProjectSessionCostsPage {
  id: string;
  response: ProjectSessionCostsResponse;
}

export interface ProjectSessionCostsParams {
  organizationId: string;
  projectId: string;
  routingAgentSessionId: string;
  activityFrom: string | null;
  activityTo: string | null;
  minKnownCostUsd: number | null;
  limit: number;
  cursor: string | null;
}
const normalizeOptionalString = (value: string | undefined): string | null =>
  value?.trim() || null;

const normalizePositiveCost = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

const normalizeLimit = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 25;
  }
  return Math.min(100, Math.max(1, Math.trunc(value)));
};

export function buildProjectSessionCostsParams(
  organizationId: string,
  projectId: string,
  routingAgentSessionId: string,
  filters: ProjectSessionCostsFilters = {},
): ProjectSessionCostsParams {
  return {
    organizationId,
    projectId,
    routingAgentSessionId,
    activityFrom: normalizeOptionalString(filters.activityFrom),
    activityTo: normalizeOptionalString(filters.activityTo),
    minKnownCostUsd: normalizePositiveCost(filters.minKnownCostUsd),
    limit: normalizeLimit(filters.limit),
    cursor: normalizeOptionalString(filters.cursor),
  };
}

export async function fetchProjectSessionCosts(
  params: ProjectSessionCostsParams,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<ProjectSessionCostsPage> {
  const {
    organizationId,
    projectId,
    routingAgentSessionId,
    activityFrom,
    activityTo,
    minKnownCostUsd,
    limit,
    cursor,
  } = params;
  const [sessionResponse, machinesResponse] = await Promise.all([
    dataClient.request<{ data: AgentSessionDto }>({
      ...requestOptions,
      method: "GET",
      url: `/organizations/${organizationId}/projects/${projectId}/agent-sessions/${routingAgentSessionId}`,
    }),
    machinesClient.listMachines(requestOptions),
  ]);
  const session = sessionResponse.data?.data;
  const machine = machinesResponse.data?.data?.machines.find(
    (candidate) => candidate.machineId === session?.machineId,
  );
  if (!machine) {
    throw new Error(
      "The execution machine for this protected read is unavailable.",
    );
  }

  const controllerReadInputs = {
    operation: "project.session_costs.list",
    projectId: projectId,
    activityFrom: activityFrom ?? undefined,
    activityTo: activityTo ?? undefined,
    minKnownCostUsd: minKnownCostUsd ?? undefined,
    limit: limit,
    cursor: cursor,
  } as const;
  const authorized = await executeControllerAuthorizedAction({
    organizationId: organizationId,
    projectId: projectId,
    machine,
    action: {
      requestId: crypto.randomUUID(),
      actionCategory: HostActionCategory.CliRead,
      actionType: HostAffectingActionType.CliRead,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: routingAgentSessionId,
      inputs: {
        kind: "CLI_READ",
        body: {
          requestId: crypto.randomUUID(),
          agentSessionId: routingAgentSessionId,
          ...controllerReadInputs,
        },
      },
    },
    submit: ({ authorization }) =>
      agentSessionsClient.readAgentSessionCliState(
        {
          organizationId: organizationId,
          projectId: projectId,
          agentSessionId: routingAgentSessionId,
          cliReadRequestDto: { ...controllerReadInputs, authorization },
        },
        requestOptions,
      ),
  });
  if (authorized.outcome === "DENIED") {
    throw new Error(`Controller authorization denied: ${authorized.reason}`);
  }
  const response = authorized.data;
  const result = response.data.data;

  if (!result || result.operation !== "project.session_costs.list") {
    throw new Error("The Costs read returned an unexpected response.");
  }

  return {
    id: result.requestId,
    response: result,
  };
}

export const projectSessionCostsQueryOptions = (
  params: ProjectSessionCostsParams,
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: [
      ...projectKeys.sessionCosts(params.organizationId, params.projectId),
      params,
    ] as const,
    queryFn: () => fetchProjectSessionCosts(params),
  });
