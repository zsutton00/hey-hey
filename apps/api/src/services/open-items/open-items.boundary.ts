import { Logger } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  ActivateOpenItemRequest,
  AssignOpenItemsToGroupRequest,
  CreateOpenItemGroupRequest,
  DeleteOpenItemGroupRequest,
  MigrateOpenItemsRequest,
  MoveOpenItemGroupMemberRequest,
  MoveOpenItemGroupRequest,
  MoveOpenItemRequest,
  OpenItemRef,
  RemoveOpenItemRequest,
  RemoveOpenItemsRequest,
  RenameOpenItemGroupRequest,
  ResetOpenItemsRequest,
  SetOpenItemGroupDisclosureRequest,
  SetOpenItemNoteRequest,
  SetOpenItemPinRequest,
  SetOpenItemGoalFilterRequest,
  SetOpenItemGoalDisclosureRequest,
  PromoteGroupToGoalRequest,
  UngroupOpenItemsRequest,
} from 'src/generated';
import { openItemsJsonSchemas } from 'src/generated/open-items.schemas';
import { OpenItemsValidationException } from './open-items.errors';

/** Request body type for each generated request schema. */
export interface OpenItemsRequestTypes {
  ActivateOpenItemRequest: ActivateOpenItemRequest;
  SetOpenItemNoteRequest: SetOpenItemNoteRequest;
  SetOpenItemPinRequest: SetOpenItemPinRequest;
  MoveOpenItemRequest: MoveOpenItemRequest;
  RemoveOpenItemRequest: RemoveOpenItemRequest;
  RemoveOpenItemsRequest: RemoveOpenItemsRequest;
  CreateOpenItemGroupRequest: CreateOpenItemGroupRequest;
  RenameOpenItemGroupRequest: RenameOpenItemGroupRequest;
  DeleteOpenItemGroupRequest: DeleteOpenItemGroupRequest;
  SetOpenItemGroupDisclosureRequest: SetOpenItemGroupDisclosureRequest;
  MoveOpenItemGroupRequest: MoveOpenItemGroupRequest;
  AssignOpenItemsToGroupRequest: AssignOpenItemsToGroupRequest;
  UngroupOpenItemsRequest: UngroupOpenItemsRequest;
  MoveOpenItemGroupMemberRequest: MoveOpenItemGroupMemberRequest;
  MigrateOpenItemsRequest: MigrateOpenItemsRequest;
  ResetOpenItemsRequest: ResetOpenItemsRequest;
  SetOpenItemGoalFilterRequest: SetOpenItemGoalFilterRequest;
  SetOpenItemGoalDisclosureRequest: SetOpenItemGoalDisclosureRequest;
  PromoteGroupToGoalRequest: PromoteGroupToGoalRequest;
}

export type OpenItemsRequestName = keyof OpenItemsRequestTypes;

const logger = new Logger('OpenItemsBoundary');

const ajv = addFormats(
  new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  }),
);

const requestValidators = Object.fromEntries(
  (Object.keys(openItemsJsonSchemas) as (keyof typeof openItemsJsonSchemas)[])
    .filter((name) => name.endsWith('Request'))
    .map((name) => [name, ajv.compile(openItemsJsonSchemas[name])]),
) as {
  [Name in OpenItemsRequestName]: ValidateFunction<OpenItemsRequestTypes[Name]>;
};

const validateItemRef = ajv.compile<OpenItemRef>(
  openItemsJsonSchemas.OpenItemRef,
);
const validateGroupId = ajv.compile<string>(
  openItemsJsonSchemas.OpenItemGroupId,
);

const toViolations = (errors: ErrorObject[] | null | undefined, prefix = '') =>
  (errors ?? []).map((error) => ({
    path: `${prefix}${error.instancePath}` || '/',
    message: [error.message ?? 'is invalid', describeParams(error)]
      .filter(Boolean)
      .join(' '),
  }));

const describeParams = (error: ErrorObject): string | undefined =>
  error.keyword === 'additionalProperties'
    ? `(${String(error.params.additionalProperty)})`
    : undefined;

const reject = (
  subject: string,
  errors: ErrorObject[] | null | undefined,
  prefix?: string,
): never => {
  const violations = toViolations(errors, prefix);
  logger.debug(
    `Rejected contract-invalid ${subject}: ${violations
      .map((violation) => `${violation.path} ${violation.message}`)
      .join('; ')}`,
  );
  throw OpenItemsValidationException.of(
    'INVALID_REQUEST',
    `${subject} does not match the Open Items API contract.`,
    violations,
  );
};

/** Validates an untrusted request body once against its generated schema. */
export function parseOpenItemsRequest<Name extends OpenItemsRequestName>(
  name: Name,
  body: unknown,
): OpenItemsRequestTypes[Name] {
  const validate = requestValidators[name];
  if (!validate(body)) {
    return reject(name, validate.errors);
  }
  logger.debug(`Accepted ${name} at the generated boundary`);
  return body;
}

/** Validates an item identity taken from path parameters. */
export function parseOpenItemRef(params: {
  entityType: unknown;
  entityId: unknown;
}): OpenItemRef {
  const ref = { entityType: params.entityType, entityId: params.entityId };
  if (!validateItemRef(ref)) {
    return reject('Open Item path identity', validateItemRef.errors, '#path');
  }
  return ref;
}

/** Validates a group identity taken from path parameters. */
export function parseOpenItemGroupId(groupId: unknown): string {
  if (!validateGroupId(groupId)) {
    return reject(
      'Open Item group path identity',
      validateGroupId.errors,
      '#path/groupId',
    );
  }
  return groupId;
}
