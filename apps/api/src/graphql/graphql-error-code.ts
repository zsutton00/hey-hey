import { HttpException } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { extractHttpExceptionCode } from '../common/filters/exception-error-code';
import {
  describePrismaException,
  type PrismaException,
} from '../prisma-exception.filter';
import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
  PrismaClientUnknownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/library';

function isPrismaException(error: unknown): error is PrismaException {
  return (
    error instanceof PrismaClientKnownRequestError ||
    error instanceof PrismaClientUnknownRequestError ||
    error instanceof PrismaClientRustPanicError ||
    error instanceof PrismaClientInitializationError ||
    error instanceof PrismaClientValidationError
  );
}

/**
 * Converts an error thrown while resolving a query into a GraphQL error whose
 * `extensions.code` is the value the REST error body carries for the same
 * exception, and whose HTTP status matches the REST response status.
 *
 * Errors REST would answer without a stable code carry no `extensions.code`
 * from us; Apollo then labels them as a generic internal failure.
 */
export function toGraphQLError(error: unknown): GraphQLError {
  if (error instanceof GraphQLError) {
    return error;
  }

  if (error instanceof HttpException) {
    return new GraphQLError(error.message, {
      originalError: error,
      extensions: {
        code: extractHttpExceptionCode(error),
        http: { status: error.getStatus() },
      },
    });
  }

  if (isPrismaException(error)) {
    const { status, message, errorCode } = describePrismaException(error);

    return new GraphQLError(message, {
      originalError: error,
      extensions: { code: errorCode, http: { status } },
    });
  }

  return new GraphQLError('Internal server error', {
    originalError: error instanceof Error ? error : undefined,
  });
}
