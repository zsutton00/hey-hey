// prisma-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/library';

@Catch(
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      | PrismaClientKnownRequestError
      | PrismaClientUnknownRequestError
      | PrismaClientRustPanicError
      | PrismaClientInitializationError
      | PrismaClientValidationError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error';
    let errorCode = 'INTERNAL_ERROR';
    let details = {};

    // Handle known request errors (most common)
    if (exception instanceof PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'Unique constraint violation';
          details = exception.meta || {};
          errorCode = exception.code;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          errorCode = exception.code;
          break;
        // Add more cases as needed
        default:
          status = HttpStatus.BAD_REQUEST;
          message = `Database error: ${exception.code}`;
          errorCode = exception.code;
      }
    }
    // Handle validation errors
    else if (exception instanceof PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Validation error: Invalid data provided';
      errorCode = 'VALIDATION_ERROR';
    }
    // Handle other types of errors
    else if (exception instanceof PrismaClientInitializationError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Failed to initialize database connection';
      errorCode = 'DB_INIT_ERROR';
    } else if (exception instanceof PrismaClientRustPanicError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Critical database error';
      errorCode = 'CRITICAL_DB_ERROR';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Unexpected database error';
      errorCode = 'UNKNOWN_DB_ERROR';
    }

    // Log the error
    console.error('Prisma Exception:', exception);

    // Return response
    response.status(status).json({
      success: false,
      message,
      data: null,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
      error: {
        code: errorCode,
        details,
      },
    });
  }
}
