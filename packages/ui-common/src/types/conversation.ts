/**
 * Conversation Versioning TypeScript Interfaces
 *
 * Extends the auto-generated API types to support conversation versioning
 * for preventing race conditions and ensuring data consistency.
 */

import type {
  ConversationResponseDto,
  CreateUserMessage,
  MessageResponseDto,
} from "../api";

// Conversation message with state for UI rendering
export interface ConversationMessage {
  message: MessageResponseDto;
  state:
    | "system_processing"
    | "awaiting_response"
    | "open"
    | "completed"
    | "error"
    | "sending"
    | "sent";
  canEdit: boolean;
  data?: {
    originalData?: Record<string, FormValue>;
    realtimeMetadata?: Record<string, unknown>;
  };
}

// Version-aware conversation response
export interface VersionedConversationResponseDto
  extends ConversationResponseDto {
  /**
   * Monotonically increasing version number for optimistic locking
   * @type {number}
   */
  version: number;
}

// Version-aware message creation with expected conversation version
export interface VersionedCreateUserMessage extends CreateUserMessage {
  /**
   * Expected conversation version for conflict detection
   * @type {number}
   */
  expectedConversationVersion?: number;
}

// Version conflict error interface
export interface VersionConflictError {
  /**
   * Error type identifier
   */
  error: "VERSION_CONFLICT";

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Current conversation version on server
   */
  currentVersion: number;

  /**
   * Expected version from client request
   */
  expectedVersion: number;

  /**
   * Latest conversation data with current version
   */
  latestConversation: VersionedConversationResponseDto;
}

// WebSocket event with version information
export interface VersionedWebSocketMessage {
  /**
   * Event type
   */
  type: "conversation_update" | "message_added" | "message_updated";

  /**
   * Conversation identifier
   */
  conversationId: string;

  /**
   * Expected version after this update
   */
  version: number;

  /**
   * Event timestamp for ordering
   */
  timestamp: number;

  /**
   * Additional event data
   */
  eventType?: string;
}

// Optimistic message state for UI
export interface OptimisticMessageState {
  /**
   * Parent message ID for threading
   */
  parentMessageId: string;

  /**
   * Form data being submitted
   */
  formData: Record<string, FormValue>;

  /**
   * Current submission status
   */
  status: "sending" | "sent" | "conflict" | "processing" | "rollback";

  /**
   * Timestamp when message was created
   */
  timestamp: number;

  /**
   * Expected conversation version when message was submitted
   */
  expectedVersion?: number;

  /**
   * Rollback data for failed optimistic updates
   */
  rollbackData?: VersionedConversationResponseDto;
}

// Version conflict dialog state
export interface VersionConflictDialogState {
  /**
   * Whether dialog is open
   */
  isOpen: boolean;

  /**
   * Expected version from failed request
   */
  expectedVersion: number;

  /**
   * Current version on server
   */
  currentVersion: number;

  /**
   * Latest conversation data
   */
  latestConversation: VersionedConversationResponseDto | null;

  /**
   * Original form data to retry with
   */
  originalFormData: Record<string, FormValue>;

  /**
   * Retry callback function
   */
  onRetry: (formData: Record<string, FormValue>) => void;

  /**
   * Cancel callback function
   */
  onCancel: () => void;
}

// Retry configuration options
export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   */
  maxRetries: number;

  /**
   * Base delay in milliseconds
   */
  baseDelay: number;

  /**
   * Maximum delay in milliseconds
   */
  maxDelay: number;

  /**
   * Optional callback for retry events
   */
  onRetry?: (attempt: number, error: unknown) => void;
}

// Version metrics for monitoring
export interface VersionMetrics {
  /**
   * Total number of version conflicts detected
   */
  conflictsDetected: number;

  /**
   * Number of conflicts successfully resolved
   */
  conflictsResolved: number;

  /**
   * Number of stale data updates rejected
   */
  staleDataRejected: number;

  /**
   * Average time to resolve conflicts in milliseconds
   */
  averageConflictResolutionTime: number;
}

// Conversation error types
export interface ConversationError {
  /**
   * Error type classification
   */
  type: "version_conflict" | "network" | "validation" | "unknown";

  /**
   * Error message
   */
  message: string;

  /**
   * Additional error details
   */
  details?: {
    expectedVersion?: number;
    currentVersion?: number;
    retryable: boolean;
  };
}

// Type guards for version-aware types
export function isVersionedConversationResponseDto(
  conversation: ConversationResponseDto
): conversation is VersionedConversationResponseDto {
  return (
    typeof (conversation as VersionedConversationResponseDto).version ===
    "number"
  );
}

export function isVersionConflictError(
  error: unknown
): error is VersionConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    (error as VersionConflictError).error === "VERSION_CONFLICT"
  );
}

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

// Utility functions for version comparison
export function isVersionNewer(
  newVersion: number,
  currentVersion: number
): boolean {
  return newVersion > currentVersion;
}

export function shouldRetryOnVersionConflict(
  attempt: number,
  maxRetries: number
): boolean {
  return attempt < maxRetries;
}

// Default retry options
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000,
};

// Re-export API types for convenience
export type {
  MessageRetryResponse,
  RetryMessage200Response,
  GetRetryStatus200Response,
} from "../api";

// Import MessageRetryStatus from api.ts directly since it's not exported from index
import type { MessageRetryStatus } from "../api/api";
import type { FormValue } from "../components/LlmForms/types";
export type { MessageRetryStatus };

export interface MessageRetryState {
  /**
   * Whether a retry is currently in progress
   */
  isRetrying: boolean;

  /**
   * Current retry status
   */
  retryStatus?: MessageRetryStatus;

  /**
   * Error message if retry failed
   */
  retryError?: string;

  /**
   * Function to initiate retry
   */
  retry: () => Promise<void>;

  /**
   * Function to cancel ongoing retry
   */
  cancelRetry: () => void;

  /**
   * Whether retry polling is active
   */
  isPolling: boolean;
}

/** Local startup content has no persisted Conversation or Message identity. */
export interface ConversationPreviewInput {
  kind: "preview";
  text: string;
  isThinking: boolean;
}
