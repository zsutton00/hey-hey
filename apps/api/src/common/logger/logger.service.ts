import { Injectable, LoggerService, Optional } from '@nestjs/common';
import * as winston from 'winston';
import { getNamespace } from 'cls-hooked';
import { ErrorFileWriter } from './error-file-writer.service';
import {
  buildProductionLogEnvelope,
  preserveLogAttributes,
  attributesFromWinston,
  ProductionLogContext,
  serializeProductionLogEnvelope,
} from './production-log-envelope';
import { EventContextManager } from '../../core/events/observable-event.context';
import { activeTraceId, activeTraceSampled } from '../../telemetry/api-tracing';

export interface LogContext extends ProductionLogContext {
  userId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  responseTimeMs?: number;
  [key: string]: unknown;
}

interface NormalizedLogArguments {
  context?: string;
  attributes: Record<string, unknown>;
  error?: Error;
  stack?: string;
}

@Injectable()
export class CustomLoggerService implements LoggerService {
  private readonly logger: winston.Logger;
  private readonly namespace = 'request-context';

  constructor(@Optional() private readonly errorFileWriter?: ErrorFileWriter) {
    const validLevels = [
      'error',
      'warn',
      'info',
      'http',
      'verbose',
      'debug',
      'silly',
    ];
    const rawLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
    const isSilent = rawLevel === 'silent';
    const resolvedLevel = isSilent
      ? 'error'
      : validLevels.includes(rawLevel)
        ? rawLevel
        : 'info';

    if (!isSilent && rawLevel !== resolvedLevel) {
      console.warn(
        `[CustomLoggerService] Invalid LOG_LEVEL "${process.env.LOG_LEVEL}" — ` +
          `must be one of: ${validLevels.join(', ')}, silent. Falling back to "info".`,
      );
    }

    // Production logging deliberately has one non-blocking stdout transport.
    // ErrorFileWriter remains a separate development diagnostic path and is not
    // part of the application request transport.
    const consoleFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf((info) =>
        serializeProductionLogEnvelope({
          level: String(info.level),
          message: info.message,
          timestamp: info.timestamp as string | undefined,
          source: this.sourceFromInfo(info),
          context: this.getContext(),
          attributes: attributesFromWinston(info),
          error: info.error,
        }),
      ),
    );

    this.logger = winston.createLogger({
      level: resolvedLevel,
      silent: isSilent,
      format: consoleFormat,
      transports: [new winston.transports.Console()],
    });

