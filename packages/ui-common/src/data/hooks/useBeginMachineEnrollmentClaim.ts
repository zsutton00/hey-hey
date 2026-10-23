import type {
  BeginMachineEnrollmentClaimRequestDto,
  BeginMachineEnrollmentClaimResponseDto,
} from "../../api";
import { machinesClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";
import { toMachineEnrollmentClaimError } from "./machineEnrollmentClaimError";

export type BeginMachineEnrollmentClaimVariables =
  BeginMachineEnrollmentClaimRequestDto;

export interface UseBeginMachineEnrollmentClaimOptions {
  onSuccess?: (data: BeginMachineEnrollmentClaimResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useBeginMachineEnrollmentClaim(
  options: UseBeginMachineEnrollmentClaimOptions = {},
) {
  const mutationFn = async (
    variables: BeginMachineEnrollmentClaimVariables,
  ): Promise<BeginMachineEnrollmentClaimResponseDto> => {
    try {
      const response = await machinesClient.beginMachineEnrollmentClaim({
        beginMachineEnrollmentClaimRequestDto: variables,
      });
      return response.data.data;
    } catch (error) {
      throw toMachineEnrollmentClaimError(error);
    }
  };

  return useMutation<
    BeginMachineEnrollmentClaimVariables,
    BeginMachineEnrollmentClaimResponseDto
  >(mutationFn, options);
}
