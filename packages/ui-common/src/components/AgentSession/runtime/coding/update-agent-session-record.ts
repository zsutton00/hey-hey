import type {
  AgentSessionConfig,
  AgentSessionDto,
  AgentSessionStatus,
  UpdateAgentSessionDto,
} from "../../../../api";
import { agentSessionsClient } from "../../../../clients";
import type { ConversationStartRunRequestDtoProviderEnum } from "../../../../api";

type UpdateAgentSessionRecordResponse = Awaited<
  ReturnType<typeof agentSessionsClient.updateAgentSession>
>["data"];

export interface UpdateAgentSessionRecordInput {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  machineId: string;
  serviceIds?: string[];
  launchServiceId?: string;
  provider?: ConversationStartRunRequestDtoProviderEnum;
  providerAgentSessionId?: string;
  status?: AgentSessionStatus;
  monitoringEnabled?: boolean;
  autoDecide?: boolean;
  config?: AgentSessionConfig;
  writeTraceId?: string;
}

interface UpdateAgentSessionRecordDependencies {
  updateAgentSession: (
    organizationId: string,
    projectId: string,
    agentSessionId: string,
    payload: UpdateAgentSessionDto,
  ) => Promise<UpdateAgentSessionRecordResponse>;
}

export type UpdateAgentSessionRecordResult =
  | { ok: true; session: AgentSessionDto }
  | { ok: false; error: string };

