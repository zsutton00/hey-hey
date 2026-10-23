import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type {
  CliReadRuntimeModelCatalogGetErrorResponseDto,
  CliReadRuntimeModelCatalogGetSuccessResponseDto,
} from "../../api";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from "../../api";
import { agentSessionsClient, machinesClient } from "../../clients";
import { executeControllerAuthorizedAction } from "../hooks/useControllerAuthorizedAction";

// The CLI's own answer, an error, or a timeout (an error with code TIMEOUT).
type RuntimeModelCatalogResponse =
  | CliReadRuntimeModelCatalogGetSuccessResponseDto
  | CliReadRuntimeModelCatalogGetErrorResponseDto;

export interface RuntimeModelCatalogRead {
  id: string;
  response: RuntimeModelCatalogResponse;
}

export interface RuntimeModelCatalogParams {
  organizationId: string;
  projectId: string;
  machineId: string;
}

/**
 * Asks the CLI on `machineId` which providers, models and reasoning efforts it
 * can launch. Needs no agent session, conversation or Run. Returns the CLI's
 * response untouched; it neither caches nor substitutes a built-in list when
 * the read fails.
 */
export async function fetchRuntimeModelCatalog(
  params: RuntimeModelCatalogParams,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<RuntimeModelCatalogRead> {
  const { organizationId, projectId, machineId } = params;
  const machinesResponse = await machinesClient.listMachines(requestOptions);
  const machine = machinesResponse.data?.data?.machines.find(
    (candidate) => candidate.machineId === machineId,
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
      targetKind: HostActionTargetKind.CliRead,
      targetId: machineId,
    },
    submit: ({ authorization }) =>
      agentSessionsClient.getRuntimeModelCatalog(
        {
          organizationId,
          projectId,
          machineId,
          cliReadRuntimeModelCatalogGetRequest: {
            operation: "runtime.model_catalog.get",
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

  if (!result || result.operation !== "runtime.model_catalog.get") {
    throw new Error("The model catalog read returned an unexpected response.");
  }

  return {
    id: result.requestId,
    response: result,
  };
}
