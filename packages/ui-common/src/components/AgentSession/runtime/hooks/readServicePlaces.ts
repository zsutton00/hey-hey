import type { CliReadServicePlacesEntry, MachineDto } from "../../../../api";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from "../../../../api";
import { agentSessionsClient } from "../../../../clients";
import { executeControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";

export type ServicePlacesRead = ReadonlyMap<string, CliReadServicePlacesEntry>;

export interface ReadServicePlacesInput {
  organizationId: string;
  projectId: string;
  machine: MachineDto;
  serviceIds: readonly string[];
  /** Also returns the local branches matching this text. */
  branchQuery?: string;
}

/** One machine read of where each Service can work, keyed by Service id. */
export const readServicePlaces = async ({
  organizationId,
  projectId,
  machine,
  serviceIds,
  branchQuery,
}: ReadServicePlacesInput): Promise<ServicePlacesRead> => {
  const { machineId } = machine;
  const ids = [...serviceIds];
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
      serviceIds: ids,
      ...(branchQuery ? { branchQuery } : {}),
    },
    submit: ({ authorization }) =>
      agentSessionsClient.listMachineServicePlaces({
        organizationId,
        projectId,
        machineId,
        cliReadWorkspaceServicePlacesListRequest: {
          operation: "workspace.service_places.list",
          serviceIds: ids,
          ...(branchQuery ? { branchQuery } : {}),
          authorization,
        },
      }),
  });

  if (authorized.outcome === "DENIED") {
    throw new Error(`Controller authorization denied: ${authorized.reason}`);
  }

  const response = authorized.data.data.data;
  if (!response) {
    throw new Error("The Service places read returned no result.");
  }
  if (response.status === "error") {
    throw new Error(response.error.message);
  }

  return new Map(
    response.result.services.map((entry) => [entry.serviceId, entry]),
  );
};
