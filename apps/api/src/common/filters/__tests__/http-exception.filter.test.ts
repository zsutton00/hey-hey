import { ArgumentsHost, ConflictException } from '@nestjs/common';
import { HttpExceptionFilter } from '../http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('retains bounded reconciliation issues and originating correlation', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          url: '/work-item-types/mockup',
          header: () => 'transport-correlation',
        }),
      }),
    } as unknown as ArgumentsHost;
    const issue = {
      field: 'definition.name',
      code: 'PROPOSAL_RECONCILIATION_REQUIRED',
      reason: 'This field changed after review.',
      layer: 'referential',
      suggestion: 'Review a reconciled result before applying.',
    };
    new HttpExceptionFilter().catch(
      new ConflictException({
        message:
          'Proposal content changed after review. Reconciliation is required.',
        correlationId: 'originating-correlation',
        issues: Array.from({ length: 40 }, () => ({
          ...issue,
          reason: 'x'.repeat(600),
        })),
        code: 'conflict',
        data: { retained: true },
        retryAfterSeconds: 3,
      }),
      host,
    );
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({
      success: false,
      statusCode: 409,
      message:
        'Proposal content changed after review. Reconciliation is required.',
      diagnostic: {
        correlationId: 'originating-correlation',
        issueCount: 40,
        truncated: true,
      },
    });
    expect(body.diagnostic.issues).toHaveLength(32);
    expect(body.diagnostic.issues[0]).toEqual({
      ...issue,
      reason: 'x'.repeat(512),
    });
  });

  it('preserves typed error data in the canonical error envelope', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/v1/organizations/id/reactivate' }),
      }),
    } as unknown as ArgumentsHost;
    const data = {
      outcome: 'DEADLINE_LOST',
      lifecycle: { lifecycleState: 'IRREVERSIBLY_CLOSED' },
    };

    new HttpExceptionFilter().catch(
      new ConflictException({
        message: 'Reactivation deadline was lost to irreversible closure',
        code: 'REACTIVATION_DEADLINE_LOST',
        data,
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'REACTIVATION_DEADLINE_LOST',
        data,
        statusCode: 409,
      }),
    );
  });

  it('returns the bounded approval diagnostic response with correlation data', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          url: '/api/v1/proposals/proposal-1',
          header: (name: string) =>
            name === 'x-correlation-id' ? 'correlation-1' : undefined,
        }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(
      new ConflictException({
        message: 'Cannot materialize an invalid work-item change set',
        projection: {
          valid: false,
          issues: [
            {
              field: 'operations[0].name',
              code: 'required',
              reason: 'Name is required',
              layer: 'structural',
            },
          ],
        },
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Cannot materialize an invalid work-item change set',
        diagnostic: {
          issueCount: 1,
          truncated: false,
          correlationId: 'correlation-1',
          issues: [
            expect.objectContaining({
              field: 'operations[0].name',
              code: 'required',
              reason: 'Name is required',
              layer: 'structural',
            }),
          ],
        },
        statusCode: 409,
        path: '/api/v1/proposals/proposal-1',
      }),
    );
  });
});
