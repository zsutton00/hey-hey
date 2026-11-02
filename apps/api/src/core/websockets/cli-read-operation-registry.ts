import type {
  CliReadRequestDto,
  CliReadEnvelopeBody,
  ExecutableEnvelopeAuthorization,
} from '@hey-hey/contracts/api/models';
import { CliReadRequestDtoDiscriminatorValues } from '@hey-hey/contracts/agent-bridge/models';

export interface AdmittedCliReadAuthorization {
  authorizationId: string;
  envelopeAuthorization: ExecutableEnvelopeAuthorization;
  actionPayloadHash: string;
}

export const SESSION_CLI_READ_OPERATIONS = Object.freeze(
  CliReadRequestDtoDiscriminatorValues satisfies readonly CliReadRequestDto['operation'][],
);

// The machine-addressed operations are deliberately admitted without widening the session endpoint.
export const PROTECTED_CLI_READ_OPERATIONS = Object.freeze([
  ...SESSION_CLI_READ_OPERATIONS,
  'workspace.skills.list',
  'runtime.model_catalog.get',
] satisfies CliReadEnvelopeBody['operation'][]);
