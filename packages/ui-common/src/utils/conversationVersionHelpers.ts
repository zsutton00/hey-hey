/**
 * Conversation Version Helper Functions
 *
 * Testable utility functions for conversation version management.
 * These functions are pure and can be easily unit tested.
 */

import { MessageStatus, MessageType } from "../api";
import type { ConversationResponseDto, CreateUserMessage } from "../api";
import type { FormValue } from "../components/LlmForms/types";
import type {
  VersionedConversationResponseDto,
  VersionedCreateUserMessage,
  OptimisticMessageState,
  VersionConflictError,
} from "../types/conversation";
import { hasVersionInfo } from "./versionUtils";

/**
 * Create a version-aware user message from form data and conversation
 *
 * @param data - Form data from user input
 * @param parentMessageId - ID of the parent message
 * @param conversation - Current conversation state
 * @param projectId - Project ID for the message
 * @returns Version-aware user message
 */
export interface VersionAwareUserMessage extends VersionedCreateUserMessage {
  /**
   * Backwards compatible alias for legacy tests and utilities
   */
  content: Record<string, FormValue>;
  /**
   * Alias for expectedConversationVersion used in legacy code paths
   */
  expectedVersion?: number;
  /**
   * Custom JSON serialization that strips compatibility helpers
   */
  toJSON(): CreateUserMessage;
}

export function createVersionAwareUserMessage(
  data: Record<string, FormValue>,
  parentMessageId: string,
  conversation?: ConversationResponseDto | null,
  projectId?: string,
  handler?: CreateUserMessage["handler"]
): VersionAwareUserMessage {
  const safeConversation = conversation ?? ({} as ConversationResponseDto);
  const expectedConversationVersion = hasVersionInfo(conversation)
    ? (conversation as VersionedConversationResponseDto).version
    : undefined;

  const baseMessage: VersionedCreateUserMessage = {
    projectId: projectId ?? safeConversation.projectId ?? "",
    data,
    type: MessageType.User,
    conversationId: safeConversation.id ?? "",
    status: MessageStatus.Completed,
    parentMessageId,
    handler,
    expectedConversationVersion,
  };

  const message = baseMessage as VersionAwareUserMessage;

  Object.defineProperty(message, "content", {
    value: data,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(message, "expectedVersion", {
    get() {
      return this.expectedConversationVersion;
    },
    set(value: number | undefined) {
      if (typeof value === "number") {
        this.expectedConversationVersion = value;
      } else {
        (this as Partial<VersionAwareUserMessage>).expectedConversationVersion =
          undefined;
      }
    },
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(message, "toJSON", {
    value() {
      const {
        content: _content,
        expectedVersion: _expectedVersion,
        ...rest
      } = this as VersionAwareUserMessage;

      if (
        "expectedConversationVersion" in rest &&
        typeof rest.expectedConversationVersion !== "number"
      ) {
        (
          rest as Partial<VersionedCreateUserMessage>
        ).expectedConversationVersion = undefined;
      }

      return rest as CreateUserMessage;
    },
    enumerable: false,
  });

  return message;
}

export function shouldUpdateConversationVersion(
  newVersion: number,
  currentVersion: number | null | undefined
): boolean {
  if (!Number.isFinite(newVersion)) {
    return false;
  }

  if (!Number.isFinite(currentVersion ?? NaN)) {
    return true;
  }

  return newVersion > (currentVersion as number);
}

export function handleVersionConflictUpdate<
  TResult,
  TCallback extends (conversation: VersionedConversationResponseDto) => TResult
>(error: VersionConflictError, updateConversation: TCallback): TResult {
  if (!error?.latestConversation) {
    throw new Error("Version conflict error is missing latest conversation");
  }

  return updateConversation(error.latestConversation);
}

/**
 * Create optimistic message state for UI updates
 *
 * @param parentMessageId - ID of the parent message
 * @param formData - Form data being submitted
 * @param conversation - Current conversation state
 * @returns Optimistic message state object
 */
export function createOptimisticMessageState(
  parentMessageId: string,
  formData: Record<string, FormValue>,
  conversation: ConversationResponseDto
): OptimisticMessageState {
  // Add expected version if available
  if (hasVersionInfo(conversation)) {
    const versionedConversation =
      conversation as VersionedConversationResponseDto;
    return {
      parentMessageId,
      formData,
      status: "sending",
      timestamp: Date.now(),
      expectedVersion: versionedConversation.version,
    };
  }

  return {
    parentMessageId,
    formData,
    status: "sending",
    timestamp: Date.now(),
    expectedVersion: undefined,
  };
}

/**
 * Determine if a version conflict should show a user dialog
 *
 * @param error - The version conflict error
 * @param retryAttempts - Number of retry attempts made
 * @param maxRetries - Maximum number of retries allowed
 * @returns true if should show dialog to user
 */
export function shouldShowVersionConflictDialog(
  error: VersionConflictError,
  retryAttempts: number,
  maxRetries: number
): boolean {
  // Show dialog if we've exhausted all retry attempts
  if (retryAttempts >= maxRetries) {
    return true;
  }

  // Show dialog if the version difference is large (indicates many changes)
  const versionDifference = error.currentVersion - error.expectedVersion;
  if (versionDifference > 3) {
    return true;
  }

  // Otherwise, continue with automatic retry
  return false;
}

/**
 * Calculate the version difference for user messaging
 *
 * @param currentVersion - Current version on server
 * @param expectedVersion - Expected version from client
 * @returns Object with difference and description
 */
export function calculateVersionDifference(
  currentVersion: number,
  expectedVersion: number
): {
  difference: number;
  description: "single" | "multiple" | "none";
} {
  const difference = currentVersion - expectedVersion;

  if (difference === 1) {
    return { difference, description: "single" };
  } else if (difference > 1) {
    return { difference, description: "multiple" };
  } else {
    return { difference: 0, description: "none" };
  }
}

/**
 * Update user message with new expected version (for retries)
 *
 * @param userMessage - Original user message
 * @param newExpectedVersion - New expected version
 * @returns Updated user message
 */
export function updateUserMessageVersion(
  userMessage: VersionedCreateUserMessage,
  newExpectedVersion: number
): VersionedCreateUserMessage {
  return {
    ...userMessage,
    expectedConversationVersion: newExpectedVersion,
  };
}

/**
 * Validate that a conversation has the minimum required fields for versioning
 *
 * @param conversation - Conversation to validate
 * @returns Validation result with details
 */
export function validateConversationForVersioning(
  conversation: ConversationResponseDto
): {
  isValid: boolean;
  hasVersion: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  if (!conversation.id) {
    missingFields.push("id");
  }

  if (!conversation.workflowId) {
    missingFields.push("workflowId");
  }

  const hasVersion = hasVersionInfo(conversation);
  const isValid = missingFields.length === 0;

  return {
    isValid,
    hasVersion,
    missingFields,
  };
}

/**
 * Create a safe conversation reference for version tracking
 *
 * @param conversation - Conversation to create reference from
 * @returns Safe reference object
 */
export function createConversationReference(
  conversation: ConversationResponseDto
): {
  id: string;
  version: number | undefined;
  lastModified: Date;
} {
  return {
    id: conversation.id,
    version: hasVersionInfo(conversation)
      ? (conversation as VersionedConversationResponseDto).version
      : undefined,
    lastModified: new Date(conversation.updatedAt),
  };
}
