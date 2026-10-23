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
} from "@hey-hey/ui-common/api";
import type { SecondAction } from "@hey-hey/ui-common/components";

type FormValue = Parameters<SecondAction["onExecute"]>[0][string];

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
  };
}

// Version-aware conversation response
export interface VersionedConversationResponseDto extends ConversationResponseDto {
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
  expectedConversationVersion: number;
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
