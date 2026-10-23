import type { AgentSessionDto } from "../../api";

export interface PastSearch {
  sessionId: string;
  conversationId: string;
  query: string;
  sessionDate: string;
  session: AgentSessionDto;
}

export const canonicalKey = (query: string): string =>
  query.trim().toLocaleLowerCase();

export const buildPastSearch = (
  session: AgentSessionDto
): PastSearch | null => {
  const query = (session.title ?? "").trim();
  if (!query) return null;
  if (!session.conversationId) return null;
  return {
    sessionId: session.id,
    conversationId: session.conversationId,
    query,
    sessionDate: session.sessionDate,
    session,
  };
};

const sessionDateMs = (item: PastSearch): number => {
  const ms = Date.parse(item.sessionDate);
  return Number.isFinite(ms) ? ms : 0;
};

export const orderPastSearches = (items: PastSearch[]): PastSearch[] =>
  [...items].sort((a, b) => sessionDateMs(b) - sessionDateMs(a));

export const dedupePastSearches = (items: PastSearch[]): PastSearch[] => {
  const seen = new Set<string>();
  const result: PastSearch[] = [];
  for (const item of items) {
    const key = canonicalKey(item.query);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

export const buildPastSearches = (
  sessions: AgentSessionDto[],
  options: { limit?: number } = {}
): PastSearch[] => {
  const normalized = sessions
    .map(buildPastSearch)
    .filter((entry): entry is PastSearch => entry !== null);
  const ordered = orderPastSearches(normalized);
  const deduped = dedupePastSearches(ordered);
  return options.limit !== undefined
    ? deduped.slice(0, options.limit)
    : deduped;
};
