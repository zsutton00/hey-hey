type SlashCompletionCandidate = {
  name: string;
  completesOnExactMatch?: boolean;
};

export type SlashCompletionInput = {
  query: string;
  candidates: SlashCompletionCandidate[];
  highlightedName: string | undefined;
};

export type SlashCompletionResult = {
  text: string;
  completed: boolean;
};

export function computeSlashCompletion({
  query,
  candidates,
  highlightedName,
}: SlashCompletionInput): SlashCompletionResult {
  if (highlightedName) {
    return { text: highlightedName, completed: true };
  }
  const exactCompletionCandidate = candidates.find(
    (candidate) => candidate.name === query && candidate.completesOnExactMatch,
  );
  if (exactCompletionCandidate) {
    return { text: exactCompletionCandidate.name, completed: true };
  }
  if (candidates.length === 0) {
    return { text: query, completed: false };
  }
  if (candidates.length === 1) {
    return { text: candidates[0].name, completed: true };
  }
  const lcp = longestCommonPrefix(candidates.map((c) => c.name));
  if (lcp.length > query.length) {
    return { text: lcp, completed: false };
  }
  return { text: query, completed: false };
}

function longestCommonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (let i = 1; i < names.length; i++) {
    const name = names[i];
    let j = 0;
    while (j < prefix.length && j < name.length && prefix[j] === name[j]) {
      j++;
    }
    prefix = prefix.slice(0, j);
    if (prefix === "") break;
  }
  return prefix;
}
