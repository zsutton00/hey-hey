import * as fs from 'fs';
import * as path from 'path';
import {
  MCP_OPERATION_INPUT_SCHEMA_ID,
  getMcpOperationInputOverlaySchemaDocument,
  getMcpOperationInputSchema,
  mcpOperationInputSchemaDocument,
} from '../schemas/mcp-operation-input.schema';

// Ajv is loaded from CommonJS in this repository setup.

const Ajv = require('ajv');

describe('mcp operation input schema', () => {
  const basePayload = {
    scope: {
      organizationId: 'org_123',
      projectId: 'proj_456',
      initiativeId: 'init_789',
    },
    refs: [
      { entityType: 'initiative', ref: 'initiative:init_789' },
      { entityType: 'task', ref: 'task:task_001' },
    ],
    changes: [
      {
        changeType: 'replace',
        target: '$.details.technologyStack',
        value: ['NestJS', 'PostgreSQL', 'Temporal'],
        reason: 'Standardize backend stack',
        intent: 'replace_technology_stack',
      },
    ],
    metadata: {
      requestorId: 'user_100',
      correlationId: 'corr_abc_123',
      intent: 'replace_technology_stack',
      timestamp: '2026-02-25T12:00:00.000Z',
    },
  } as const;

  it('publishes a versioned schema identifier', () => {
    expect(MCP_OPERATION_INPUT_SCHEMA_ID).toBe(
      '/schemas/mcp-operation-input/v1.0.0',
    );
    expect((mcpOperationInputSchemaDocument as { $id?: string }).$id).toBe(
      MCP_OPERATION_INPUT_SCHEMA_ID,
    );
  });

  it('accepts a representative replace technology stack payload', () => {
    const parsed = getMcpOperationInputSchema(['initiativeId']).safeParse(
      basePayload,
    );

    expect(parsed.success).toBe(true);
  });

  it('publishes a JSON schema document that validates a representative payload', () => {
    const schemaPath = path.resolve(
      __dirname,
      '../../../schemas/mcp-operation-input.v1.0.0.schema.json',
    );
    const schemaDocument = JSON.parse(
      fs.readFileSync(schemaPath, 'utf8'),
    ) as Record<string, unknown>;

    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schemaDocument);
    const isValid = validate(basePayload);

    expect(schemaDocument.$id).toBe(MCP_OPERATION_INPUT_SCHEMA_ID);
    expect(isValid).toBe(true);
  });

  it('requires at least one change item', () => {
    const parsed = getMcpOperationInputSchema().safeParse({
      ...basePayload,
      changes: [],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error('expected validation to fail');
    }

    expect(parsed.error.issues[0]?.path).toEqual(['changes']);
  });

  it('validates refs entity type enum', () => {
    const parsed = getMcpOperationInputSchema().safeParse({
      ...basePayload,
      refs: [{ entityType: 'unknown', ref: 'initiative:init_789' }],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error('expected validation to fail');
    }

    expect(parsed.error.issues[0]?.code).toBe('invalid_enum_value');
    expect(parsed.error.issues[0]?.path).toEqual(['refs', 0, 'entityType']);
  });

  it('requires initiativeId when requiredScope includes initiativeId', () => {
    const payloadWithoutInitiative = {
      ...basePayload,
      scope: {
        organizationId: 'org_123',
        projectId: 'proj_456',
      },
    };

    const parsed = getMcpOperationInputSchema(['initiativeId']).safeParse(
      payloadWithoutInitiative,
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error('expected validation to fail');
    }

    expect(parsed.error.issues[0]?.path).toEqual(['scope', 'initiativeId']);
    expect(parsed.error.issues[0]?.message).toContain(
      'required by operation.requiredScope',
    );
  });

  it('builds a scope overlay schema document for required scope fields', () => {
    const overlay = getMcpOperationInputOverlaySchemaDocument([
      'initiativeId',
    ]) as { allOf?: Array<Record<string, unknown>> };

    expect(Array.isArray(overlay.allOf)).toBe(true);

    const scopeOverlay = overlay.allOf?.[1] as {
      properties?: { scope?: { required?: string[] } };
    };
    expect(scopeOverlay.properties?.scope?.required).toEqual(['initiativeId']);
  });
});
