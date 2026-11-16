import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  WorkItemExecutionState,
  WorkItemExecutionStateBatchRequestDto,
  WorkItemExecutionStateObservation,
} from '@hey-hey/contracts/api/models';
import { workItemExecutionStateJsonSchemas } from 'src/generated/work-item-execution-state.schemas';

const ajv = addFormats(
  new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  }),
);

const validateObservation = ajv.compile<WorkItemExecutionStateObservation>(
  workItemExecutionStateJsonSchemas.WorkItemExecutionStateObservation,
);
const validatePayload = ajv.compile<WorkItemExecutionState['state']>(
  workItemExecutionStateJsonSchemas.WorkItemExecutionStatePayload,
);
const validateBatchRequest = ajv.compile<WorkItemExecutionStateBatchRequestDto>(
  workItemExecutionStateJsonSchemas.WorkItemExecutionStateBatchRequestDto,
);

/** Schema locations that failed, without any of the submitted content. */
const failedLocations = (
  errors: ErrorObject[] | null | undefined,
): string[] => [
  ...new Set(
    (errors ?? []).map(
      (error) => `${error.instancePath || '/'} ${error.keyword}`,
    ),
  ),
];

export type Parsed<T> =
  | { valid: true; value: T }
  | { valid: false; failures: string[] };

const parseWith =
  <T>(validate: {
    (value: unknown): value is T;
    errors?: ErrorObject[] | null;
  }) =>
  (value: unknown): Parsed<T> =>
    validate(value)
      ? { valid: true, value }
      : { valid: false, failures: failedLocations(validate.errors) };

/** Inbound CLI frame, validated once where it enters the platform. */
export const parseWorkItemExecutionStateObservation =
  parseWith(validateObservation);

/** Retained payload read back from storage, which may predate this contract. */
export const parseStoredWorkItemExecutionStatePayload =
  parseWith(validatePayload);

export const parseWorkItemExecutionStateBatchRequest =
  parseWith(validateBatchRequest);
