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
  OpenItemsIdempotencyKeyReusedError,
  OpenItemsValidationError,
} from '@hey-hey/contracts/api/models';

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

/** 422 whose body is exactly the generated OpenItemsIdempotencyKeyReusedError. */
export class OpenItemsIdempotencyKeyReusedException extends HttpException {
  constructor(readonly body: OpenItemsIdempotencyKeyReusedError) {
    super(body, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  static of(
    message: string,
    currentCollectionRevision: number | null,
  ): OpenItemsIdempotencyKeyReusedException {
    return new OpenItemsIdempotencyKeyReusedException({
      success: false,
      code: 'IDEMPOTENCY_KEY_REUSED',
      message,
      currentCollectionRevision,
    });
  }
}

/**
 * The global HttpExceptionFilter decorates error bodies with extra keys; the
 * Open Items error schemas are closed, so these errors are written as-is.
 */
@Catch(
  OpenItemsValidationException,
  OpenItemsConflictException,
  OpenItemsIdempotencyKeyReusedException,
)
export class OpenItemsExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      | OpenItemsValidationException
      | OpenItemsConflictException
      | OpenItemsIdempotencyKeyReusedException,
    host: ArgumentsHost,
  ) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.body);
  }
}
