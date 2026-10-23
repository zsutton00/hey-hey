import {
  ControllerAuthorizationDenialReason,
  MachineExecutionReadinessState,
  type AdmissionEnvelopeAuthorization,
  type ControllerAuthorizationDeniedDto,
  type HostActionPreparation,
  type MachineDto,
} from "../../api";
import { controllerAuthorizationClient } from "../../clients/serviceClients";
import { extractErrorCode } from "../../utils/errorUtils";
import { useMutation, type MutationOptions } from "../core/useMutation";
import {
  readControllerAuthorizationPreference,
  writeControllerAuthorizationCadence,
} from "../controllerAuthorization/controllerAuthorizationPreference";
import {
  requestControllerAuthorizationCadence,
  type ControllerAuthorizationPromptCause,
} from "../controllerAuthorization/controllerAuthorizationPrompt";
import {
  collectControllerAssertion,
  ControllerAuthorizationClientError,
  ControllerAuthorizationClientFailureCode,
} from "../controllerAuthorization/webauthnAssertion";

export interface ControllerAuthorizedActionSubmission {
  authorization: AdmissionEnvelopeAuthorization;
}

export interface ControllerAuthorizedActionVariables<TResult> {
  cause?: ControllerAuthorizationPromptCause | null;
  organizationId: string;
  projectId: string;
  machine: MachineDto;
  action: HostActionPreparation;
  submit: (
    authorization: ControllerAuthorizedActionSubmission
  ) => Promise<TResult>;
}

export type ControllerAuthorizedActionResult<TResult> =
  | { outcome: "ADMITTED"; data: TResult }
  | ControllerAuthorizationDeniedDto;

export type UseControllerAuthorizedActionOptions<TResult> = MutationOptions<
  ControllerAuthorizedActionResult<TResult>
>;

const requirePayload = <T>(
  payload: T | null | undefined,
  message: string
): T => {
  if (!payload) {
    throw new Error(message);
  }
  return payload;
};

const RETRYABLE_DENIAL_REASONS = new Set<string>([
  ControllerAuthorizationDenialReason.AuthorizationExpired,
  ControllerAuthorizationDenialReason.MachineNotReady,
  ControllerAuthorizationDenialReason.ControllerNotActive,
]);

const getAuthorizationRetryMessage = (error: unknown): string | null => {
  if (error instanceof ControllerAuthorizationClientError) {
    if (
      error.code === ControllerAuthorizationClientFailureCode.UserCancelled ||
      error.code ===
        ControllerAuthorizationClientFailureCode.UnsupportedWebAuthn ||
      error.code === ControllerAuthorizationClientFailureCode.InvalidCredential
    ) {
      return error.message;
    }
    return null;
  }

  const code = extractErrorCode(error);
  if (code && RETRYABLE_DENIAL_REASONS.has(code)) {
    return "That authorization is no longer valid. Choose a cadence and authorize again.";
  }
  return null;
};

export function useControllerAuthorizedAction<TResult>(
  options: UseControllerAuthorizedActionOptions<TResult> = {}
) {
  return useMutation(executeControllerAuthorizedAction<TResult>, options);
}

export async function executeControllerAuthorizedAction<TResult>({
  cause,
  organizationId,
  projectId,
  machine,
  action,
  submit,
}: ControllerAuthorizedActionVariables<TResult>): Promise<
  ControllerAuthorizedActionResult<TResult>
> {
  if (machine.executionReadiness !== MachineExecutionReadinessState.Ready) {
    throw new ControllerAuthorizationClientError(
      ControllerAuthorizationClientFailureCode.MachineNotReady,
      "The selected machine is not ready for controller-authorized work."
    );
  }

  const preference = readControllerAuthorizationPreference(organizationId);
  const resolutionResponse =
    await controllerAuthorizationClient.resolveControllerAuthorization({
      organizationId,
      projectId,
      resolveControllerAuthorizationRequestDto: {
        machineId: machine.machineId,
        action,
      },
    });
  const resolution = requirePayload(
    resolutionResponse.data?.data,
    "The platform did not return a controller authorization decision."
  );

  let retryMessage: string | null = null;
  if (resolution.outcome === "ACTIVE_GRANT") {
    try {
      const data = await submit({ authorization: resolution.authorization });
      return { outcome: "ADMITTED", data };
    } catch (error) {
      retryMessage = getAuthorizationRetryMessage(error);
      if (!retryMessage) {
        throw error;
      }
    }
  }

  while (true) {
    const cadence = await requestControllerAuthorizationCadence({
      cause,
      errorMessage: retryMessage,
      machine,
      preferredCadence: preference.cadence,
    });
    writeControllerAuthorizationCadence(organizationId, cadence);

    try {
      if (!machine.currentControllerCredentialId) {
        throw new ControllerAuthorizationClientError(
          ControllerAuthorizationClientFailureCode.InvalidCredential,
          "Choose an exact active controller passkey before authorizing."
        );
      }
      const preparationResponse =
        await controllerAuthorizationClient.prepareControllerAuthorization({
          organizationId,
          projectId,
          prepareControllerAuthorizationRequestDto: {
            machineId: machine.machineId,
            controllerCredentialId: machine.currentControllerCredentialId,
            cadence,
            action,
          },
        });
      const prepared = requirePayload(
        preparationResponse.data?.data,
        "The platform did not return controller authorization preparation."
      );
      const assertion = await collectControllerAssertion({
        grantDescriptor: prepared.grantDescriptor,
        publicKey: prepared.publicKey,
        intent: prepared.intent,
      });
      const admissionResponse =
        await controllerAuthorizationClient.submitControllerAuthorizedAction({
          organizationId,
          projectId,
          submitControllerAuthorizedActionRequestDto: {
            authorizationId: assertion.intent.authorizationId,
            assertion,
          },
        });
      const admission = requirePayload(
        admissionResponse.data?.data,
        "The platform did not return a controller authorization admission decision."
      );
      if (admission.outcome === "DENIED") {
        if (!admission.retryable) {
          return admission;
        }
        retryMessage =
          "That authorization was not admitted. Choose a cadence and authorize again.";
        continue;
      }
      const data = await submit({ authorization: assertion });
      return { outcome: "ADMITTED", data };
    } catch (error) {
      retryMessage = getAuthorizationRetryMessage(error);
      if (!retryMessage) {
        throw error;
      }
    }
  }
}
