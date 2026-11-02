import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { repositoryFeatureEnrichmentRuntimeSchema } from '@hey-hey/contracts/agent-bridge/runtime-schema';

export function createOpenApiRuntimeSchema<T>(
  definition: string,
): z.ZodType<T> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validator: ValidateFunction<T> = ajv.compile<T>({
    ...repositoryFeatureEnrichmentRuntimeSchema,
    $ref: `#/definitions/${definition}`,
  });
  return z.custom<T>((value) => validator(value), {
    message: 'Payload does not satisfy the generated OpenAPI contract.',
  });
}
