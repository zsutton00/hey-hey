import type { ControllerInventoryResponseDto } from "../../api";
import { controllerInventoryQueryOptions } from "../collections/controllerInventory";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UseControllerInventoryOptions =
  CollectionHookOptions<ControllerInventoryResponseDto>;
export type UseControllerInventoryReturn =
  DataHookReturn<ControllerInventoryResponseDto>;
export function useControllerInventory(
  machineId: string | undefined,
  options: CollectionHookOptions<ControllerInventoryResponseDto> = {}
): UseControllerInventoryReturn {
  const { result, state } = useDataLayerQuery(
    controllerInventoryQueryOptions(machineId ?? ""),
    { ...options, enabled: options.enabled !== false && Boolean(machineId) }
  );
  return { ...state, data: result.data ?? null };
}
