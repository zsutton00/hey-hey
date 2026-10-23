import { queryOptions } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type { MachineDto } from "../../api";
import { machinesClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { logger } from "../../utils/logger";

/** The current user's paired machines: one list per signed-in client. */
export const machineKeys = {
  root: () => ["machines"] as const,
  currentUser: () => [...machineKeys.root(), "currentUser"] as const,
};

async function fetchMachines(
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<MachineDto[]> {
  logger.info("data_core", "[machinesCollection] Fetch machines");

  const response = await machinesClient.listMachines(requestOptions);
  const machines = response.data?.data?.machines;

  if (!Array.isArray(machines)) {
    logger.warn(
      "data_core",
      "[machinesCollection] Unexpected response format",
      {
        dataType: typeof response.data,
      }
    );
    return [];
  }

  return machines;
}

export function machinesQueryOptions() {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: machineKeys.currentUser(),
    queryFn: ({ signal }) =>
      fetchMachines({ ...captureRequestOptions(), signal }),
  });
}
