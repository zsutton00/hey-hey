import { ConflictException } from '@nestjs/common';
import { PrivateBetaAccessProvisioningFailureCode } from '../generated';

export const PRIVATE_BETA_PROVISIONING_FAILURE_MESSAGE =
  'Private-beta provisioning could not be completed.';

export class PrivateBetaProvisioningError extends Error {
  readonly errorType: string;

  constructor(
    readonly code: PrivateBetaAccessProvisioningFailureCode,
    error: unknown,
  ) {
    super(PRIVATE_BETA_PROVISIONING_FAILURE_MESSAGE);
    this.name = PrivateBetaProvisioningError.name;
    this.errorType = error instanceof Error ? error.name : typeof error;
  }
}

export function toPrivateBetaProvisioningError(
  code: PrivateBetaAccessProvisioningFailureCode,
  error: unknown,
): PrivateBetaProvisioningError {
  if (error instanceof PrivateBetaProvisioningError) {
    return error;
  }
  if (
    code === PrivateBetaAccessProvisioningFailureCode.UserProvisioning &&
    error instanceof ConflictException
  ) {
    return new PrivateBetaProvisioningError(
      PrivateBetaAccessProvisioningFailureCode.UserConflict,
      error,
    );
  }
  return new PrivateBetaProvisioningError(code, error);
}

export function parsePrivateBetaProvisioningFailureCode(
  code: string | null,
): PrivateBetaAccessProvisioningFailureCode | null {
  if (code === null) {
    return null;
  }
  for (const generatedCode of Object.values(
    PrivateBetaAccessProvisioningFailureCode,
  )) {
    if (generatedCode === code) {
      return generatedCode;
    }
  }
  throw new Error('Private-beta provisioning failure code is invalid');
}
