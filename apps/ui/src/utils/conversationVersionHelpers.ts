/**
 * Conversation Version Helper Functions
 *
 * Testable utility functions for conversation version management.
 * These functions are pure and can be easily unit tested.
 */

import { MessageStatus, MessageType } from "@hey-hey/ui-common/api";
import type {
  ConversationResponseDto,
  CreateUserMessage,
} from "@hey-hey/ui-common/api";
import type {
  VersionedConversationResponseDto,
  VersionedCreateUserMessage,
  OptimisticMessageState,
  VersionConflictError,
} from "../types/conversation";
import { hasVersionInfo } from "./versionUtils";
import type { FormValue } from "../components/LlmForms/DynamicForm";

/**
 * Create a version-aware user message from form data and conversation
 *
 * @param data - Form data from user input
 * @param parentMessageId - ID of the parent message
 * @param conversation - Current conversation state
 * @param projectId - Project ID for the message
 * @returns Version-aware user message
 */
export function createVersionAwareUserMessage(
  data: Record<string, FormValue>,
  parentMessageId: string,
  conversation: ConversationResponseDto,
  projectId: string,
): VersionedCreateUserMessage {
  const baseMessage: CreateUserMessage = {
    workflowId: conversation.workflowId!,
    projectId,
    data,
    type: MessageType.User,
    conversationId: conversation.id,
    status: MessageStatus.Completed,
    parentMessageId,
  };

  // Add version info if conversation has version
  if (hasVersionInfo(conversation)) {
    const versionedConversation =
      conversation as VersionedConversationResponseDto;
    return {
      ...baseMessage,
      expectedConversationVersion: versionedConversation.version,
    };
  }

  return baseMessage as VersionedCreateUserMessage;
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
  conversation: ConversationResponseDto,
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
  maxRetries: number,
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
  expectedVersion: number,
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
  newExpectedVersion: number,
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
  conversation: ConversationResponseDto,
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
  conversation: ConversationResponseDto,
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
