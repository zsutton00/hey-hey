/**
 * Combines the caller's required prompt with optional user guidance for an
 * entity conversation. The required prompt is never omitted; blank guidance
 * does not add an extra separator.
 */
export const buildEntityConversationPrompt = (
  preCannedPrompt: string,
  optionalUserInput = ""
): string => {
  const trimmedUserInput = optionalUserInput.trim();

  return trimmedUserInput.length > 0
    ? `${preCannedPrompt}\n\n${trimmedUserInput}`
    : preCannedPrompt;
};
