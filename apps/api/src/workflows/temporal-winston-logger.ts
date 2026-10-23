import {
  Logger as TemporalLogger,
  LogEntry,
  LogLevel,
} from '@temporalio/worker';
import * as winston from 'winston';
import {
  serializeProductionLogEnvelope,
  preserveLogAttributes,
  attributesFromWinston,
  ProductionLogContext,
} from '../common/logger/production-log-envelope';
import { EventContextManager } from '../core/events/observable-event.context';

/**
 * Temporal's runtime logger uses the same stdout-only envelope as the Nest
 * application logger. Remote and file transports are intentionally absent.
 */
export class TemporalWinstonLogger implements TemporalLogger {
  private readonly winstonLogger: winston.Logger;

  constructor() {
    const level = (process.env.LOG_LEVEL || 'debug').toLowerCase();
    this.winstonLogger = winston.createLogger({
      level: level === 'silent' ? 'error' : level,
      silent: level === 'silent',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf((info) =>
          serializeProductionLogEnvelope({
            level: String(info.level),
            message: info.message,
            timestamp: info.timestamp as string | undefined,
            source: 'temporal',
            context: this.getContext() as Record<string, unknown>,
            attributes: attributesFromWinston(info),
            error: info.error,
          }),
        ),
      ),
      transports: [new winston.transports.Console()],
    });
  }

  log(level: LogLevel, message: string, attrs?: Record<string, unknown>): void {
    const winstonLevel = this.mapLogLevel(level);
    this.winstonLogger.log(winstonLevel, message, {
      source: 'temporal',
      ...preserveLogAttributes(attrs ?? {}, [
        'message',
        'level',
        'timestamp',
        'includeErrorDetails',
      ]),
      // Activity failures need the rejection reason as well as its stack.
      includeErrorDetails: message === 'Activity failed',
    });
  }

  trace(message: string, attrs?: Record<string, unknown>): void {
    this.log('TRACE', message, attrs);
  }

  debug(message: string, attrs?: Record<string, unknown>): void {
    this.log('DEBUG', message, attrs);
  }

  info(message: string, attrs?: Record<string, unknown>): void {
    this.log('INFO', message, attrs);
  }

  warn(message: string, attrs?: Record<string, unknown>): void {
    this.log('WARN', message, attrs);
  }

  error(message: string, attrs?: Record<string, unknown>): void {
    this.log('ERROR', message, attrs);
  }

  private getContext(): ProductionLogContext {
    const context = EventContextManager.getInstance().getCurrentContext();
    if (!context) return {};
    return {
      requestId: context.requestId ?? context.metadata?.requestId,
      correlationId: context.correlationId,
      organizationId: context.organizationId ?? undefined,
      projectId: context.projectId ?? undefined,
      workflowId: context.workflowId ?? undefined,
      conversationId: context.conversationId ?? undefined,
      messageId: context.messageId ?? undefined,
      agentSessionId:
        context.agentSessionId ?? context.metadata?.agentSessionId,
    };
  }

  private mapLogLevel(level: LogLevel): string {
    switch (level) {
      case 'TRACE':
      case 'DEBUG':
        return 'debug';
      case 'INFO':
        return 'info';
      case 'WARN':
        return 'warn';
      case 'ERROR':
        return 'error';
      default:
        return 'info';
    }
  }
}

export function temporalLogEntryToAttributes(
  entry: LogEntry,
): Record<string, unknown> {
  return {
    component: 'TemporalRuntime',
    ...entry,
  };
}
