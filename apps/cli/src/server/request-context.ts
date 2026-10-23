import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import type { ServerLogLevel, ServerLogger } from './logger';

interface LocalRequestContext {
  correlationId: string;
}

const CORRELATION_ID_HEADER = 'x-correlation-id';

const readCorrelationIdHeader = (headerValue: string | string[] | undefined): string | null => {
  if (Array.isArray(headerValue)) {
    for (const entry of headerValue) {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    return null;
  }

  if (typeof headerValue !== 'string') {
    return null;
  }

  const trimmed = headerValue.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Owns request-local correlation state and the HTTP middleware that establishes it. */
class RequestContext {
  private readonly storage = new AsyncLocalStorage<LocalRequestContext>();

  public getCorrelationId(): string | null {
    return this.storage.getStore()?.correlationId ?? null;
  }

  public run<T>(correlationId: string, callback: () => T): T {
    return this.storage.run({ correlationId }, callback);
  }

  public log(
    logger: ServerLogger,
    level: ServerLogLevel,
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    const correlationId = this.getCorrelationId();
    const payload = correlationId ? { correlationId, ...fields } : fields;
    logger[level](event, payload);
  }

  public middleware(input: { logger: ServerLogger }): RequestHandler {
    return (request, response, next) => {
      const incomingCorrelationId = readCorrelationIdHeader(request.headers[CORRELATION_ID_HEADER]);
      const correlationId = incomingCorrelationId ?? crypto.randomUUID();
      const startedAt = Date.now();
      let completed = false;

      response.setHeader(CORRELATION_ID_HEADER, correlationId);

      this.storage.run({ correlationId }, () => {
        input.logger.trace('local.http.request.started', {
          correlationId,
          method: request.method,
          path: request.originalUrl,
        });

        response.once('finish', () => {
          completed = true;
          input.logger.trace('local.http.request.completed', {
            correlationId,
            method: request.method,
            path: request.originalUrl,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
          });
        });

        response.once('close', () => {
          if (completed) {
            return;
          }

          input.logger.warn('local.http.request.closed', {
            correlationId,
            method: request.method,
            path: request.originalUrl,
            durationMs: Date.now() - startedAt,
          });
        });

        next();
      });
    };
  }
}

export const requestContext = new RequestContext();
