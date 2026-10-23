/**
 * Exponential Backoff Retry Hook
 *
 * React hook for implementing retry logic with exponential backoff,
 * specifically designed for handling version conflicts and network errors.
 */

import { useCallback, useRef } from "react";
import type { RetryOptions } from "../types/conversation";
import {
  isVersionConflictError,
  calculateBackoffDelay,
  logVersionConflict,
  sleep,
} from "../utils/versionUtils";

/**
 * Hook for implementing exponential backoff retry logic
 *
 * @returns Object with retryWithBackoff function
 */
export function useRetryWithBackoff() {
  // Track active retry operations to prevent concurrent retries
  const activeRetries = useRef<Set<string>>(new Set());

  /**
   * Execute an operation with exponential backoff retry logic
   *
   * @param operation - Async operation to retry
   * @param options - Retry configuration options
   * @param operationId - Optional unique ID to prevent concurrent retries
   * @returns Promise that resolves with operation result or rejects with final error
   */
  const retryWithBackoff = useCallback(
    async <T>(
      operation: () => Promise<T>,
      options: Partial<RetryOptions> = {},
      operationId?: string,
    ): Promise<T> => {
      const config: RetryOptions = {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        ...options,
      };

      // Prevent concurrent retries of the same operation
      if (operationId && activeRetries.current.has(operationId)) {
        throw new Error("Operation already in progress");
      }

      if (operationId) {
        activeRetries.current.add(operationId);
      }

      let lastError: unknown;
      let attempt = 0;

      try {
        while (attempt <= config.maxRetries) {
          try {
            // Attempt the operation
            const result = await operation();

            // Success - clean up and return result
            if (operationId) {
              activeRetries.current.delete(operationId);
            }

            return result;
          } catch (error) {
            lastError = error;

            // Log version conflicts for debugging
            if (isVersionConflictError(error)) {
              logVersionConflict(
                error,
                `Retry attempt ${attempt + 1}/${config.maxRetries + 1}`,
              );
            }

            // Don't retry on the last attempt
            if (attempt === config.maxRetries) {
              break;
            }

            // Only retry on version conflicts or network errors
            if (!shouldRetryError(error)) {
              break;
            }

            // Calculate delay for this attempt
            const delay = calculateBackoffDelay(
              attempt,
              config.baseDelay,
              config.maxDelay,
            );

            console.log(
              `🔄 Retry attempt ${attempt + 1}/${
                config.maxRetries + 1
              } after ${delay}ms`,
              {
                error: isVersionConflictError(error)
                  ? error.error
                  : "Network error",
                operationId: operationId || "unknown",
              },
            );

            // Call retry callback if provided
            config.onRetry?.(attempt + 1, error);

            // Wait before retry
            await sleep(delay);

            attempt++;
          }
        }
      } finally {
        // Clean up active retry tracking
        if (operationId) {
          activeRetries.current.delete(operationId);
        }
      }

      // All retries exhausted - throw the last error
      console.error("🚨 All retry attempts exhausted", {
        attempts: attempt,
        maxRetries: config.maxRetries,
        lastError,
        operationId: operationId || "unknown",
      });

      throw lastError;
    },
    [],
  );

  /**
   * Check if an error should trigger a retry
   *
   * @param error - The error to check
   * @returns true if the error is retryable
   */
  const shouldRetryError = useCallback((error: unknown): boolean => {
    // Always retry version conflicts
    if (isVersionConflictError(error)) {
      return true;
    }

    // Retry network errors
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return true;
    }

    // Retry server errors (500-599)
    if (typeof error === "object" && error !== null && "status" in error) {
      const statusError = error as { status: number };
      return statusError.status >= 500 && statusError.status < 600;
    }

    // Don't retry other errors (validation, auth, etc.)
    return false;
  }, []);

  /**
   * Execute an operation with a simplified retry for version conflicts only
   *
   * @param operation - Async operation to retry
   * @param maxRetries - Maximum number of retries (default: 3)
   * @returns Promise that resolves with operation result or rejects with final error
   */
  const retryVersionConflicts = useCallback(
    async <T>(
      operation: () => Promise<T>,
      maxRetries: number = 3,
    ): Promise<T> => {
      return retryWithBackoff(operation, {
        maxRetries,
        baseDelay: 500,
        maxDelay: 2000,
      });
    },
    [retryWithBackoff],
  );

  /**
   * Get information about active retry operations
   *
   * @returns Array of active operation IDs
   */
  const getActiveRetries = useCallback((): string[] => {
    return Array.from(activeRetries.current);
  }, []);

  /**
   * Cancel a specific retry operation
   *
   * @param operationId - ID of the operation to cancel
   */
  const cancelRetry = useCallback((operationId: string): void => {
    activeRetries.current.delete(operationId);
  }, []);

  /**
   * Cancel all active retry operations
   */
  const cancelAllRetries = useCallback((): void => {
    activeRetries.current.clear();
  }, []);

  return {
    retryWithBackoff,
    retryVersionConflicts,
    getActiveRetries,
    cancelRetry,
    cancelAllRetries,
  };
}
