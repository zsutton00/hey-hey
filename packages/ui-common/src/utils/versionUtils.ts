/**
 * Version Utility Functions
 *
 * Utility functions for conversation version checking, comparison, and conflict handling.
 */

import type {
  VersionConflictError,
  VersionedConversationResponseDto,
  VersionedWebSocketMessage,
  ConversationError,
} from "../types/conversation";

/**
 * Compare two version numbers to determine if the new version is newer
 *
 * @param newVersion - The new version number
 * @param currentVersion - The current version number
 * @returns true if newVersion is greater than currentVersion
 */
export function isVersionNewer(
  newVersion: number,
  currentVersion: number
): boolean {
  return newVersion > currentVersion;
}

/**
 * Compare two version numbers to determine if they are equal
 *
 * @param version1 - First version number
 * @param version2 - Second version number
 * @returns true if versions are equal
 */
export function isVersionEqual(version1: number, version2: number): boolean {
  return version1 === version2;
}

/**
 * Type guard to check if an error is a version conflict error
 *
 * @param error - The error to check
 * @returns true if the error is a VersionConflictError
 */
export function isVersionConflictError(
  error: unknown
): error is VersionConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    "currentVersion" in error &&
    "expectedVersion" in error &&
    "latestConversation" in error &&
    (error as VersionConflictError).error === "VERSION_CONFLICT" &&
    typeof (error as VersionConflictError).currentVersion === "number" &&
    typeof (error as VersionConflictError).expectedVersion === "number"
  );
}

/**
 * Type guard to check if a conversation has version information
 *
 * @param conversation - The conversation to check
 * @returns true if the conversation has version information
 */
export function hasVersionInfo(
  conversation: unknown
): conversation is VersionedConversationResponseDto {
  return (
    typeof conversation === "object" &&
    conversation !== null &&
    "version" in conversation &&
    typeof (conversation as VersionedConversationResponseDto).version ===
      "number"
  );
}

/**
 * Extract the current version from a conversation object
 *
 * @param conversation - The conversation to extract version from
 * @returns version number if available, undefined otherwise
 */
export function getCurrentVersion(conversation: unknown): number | undefined {
  if (hasVersionInfo(conversation)) {
    return (conversation as VersionedConversationResponseDto).version;
  }
  return undefined;
}

/**
 * Type guard to check if a WebSocket message has version information
 *
 * @param message - The message to check
 * @returns true if the message has version information
 */
export function isVersionedWebSocketMessage(
  message: unknown
): message is VersionedWebSocketMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    "conversationId" in message &&
    "version" in message &&
    typeof (message as VersionedWebSocketMessage).version === "number"
  );
}

/**
 * Determine if a retry should be attempted based on attempt count and max retries
 *
 * @param attempt - Current attempt number (0-based)
 * @param maxRetries - Maximum number of retries allowed
 * @returns true if should retry
 */
export function shouldRetryOnVersionConflict(
  attempt: number,
  maxRetries: number
): boolean {
  return attempt < maxRetries;
}

/**
 * Calculate exponential backoff delay with jitter
 *
 * @param attempt - Current attempt number (0-based)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @param jitter - Whether to add random jitter (default: true)
 * @returns delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: boolean = true
): number {
  // Calculate exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter to prevent thundering herd
  if (jitter) {
    const jitterAmount = cappedDelay * 0.1; // 10% jitter
    const randomJitter = (Math.random() - 0.5) * 2 * jitterAmount;
    return Math.max(0, cappedDelay + randomJitter);
  }

  return cappedDelay;
}

/**
 * Create a ConversationError from a VersionConflictError
 *
 * @param versionError - The version conflict error
 * @returns ConversationError with appropriate details
 */
export function createConversationErrorFromVersionConflict(
  versionError: VersionConflictError
): ConversationError {
  return {
    type: "version_conflict",
    message: versionError.message || "Conversation was updated by another user",
    details: {
      expectedVersion: versionError.expectedVersion,
      currentVersion: versionError.currentVersion,
      retryable: true,
    },
  };
}

/**
 * Create a ConversationError from a generic error
 *
 * @param error - The error to convert
 * @returns ConversationError with appropriate type and message
 */
export function createConversationErrorFromGeneric(
  error: unknown
): ConversationError {
  if (isVersionConflictError(error)) {
    return createConversationErrorFromVersionConflict(error);
  }

  // Handle network errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return {
      type: "network",
      message: "Network connection failed",
      details: { retryable: true },
    };
  }

  // Handle validation errors (400 status codes)
  if (typeof error === "object" && error !== null && "status" in error) {
    const statusError = error as { status: number; message?: string };
    if (statusError.status >= 400 && statusError.status < 500) {
      return {
        type: "validation",
        message: statusError.message || "Invalid request",
        details: { retryable: false },
      };
    }
  }

  // Default to unknown error
  return {
    type: "unknown",
    message: error instanceof Error ? error.message : "Unknown error occurred",
    details: { retryable: false },
  };
}

/**
 * Validate that a conversation version is a valid positive integer
 *
 * @param version - The version to validate
 * @returns true if version is valid
 */
export function isValidVersion(version: unknown): version is number {
  return (
    typeof version === "number" && Number.isInteger(version) && version >= 0
  );
}

/**
 * Get a safe version number, defaulting to 0 for invalid versions
 *
 * @param version - The version to validate
 * @returns validated version number or 0
 */
export function getSafeVersion(version: unknown): number {
  return isValidVersion(version) ? version : 0;
}

/**
 * Create a version conflict error object
 *
 * @param expectedVersion - The expected version
 * @param currentVersion - The current version
 * @param latestConversation - The latest conversation data
 * @param message - Optional custom message
 * @returns VersionConflictError object
 */
export function createVersionConflictError(
  expectedVersion: number,
  currentVersion: number,
  latestConversation: VersionedConversationResponseDto,
  message?: string
): VersionConflictError {
  return {
    error: "VERSION_CONFLICT",
    message:
      message ||
      `Expected version ${expectedVersion}, but current version is ${currentVersion}`,
    expectedVersion,
    currentVersion,
    latestConversation,
  };
}

/**
 * Log version-related information for debugging
 *
 * @param context - Context string for the log
 * @param details - Version details to log
 */
export function logVersionInfo(
  context: string,
  details: {
    conversationId?: string;
    expectedVersion?: number;
    currentVersion?: number;
    action?: string;
  }
): void {
  const logData = {
    context,
    timestamp: new Date().toISOString(),
    ...details,
  };

  console.log(`🔄 Version Debug [${context}]:`, logData);
}

/**
 * Log version conflict information for debugging
 *
 * @param error - The version conflict error
 * @param context - Additional context
 */
export function logVersionConflict(
  error: VersionConflictError,
  context?: string
): void {
  console.warn("🚨 Version Conflict Detected:", {
    context: context || "unknown",
    expectedVersion: error.expectedVersion,
    currentVersion: error.currentVersion,
    message: error.message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Sleep utility for implementing delays in retry logic
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
