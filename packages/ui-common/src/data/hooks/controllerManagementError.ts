import axios from "axios";
import {
  ControllerManagementErrorDtoMessageEnum,
  ControllerManagementErrorDtoStatusCodeEnum,
  ControllerManagementOutcomeCode,
  type ControllerManagementErrorDto,
} from "../../api";

export class ControllerManagementDenialError extends Error {
  readonly serverError: ControllerManagementErrorDto;

  get status(): number {
    return this.serverError.statusCode;
  }

  constructor(serverError: ControllerManagementErrorDto) {
    super(serverError.message);
    this.name = "ControllerManagementDenialError";
    this.serverError = serverError;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isControllerManagementErrorDto = (
  value: unknown
): value is ControllerManagementErrorDto => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.success === false &&
    value.message ===
      ControllerManagementErrorDtoMessageEnum.UnableToCompleteControllerManagementOperation &&
    Object.values(ControllerManagementOutcomeCode).some(
      (code) => code === value.code
    ) &&
    value.data === null &&
    typeof value.timestamp === "string" &&
    Object.values(ControllerManagementErrorDtoStatusCodeEnum).some(
      (statusCode) => statusCode === value.statusCode
    ) &&
    typeof value.path === "string"
  );
};

export const toControllerManagementError = (
  error: unknown
): ControllerManagementDenialError | Error => {
  if (axios.isAxiosError(error)) {
    const responseData: unknown = error.response?.data;
    if (isControllerManagementErrorDto(responseData)) {
      return new ControllerManagementDenialError(responseData);
    }
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unable to complete controller management operation.");
};
