import type {
  AbandonMachineEnrollmentClaimRequestDto,
  AbandonMachineEnrollmentClaimResponseDto,
} from "../../api";
import { machinesClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";
import { toMachineEnrollmentClaimError } from "./machineEnrollmentClaimError";

export type AbandonMachineEnrollmentClaimVariables =
  AbandonMachineEnrollmentClaimRequestDto;

export interface UseAbandonMachineEnrollmentClaimOptions {
  onSuccess?: (data: AbandonMachineEnrollmentClaimResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useAbandonMachineEnrollmentClaim(
  options: UseAbandonMachineEnrollmentClaimOptions = {},
) {
  const mutationFn = async (
    variables: AbandonMachineEnrollmentClaimVariables,
  ): Promise<AbandonMachineEnrollmentClaimResponseDto> => {
    try {
      const response = await machinesClient.abandonMachineEnrollmentClaim({
        abandonMachineEnrollmentClaimRequestDto: variables,
      });
      return response.data.data;
    } catch (error) {
      throw toMachineEnrollmentClaimError(error);
    }
  };

  return useMutation<
    AbandonMachineEnrollmentClaimVariables,
    AbandonMachineEnrollmentClaimResponseDto
  >(mutationFn, options);
}
