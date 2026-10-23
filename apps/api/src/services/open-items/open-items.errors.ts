import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  OpenItemsConflictError,
  OpenItemsValidationError,
} from 'src/generated';

type Violation = OpenItemsValidationError['violations'][number];

const MAX_VIOLATIONS = 100;

/** 400 whose body is exactly the generated OpenItemsValidationError. */
export class OpenItemsValidationException extends HttpException {
  constructor(readonly body: OpenItemsValidationError) {
    super(body, HttpStatus.BAD_REQUEST);
  }

  static of(
    code: OpenItemsValidationError.CodeEnum,
    message: string,
    violations: Violation[],
  ): OpenItemsValidationException {
    return new OpenItemsValidationException({
      success: false,
      code,
      message,
      violations: violations.slice(0, MAX_VIOLATIONS).map((violation) => ({
        path: violation.path.slice(0, 256),
        message: violation.message.slice(0, 500),
      })),
    });
  }
}

/** 409 whose body is exactly the generated OpenItemsConflictError. */
export class OpenItemsConflictException extends HttpException {
  constructor(readonly body: OpenItemsConflictError) {
    super(body, HttpStatus.CONFLICT);
  }

  static of(
    code: OpenItemsConflictError.CodeEnum,
    message: string,
    currentCollectionRevision: number | null,
  ): OpenItemsConflictException {
    return new OpenItemsConflictException({
      success: false,
      code,
      message,
      currentCollectionRevision,
    });
  }
}

/**
 * The global HttpExceptionFilter decorates error bodies with extra keys; the
 * Open Items error schemas are closed, so these two errors are written as-is.
 */
@Catch(OpenItemsValidationException, OpenItemsConflictException)
export class OpenItemsExceptionFilter implements ExceptionFilter {
  catch(
    exception: OpenItemsValidationException | OpenItemsConflictException,
    host: ArgumentsHost,
  ) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.body);
  }
}