const defaultDependencies: UpdateAgentSessionRecordDependencies = {
  updateAgentSession: async (
    organizationId,
    projectId,
    agentSessionId,
    payload,
  ) =>
    (
      await agentSessionsClient.updateAgentSession({
        organizationId: organizationId,
        projectId: projectId,
        agentSessionId: agentSessionId,
        updateAgentSessionDto: payload,
      })
    ).data,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readStatusCode = (error: unknown): number | null => {
  if (!isObject(error)) {
    return null;
  }
  const response = error["response"];
  if (!isObject(response)) {
    return null;
  }
  const status = response["status"];
  return typeof status === "number" ? status : null;
};

const toUpdateSessionError = (error: unknown): string => {
  const status = readStatusCode(error);

  if (status === 401 || status === 403) {
    return "Authentication expired. Please login again and retry.";
  }

  if (status === 404) {
    return "Agent session no longer exists. Refresh and choose another session.";
  }

  if (status === 409) {
    return "This agent session is already bound to a different service or agent.";
  }

  if (status === 400) {
    return "Agent session update request was rejected. Verify session state and retry.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Failed to update agent session.";
};

const UPDATE_LOG_PREFIX = "[updateAgentSessionRecord]";
const updateLog = (action: string, data?: Record<string, unknown>) => {
  if (data) {
    console.log(`${UPDATE_LOG_PREFIX} ${action}`, data);
  } else {
    console.log(`${UPDATE_LOG_PREFIX} ${action}`);
  }
};
const updateLogError = (
  action: string,
  error: unknown,
  data?: Record<string, unknown>,
) => {
  console.error(`${UPDATE_LOG_PREFIX} ${action}`, { error, ...data });
};

export const updateAgentSessionRecord = async (
  input: UpdateAgentSessionRecordInput,
  dependencies: UpdateAgentSessionRecordDependencies = defaultDependencies,
): Promise<UpdateAgentSessionRecordResult> => {
  updateLog("called", {
    organizationId: input.organizationId,
    agentSessionId: input.agentSessionId,
    machineId: input.machineId,
    serviceIds: input.serviceIds ?? "(not set)",
    launchServiceId: input.launchServiceId ?? "(not set)",
    provider: input.provider ?? "(not set)",
    providerAgentSessionId: input.providerAgentSessionId ?? "(not set)",
    status: input.status ?? "(not set)",
    monitoringEnabled:
      input.monitoringEnabled === undefined
        ? "(not set)"
        : input.monitoringEnabled,
    autoDecide: input.autoDecide === undefined ? "(not set)" : input.autoDecide,
    writeTraceId: input.writeTraceId ?? "(not set)",
  });

  const payload: UpdateAgentSessionDto = {
    machineId: input.machineId,
    ...(input.serviceIds ? { serviceIds: input.serviceIds } : {}),
    ...(input.launchServiceId
      ? { launchServiceId: input.launchServiceId }
      : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.providerAgentSessionId
      ? { agentSessionId: input.providerAgentSessionId }
      : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.monitoringEnabled === undefined
      ? {}
      : { monitoringEnabled: input.monitoringEnabled }),
    ...(input.autoDecide === undefined ? {} : { autoDecide: input.autoDecide }),
    ...(input.config ? { config: input.config } : {}),
  };

  updateLog("built payload", {
    writeTraceId: input.writeTraceId ?? "(not set)",
    machineId: payload.machineId,
    hasLaunchServiceId: payload.launchServiceId !== undefined,
    hasServiceIds: payload.serviceIds !== undefined,
    hasProvider: payload.provider !== undefined,
    hasAgentSessionId: payload.agentSessionId !== undefined,
    hasStatus: payload.status !== undefined,
    hasMonitoringEnabled: payload.monitoringEnabled !== undefined,
    hasAutoDecide: payload.autoDecide !== undefined,
    payloadKeys: Object.keys(payload),
  });

  try {
    updateLog("pre-write: PATCH begin", {
      writeTraceId: input.writeTraceId ?? "(not set)",
      organizationId: input.organizationId,
      agentSessionId: input.agentSessionId,
      hasAgentSessionId: payload.agentSessionId !== undefined,
      hasLaunchServiceId: payload.launchServiceId !== undefined,
      hasProvider: payload.provider !== undefined,
      hasStatus: payload.status !== undefined,
    });
    updateLog("calling API PATCH", {
      writeTraceId: input.writeTraceId ?? "(not set)",
      organizationId: input.organizationId,
      agentSessionId: input.agentSessionId,
      payload: JSON.stringify(payload),
    });
    const response = await dependencies.updateAgentSession(
      input.organizationId,
      input.projectId,
      input.agentSessionId,
      payload,
    );
    updateLog("API PATCH returned", {
      writeTraceId: input.writeTraceId ?? "(not set)",
      hasData: response.data !== undefined && response.data !== null,
      responseKeys: response.data ? Object.keys(response.data) : [],
    });
    const session = response.data;
    if (!session) {
      updateLog("post-write: PATCH invalid response payload", {
        writeTraceId: input.writeTraceId ?? "(not set)",
      });
      return {
        ok: false,
        error: "Agent session was updated but response payload was invalid.",
      };
    }

    updateLog("OK — session updated", {
      writeTraceId: input.writeTraceId ?? "(not set)",
      returnedAgentSessionId: session.agentSessionId ?? "(null)",
      returnedServiceId: session.launchServiceId ?? "(null)",
      returnedProvider: session.provider ?? "(null)",
      returnedStatus: session.status ?? "(null)",
    });
    updateLog("post-write: PATCH succeeded", {
      writeTraceId: input.writeTraceId ?? "(not set)",
      agentSessionId: session.id,
      returnedAgentSessionId: session.agentSessionId ?? "(null)",
      returnedServiceId: session.launchServiceId ?? "(null)",
      returnedProvider: session.provider ?? "(null)",
    });

    return {
      ok: true,
      session,
    };
  } catch (error) {
    const mapped = toUpdateSessionError(error);
    updateLogError("API PATCH threw", error, {
      writeTraceId: input.writeTraceId ?? "(not set)",
      mappedError: mapped,
    });
    updateLog("post-write: PATCH failed", {
      writeTraceId: input.writeTraceId ?? "(not set)",
      agentSessionId: input.agentSessionId,
      mappedError: mapped,
    });
    return {
      ok: false,
      error: mapped,
    };
  }
};
