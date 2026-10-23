import type {
  CliReadRequestDto,
  CliReadEnvelopeBody,
  ExecutableEnvelopeAuthorization,
} from '../../generated';
import { CliReadRequestDtoClass } from '../../generated/local/models/CliReadRequestDto';

export interface AdmittedCliReadAuthorization {
  authorizationId: string;
  envelopeAuthorization: ExecutableEnvelopeAuthorization;
  actionPayloadHash: string;
}

export const SESSION_CLI_READ_OPERATIONS = Object.freeze(
  Object.keys(CliReadRequestDtoClass.mapping ?? {}) as Array<
    CliReadRequestDto['operation']
  >,
);

// The machine-addressed operations are deliberately admitted without widening the session endpoint.
export const PROTECTED_CLI_READ_OPERATIONS = Object.freeze([
  ...SESSION_CLI_READ_OPERATIONS,
  'workspace.skills.list',
  'runtime.model_catalog.get',
] satisfies CliReadEnvelopeBody['operation'][]);
