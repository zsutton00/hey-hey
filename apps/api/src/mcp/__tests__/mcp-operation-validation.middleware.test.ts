import { BadRequestException } from '@nestjs/common';
import {
  McpOperationValidationMiddleware,
  createMcpValidationErrorEnvelope,
} from '../middleware/mcp-operation-validation.middleware';
import { getMcpOperationCatalogEntry } from '../operation-catalog';

describe('mcp operation validation middleware', () => {
  const middleware = new McpOperationValidationMiddleware();

  const validPayload = {
    scope: {
      organizationId: 'org_123',
      projectId: 'proj_456',
      initiativeId: 'init_789',
    },
    refs: [{ entityType: 'initiative', ref: 'initiative:init_789' }],
    changes: [
      {
        changeType: 'replace',
        target: '$.details.technologyStack',
        value: ['TypeScript', 'NestJS'],
        reason: 'Migrate stack',
      },
    ],
    metadata: {
      requestorId: 'user_001',
      correlationId: 'corr_001',
      intent: 'replace_technology_stack',
      timestamp: '2026-02-25T12:00:00.000Z',
    },
  };

  it('validates payloads using operation requiredScope overlays', () => {
    const parsed = middleware.validateForOperation(
      'search_work_items',
      validPayload,
    );

    expect(parsed.scope.projectId).toBe('proj_456');
  });

  it('returns machine-readable required error when required scope is missing', () => {
    const missingProjectPayload = {
      ...validPayload,
      scope: {
        organizationId: 'org_123',
        initiativeId: 'init_789',
      },
    };

    try {
      middleware.validatePayload(
        getMcpOperationCatalogEntry('search_work_items'),
        missingProjectPayload,
      );
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        error: {
          details: { validationErrors: Array<{ field: string; code: string }> };
        };
      };

      expect(response.error.details.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'scope.projectId',
            code: 'required',
          }),
        ]),
      );
    }
  });

  it('maps enum failures to invalid_enum issue code', () => {
    const invalidEnumPayload = {
      ...validPayload,
      changes: [
        {
          ...validPayload.changes[0],
          changeType: 'swap',
        },
      ],
    };

    try {
      middleware.validateForOperation('search_work_items', invalidEnumPayload);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        error: {
          details: {
            validationErrors: Array<{
              field: string;
              code: string;
              reason: string;
            }>;
          };
        };
      };

      expect(response.error.details.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'changes[0].changeType',
            code: 'invalid_enum',
          }),
        ]),
      );
    }
  });

  it('builds typed validation envelopes', () => {
    const envelope = createMcpValidationErrorEnvelope([
      {
        code: 'custom',
        path: ['metadata', 'requestorId'],
        message: 'requestorId is required',
        params: { errorCode: 'required' },
      },
    ]);

    expect(envelope.error.code).toBe('validation_error');
    expect(envelope.error.details.validationErrors[0]).toEqual({
      field: 'metadata.requestorId',
      code: 'required',
      reason: 'requestorId is required',
      layer: 'structural',
    });
  });
});
