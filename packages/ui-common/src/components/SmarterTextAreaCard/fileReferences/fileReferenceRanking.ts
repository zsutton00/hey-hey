import type { FileTouchReferenceCandidateDto } from "../../../api";

interface RankedCandidate {
  candidate: FileTouchReferenceCandidateDto;
  tier: number;
  basenamePenalty: number;
  segmentPenalty: number;
}

const normalize = (value: string): string =>
  value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();

const basename = (path: string): string => path.split("/").at(-1) ?? path;

const tokens = (value: string): string[] =>
  normalize(value.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const orderedTokenMatch = (
  queryTokens: readonly string[],
  candidateTokens: readonly string[]
): boolean => {
  let candidateIndex = 0;
  for (const queryToken of queryTokens) {
    const nextIndex = candidateTokens.findIndex(
      (candidateToken, index) =>
        index >= candidateIndex && candidateToken.startsWith(queryToken)
    );
    if (nextIndex < 0) return false;
    candidateIndex = nextIndex + 1;
  }
  return queryTokens.length > 0;
};

const boundedDamerauLevenshtein = (
  left: string,
  right: string,
  maximum: number
): number | null => {
  if (Math.abs(left.length - right.length) > maximum) return null;

  const previousPrevious = Array.from(
    { length: right.length + 1 },
    (_, index) => index
  );
  let previous = [...previousPrevious];

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      let distance = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost
      );

      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(
          distance,
          (previousPrevious[rightIndex - 2] ?? 0) + 1
        );
      }

      current[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }

    if (rowMinimum > maximum) return null;
    previousPrevious.splice(0, previousPrevious.length, ...previous);
    previous = current;
  }

  const distance = previous[right.length] ?? maximum + 1;
  return distance <= maximum ? distance : null;
};

const fuzzyTokenMatch = (
  queryTokens: readonly string[],
  candidateTokens: readonly string[]
): boolean =>
  queryTokens.length > 0 &&
  queryTokens.every((queryToken) => {
    if (queryToken.length < 3) return false;
    const maximum = queryToken.length > 5 ? 2 : 1;
    return candidateTokens.some(
      (candidateToken) =>
        boundedDamerauLevenshtein(queryToken, candidateToken, maximum) !== null
    );
  });

const rankCandidate = (
  candidate: FileTouchReferenceCandidateDto,
  query: string
): RankedCandidate | null => {
  const normalizedPath = normalize(candidate.normalizedPath);
  const normalizedBasename = basename(normalizedPath);
  const normalizedQuery = normalize(query);
  const queryTokens = tokens(query);
  const candidateTokens = tokens(candidate.normalizedPath);
  const segments = normalizedPath.split("/");
  let matchingSegmentIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.startsWith(normalizedQuery)) {
      matchingSegmentIndex = index;
      break;
    }
  }
  const segmentPenalty =
    matchingSegmentIndex < 0
      ? 0
      : segments.length - matchingSegmentIndex;
  const basenamePenalty =
    normalizedBasename.includes(normalizedQuery) ||
    queryTokens.every((token) => normalizedBasename.includes(token))
      ? 0
      : 1;

  if (!normalizedQuery) {
    return { candidate, tier: 6, basenamePenalty, segmentPenalty };
  }
  if (normalizedPath === normalizedQuery) {
    return { candidate, tier: 0, basenamePenalty: 0, segmentPenalty: 0 };
  }
  if (normalizedBasename === normalizedQuery) {
    return { candidate, tier: 1, basenamePenalty: 0, segmentPenalty: 0 };
  }
  if (normalizedBasename.startsWith(normalizedQuery)) {
    return { candidate, tier: 2, basenamePenalty: 0, segmentPenalty: 0 };
  }
  if (matchingSegmentIndex >= 0) {
    return { candidate, tier: 3, basenamePenalty, segmentPenalty };
  }
  if (orderedTokenMatch(queryTokens, candidateTokens)) {
    return { candidate, tier: 4, basenamePenalty, segmentPenalty };
  }
  if (fuzzyTokenMatch(queryTokens, candidateTokens)) {
    return { candidate, tier: 5, basenamePenalty, segmentPenalty };
  }
  return null;
};

export const rankFileReferenceCandidates = (
  candidates: readonly FileTouchReferenceCandidateDto[],
  query: string
): FileTouchReferenceCandidateDto[] =>
  candidates
    .map((candidate) => rankCandidate(candidate, query))
    .filter((ranked): ranked is RankedCandidate => ranked !== null)
    .sort(
      (left, right) =>
        left.tier - right.tier ||
        left.basenamePenalty - right.basenamePenalty ||
        left.segmentPenalty - right.segmentPenalty ||
        normalize(left.candidate.normalizedPath).localeCompare(
          normalize(right.candidate.normalizedPath)
        ) ||
        left.candidate.serviceName.localeCompare(right.candidate.serviceName) ||
        left.candidate.serviceId.localeCompare(right.candidate.serviceId)
    )
    .map(({ candidate }) => candidate);
