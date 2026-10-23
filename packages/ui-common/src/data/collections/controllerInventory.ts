import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { toControllerManagementError } from "../hooks/controllerManagementError";
import { machinesClient } from "../../clients/serviceClients";
export const controllerInventoryKeys = {
  root: () => ["controllerInventory"] as const,
  detail: (machineId: string) =>
    [...controllerInventoryKeys.root(), machineId] as const,
};
export function controllerInventoryQueryOptions(machineId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: controllerInventoryKeys.detail(machineId),
    queryFn: async ({ signal }) => {
      try {
        const response = await machinesClient.listMachineControllers(
          { machineId },
          { ...captureRequestOptions(), signal }
        );
        return response.data.data;
      } catch (error) {
        throw toControllerManagementError(error);
      }
    },
  });
}
