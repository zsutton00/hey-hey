import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type {
  AgentSessionDto,
  CliReadProviderUsageGetErrorResponseDto,
  CliReadProviderUsageGetSuccessResponseDto,
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

type ProviderUsageResponse =
  | CliReadProviderUsageGetSuccessResponseDto
  | CliReadProviderUsageGetErrorResponseDto;

export interface ProviderUsageRead {
  id: string;
  response: ProviderUsageResponse;
}

export interface ProviderUsageParams {
  organizationId: string;
  projectId: string;
  routingAgentSessionId: string;
}

export async function fetchProviderUsage(
  params: ProviderUsageParams,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<ProviderUsageRead> {
  const { organizationId, projectId, routingAgentSessionId } = params;
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

  const authorized = await executeControllerAuthorizedAction({
    organizationId,
    projectId,
    machine,
    action: {
      requestId: crypto.randomUUID(),
      actionCategory: HostActionCategory.CliRead,
      actionType: HostAffectingActionType.CliRead,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: routingAgentSessionId,
    },
    submit: ({ authorization }) =>
      agentSessionsClient.readAgentSessionCliState(
        {
          organizationId,
          projectId,
          agentSessionId: routingAgentSessionId,
          cliReadRequestDto: {
            operation: "provider.usage.get",
            authorization,
          },
        },
        requestOptions,
      ),
  });
  if (authorized.outcome === "DENIED") {
    throw new Error(`Controller authorization denied: ${authorized.reason}`);
  }
  const result = authorized.data.data.data;

  if (!result || result.operation !== "provider.usage.get") {
    throw new Error("The provider usage read returned an unexpected response.");
  }

  return {
    id: result.requestId,
    response: result,
  };
}

export const providerUsageQueryOptions = (params: ProviderUsageParams) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: [
      ...projectKeys.providerUsage(params.organizationId, params.projectId),
      params,
    ] as const,
    queryFn: () => fetchProviderUsage(params),
  });
