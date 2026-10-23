/**
 * Message Retry Hook
 *
 * Provides functionality for retrying failed system messages with polling
 * for retry status and automatic conversation reload on success.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../clients";
import type {
  MessageRetryState,
  MessageRetryStatus,
} from "../types/conversation";

export interface UseMessageRetryProps {
  /**
   * Organization ID
   */
  organizationId: string;

  /**
   * Project ID
   */
  projectId: string;

  /**
   * Message ID to retry
   */
  messageId: string;

  /**
   * Callback when retry is successful and conversation should be reloaded
   */
  onRetrySuccess?: () => Promise<void>;

  /**
   * Callback when retry fails
   */
  onRetryError?: (error: string) => void;

  /**
   * Polling interval in milliseconds (default: 500)
   */
  pollingInterval?: number;

  /**
   * Maximum number of polling attempts (default: 120, which is 1 minute at 500ms intervals)
   */
  maxPollingAttempts?: number;
}

/**
 * Hook for handling message retry with status polling
 */
export function useMessageRetry({
  organizationId,
  projectId,
  messageId,
  onRetrySuccess,
  onRetryError,
  pollingInterval = 500,
  maxPollingAttempts = 120,
}: UseMessageRetryProps): MessageRetryState {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryStatus, setRetryStatus] = useState<
    MessageRetryStatus | undefined
  >();
  const [retryError, setRetryError] = useState<string | undefined>();
  const [isPolling, setIsPolling] = useState(false);

  // Refs to manage polling lifecycle
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingAttemptsRef = useRef(0);

  /**
   * Clear polling interval and reset polling state
   */
  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsPolling(false);
    pollingAttemptsRef.current = 0;
  }, []);

  /**
   * Check retry status once - the API doesn't support polling for completion
   */
  const checkRetryStatus = useCallback(async () => {
    try {
      console.log(`🔍 Checking retry status for message ${messageId}...`);

      const response = await apiClient.getMessageRetryStatus(
        organizationId,
        projectId,
        messageId
      );

      if (response.data?.data) {
        setRetryStatus(response.data.data);

        // If the message is retryable and has been retried, the retry was successful
        // We'll let the conversation polling handle detecting when processing is complete
        if (response.data.data.retryable && response.data.data.retryCount > 0) {
          console.log(
            "🎉 Message retry status confirmed, reloading conversation..."
          );
          clearPolling();
          setIsRetrying(false);
          if (onRetrySuccess) {
            await onRetrySuccess();
          }
        }
      }
    } catch (error) {
      console.error("Error checking retry status:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to check retry status";
      setRetryError(errorMessage);
      onRetryError?.(errorMessage);
      clearPolling();
      setIsRetrying(false);
    }
  }, [
    organizationId,
    projectId,
    messageId,
    onRetrySuccess,
    onRetryError,
    clearPolling,
  ]);

  const startPolling = useCallback(() => {
    clearPolling();

    if (maxPollingAttempts <= 0) {
      checkRetryStatus();
      return;
    }

    setIsPolling(true);
    pollingAttemptsRef.current = 0;

    const poll = async () => {
      pollingAttemptsRef.current += 1;
      await checkRetryStatus();

      if (pollingAttemptsRef.current >= maxPollingAttempts) {
        clearPolling();
        setIsRetrying(false);
        const timeoutMessage = "Retry status polling timed out";
        setRetryError(timeoutMessage);
        onRetryError?.(timeoutMessage);
      }
    };

    // Perform an immediate check, then continue polling
    void poll();
    pollingIntervalRef.current = setInterval(() => {
      void poll();
    }, pollingInterval);
  }, [
    checkRetryStatus,
    clearPolling,
    maxPollingAttempts,
    pollingInterval,
    onRetryError,
  ]);

  /**
   * Initiate message retry
   */
  const retry = useCallback(async (): Promise<void> => {
    if (isRetrying) {
      console.warn("Retry already in progress");
      return;
    }

    setIsRetrying(true);
    setRetryError(undefined);
    setRetryStatus(undefined);

    try {
      console.log(`🔄 Initiating retry for message ${messageId}...`);

      const response = await apiClient.retryMessage(
        organizationId,
        projectId,
        messageId
      );

      if (response.data?.success && response.data?.data) {
        console.log("✅ Retry initiated successfully:", response.data?.message);
        startPolling();
      } else {
        throw new Error(response.data?.message || "Failed to initiate retry");
      }
    } catch (error) {
      console.error("Error initiating retry:", error);
      setIsRetrying(false);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to initiate retry";
      setRetryError(errorMessage);
      onRetryError?.(errorMessage);
    }
  }, [
    isRetrying,
    messageId,
    organizationId,
    projectId,
    startPolling,
    onRetryError,
  ]);

  /**
   * Cancel ongoing retry operation
   */
  const cancelRetry = useCallback(() => {
    console.log("🛑 Canceling retry operation...");
    clearPolling();
    setIsRetrying(false);
    setRetryStatus(undefined);
    setRetryError(undefined);
  }, [clearPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearPolling();
    };
  }, [clearPolling]);

  return {
    isRetrying,
    retryStatus,
    retryError,
    retry,
    cancelRetry,
    isPolling,
  };
}
