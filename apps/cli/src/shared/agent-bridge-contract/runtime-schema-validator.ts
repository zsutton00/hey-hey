import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { repositoryFeatureEnrichmentRuntimeSchema } from './generated/repository-feature-enrichment-runtime-schema';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export const createAgentBridgeRuntimeValidator = <T>(definition: string): ValidateFunction<T> =>
  ajv.compile<T>({
    ...repositoryFeatureEnrichmentRuntimeSchema,
    $ref: `#/definitions/${definition}`,
  });

const errorPath = (error: ErrorObject): string => {
  if (error.keyword === 'required') {
    const missingProperty = error.params['missingProperty'];
    return `${error.instancePath}/${missingProperty}`;
  }
  if (error.keyword === 'additionalProperties') {
    const additionalProperty = error.params['additionalProperty'];
    return `${error.instancePath}/${additionalProperty}`;
  }
  return error.instancePath || 'completion';
};

export const formatRuntimeSchemaErrors = (errors: ErrorObject[] | null | undefined): string =>
  (errors ?? [])
    .map((error) => `${errorPath(error)}: ${error.message ?? 'invalid value'}`)
    .join('; ');

export const readOutcome = <TOutcome extends string>(
  value: unknown,
  allowed: readonly TOutcome[],
): TOutcome | null => {
  if (typeof value !== 'object' || value === null || !('outcome' in value)) return null;
  const outcome = value.outcome;
  return typeof outcome === 'string' && allowed.includes(outcome as TOutcome)
    ? (outcome as TOutcome)
    : null;
};
