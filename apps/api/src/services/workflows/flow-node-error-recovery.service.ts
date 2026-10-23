import { Injectable, Logger } from '@nestjs/common';
import {
  CircuitBreakerState,
  WorkflowStep,
} from '../../workflows/conversation-workflow-state';

/**
 * Service-compatible error recovery for flow node processing
 * This is a simplified version of the workflow error recovery manager
 * that uses NestJS Logger instead of Temporal workflow logging
 */

export interface ErrorRecoveryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeoutMs: number;
}

export interface ErrorRecoveryState {
  retryCount: number;
  lastErrorTime: Date;
  errorHistory: ErrorHistoryEntry[];
  circuitBreakerState: CircuitBreakerState;
}

export interface ErrorHistoryEntry {
  timestamp: Date;
  error: string;
  context: string;
  recovered: boolean;
}

export interface RecoveryResult {
  shouldRetry: boolean;
  delayMs?: number;
  nextStep?: WorkflowStep;
  errorMessage?: string;
}

/**
 * Default error recovery configuration
 */
const DEFAULT_RECOVERY_CONFIG: ErrorRecoveryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeoutMs: 60000,
};

/**
 * Service-compatible error recovery manager for flow node processing
 */
@Injectable()
export class FlowNodeErrorRecoveryService {
  private readonly logger = new Logger(FlowNodeErrorRecoveryService.name);

  // Simple in-memory state storage (could be enhanced with Redis/DB for persistence)
  private errorStates = new Map<string, ErrorRecoveryState>();

  // Circuit breaker state
  private circuitBreakerFailures = new Map<string, number>();
  private circuitBreakerLastFailure = new Map<string, number>();
  private readonly circuitBreakerThreshold = 5; // failures before opening circuit
  private readonly circuitBreakerResetTime = 5 * 60 * 1000; // 5 minutes

  /**
   * Record circuit breaker failure
   */
  recordCircuitBreakerFailure(circuitKey: string): void {
    const failures = (this.circuitBreakerFailures.get(circuitKey) || 0) + 1;
    this.circuitBreakerFailures.set(circuitKey, failures);
    this.circuitBreakerLastFailure.set(circuitKey, Date.now());

    if (failures >= this.circuitBreakerThreshold) {
      this.logger.warn(
        `Circuit breaker opened for ${circuitKey} after ${failures} failures`,
      );
    }
  }

  /**
   * Record circuit breaker success (reset failure count)
   */
  recordCircuitBreakerSuccess(circuitKey: string): void {
    if (this.circuitBreakerFailures.has(circuitKey)) {
      this.circuitBreakerFailures.delete(circuitKey);
      this.circuitBreakerLastFailure.delete(circuitKey);
    }
  }

  /**
   * Get circuit breaker key for node processing
   * AGENT nodes get organization-specific circuit breakers like other node types
   */
  getCircuitBreakerKey(nodeType: string, organizationId: string): string {
    return `${nodeType}_${organizationId}`;
  }

  /**
   * Check if circuit breaker is open for a given key
   */
  isCircuitOpen(circuitKey: string): boolean {
    // Disable circuit breaker in development and test environments
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test'
    ) {
      return false;
    }

    const failures = this.circuitBreakerFailures.get(circuitKey) || 0;
    const lastFailure = this.circuitBreakerLastFailure.get(circuitKey) || 0;

    if (failures >= this.circuitBreakerThreshold) {
      const timeSinceLastFailure = Date.now() - lastFailure;
      if (timeSinceLastFailure < this.circuitBreakerResetTime) {
        return true; // Circuit is still open
      } else {
        // Reset circuit breaker
        this.circuitBreakerFailures.delete(circuitKey);
        this.circuitBreakerLastFailure.delete(circuitKey);
        this.logger.log(`Circuit breaker reset for ${circuitKey}`);
        return false;
      }
    }

