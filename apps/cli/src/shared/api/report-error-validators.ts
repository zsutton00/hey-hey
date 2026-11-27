import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {
  ApiErrorResponse,
  CreateReportCompletedAttemptError,
  CreateReportValidationError,
} from '@hey-hey/contracts/api/models';
import { reportErrorSchemas } from './generated/report-error-schemas';

const errorValidator = new Ajv({ strict: false });
addFormats(errorValidator);
export const parsePlatformError = errorValidator.compile<ApiErrorResponse>(
  reportErrorSchemas.ApiErrorResponse,
);
export const parseValidationError = errorValidator.compile<CreateReportValidationError>(
  reportErrorSchemas.CreateReportValidationError,
);
export const parseCompletedAttempt = errorValidator.compile<CreateReportCompletedAttemptError>(
  reportErrorSchemas.CreateReportCompletedAttemptError,
);
