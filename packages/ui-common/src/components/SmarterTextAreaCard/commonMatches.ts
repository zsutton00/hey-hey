import type { SearchEntity } from "./types";
import type { RecentSelection } from "./recentMentionSelections";

export const COMMON_MATCH_MIN_COUNT = 3;
const MAX_EDIT_DISTANCE = 1;
const MAX_COMMON_MATCHES = 5;

const levenshtein = (a: string, b: string, limit: number): number => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array<number>(cols);
  let curr = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j < cols; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > limit) return limit + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[cols - 1];
};

const isStrongMatch = (query: string, name: string): boolean => {
  if (!query || !name) return false;
  const q = query.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (!q) return false;
  if (n.startsWith(q)) return true;
  if (Math.abs(q.length - n.length) <= MAX_EDIT_DISTANCE) {
    return levenshtein(q, n, MAX_EDIT_DISTANCE) <= MAX_EDIT_DISTANCE;
  }
  if (q.length >= 3 && n.length >= q.length) {
    const prefix = n.slice(0, q.length);
    return levenshtein(q, prefix, MAX_EDIT_DISTANCE) <= MAX_EDIT_DISTANCE;
  }
  return false;
};

export const getCommonMatches = (
  query: string,
  selections: RecentSelection[],
  existingResults: SearchEntity[]
): SearchEntity[] => {
  if (!query) return [];
  const seen = new Set(existingResults.map((r) => `${r.type}:${r.id}`));
  const matches = selections
    .filter((s) => s.timestamps.length >= COMMON_MATCH_MIN_COUNT)
    .filter((s) => !seen.has(`${s.type}:${s.id}`))
    .filter((s) => isStrongMatch(query, s.name))
    .sort((a, b) => b.timestamps.length - a.timestamps.length)
    .slice(0, MAX_COMMON_MATCHES);

  return matches.map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name,
  }));
};
