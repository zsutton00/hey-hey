import { UseFilters } from '@nestjs/common';
import { GraphQLExceptionFilter } from './graphql-exception.filter';

/**
 * Reports failures thrown inside a resolver under the REST stable error code.
 * Access is not decided here: WebUiReadAccessMiddleware protects the whole endpoint.
 */
export const UseRestErrorCodes = () => UseFilters(GraphQLExceptionFilter);
