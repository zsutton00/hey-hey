import type { NextFunction, Request, Response } from 'express';
import {
  isReadRestriction,
  READ_RESTRICTION_HEADER,
  ReadPolicyContext,
  readPolicyFor,
} from './read-policy';

/**
 * Serves each request under the read policy its `X-Read-Restriction` header names.
 * An unknown value is refused rather than treated as unrestricted.
 */
export function readRestrictionMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const header = request.headers[READ_RESTRICTION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined) {
    next();
    return;
  }

  if (!isReadRestriction(value)) {
    response
      .status(400)
      .json({ message: `Unknown ${READ_RESTRICTION_HEADER} value.` });
    return;
  }

  ReadPolicyContext.run(readPolicyFor(value), next);
}
