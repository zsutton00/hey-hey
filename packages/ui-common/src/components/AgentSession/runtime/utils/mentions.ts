export const dedupeMentions = (values: string[]): string[] => [
  ...new Set(values),
];

export const readTrailingMentionQuery = (value: string): string | null => {
  const match = value.match(/(?:^|\s)(@[^\s@]*)$/u);
  if (!match) {
    return null;
  }

  const candidate = match[1];
  if (!candidate || candidate.length <= 1) {
    return null;
  }

  return candidate;
};

export const replaceTrailingMention = (
  value: string,
  mentionText: string
): string => {
  const match = value.match(/(?:^|\s)@[^\s@]*$/u);
  if (!match) {
    return value;
  }

  const fullMatch = match[0];
  const matchIndex = match.index ?? 0;
  const prefix = value.slice(0, matchIndex);
  const leadingWhitespace = fullMatch.startsWith(" ") ? " " : "";
  return `${prefix}${leadingWhitespace}${mentionText} `;
};

export const extractReferenceMentions = (value: string): string[] => {
  const matches = value.match(/@[^\s]+/gu) ?? [];
  return dedupeMentions(matches.filter((entry) => entry.length > 1));
};
