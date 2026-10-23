import { useMemo } from "react";
import type { MachineDto } from "../../api";
import { machinesQueryOptions } from "../collections/machines";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseUserPairedMachinesOptions = CollectionHookOptions<MachineDto>;

export interface UseUserPairedMachinesReturn
  extends DataCollectionHookReturn<MachineDto> {
  machines: MachineDto[];
}

const NO_MACHINES: MachineDto[] = [];

export function useUserPairedMachines(
  options: UseUserPairedMachinesOptions = {}
): UseUserPairedMachinesReturn {
  const {
    enabled = true,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;

  const queryOptions = useMemo(() => machinesQueryOptions(), []);
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
