import { useQueryClient } from "@tanstack/react-query";
import { machinesClient } from "../../clients/serviceClients";
import { machineKeys } from "../collections/machines";
import { useMutation } from "../core/useMutation";

export interface RevokeMachineVariables {
  machineId: string;
}

export interface UseRevokeMachineOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useRevokeMachine(options: UseRevokeMachineOptions = {}) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    machineId,
  }: RevokeMachineVariables): Promise<void> => {
    await machinesClient.revokeMachine({ machineId: machineId });

    void queryClient.invalidateQueries({ queryKey: machineKeys.root() });
  };

  return useMutation(mutationFn, options);
}
