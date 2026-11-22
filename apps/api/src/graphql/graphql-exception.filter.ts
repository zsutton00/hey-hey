import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { toGraphQLError } from './graphql-error-code';

/**
 * Resolver-level filter. Nest tries method/class filters before the global
 * HTTP filters, so resolver failures become GraphQL errors instead of being
 * written to an HTTP response that the resolver does not own.
 *
 * An HttpException REST answers without a stable code is labelled with its
 * status name (NOT_FOUND, BAD_REQUEST, ...), so clients can still branch on it
 * instead of seeing a generic internal failure.
 */
@Catch()
export class GraphQLExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): GraphQLError {
    const error = toGraphQLError(exception);

    if (!(exception instanceof HttpException) || error.extensions.code) {
      return error;
    }

    return new GraphQLError(error.message, {
      originalError: exception,
      extensions: {
        ...error.extensions,
        code: HttpStatus[exception.getStatus()],
      },
    });
  }
}
