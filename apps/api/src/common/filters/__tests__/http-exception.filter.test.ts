import { ArgumentsHost, ConflictException } from '@nestjs/common';
import { HttpExceptionFilter } from '../http-exception.filter';

describe('HttpExceptionFilter', () => {
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
