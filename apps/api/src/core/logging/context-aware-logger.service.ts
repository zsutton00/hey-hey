import { Injectable, Logger, LogLevel, Inject, Optional } from '@nestjs/common';
import { EventContextManager } from '../events/observable-event.context';
import { FlowContextMetadata } from '../events/context-utils';
import { CustomLoggerService } from '../../common/logger/logger.service';

/**
 * Configuration interface for ContextAwareLogger behavior
 */
export interface ContextAwareLoggerConfig {
  // Core context fields to always include
  includeCorrelationId?: boolean;
  includeCausationId?: boolean;
  includeWorkflowId?: boolean;
  includeConversationId?: boolean;
  includeMessageId?: boolean;
  includeRequestId?: boolean;
  includeAgentSessionId?: boolean;
  includeOrganizationId?: boolean;
  includeProjectId?: boolean;
  includeUserId?: boolean;

  // Flow-specific metadata to include
  includeFlowId?: boolean;
  includeNodeId?: boolean;
  includeNodeType?: boolean;
  includeServiceChain?: boolean;
  includeExecutionType?: boolean;
  includeOperationType?: boolean;

  // Performance metadata
  includeProcessingTime?: boolean;
  includeLLMMetadata?: boolean;

  // Context sampling for high-volume logs
  enableSampling?: boolean;
  samplingRate?: number; // 0.0 to 1.0

  // Format customization
  contextPrefix?: string; // Default: '[CTX]'
  contextSeparator?: string; // Default: ' | '
  maxContextLength?: number; // Truncate context if too long
}

/**
 * Default configuration for ContextAwareLogger
 */
const DEFAULT_CONFIG: Required<ContextAwareLoggerConfig> = {
  // Core context - most important for debugging
  includeCorrelationId: true,
  includeCausationId: false,
  includeWorkflowId: true,
  includeConversationId: true,
  includeMessageId: true,
  includeRequestId: true,
  includeAgentSessionId: true,
  includeOrganizationId: false, // Added as structured fields for CustomLoggerService
  includeProjectId: false, // Added as structured fields for CustomLoggerService
  includeUserId: false, // Usually not needed in logs

  // Flow-specific metadata - critical for flow debugging
  includeFlowId: true,
  includeNodeId: true,
  includeNodeType: true,
  includeServiceChain: false, // Can be verbose, enable selectively
  includeExecutionType: true,
  includeOperationType: true,

  // Performance metadata - useful for performance analysis
  includeProcessingTime: false, // Enable for performance debugging
  includeLLMMetadata: false, // Enable for LLM cost analysis

  // Sampling - disabled by default
  enableSampling: false,
  samplingRate: 1.0,

  // Format customization
  contextPrefix: '[CTX]',
  contextSeparator: ' | ',
  maxContextLength: 200,
};

/**
 * ContextAwareLogger Service
 *
 * Automatically enriches log messages with current EventContext information.
 * This service wraps NestJS Logger and provides the same interface while
 * adding contextual information to every log message.
 *
 * Features:
 * - Automatic context extraction from AsyncLocalStorage
 * - Configurable context fields inclusion
 * - Context sampling for high-volume scenarios
 * - Graceful degradation when context is unavailable
 * - Performance-optimized context serialization
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * class MyService {
 *   constructor(private contextLogger: ContextAwareLogger) {
 *     this.contextLogger.setContext('MyService');
 *   }
 *
 *   someMethod() {
 *     this.contextLogger.log('Processing started');
 *     // Output: [CTX] [workflowId: wf_123] [nodeId: node_456] Processing started
 *   }
 * }
 * ```
 */
@Injectable()
export class ContextAwareLogger {
  private readonly logger: Logger;
  private readonly customLogger?: CustomLoggerService;
  private readonly config: Required<ContextAwareLoggerConfig>;
  private readonly contextName?: string;
  private readonly isDevelopment: boolean;

  // Global reference to CustomLoggerService for static factory methods
  private static globalCustomLogger?: CustomLoggerService;

