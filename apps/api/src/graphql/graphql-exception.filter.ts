import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { toGraphQLError } from './graphql-error-code';

/**
 * Resolver-level filter. Nest tries method/class filters before the global
 * HTTP filters, so resolver failures become GraphQL errors instead of being
 * written to an HTTP response that the resolver does not own.
 */
@Catch()
export class GraphQLExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): GraphQLError {
    return toGraphQLError(exception);
  }
}
