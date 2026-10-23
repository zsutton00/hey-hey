import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ControllerRevocationResponseDto,
  MachinesApiRevokeMachineControllerRequest,
} from "../../api";
import { machinesClient } from "../../clients/serviceClients";
import { controllerInventoryKeys } from "../collections/controllerInventory";
import { machineKeys } from "../collections/machines";
import { useMutation } from "../core/useMutation";
import { toControllerManagementError } from "./controllerManagementError";

export type RevokeControllerVariables =
  MachinesApiRevokeMachineControllerRequest;

export interface UseRevokeControllerOptions {
  onSuccess?: (data: ControllerRevocationResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useRevokeController(options: UseRevokeControllerOptions = {}) {
  const queryClient = useQueryClient();

  const mutationFn = async (
    variables: RevokeControllerVariables
  ): Promise<ControllerRevocationResponseDto> => {
    let response: Awaited<
      ReturnType<typeof machinesClient.revokeMachineController>
    >;
    try {
      response = await machinesClient.revokeMachineController(variables);
    } catch (error) {
      throw toControllerManagementError(error);
    }

    const result = response.data.data;
    void invalidateWithFollowUpRead(queryClient, {
      queryKey: controllerInventoryKeys.detail(variables.machineId),
      exact: true,
    });
    void queryClient.invalidateQueries({ queryKey: machineKeys.root() });

    return result;
  };

  return useMutation<
    RevokeControllerVariables,
    ControllerRevocationResponseDto
  >(mutationFn, options);
}
