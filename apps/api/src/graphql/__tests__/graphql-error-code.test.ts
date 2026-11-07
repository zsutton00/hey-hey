import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../../prisma-exception.filter';
import { toGraphQLError } from '../graphql-error-code';

function restBodyFor(
  filter: { catch(e: never, host: ArgumentsHost): void },
  exception: unknown,
) {
  const json = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/x', header: () => undefined }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception as never, host);

  return {
    status: response.status.mock.calls[0][0] as number,
    body: json.mock.calls[0][0] as { code?: string },
  };
}

describe('toGraphQLError', () => {
  it.each([
    new ForbiddenException({ message: 'no', code: 'PROJECT_ACCESS_DENIED' }),
    new BadRequestException('plain, no stable code'),
    new NotFoundException({ message: 'gone', code: 'CURSOR_NOT_FOUND' }),
  ])('carries the REST body code and status for %s', (exception) => {
    const rest = restBodyFor(new HttpExceptionFilter(), exception);
    const graphql = toGraphQLError(exception);

    expect(graphql.extensions.code).toBe(rest.body.code);
    expect(graphql.extensions.http).toEqual({ status: rest.status });
  });

  it('carries the REST error code and status for Prisma errors', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const rest = restBodyFor(new PrismaExceptionFilter(), exception);
    const graphql = toGraphQLError(exception);

    expect(graphql.extensions.code).toBe('P2002');
    expect(graphql.extensions.http).toEqual({ status: rest.status });
  });
});
