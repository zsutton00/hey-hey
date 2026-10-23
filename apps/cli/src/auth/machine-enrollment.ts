import type { AxiosError } from 'axios';
import { isAxiosError } from 'axios';

export type MachineEnrollmentErrorCode =
  | 'INVALID_MACHINE_MATERIAL'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNEXPECTED';

export class MachineEnrollmentError extends Error {
  readonly code: MachineEnrollmentErrorCode;
  readonly statusCode?: number;
  readonly retryAfterSeconds?: number;
  override readonly cause?: Error;

  constructor(
    message: string,
    code: MachineEnrollmentErrorCode,
    options: { statusCode?: number; retryAfterSeconds?: number; cause?: Error } = {},
  ) {
    super(message);
    this.name = 'MachineEnrollmentError';
    this.code = code;
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

const DEFAULT_MESSAGES: Record<MachineEnrollmentErrorCode, string> = {
  INVALID_MACHINE_MATERIAL: 'The machine enrollment request was rejected as invalid.',
  RATE_LIMITED: 'Too many enrollment attempts. Wait a few minutes before trying again.',
  NETWORK_ERROR: 'Could not reach the Hey Hey API to open an enrollment.',
  INVALID_RESPONSE: 'Machine enrollment returned an unexpected response.',
  UNEXPECTED: 'Machine enrollment failed unexpectedly.',
};

const errorCodeForStatus = (status: number): MachineEnrollmentErrorCode => {
  if (status === 400) return 'INVALID_MACHINE_MATERIAL';
  if (status === 429) return 'RATE_LIMITED';
  return 'UNEXPECTED';
};

const extractErrorDetails = (
  axiosError: AxiosError,
  code: MachineEnrollmentErrorCode,
): { message: string; retryAfterSeconds?: number } => {
  const body = axiosError.response?.data;
  if (typeof body !== 'object' || body === null) {
    return { message: DEFAULT_MESSAGES[code] };
  }

  const message =
    'message' in body && typeof body.message === 'string' ? body.message : DEFAULT_MESSAGES[code];
  const retryAfter = 'retryAfterSeconds' in body ? body.retryAfterSeconds : undefined;
  const retryAfterSeconds =
    typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter : undefined;
  return retryAfterSeconds === undefined ? { message } : { message, retryAfterSeconds };
};

/** Names the attempted URL and the transport cause (e.g. ECONNREFUSED) so the failure is actionable. */
const describeNetworkFailure = (axiosError: AxiosError): string => {
  const url = axiosError.config?.url;
  const target = url ? ` at ${url}` : '';
  const cause = axiosError.code ?? axiosError.message;
  return `Could not reach the Hey Hey API${target} to open an enrollment (${cause}).`;
};

/** Converts an enrollment API failure into a stable user-facing error. */
export const toMachineEnrollmentError = (error: Error): MachineEnrollmentError => {
  if (error instanceof MachineEnrollmentError) return error;

  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) {
      return new MachineEnrollmentError(describeNetworkFailure(error), 'NETWORK_ERROR', {
        cause: error,
      });
    }

    const code = errorCodeForStatus(status);
    const { message, retryAfterSeconds } = extractErrorDetails(error, code);
    return new MachineEnrollmentError(message, code, {
      statusCode: status,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      cause: error,
    });
  }

  return new MachineEnrollmentError(
    error.message,
    'UNEXPECTED',
    { cause: error },
  );
};
