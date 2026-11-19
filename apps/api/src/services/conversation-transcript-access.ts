/** The conversation fields the message-content access rule depends on. */
export type TranscriptAccessSubject = {
  restricted: boolean;
  createdBy: string | null;
};

/**
 * The single message-content access rule. A restricted conversation's
 * messages are readable only by its recorded creator; a conversation with no
 * recorded creator therefore has no user reader. Metadata and reports are not
 * message content and are never gated here.
 */
export function canReadConversationTranscript(
  conversation: TranscriptAccessSubject,
  readerUserId: string | null | undefined,
): boolean {
  if (!conversation.restricted) {
    return true;
  }

  return (
    readerUserId != null &&
    conversation.createdBy !== null &&
    conversation.createdBy === readerUserId
  );
}
