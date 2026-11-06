import { useMemo } from "react";
import { MachineExecutionReadinessState, type MachineDto } from "../../api";
import { machinesQueryOptions } from "../collections/machines";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseUserPairedMachinesOptions = CollectionHookOptions<MachineDto> & {
  /**
   * Re-read the list at this interval until a machine is ready to run work,
   * so a CLI that connects after the page opened shows up without a reload.
   */
  pollUntilReadyMs?: number;
};

export interface UseUserPairedMachinesReturn extends DataCollectionHookReturn<MachineDto> {
  machines: MachineDto[];
}

const NO_MACHINES: MachineDto[] = [];

export function useUserPairedMachines(
  options: UseUserPairedMachinesOptions = {},
): UseUserPairedMachinesReturn {
  const {
    enabled = true,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
    pollUntilReadyMs,
  } = options;

  const queryOptions = useMemo(
    () => ({
      ...machinesQueryOptions(),
      ...(pollUntilReadyMs
        ? {
            refetchInterval: (query: {
              state: { data: MachineDto[] | undefined };
            }) =>
              query.state.data?.some(
                (machine) =>
                  machine.executionReadiness ===
                  MachineExecutionReadinessState.Ready,
              )
                ? false
                : pollUntilReadyMs,
          }
        : {}),
    }),
    [pollUntilReadyMs],
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  });

  const machines = result.data ?? NO_MACHINES;

  return { ...state, machines, data: machines };
}
