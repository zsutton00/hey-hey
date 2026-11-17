import { queryOptions } from "@tanstack/react-query";
import type {
  AgentSessionContinuationDto,
  AgentSessionContinuationStatusDto,
  MachineDto,
} from "../../api";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from "../../api";
import { agentSessionsClient } from "../../clients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { executeControllerAuthorizedAction } from "../hooks/useControllerAuthorizedAction";

/** Continuation status of one Agent Session. Keys: [root, org, project, session]. */
export const agentSessionContinuationKeys = {
  root: () => ["agentSessionContinuation"] as const,
  session: (
    organizationId: string,
    projectId: string,
    agentSessionId: string,
  ) =>
    [
      ...agentSessionContinuationKeys.root(),
      organizationId,
      projectId,
      agentSessionId,
    ] as const,
};

export function agentSessionContinuationQueryOptions(
  organizationId: string,
  projectId: string,
  agentSessionId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: agentSessionContinuationKeys.session(
      organizationId,
      projectId,
      agentSessionId,
    ),
    queryFn: async ({ signal }) => {
      const response =
        await agentSessionsClient.getAgentSessionContinuationStatus(
          { organizationId, projectId, agentSessionId },
          { ...captureRequestOptions(), signal },
        );
      return response.data?.data ?? null;
    },
  });
}

export interface AgentSessionContinuationTarget {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
}

export class ContinuationAuthorizationDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`Controller authorization denied: ${reason}`);
    this.name = "ContinuationAuthorizationDeniedError";
  }
}

const requireContinuation = (
  value: AgentSessionContinuationDto | undefined,
): AgentSessionContinuationDto => {
  if (!value) {
    throw new Error("The platform did not return the continuation.");
  }
  return value;
};

/**
 * Asks the destination computer, under its own controller authorization,
 * whether it holds usable provider state for this session. Moves nothing.
 */
export async function inspectAgentSessionContinuation(
  target: AgentSessionContinuationTarget & {
    continuationId: string;
    expectedSourceMachineId: string;
    destination: MachineDto;
  },
): Promise<AgentSessionContinuationDto> {
  const requestOptions = captureRequestOptions();
  const authorized = await executeControllerAuthorizedAction({
    organizationId: target.organizationId,
    projectId: target.projectId,
    machine: target.destination,
    action: {
      requestId: crypto.randomUUID(),
      actionCategory: HostActionCategory.CliRead,
      actionType: HostAffectingActionType.CliRead,
      targetKind: HostActionTargetKind.CliRead,
      targetId: target.destination.machineId,
      agentSessionId: target.agentSessionId,
      continuationId: target.continuationId,
      expectedSourceMachineId: target.expectedSourceMachineId,
    },
    submit: ({ authorization }) =>
      agentSessionsClient.inspectAgentSessionContinuation(
        {
          organizationId: target.organizationId,
          projectId: target.projectId,
          agentSessionId: target.agentSessionId,
          continuationId: target.continuationId,
          inspectAgentSessionContinuationRequestDto: {
            expectedSourceMachineId: target.expectedSourceMachineId,
            destinationMachineId: target.destination.machineId,
            authorization,
          },
        },
        requestOptions,
      ),
  });
  if (authorized.outcome === "DENIED") {
    throw new ContinuationAuthorizationDeniedError(authorized.reason);
  }
  return requireContinuation(authorized.data.data.data);
}

/**
 * Delivers the attempt: the first delivery rebinds the session; on a FAILED
 * attempt it retries delivery to the same destination without a second
 * rebind. Each delivery runs under the destination's authorization for
 * exactly the server-authored start inputs.
 */
export async function commitAgentSessionContinuation(
  target: AgentSessionContinuationTarget & {
    continuation: AgentSessionContinuationDto;
    destination: MachineDto;
    confirmSavedHistory: boolean;
  },
): Promise<AgentSessionContinuationDto> {
  const requestOptions = captureRequestOptions();
  const authorized = await executeControllerAuthorizedAction({
    organizationId: target.organizationId,
    projectId: target.projectId,
    machine: target.destination,
    action: {
      requestId: crypto.randomUUID(),
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: target.agentSessionId,
      inputs: target.continuation.startRunInputs,
    },
    submit: ({ authorization }) =>
      agentSessionsClient.commitAgentSessionContinuation(
        {
          organizationId: target.organizationId,
          projectId: target.projectId,
          agentSessionId: target.agentSessionId,
          continuationId: target.continuation.continuationId,
          commitAgentSessionContinuationRequestDto: {
            confirmSavedHistory: target.confirmSavedHistory,
            authorization,
          },
        },
        requestOptions,
      ),
  });
  if (authorized.outcome === "DENIED") {
    throw new ContinuationAuthorizationDeniedError(authorized.reason);
  }
  return requireContinuation(authorized.data.data.data);
}

/** Records that the person declined; nothing is delivered or started. */
export async function cancelAgentSessionContinuation(
  target: AgentSessionContinuationTarget & { continuationId: string },
): Promise<AgentSessionContinuationDto> {
  const response = await agentSessionsClient.cancelAgentSessionContinuation(
    {
      organizationId: target.organizationId,
      projectId: target.projectId,
      agentSessionId: target.agentSessionId,
      continuationId: target.continuationId,
    },
    captureRequestOptions(),
  );
  return requireContinuation(response.data.data);
}

export type { AgentSessionContinuationStatusDto };
