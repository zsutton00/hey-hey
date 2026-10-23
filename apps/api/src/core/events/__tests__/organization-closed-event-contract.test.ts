import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';
import type { OrganizationClosedEventPayload } from '../../../generated';
import type { OrganizationId } from '../../../types';
import { resolveOpenapiRoot } from '../../../../test/helpers/openapi-root';

interface JsonSchema {
  $ref?: string;
  type?: string;
  format?: string;
  pattern?: string;
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
}

const openapiRoot = resolveOpenapiRoot();
const eventSpecification = load(
  readFileSync(join(openapiRoot, 'specs/schemas/events.yaml'), 'utf8'),
) as { components: { schemas: Record<string, JsonSchema> } };
const commonSchemas = load(
  readFileSync(join(openapiRoot, 'specs/schemas/common.yaml'), 'utf8'),
) as Record<string, JsonSchema>;

function resolveOrganizationClosedPayloadSchema(): JsonSchema {
  const payloadSchema =
    eventSpecification.components.schemas.OrganizationClosedEventPayload;
  if (!payloadSchema) {
    throw new Error('Organization closure payload schema is missing');
  }

  const resolvedSchema = JSON.parse(
    JSON.stringify(payloadSchema),
  ) as JsonSchema;
  const organizationId = resolvedSchema.properties?.organizationId;
  if (organizationId?.$ref !== './common.yaml#/OrganizationId') {
    throw new Error(
      'Organization closure payload has an unexpected organizationId reference',
    );
  }

  const organizationIdSchema = commonSchemas.OrganizationId;
  if (!organizationIdSchema) {
    throw new Error('OrganizationId schema is missing');
  }
  resolvedSchema.properties!.organizationId = organizationIdSchema;
  return resolvedSchema;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addFormat(
  'branded-OrganizationId',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const validatePayload = ajv.compile<Record<string, unknown>>(
  resolveOrganizationClosedPayloadSchema(),
);

describe('organization.closed event contract', () => {
  it('validates a complete generated payload against the resolved schema', () => {
    const payload = {
      payloadType: 'organization.closed',
      organizationId: '50e01076-bce8-4a65-b205-c5da8480e8fb' as OrganizationId,
      markerId: '43ed65fa-b0a8-4fe3-9577-28ee86f964d1',
      irreversibleClosureAt: '2026-08-14T12:00:00.000Z',
      deletionDeadline: '2026-09-13T12:00:00.000Z',
    } satisfies OrganizationClosedEventPayload;

    expect(validatePayload(payload)).toBe(true);
  });

  it('rejects a payload missing a required closure field', () => {
    const payload = {
      payloadType: 'organization.closed',
      organizationId: '50e01076-bce8-4a65-b205-c5da8480e8fb',
      irreversibleClosureAt: '2026-08-14T12:00:00.000Z',
      deletionDeadline: '2026-09-13T12:00:00.000Z',
    };

    expect(validatePayload(payload)).toBe(false);
  });

  it('rejects a payload with an undeclared field', () => {
    const payload = {
      payloadType: 'organization.closed',
      organizationId: '50e01076-bce8-4a65-b205-c5da8480e8fb',
      markerId: '43ed65fa-b0a8-4fe3-9577-28ee86f964d1',
      irreversibleClosureAt: '2026-08-14T12:00:00.000Z',
      deletionDeadline: '2026-09-13T12:00:00.000Z',
      projectId: '0fbfaeca-a381-4ff0-82ba-0bd772095e77',
    };

    expect(validatePayload(payload)).toBe(false);
  });
});