  constructor(
    context?: string,
    config: Partial<ContextAwareLoggerConfig> = {},
    @Optional() customLogger?: CustomLoggerService,
  ) {
    this.logger = new Logger(context ?? ContextAwareLogger.name);
    this.customLogger = customLogger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.contextName = context;
    this.isDevelopment = process.env.NODE_ENV !== 'production';

    // Store first injected CustomLoggerService as global reference
    if (customLogger && !ContextAwareLogger.globalCustomLogger) {
      ContextAwareLogger.globalCustomLogger = customLogger;
    }
  }

  /**
   * Set the global CustomLoggerService instance for static factory methods
   * This is automatically called when the first ContextAwareLogger is created via DI
   */
  static setGlobalCustomLogger(customLogger: CustomLoggerService): void {
    ContextAwareLogger.globalCustomLogger = customLogger;
  }

  /**
   * Set the logger context (service/class name)
   */
  setContext(context: string): void {
    // NestJS Logger context is set via constructor or localInstance
    // We'll store it for child logger creation
    (this.logger as unknown as { context?: string }).context = context;
  }

  /**
   * Update logger configuration at runtime
   */
  updateConfig(config: Partial<ContextAwareLoggerConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Check if we should sample this log entry
   */
  private shouldSample(): boolean {
    if (!this.config.enableSampling) {
      return true;
    }
    return Math.random() < this.config.samplingRate;
  }

  /**
   * Build structured metadata for the current context.
   */
  private buildContextMetadata(): Record<string, string> {
    const contextMap: Record<string, string> = {};

    try {
      const context = EventContextManager.getInstance().getCurrentContext();
      if (!context) {
        return contextMap;
      }

      const metadata = context.metadata || {};

      // Core context fields
      if (this.config.includeCorrelationId && context.correlationId) {
        contextMap.correlationId = context.correlationId;
      }
      if (this.config.includeCausationId && context.causationId) {
        contextMap.causationId = context.causationId;
      }
      if (this.config.includeWorkflowId && context.workflowId) {
        contextMap.workflowId = context.workflowId;
      }
      if (this.config.includeConversationId && context.conversationId) {
        contextMap.conversationId = context.conversationId;
      }
      if (this.config.includeMessageId && context.messageId) {
        contextMap.messageId = context.messageId;
      }
      if (
        this.config.includeRequestId &&
        (context.requestId || context.metadata?.requestId)
      ) {
        contextMap.requestId =
          context.requestId || String(context.metadata?.requestId);
      }
      if (
        this.config.includeAgentSessionId &&
        (context.agentSessionId || context.metadata?.agentSessionId)
      ) {
        contextMap.agentSessionId =
          context.agentSessionId || String(context.metadata?.agentSessionId);
      }
      if (this.config.includeOrganizationId && context.organizationId) {
        contextMap.organizationId = context.organizationId;
      }
      if (this.config.includeProjectId && context.projectId) {
        contextMap.projectId = context.projectId;
      }
      if (this.config.includeUserId && context.userId) {
        contextMap.userId = context.userId;
      }

      // Flow-specific metadata
      if (this.config.includeFlowId && metadata.flowId) {
        contextMap.flowId = String(metadata.flowId);
      }
      if (this.config.includeNodeId && metadata.nodeId) {
        contextMap.nodeId = String(metadata.nodeId);
      }
      if (this.config.includeNodeType && metadata.nodeType) {
        contextMap.nodeType = String(metadata.nodeType);
      }
      if (this.config.includeExecutionType && metadata.executionType) {
        contextMap.executionType = String(metadata.executionType);
      }
      if (this.config.includeOperationType && metadata.operationType) {
        contextMap.operationType = String(metadata.operationType);
      }

      if (this.config.includeServiceChain && metadata.serviceChain?.length) {
        const chain = metadata.serviceChain.slice(-3).join('→');
        contextMap.serviceChain = chain;
      }

      if (this.config.includeProcessingTime && metadata.processingStartTime) {
        const duration = Date.now() - metadata.processingStartTime;
        contextMap.processingDurationMs = String(duration);
      }

      if (this.config.includeLLMMetadata) {
        if (metadata.llmModel) {
          contextMap.llmModel = String(metadata.llmModel);
        }
        if (metadata.llmTokensUsed) {
          contextMap.llmTokensUsed = String(metadata.llmTokensUsed);
        }
      }
    } catch (error) {
      contextMap.contextError = 'context_format_failed';
    }

    return contextMap;
  }

  private serializeParam(param: unknown): string | undefined {
    if (param === undefined || param === null) {
      return undefined;
    }
    if (param instanceof Error) {
      return param.stack || param.message;
    }
    if (typeof param === 'string') {
      return param;
    }
    try {
      return JSON.stringify(param);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(param);
    }
  }

  private normalizePrimaryMessage(message: unknown): string {
    if (message instanceof Error) {
      return message.message;
    }
    if (typeof message === 'string') {
      return message;
    }
    if (message === undefined || message === null) {
      return '';
    }
    try {
      return JSON.stringify(message);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(message);
    }
  }

  private collectDetails(optionalParams: unknown[]): string[] {
    if (this.isDevelopment) {
      return optionalParams.filter(Boolean) as string[];
    }
    return optionalParams
      .map((param) => this.serializeParam(param))
      .filter((value): value is string => Boolean(value));
  }

  private extractErrorStack(
    message: unknown,
    optionalParams: unknown[],
  ): string | undefined {
    if (message instanceof Error) {
      return message.stack ?? message.message;
    }
    for (const param of optionalParams) {
      if (param instanceof Error) {
        return param.stack ?? param.message;
      }
    }
    return undefined;
  }

  private formatFallbackMessage(
    message: string,
    contextMetadata: Record<string, string>,
    details: string[],
    errorStack?: string,
    includeContextPrefix = true,
  ): string {
    const parts: string[] = [];
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const jsonSpace = isDevelopment ? 2 : 0;

    if (Object.keys(contextMetadata).length) {
      const rawContext = JSON.stringify(contextMetadata, null, jsonSpace);
      const truncatedContext =
        rawContext.length > this.config.maxContextLength
          ? `${rawContext.substring(0, this.config.maxContextLength - 3)}...`
          : rawContext;
      const prefix = this.config.contextPrefix
        ? `${this.config.contextPrefix} ${truncatedContext}`
        : truncatedContext;
      parts.push(prefix);
    } else if (includeContextPrefix && this.config.contextPrefix) {
      parts.push(this.config.contextPrefix);
    }

    parts.push(message);

    if (details.length) {
      const truncatedDetails = details.slice(0, 5);
      parts.push(
        `details=${JSON.stringify(truncatedDetails, null, jsonSpace)}`,
      );
    }

    if (errorStack) {
      parts.push(
        `errorStack=${JSON.stringify(errorStack.substring(0, 500), null, jsonSpace)}`,
      );
    }

    return parts.join(' ');
  }

  private resolveNestMethod(
    level: LogLevel | 'fatal',
  ): (...args: unknown[]) => void {
    switch (level) {
      case 'error':
        return this.logger.error.bind(this.logger);
      case 'warn':
        return this.logger.warn.bind(this.logger);
      case 'debug':
        return this.logger.debug.bind(this.logger);
      case 'verbose':
        return this.logger.verbose.bind(this.logger);
      case 'fatal':
        return this.logger.fatal
          ? this.logger.fatal.bind(this.logger)
          : this.logger.error.bind(this.logger);
      default:
        return this.logger.log.bind(this.logger);
    }
  }

  private emit(
    level: LogLevel | 'fatal',
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const normalizedMessage = this.normalizePrimaryMessage(message);
    const details = this.collectDetails(optionalParams);
    const errorStack = this.extractErrorStack(message, optionalParams);
    const includeContext = this.shouldSample();
    const contextMetadata = includeContext ? this.buildContextMetadata() : {};

    if (this.customLogger) {
      const structuredContext = { ...contextMetadata };
      const eventContext =
        EventContextManager.getInstance().getCurrentContext();
      if (eventContext) {
        if (eventContext.organizationId) {
          structuredContext.organizationId = eventContext.organizationId;
        }
        if (eventContext.projectId) {
          structuredContext.projectId = eventContext.projectId;
        }
      }
      const meta: Record<string, unknown> = {
        loggerContext: this.contextName,
        ...structuredContext,
      };
      if (errorStack) {
        meta.errorStack = errorStack;
      }

      if (level === 'error' || level === 'fatal') {
        if (this.isDevelopment) {
          this.customLogger.error('ERRORPATTERN');
        }
        this.customLogger.error(
          normalizedMessage,
          errorStack,
          this.contextName,
          meta,
        );
      } else if (level === 'log') {
        this.customLogger.logWithContext('info', normalizedMessage, meta);
      } else {
        this.customLogger.logWithContext(level, normalizedMessage, meta);
      }
      return;
    }

    const fallbackMessage = this.formatFallbackMessage(
      normalizedMessage,
      contextMetadata,
      details,
      errorStack,
      includeContext,
    );
    const method = this.resolveNestMethod(level);
    method(fallbackMessage);
  }

  // Standard Logger interface methods with structured context

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  /**
   * Set log levels for the logger instance.
   */
  setLogLevels(levels: LogLevel[]): void {
    // NestJS Logger setLogLevels is a static method, not instance method
    Logger.overrideLogger(levels);
  }

  /**
   * Get the current context
   */
  getContext(): string | undefined {
    return this.contextName;
  }

  /**
   * Create a child logger with the same configuration but different context
   */
  createChildLogger(context: string): ContextAwareLogger {
    return new ContextAwareLogger(
      context,
      { ...this.config },
      this.customLogger,
    );
  }

  /**
   * Static factory method for quick logger creation with common configurations
   */
  static createServiceLogger(
    serviceName: string,
    customLogger?: CustomLoggerService,
  ): ContextAwareLogger {
    // Use provided customLogger or fall back to global one
    const logger = customLogger || ContextAwareLogger.globalCustomLogger;
    return new ContextAwareLogger(
      serviceName,
      {
        includeFlowId: true,
        includeNodeId: true,
        includeWorkflowId: true,
        includeConversationId: true,
        includeMessageId: true,
        includeExecutionType: true,
        includeOperationType: true,
      },
      logger,
    );
  }

  /**
   * Static factory method for performance-focused logging
   */
  static createPerformanceLogger(
    serviceName: string,
    customLogger?: CustomLoggerService,
  ): ContextAwareLogger {
    const logger = customLogger || ContextAwareLogger.globalCustomLogger;
    return new ContextAwareLogger(
      serviceName,
      {
        includeFlowId: true,
        includeNodeId: true,
        includeProcessingTime: true,
        includeLLMMetadata: true,
        includeServiceChain: true,
        enableSampling: true,
        samplingRate: 0.1, // 10% sampling for performance logs
      },
      logger,
    );
  }

  /**
   * Static factory method for debugging-focused logging
   */
  static createDebugLogger(
    serviceName: string,
    customLogger?: CustomLoggerService,
  ): ContextAwareLogger {
    const logger = customLogger || ContextAwareLogger.globalCustomLogger;
    return new ContextAwareLogger(
      serviceName,
      {
        includeCorrelationId: true,
        includeCausationId: true,
        includeWorkflowId: true,
        includeConversationId: true,
        includeMessageId: true,
        includeFlowId: true,
        includeNodeId: true,
        includeNodeType: true,
        includeServiceChain: true,
        includeExecutionType: true,
        includeOperationType: true,
        maxContextLength: 500, // Allow longer context for debugging
      },
      logger,
    );
  }
}