    return false;
  }

  /**
   * Handle error recovery for flow node processing
   */
  handleErrorRecovery(
    nodeId: string,
    organizationId: string,
    error: Error,
    context: string,
    config: Partial<ErrorRecoveryConfig> = {},
  ): RecoveryResult {
    const recoveryConfig = { ...DEFAULT_RECOVERY_CONFIG, ...config };
    const stateKey = `${organizationId}:${nodeId}`;

    // Surface the initial failure loudly; subsequent retries downgrade.
    const existingState = this.errorStates.get(stateKey);
    const isFirstOccurrence = !existingState || existingState.retryCount === 0;

    const logPayload = {
      nodeId,
      organizationId,
      error: error.message,
      errorType: error.constructor.name,
      context,
      config: recoveryConfig,
    };

    if (isFirstOccurrence) {
      this.logger.error('Flow node error detected', logPayload);
    } else {
      this.logger.warn('Flow node error detected (retrying)', logPayload);
    }

    this.logger.debug('Starting error recovery analysis', logPayload);

    // Get or initialize recovery state
    let recoveryState = existingState;
    if (!recoveryState) {
      recoveryState = this.initializeErrorRecoveryState();
      this.errorStates.set(stateKey, recoveryState);
      this.logger.debug('Initialized new error recovery state', { stateKey });
    }

    this.logger.debug('Current recovery state', {
      stateKey,
      retryCount: recoveryState.retryCount,
      circuitBreakerState: recoveryState.circuitBreakerState,
      lastErrorTime: recoveryState.lastErrorTime,
      errorHistoryCount: recoveryState.errorHistory.length,
    });

    // Add error to history
    this.addErrorToHistory(recoveryState, error, context);

    // Check circuit breaker state
    const circuitBreakerResult = this.checkCircuitBreaker(
      recoveryState,
      recoveryConfig,
    );

    this.logger.debug('Circuit breaker check result', {
      stateKey,
      allowRequest: circuitBreakerResult.allowRequest,
      state: circuitBreakerResult.state,
      reason: circuitBreakerResult.reason,
    });

    if (!circuitBreakerResult.allowRequest) {
      this.logger.warn('Circuit breaker blocking request', {
        stateKey,
        state: circuitBreakerResult.state,
        reason: circuitBreakerResult.reason,
      });
      return {
        shouldRetry: false,
        errorMessage: `Circuit breaker is ${circuitBreakerResult.state}. ${circuitBreakerResult.reason}`,
        nextStep: WorkflowStep.COMPLETING_FLOW,
      };
    }

    // Determine if we should retry
    const shouldRetry = this.shouldAttemptRetry(
      recoveryState,
      recoveryConfig,
      error,
    );

    this.logger.log('Retry decision', {
      stateKey,
      shouldRetry,
      currentRetryCount: recoveryState.retryCount,
      maxRetries: recoveryConfig.maxRetries,
      errorRetryable: this.isRetryableError(error),
    });

    if (!shouldRetry) {
      // Max retries exceeded or non-retryable error
      this.logger.warn(
        'Not retrying - permanent failure or max retries exceeded',
        {
          stateKey,
          retryCount: recoveryState.retryCount,
          maxRetries: recoveryConfig.maxRetries,
          errorRetryable: this.isRetryableError(error),
        },
      );

      this.updateCircuitBreakerOnFailure(recoveryState, recoveryConfig);

      return {
        shouldRetry: false,
        errorMessage: `Recovery failed after ${recoveryState.retryCount} attempts: ${error.message}`,
        nextStep: WorkflowStep.COMPLETING_FLOW,
      };
    }

    // Calculate retry delay with exponential backoff
    const delayMs = this.calculateRetryDelay(
      recoveryState.retryCount,
      recoveryConfig,
      error,
    );

    const timeSinceLastError =
      new Date().getTime() - recoveryState.lastErrorTime.getTime();

    this.logger.warn('Scheduling retry', {
      stateKey,
      nodeId,
      error: error.message,
      errorType: error.constructor.name,
      currentRetryCount: recoveryState.retryCount,
      nextRetryCount: recoveryState.retryCount + 1,
      calculatedDelayMs: delayMs,
      timeSinceLastErrorMs: timeSinceLastError,
      lastErrorTime: recoveryState.lastErrorTime,
      context,
    });

    // Increment retry count
    recoveryState.retryCount++;
    recoveryState.lastErrorTime = new Date();

    return {
      shouldRetry: true,
      delayMs,
    };
  }

  /**
   * Reset error recovery state for successful operations
   */
  resetErrorRecoveryState(nodeId: string, organizationId: string): void {
    const stateKey = `${organizationId}:${nodeId}`;
    const recoveryState = this.errorStates.get(stateKey);

    if (recoveryState) {
      recoveryState.retryCount = 0;
      this.updateCircuitBreakerOnSuccess(recoveryState);
      this.logger.debug('Reset error recovery state', { stateKey });
    }
  }

  /**
   * Update circuit breaker on successful operation
   */
  private updateCircuitBreakerOnSuccess(
    recoveryState: ErrorRecoveryState,
  ): void {
    if (recoveryState.circuitBreakerState === CircuitBreakerState.HALF_OPEN) {
      // Success in half-open state, close the circuit
      recoveryState.circuitBreakerState = CircuitBreakerState.CLOSED;
      recoveryState.retryCount = 0; // Reset retry count on success

      // Mark recent errors as recovered
      recoveryState.errorHistory.forEach((entry) => {
        if (!entry.recovered) {
          entry.recovered = true;
        }
      });

      this.logger.log('Circuit breaker closed after successful recovery');
    }
  }

  private initializeErrorRecoveryState(): ErrorRecoveryState {
    return {
      retryCount: 0,
      lastErrorTime: new Date(),
      errorHistory: [],
      circuitBreakerState: CircuitBreakerState.CLOSED,
    };
  }

  private addErrorToHistory(
    recoveryState: ErrorRecoveryState,
    error: Error,
    context: string,
  ): void {
    recoveryState.errorHistory.push({
      timestamp: new Date(),
      error: error.message,
      context,
      recovered: false,
    });

    // Keep only recent errors (last 10)
    if (recoveryState.errorHistory.length > 10) {
      recoveryState.errorHistory = recoveryState.errorHistory.slice(-10);
    }
  }

  private checkCircuitBreaker(
    recoveryState: ErrorRecoveryState,
    config: ErrorRecoveryConfig,
  ): { allowRequest: boolean; state: CircuitBreakerState; reason?: string } {
    const now = new Date();

    switch (recoveryState.circuitBreakerState) {
      case CircuitBreakerState.CLOSED:
        return { allowRequest: true, state: CircuitBreakerState.CLOSED };

      case CircuitBreakerState.OPEN: {
        const timeoutElapsed =
          now.getTime() - recoveryState.lastErrorTime.getTime() >
          config.circuitBreakerTimeoutMs;

        if (timeoutElapsed) {
          recoveryState.circuitBreakerState = CircuitBreakerState.HALF_OPEN;
          this.logger.log('Circuit breaker moving to HALF_OPEN state');
          return { allowRequest: true, state: CircuitBreakerState.HALF_OPEN };
        }

        return {
          allowRequest: false,
          state: CircuitBreakerState.OPEN,
          reason:
            'Circuit breaker is open, waiting for timeout period to elapse',
        };
      }

      case CircuitBreakerState.HALF_OPEN:
        return { allowRequest: true, state: CircuitBreakerState.HALF_OPEN };

      default:
        return { allowRequest: true, state: CircuitBreakerState.CLOSED };
    }
  }

  private updateCircuitBreakerOnFailure(
    recoveryState: ErrorRecoveryState,
    config: ErrorRecoveryConfig,
  ): void {
    const recentFailures = this.countRecentFailures(
      recoveryState,
      5 * 60 * 1000,
    );

    if (recentFailures >= config.circuitBreakerThreshold) {
      if (recoveryState.circuitBreakerState !== CircuitBreakerState.OPEN) {
        recoveryState.circuitBreakerState = CircuitBreakerState.OPEN;
        this.logger.error('Circuit breaker opened due to repeated failures', {
          recentFailures,
          threshold: config.circuitBreakerThreshold,
        });
      }
    } else if (
      recoveryState.circuitBreakerState === CircuitBreakerState.HALF_OPEN
    ) {
      recoveryState.circuitBreakerState = CircuitBreakerState.OPEN;
      this.logger.warn(
        'Circuit breaker returned to OPEN state after half-open failure',
      );
    }
  }

  private countRecentFailures(
    recoveryState: ErrorRecoveryState,
    timeWindowMs: number,
  ): number {
    const cutoffTime = new Date(Date.now() - timeWindowMs);

    return recoveryState.errorHistory.filter(
      (entry) => entry.timestamp > cutoffTime && !entry.recovered,
    ).length;
  }

  private shouldAttemptRetry(
    recoveryState: ErrorRecoveryState,
    config: ErrorRecoveryConfig,
    error: Error,
  ): boolean {
    if (recoveryState.retryCount >= config.maxRetries) {
      return false;
    }

    if (!this.isRetryableError(error)) {
      this.logger.debug('Error is not retryable', {
        error: error.message,
        errorType: error.constructor.name,
      });
      return false;
    }

    return true;
  }

  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();

    // Check if this is a structured LLMApiError with status code
    if (error.name === 'LLMApiError' && 'statusCode' in error) {
      const statusCode = (error as unknown as { statusCode: number })
        .statusCode;
      const retryable = this.isHttpStatusRetryable(statusCode);

      this.logger.debug('Analyzing LLMApiError', {
        errorName: error.name,
        statusCode,
        retryable,
        message: error.message,
      });

      return retryable;
    }

    // Fallback: check for HTTP status codes in error messages
    const statusCodeMatch = error.message.match(
      /(?:api|server)\s+error:\s+(\d{3})/i,
    );
    if (statusCodeMatch?.[1]) {
      const statusCode = parseInt(statusCodeMatch[1], 10);
      const retryable = this.isHttpStatusRetryable(statusCode);

      this.logger.debug('Analyzing error with parsed status code', {
        statusCode,
        retryable,
        message: error.message,
        errorType: error.constructor.name,
      });

      return retryable;
    }

    // Fallback to pattern matching for other error types
    const nonRetryablePatterns = [
      /invalid.*configuration/i,
      /authentication.*failed/i,
      /unauthorized/i,
      /forbidden/i,
      /not.*found/i,
      /validation.*error/i,
      /schema.*error/i,
      /bad.*request/i,
      /malformed/i,
      /invalid.*parameter/i,
    ];

    const matchedPattern = nonRetryablePatterns.find((pattern) =>
      pattern.test(errorMessage),
    );
    const retryable = !matchedPattern;

    this.logger.debug('Analyzing error with pattern matching', {
      message: error.message,
      errorType: error.constructor.name,
      matchedPattern: matchedPattern?.source,
      retryable,
    });

    return retryable;
  }

  private isHttpStatusRetryable(statusCode: number): boolean {
    let retryable = false;
    let reason = '';

    // 4xx Client Errors - Generally not retryable (permanent failures)
    if (statusCode >= 400 && statusCode < 500) {
      if (statusCode === 429) {
        retryable = true;
        reason = '429 Rate Limited - retryable with backoff';
      } else if (statusCode === 408) {
        retryable = true;
        reason = '408 Request Timeout - retryable';
      } else {
        retryable = false;
        reason = `${statusCode} Client Error - permanent failure`;
      }
    }
    // 5xx Server Errors - Generally retryable (temporary server issues)
    else if (statusCode >= 500 && statusCode < 600) {
      retryable = true;
      reason = `${statusCode} Server Error - temporary issue, retryable`;
    }
    // Other status codes
    else {
      retryable = false;
      reason = `${statusCode} - not retryable in this context`;
    }

    this.logger.debug('HTTP status code analysis', {
      statusCode,
      retryable,
      reason,
    });

    return retryable;
  }

  private calculateRetryDelay(
    retryCount: number,
    config: ErrorRecoveryConfig,
    error?: Error,
  ): number {
    const initialCalculation =
      config.initialDelayMs * Math.pow(config.backoffMultiplier, retryCount);
    let baseDelay = initialCalculation;
    let isRateLimited = false;

    this.logger.debug('Starting delay calculation', {
      retryCount,
      initialDelayMs: config.initialDelayMs,
      backoffMultiplier: config.backoffMultiplier,
      maxDelayMs: config.maxDelayMs,
      initialCalculation,
    });

    // Special handling for rate limiting (429) errors
    if (error) {
      let statusCode: number | undefined;

      if (error.name === 'LLMApiError' && 'statusCode' in error) {
        statusCode = (error as unknown as { statusCode: number }).statusCode;
      } else {
        const statusCodeMatch = error.message.match(
          /(?:api|server)\s+error:\s+(\d{3})/i,
        );
        if (statusCodeMatch?.[1]) {
          statusCode = parseInt(statusCodeMatch[1], 10);
        }
      }

      if (statusCode === 429) {
        isRateLimited = true;
        const preRateLimitDelay = baseDelay;
        baseDelay = Math.max(baseDelay, 5000); // Minimum 5 second delay for rate limits
        baseDelay *= 2; // Double the delay for rate limiting

        this.logger.warn('Rate limit detected, extending delay', {
          statusCode,
          preRateLimitDelay,
          postRateLimitDelay: baseDelay,
          minimumApplied: preRateLimitDelay < 5000,
        });
      } else if (statusCode) {
        this.logger.debug('Non-rate-limit status code, using standard delay', {
          statusCode,
          baseDelay,
        });
      }
    }

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * baseDelay;
    const finalDelay = Math.min(baseDelay + jitter, config.maxDelayMs);

    this.logger.log('Final delay calculation', {
      retryCount,
      baseDelay,
      jitter,
      finalDelay,
      maxDelayMs: config.maxDelayMs,
      isRateLimited,
      wasCapedByMax: baseDelay + jitter > config.maxDelayMs,
    });

    return finalDelay;
  }
}
