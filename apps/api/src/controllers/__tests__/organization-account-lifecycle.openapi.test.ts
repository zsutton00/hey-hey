import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type {
  CancelOrganizationAccountResponse,
  GetOrganizationAccountLifecycleResponse,
  OrganizationAccountLifecycleDto,
  ReactivateOrganizationAccountResponse,
} from '../../generated';
import {
  ORGANIZATIONS_ORGANIZATIONID_CANCEL_PATH,
  ORGANIZATIONS_ORGANIZATIONID_ACCOUNT_LIFECYCLE_PATH,
  ORGANIZATIONS_ORGANIZATIONID_REACTIVATE_PATH,
} from '../../generated/api/path-constants';
import {
  resolveSiblingRepository,
  resolveWorktreeContext,
} from '../../utils/worktree-context';

interface OperationSchema {
  operationId: string;
  requestBody?: unknown;
  responses: Record<
    string,
    { content?: { 'application/json'?: { schema?: { $ref?: string } } } }
  >;
}

interface ApiSpecification {
  security: Array<Record<string, unknown>>;
  paths: Record<string, { get?: OperationSchema; post?: OperationSchema }>;
}

interface ObjectSchema {
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, unknown>;
}

const openapiRoot = resolveSiblingRepository(
  resolveWorktreeContext(),
  'openapi',
  process.env.HEY_HEY_OPENAPI_ROOT,
);
const apiSpecification = load(
  readFileSync(join(openapiRoot, 'specs/api/openapi.yaml'), 'utf8'),
) as ApiSpecification;
const organizationSchemas = load(
  readFileSync(join(openapiRoot, 'specs/schemas/organizations.yaml'), 'utf8'),
) as Record<string, ObjectSchema>;

describe('organization account lifecycle OpenAPI contract', () => {
  it.each([
    [
      '/organizations/{organizationId}/cancel',
      'cancelOrganizationAccount',
      '#/components/schemas/CancelOrganizationAccountResponse',
    ],
    [
      '/organizations/{organizationId}/reactivate',
      'reactivateOrganizationAccount',
      '#/components/schemas/ReactivateOrganizationAccountResponse',
    ],
  ])(
    'pins the bodyless authenticated POST operation at %s',
    (path, operationId, responseRef) => {
      const operation = apiSpecification.paths[path]?.post;

      expect(apiSpecification.security).toEqual([{ BearerAuth: [] }]);
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.requestBody).toBeUndefined();
      expect(
        operation?.responses['200']?.content?.['application/json']?.schema
          ?.$ref,
      ).toBe(responseRef);
    },
  );

  it('pins the suspended-safe lifecycle read operation', () => {
    const operation =
      apiSpecification.paths[
        '/organizations/{organizationId}/account-lifecycle'
      ]?.get;

    expect(operation?.operationId).toBe('getOrganizationAccountLifecycle');
    expect(
      operation?.responses['200']?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/GetOrganizationAccountLifecycleResponse');
  });

  it('exposes only the provider-neutral lifecycle decision', () => {
    const schema = organizationSchemas.OrganizationAccountLifecycleDto;
    if (!schema) {
      throw new Error('OrganizationAccountLifecycleDto schema is missing');
    }

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      'lifecycleState',
      'accessEndsAt',
      'deletionEligibleAt',
      'irreversibleClosureAt',
      'deletedAt',
      'accessAllowed',
      'canReactivate',
    ]);
    expect(Object.keys(schema.properties ?? {})).toEqual([
      'lifecycleState',
      'accessEndsAt',
      'deletionEligibleAt',
      'irreversibleClosureAt',
      'deletedAt',
      'accessAllowed',
      'canReactivate',
    ]);
  });

  it('exports generated DTOs, envelopes, and route constants', () => {
    const lifecycle = {
      lifecycleState: 'ACTIVE',
      accessEndsAt: null,
      deletionEligibleAt: null,
      irreversibleClosureAt: null,
      deletedAt: null,
      accessAllowed: true,
      canReactivate: false,
    } satisfies OrganizationAccountLifecycleDto;
    const baseEnvelope = {
      success: true,
      message: 'ok',
      data: lifecycle,
      timestamp: '2026-08-14T20:00:00.000Z',
      statusCode: 200,
    };
    const cancellation = {
      ...baseEnvelope,
    } satisfies CancelOrganizationAccountResponse;
    const lifecycleRead = {
      ...baseEnvelope,
    } satisfies GetOrganizationAccountLifecycleResponse;
    const reactivation = {
      ...baseEnvelope,
      data: { ...lifecycle, outcome: 'REACTIVATED' as const },
    } satisfies ReactivateOrganizationAccountResponse;

    expect(cancellation.data).toEqual(lifecycle);
    expect(lifecycleRead.data).toEqual(lifecycle);
    expect(reactivation.data).toEqual({
      ...lifecycle,
      outcome: 'REACTIVATED',
    });
    expect(ORGANIZATIONS_ORGANIZATIONID_CANCEL_PATH).toBe(
      '/organizations/{organizationId}/cancel',
    );
    expect(ORGANIZATIONS_ORGANIZATIONID_REACTIVATE_PATH).toBe(
      '/organizations/{organizationId}/reactivate',
    );
    expect(ORGANIZATIONS_ORGANIZATIONID_ACCOUNT_LIFECYCLE_PATH).toBe(
      '/organizations/{organizationId}/account-lifecycle',
    );
  });
});
