import type {
  CompleteMachineEnrollmentClaimRequestDto,
  CompleteMachineEnrollmentClaimResponseDto,
} from "../../api";
import { machinesClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";
import { toMachineEnrollmentClaimError } from "./machineEnrollmentClaimError";

export type CompleteMachineEnrollmentClaimVariables =
  CompleteMachineEnrollmentClaimRequestDto;

export interface UseCompleteMachineEnrollmentClaimOptions {
  onSuccess?: (data: CompleteMachineEnrollmentClaimResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useCompleteMachineEnrollmentClaim(
  options: UseCompleteMachineEnrollmentClaimOptions = {},
) {
  const mutationFn = async (
    variables: CompleteMachineEnrollmentClaimVariables,
  ): Promise<CompleteMachineEnrollmentClaimResponseDto> => {
    try {
      const response = await machinesClient.completeMachineEnrollmentClaim({
        completeMachineEnrollmentClaimRequestDto: variables,
      });
      return response.data.data;
    } catch (error) {
      throw toMachineEnrollmentClaimError(error);
    }
  };

  return useMutation<
    CompleteMachineEnrollmentClaimVariables,
    CompleteMachineEnrollmentClaimResponseDto
  >(mutationFn, options);
}
