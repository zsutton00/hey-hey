export const MACHINE_ENROLLMENT_DIAGNOSTIC_CONTRACT =
  'machine-enrollment-v2' as const;

export type MachineEnrollmentDiagnosticEvent =
  | 'creation'
  | 'begin_claim'
  | 'complete_claim'
  | 'browser_rejection'
  | 'poll'
  | 'local_confirmation'
  | 'activation'
  | 'expiry'
  | 'throttling'
  | 'failed_transition';

type DiagnosticPrimitive = string | number | boolean | undefined;

export interface MachineEnrollmentDiagnosticFields {
  enrollmentId?: string;
  machineId?: string;
  userId?: string;
  organizationId?: string;
  sourceClass?: string;
  state?: string;
  decision?: string;
  reasonCode: string;
  attemptCount?: number;
  accountCount?: number;
  sourceCount?: number;
  retryAfterSeconds?: number;
  countedAsInvalidAttempt?: boolean;
  [field: string]: DiagnosticPrimitive;
}

const PRIVATE_DIAGNOSTIC_FIELD =
  /(usercode|secret|credential|signature|webauthn|challenge|payload|privatekey|publickey)/i;

/**
 * Produces the one privacy-bounded shape used by enrollment lifecycle logs.
 * Callers may add only primitive, non-secret facts; enrollment codes, device
 * secrets, credentials, signatures, and WebAuthn payloads never belong here.
 */
export function machineEnrollmentDiagnostic(
  event: MachineEnrollmentDiagnosticEvent,
  fields: MachineEnrollmentDiagnosticFields,
): Record<string, string | number | boolean> {
  const diagnostic: Record<string, string | number | boolean> = {
    event: `machine_enrollment.${event}`,
    operation: 'machine_enrollment',
    protocolVersion: 2,
    contractVersion: MACHINE_ENROLLMENT_DIAGNOSTIC_CONTRACT,
  };

  for (const [field, value] of Object.entries(fields)) {
    if (PRIVATE_DIAGNOSTIC_FIELD.test(field)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      diagnostic[field] = value;
    }
  }

  return diagnostic;
}
