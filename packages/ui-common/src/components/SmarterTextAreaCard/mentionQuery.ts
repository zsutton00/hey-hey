export const MENTION_MAX_QUERY_LENGTH = 100;
export const MENTION_SEARCH_DEBOUNCE_MS = 300;

// Legacy @ lookup no longer opens on a bare trigger. If an explicit
// mention-search surface reuses this helper, require at least one
// alphanumeric query character.
export const shouldSearchMentionQuery = (queryText: string): boolean => {
  if (queryText.length > MENTION_MAX_QUERY_LENGTH) return false;
  if (queryText.length === 0) return false;
  return /^[A-Za-z0-9]/.test(queryText);
};