    this.logger.info(
      `Logger initialized at "${resolvedLevel}" level` +
        (rawLevel !== resolvedLevel
          ? ` (LOG_LEVEL env was "${process.env.LOG_LEVEL}")`
          : ''),
    );
  }

  private sourceFromInfo(info: Record<string, unknown>): string {
    return typeof info.source === 'string' ? info.source : 'application';
  }

  private getContext(): LogContext {
    const clsContext: LogContext = {};
    try {
      const namespace = getNamespace(this.namespace);
      if (namespace?.active) {
        Object.assign(clsContext, namespace.get('context') || {});
      }
    } catch {
      // CLS is optional for startup and background logs.
    }

    const eventContext = EventContextManager.getInstance().getCurrentContext();
    if (eventContext) {
      Object.assign(clsContext, {
        requestId: eventContext.requestId ?? eventContext.metadata?.requestId,
        correlationId: eventContext.correlationId,
        organizationId: eventContext.organizationId,
        projectId: eventContext.projectId,
        workflowId: eventContext.workflowId,
        conversationId: eventContext.conversationId,
        messageId: eventContext.messageId,
        agentSessionId:
          eventContext.agentSessionId ?? eventContext.metadata?.agentSessionId,
      });
    }

    // A trace identifier is projected only from the active OTel context.
    delete clsContext.traceId;
    delete clsContext.traceSampled;
    const traceId = activeTraceId();
    if (traceId) {
      clsContext.traceId = traceId;
      clsContext.traceSampled = activeTraceSampled();
    }

    return clsContext;
  }

  private formatMessage(message: unknown): string {
    const normalized =
      typeof message === 'string'
        ? message
        : message instanceof Error
          ? message.message
          : '[structured message omitted]';
    return normalized;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Error)
    );
  }

  private isStack(value: unknown): value is string {
    return typeof value === 'string' && /^(.)+\n\s+at .+:\d+:\d+/.test(value);
  }

  private normalizeArguments(
    message: unknown,
    optionalParams: unknown[],
    errorLevel = false,
  ): NormalizedLogArguments {
    const params = [...optionalParams];
    const normalized: NormalizedLogArguments = { attributes: {} };

    // Preserve the pre-variadic direct-call shape while callers migrate to the
    // standard Nest signature: error(message, stack, context, attributes).
    if (
      errorLevel &&
      params.length === 3 &&
      (typeof params[0] === 'string' || params[0] === undefined) &&
      (typeof params[1] === 'string' || params[1] === undefined) &&
      this.isRecord(params[2])
    ) {
      normalized.stack = params[0];
      normalized.context = params[1];
      Object.assign(normalized.attributes, params[2]);
      params.length = 0;
    } else if (errorLevel && params.length === 1 && this.isStack(params[0])) {
      normalized.stack = params.pop() as string;
    } else if (typeof params.at(-1) === 'string') {
      normalized.context = params.pop() as string;
    }

    for (const param of params) {
      if (param instanceof Error) {
        normalized.error ??= param;
        normalized.stack ??= param.stack;
      } else if (this.isRecord(param)) {
        Object.assign(normalized.attributes, param);
      } else if (errorLevel && typeof param === 'string') {
        normalized.stack ??= param;
      }
    }

    if (message instanceof Error) {
      normalized.error ??= message;
      normalized.stack ??= message.stack;
    }
    normalized.attributes = preserveLogAttributes(normalized.attributes, [
      'message',
      'level',
      'timestamp',
      ...(normalized.context ? ['context'] : []),
      ...(normalized.error ? ['error'] : []),
      ...(normalized.stack ? ['stack', 'errorStack'] : []),
    ]);
    if (normalized.context) {
      normalized.attributes.context = normalized.context;
    }
    if (normalized.error) normalized.attributes.error = normalized.error;
    if (normalized.stack) {
      normalized.attributes.stack = normalized.stack;
      normalized.attributes.errorStack = normalized.stack;
    }
    return normalized;
  }

  private write(
    level: 'info' | 'warn' | 'debug' | 'verbose',
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const normalized = this.normalizeArguments(message, optionalParams);
    this.logger[level](this.formatMessage(message), normalized.attributes);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const normalized = this.normalizeArguments(message, optionalParams, true);
    const resolvedError = normalized.error;
    const resolvedStack = normalized.stack;
    const formattedMessage =
      resolvedStack || resolvedError
        ? 'Application error'
        : this.formatMessage(message);
    this.logger.error(formattedMessage, {
      ...normalized.attributes,
    });

    if (this.errorFileWriter) {
      this.errorFileWriter
        .writeErrorFile(formattedMessage, resolvedStack, this.getContext(), {
          loggerContext: normalized.context,
          ...normalized.attributes,
        })
        .catch(() => {
          // Error diagnostics must never affect the request.
        });
    }
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.error(message, ...optionalParams);
  }

  logWithContext(
    level: string,
    message: string,
    additionalContext?: LogContext,
  ): void {
    this.logger.log(level, message, {
      source: 'application',
      ...preserveLogAttributes(additionalContext ?? {}, [
        'message',
        'level',
        'timestamp',
      ]),
    });
  }

  logRequest(
    method: string,
    path: string,
    statusCode: number,
    responseTime: number,
  ): void {
    this.logger.info('HTTP request completed', {
      ...this.getContext(),
      source: 'http',
      component: 'LoggingInterceptor',
      method,
      path,
      statusCode,
      responseTimeMs: responseTime,
    });
  }

  logError(error: Error, additionalContext?: LogContext): void {
    this.logger.error(error.message, {
      source: 'application',
      component: 'Error',
      error,
      errorName: error.name,
      errorStack: error.stack,
      ...preserveLogAttributes(additionalContext ?? {}, [
        'message',
        'level',
        'timestamp',
        'error',
        'errorName',
        'errorStack',
      ]),
    });

    if (this.errorFileWriter) {
      this.errorFileWriter
        .writeErrorFromError(
          error,
          { ...this.getContext(), ...additionalContext },
          { loggerContext: 'ERROR' },
        )
        .catch(() => {
          // Error diagnostics must never affect the request.
        });
    }
  }

  logBusinessEvent(
    event: string,
    _data?: unknown,
    additionalContext?: LogContext,
  ): void {
    this.logger.info(`Business event: ${event}`, {
      source: 'application',
      event,
      ...preserveLogAttributes(additionalContext ?? {}, [
        'message',
        'level',
        'timestamp',
      ]),
    });
  }

  /** Exposed for focused tests without exposing Winston internals. */
  buildEnvelopeForTest(
    level: string,
    message: unknown,
    ...optionalParams: unknown[]
  ) {
    const normalized = this.normalizeArguments(
      message,
      optionalParams,
      level === 'error' || level === 'fatal',
    );
    return buildProductionLogEnvelope({
      level,
      message:
        normalized.stack || normalized.error ? 'Application error' : message,
      context: this.getContext(),
      attributes: {
        ...normalized.attributes,
      },
      error: normalized.error,
    });
  }
}
