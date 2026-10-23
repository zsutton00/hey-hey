import axios from "axios";
import {
  MachineEnrollmentClaimFailureCode,
  MachineEnrollmentClaimFailureErrorDtoStatusCodeEnum,
  MachineEnrollmentClaimRateLimitErrorDtoCodeEnum,
  MachineEnrollmentClaimRateLimitErrorDtoStatusCodeEnum,
  type MachineEnrollmentClaimFailureErrorDto,
  type MachineEnrollmentClaimRateLimitErrorDto,
} from "../../api";

export type MachineEnrollmentClaimErrorDto =
  | MachineEnrollmentClaimFailureErrorDto
  | MachineEnrollmentClaimRateLimitErrorDto;

export class MachineEnrollmentClaimError extends Error {
  readonly serverError: MachineEnrollmentClaimErrorDto | null;
  readonly code: MachineEnrollmentClaimErrorDto["code"] | null;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message = "Unable to claim this enrollment.",
    serverError: MachineEnrollmentClaimErrorDto | null = null,
  ) {
    super(message);
    this.name = "MachineEnrollmentClaimError";
    this.serverError = serverError;
    this.code = serverError?.code ?? null;
    this.status = serverError?.statusCode ?? null;
    this.retryAfterSeconds =
      serverError && "retryAfterSeconds" in serverError
        ? serverError.retryAfterSeconds
        : null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMachineEnrollmentClaimFailure = (
  value: unknown,
): value is MachineEnrollmentClaimFailureErrorDto => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.success === false &&
    typeof value.message === "string" &&
    value.message.trim().length > 0 &&
    Object.values(MachineEnrollmentClaimFailureCode).includes(
      value.code as MachineEnrollmentClaimFailureCode,
    ) &&
    value.data === null &&
    value.timestamp !== undefined &&
    typeof value.timestamp === "string" &&
    value.statusCode === MachineEnrollmentClaimFailureErrorDtoStatusCodeEnum.NUMBER_400 &&
    value.path !== undefined &&
    typeof value.path === "string"
  );
};

const isMachineEnrollmentClaimRateLimit = (
  value: unknown,
): value is MachineEnrollmentClaimRateLimitErrorDto => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.success === false &&
    typeof value.message === "string" &&
    value.message.trim().length > 0 &&
    value.code ===
      MachineEnrollmentClaimRateLimitErrorDtoCodeEnum.MachineEnrollmentClaimRateLimited &&
    value.data === null &&
    typeof value.retryAfterSeconds === "number" &&
    Number.isInteger(value.retryAfterSeconds) &&
    value.retryAfterSeconds >= 1 &&
    value.timestamp !== undefined &&
    typeof value.timestamp === "string" &&
    value.statusCode === MachineEnrollmentClaimRateLimitErrorDtoStatusCodeEnum.NUMBER_429 &&
    value.path !== undefined &&
    typeof value.path === "string"
  );
};

export const toMachineEnrollmentClaimError = (
  error: unknown,
): MachineEnrollmentClaimError | Error => {
  if (axios.isAxiosError(error)) {
    const responseData: unknown = error.response?.data;
    if (
      isMachineEnrollmentClaimFailure(responseData) ||
      isMachineEnrollmentClaimRateLimit(responseData)
    ) {
      return new MachineEnrollmentClaimError(
        responseData.message,
        responseData,
      );
    }
    return new MachineEnrollmentClaimError();
  }

  return new MachineEnrollmentClaimError();
};
