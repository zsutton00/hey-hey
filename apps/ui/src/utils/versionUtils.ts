/**
 * Version Utility Functions
 *
 * Utility functions for conversation version checking, comparison, and conflict handling.
 */

import type {
  VersionConflictError,
  VersionedConversationResponseDto,
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
  currentVersion: number,
): boolean {
  return newVersion > currentVersion;
}

/**
 * Type guard to check if an error is a version conflict error
 *
 * @param error - The error to check
 * @returns true if the error is a VersionConflictError
 */
export function isVersionConflictError(
  error: unknown,
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
  conversation: unknown,
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
