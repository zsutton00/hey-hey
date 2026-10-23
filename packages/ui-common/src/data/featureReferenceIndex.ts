import type { ServiceDto, WorkItemReferenceDto } from "../api";
import { FEATURE_TASK_TYPE } from "../constants/taskTypes";

export type PassiveReferenceEntityType = "feature" | "service";

export interface PassiveReferenceCandidate {
  entityType: PassiveReferenceEntityType;
  id: string;
  name: string;
  /** Names of known ancestors in root-to-parent order. */
  ancestorPath: string[];
}

export interface PassiveReferenceCandidateKey {
  entityType: PassiveReferenceEntityType;
  entityId: string;
}

export type FeatureReferenceCandidate = PassiveReferenceCandidate;

export interface FeatureReferenceIndex {
  candidates: FeatureReferenceCandidate[];
  groupsByNormalizedTitle: ReadonlyMap<string, FeatureReferenceCandidate[]>;
}

export type FeatureReferenceMatchKind =
  | "exact"
  | "prefix"
  | "ordered-token-prefix"
  | "token-subset"
  | "typo";

export const FEATURE_REFERENCE_MATCH_RANK = {
  exact: 0,
  prefix: 1,
  "ordered-token-prefix": 2,
  "token-subset": 3,
  typo: 4,
} as const satisfies Record<FeatureReferenceMatchKind, number>;

export type FeatureReferenceMatchRank =
  (typeof FEATURE_REFERENCE_MATCH_RANK)[FeatureReferenceMatchKind];

export interface FeatureReferenceTitleMatch {
  normalizedTitle: string;
  matchedText: string;
  start: number;
  end: number;
  matchKind: FeatureReferenceMatchKind;
  matchRank: FeatureReferenceMatchRank;
  candidates: FeatureReferenceCandidate[];
}

export const normalizeFeatureTitle = (title: string): string =>
  title.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

type ReferenceHierarchyNode = Pick<
  WorkItemReferenceDto,
  "id" | "name" | "parentTaskId"
>;

function indexHierarchyNodes(
  references: readonly ReferenceHierarchyNode[]
): Map<string, ReferenceHierarchyNode> {
  const referencesById = new Map<string, ReferenceHierarchyNode>();
  for (const candidate of references) {
    if (!referencesById.has(candidate.id)) {
      referencesById.set(candidate.id, candidate);
    }
  }
  return referencesById;
}

function deriveAncestorNamePathFromIndex(
  reference: ReferenceHierarchyNode,
  referencesById: ReadonlyMap<string, ReferenceHierarchyNode>
): string[] {
  const ancestorNames: string[] = [];
  const visitedIds = new Set<string>([reference.id]);
  let parentId = reference.parentTaskId;

  while (parentId !== null) {
    if (visitedIds.has(parentId)) {
      break;
    }
    visitedIds.add(parentId);

    const parent = referencesById.get(parentId);
    if (!parent) {
      break;
    }

    ancestorNames.unshift(parent.name);
    parentId = parent.parentTaskId;
  }

  return ancestorNames;
}

export function deriveAncestorNamePath(
  reference: ReferenceHierarchyNode,
  references: readonly ReferenceHierarchyNode[]
): string[] {
  return deriveAncestorNamePathFromIndex(
    reference,
    indexHierarchyNodes(references)
  );
}

export function createFeatureReferenceCandidates(
  references: readonly WorkItemReferenceDto[]
): FeatureReferenceCandidate[] {
  const referencesById = indexHierarchyNodes(references);
  return references
    .filter((reference) => reference.type === FEATURE_TASK_TYPE)
    .map((reference) => ({
      entityType: "feature" as const,
      id: reference.id,
      name: reference.name,
      ancestorPath: deriveAncestorNamePathFromIndex(reference, referencesById),
    }));
}

export function createServiceReferenceCandidates(
  services: readonly ServiceDto[]
): PassiveReferenceCandidate[] {
  return services
    .filter((service) => service.name.trim().length > 0)
    .map((service) => ({
      entityType: "service" as const,
      id: service.id,
      name: service.name,
      ancestorPath: [],
    }));
}

function groupIndexedCandidatesByTitle(
  candidates: readonly FeatureReferenceCandidate[]
): Map<string, FeatureReferenceCandidate[]> {
  const groups = new Map<string, FeatureReferenceCandidate[]>();

  for (const candidate of candidates) {
    const normalizedTitle = normalizeFeatureTitle(candidate.name);
    if (!normalizedTitle) {
      continue;
    }

    const group = groups.get(normalizedTitle);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(normalizedTitle, [candidate]);
    }
  }

  return groups;
}

export function groupFeatureReferencesByTitle(
  references: readonly WorkItemReferenceDto[]
): Map<string, FeatureReferenceCandidate[]> {
  return groupIndexedCandidatesByTitle(
    createFeatureReferenceCandidates(references)
  );
}

function buildIndexFromCandidates(
  candidates: FeatureReferenceCandidate[]
): FeatureReferenceIndex {
  const orderedCandidates = [...candidates].sort(
    (first, second) =>
      first.entityType.localeCompare(second.entityType) ||
      first.name.localeCompare(second.name) ||
      first.ancestorPath
        .join("\u0000")
        .localeCompare(second.ancestorPath.join("\u0000")) ||
      first.id.localeCompare(second.id)
  );
  return {
    candidates: orderedCandidates,
    groupsByNormalizedTitle: groupIndexedCandidatesByTitle(orderedCandidates),
  };
}

export function buildWorkItemReferenceIndex(
  references: readonly WorkItemReferenceDto[]
): FeatureReferenceIndex {
  return buildIndexFromCandidates(createFeatureReferenceCandidates(references));
}

export function buildFeatureReferenceIndex(
  references: readonly WorkItemReferenceDto[]
): FeatureReferenceIndex {
  return buildIndexFromCandidates(createFeatureReferenceCandidates(references));
}

export function buildPassiveReferenceIndex(input: {
  featureReferences: readonly WorkItemReferenceDto[];
  services: readonly ServiceDto[];
}): FeatureReferenceIndex {
  return buildIndexFromCandidates([
    ...createFeatureReferenceCandidates(input.featureReferences),
    ...createServiceReferenceCandidates(input.services),
  ]);
}

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{M}\p{N}_]/u.test(character);

const getPreviousCharacter = (
  text: string,
  index: number
): string | undefined => {
  if (index <= 0) {
    return undefined;
  }

  let characterIndex = index - 1;
  const characterCode = text.charCodeAt(characterIndex);
  if (
    characterCode >= 0xdc00 &&
    characterCode <= 0xdfff &&
    characterIndex > 0
  ) {
    characterIndex -= 1;
  }

  const codePoint = text.codePointAt(characterIndex);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
};

const getNextCharacter = (text: string, index: number): string | undefined => {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
};

export const hasFeatureReferenceTokenBoundaries = (
  text: string,
  start: number,
  end: number
): boolean =>
  text[start - 1] !== "@" &&
  !isWordCharacter(getPreviousCharacter(text, start)) &&
  !isWordCharacter(getNextCharacter(text, end));

const normalizeFeatureReferenceMatchText = (text: string): string =>
  normalizeFeatureTitle(text)
    .replace(/[^\p{L}\p{M}\p{N}_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const tokenizeFeatureReferenceText = (text: string): string[] =>
  normalizeFeatureReferenceMatchText(text).split(" ").filter(Boolean);

interface FeatureReferenceTextToken {
  start: number;
  end: number;
}

function getFeatureReferenceTextTokens(
  text: string
): FeatureReferenceTextToken[] {
  const tokens: FeatureReferenceTextToken[] = [];
  const tokenMatcher = /[\p{L}\p{M}\p{N}_]+/gu;
  let match: RegExpExecArray | null;

  while ((match = tokenMatcher.exec(text)) !== null) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

const isAdmissibleFuzzyQuery = (queryTokens: readonly string[]): boolean =>
  queryTokens.length > 0 &&
  queryTokens.every((token) => token.length >= 2) &&
  (queryTokens.length > 1 || (queryTokens[0]?.length ?? 0) >= 4) &&
  queryTokens.some((token) => token.length >= 3);

const COMMON_FUZZY_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "not",
  "of",
  "on",
  "or",
  "than",
  "that",
  "the",
  "then",
  "this",
  "to",
  "was",
  "were",
  "with",
] as const);

const containsCommonFuzzyFunctionWord = (
  queryTokens: readonly string[]
): boolean =>
  queryTokens.some((token) => COMMON_FUZZY_FUNCTION_WORDS.has(token));

interface OrderedTokenPrefixMatch {
  hasPartialToken: boolean;
}

const getOrderedTokenPrefixMatch = (
  queryTokens: readonly string[],
  titleTokens: readonly string[]
): OrderedTokenPrefixMatch | null => {
  if (queryTokens.length === 0 || queryTokens.length > titleTokens.length) {
    return null;
  }

  let titleIndex = 0;
  let hasPartialToken = false;
  for (const queryToken of queryTokens) {
    const nextTitleIndex = titleTokens.findIndex(
      (titleToken, index) =>
        index >= titleIndex && titleToken.startsWith(queryToken)
    );
    if (nextTitleIndex < 0) return null;
    const titleToken = titleTokens[nextTitleIndex];
    if (titleToken !== undefined && titleToken.length > queryToken.length) {
      hasPartialToken = true;
    }
    titleIndex = nextTitleIndex + 1;
  }

  return { hasPartialToken };
};

const tokenSubsetMatch = (
  queryTokens: readonly string[],
  titleTokens: readonly string[]
): boolean => {
  if (queryTokens.length === 0 || queryTokens.length > titleTokens.length) {
    return false;
  }

  const remainingTitleTokens = [...titleTokens];
  return queryTokens.every((queryToken) => {
    const titleIndex = remainingTitleTokens.indexOf(queryToken);
    if (titleIndex < 0) return false;
    remainingTitleTokens.splice(titleIndex, 1);
    return true;
  });
};

const areSimpleSingularPluralVariants = (
  firstToken: string,
  secondToken: string
): boolean => {
  const [pluralCandidate, singularCandidate] =
    firstToken.length >= secondToken.length
      ? [firstToken, secondToken]
      : [secondToken, firstToken];
  if (singularCandidate.length < 3) return false;

  return (
    pluralCandidate === `${singularCandidate}s` ||
    (/(?:s|x|z|ch|sh)$/u.test(singularCandidate) &&
      pluralCandidate === `${singularCandidate}es`) ||
    (singularCandidate.endsWith("y") &&
      pluralCandidate === `${singularCandidate.slice(0, -1)}ies`)
  );
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

const boundedTypoOrTranspositionMatch = (
  queryTokens: readonly string[],
  titleTokens: readonly string[]
): boolean => {
  if (!isAdmissibleFuzzyQuery(queryTokens)) return false;

  const usedTitleTokens = new Set<number>();
  return queryTokens.every((queryToken) => {
    const maximum = queryToken.length > 5 ? 2 : 1;
    const titleIndex = titleTokens.findIndex(
      (titleToken, index) =>
        !usedTitleTokens.has(index) &&
        (areSimpleSingularPluralVariants(queryToken, titleToken) ||
          (!(
            queryToken !== titleToken &&
            (queryToken.includes(titleToken) || titleToken.includes(queryToken))
          ) &&
            boundedDamerauLevenshtein(queryToken, titleToken, maximum) !==
              null))
    );
    if (titleIndex < 0) return false;
    usedTitleTokens.add(titleIndex);
    return true;
  });
};

function classifyFeatureReferenceQuery(
  queryText: string,
  normalizedTitle: string
): {
  matchKind: FeatureReferenceMatchKind;
  matchRank: FeatureReferenceMatchRank;
} | null {
  const query = normalizeFeatureReferenceMatchText(queryText);
  const title = normalizeFeatureReferenceMatchText(normalizedTitle);
  if (!query) return null;
  if (query === title) {
    return {
      matchKind: "exact",
      matchRank: FEATURE_REFERENCE_MATCH_RANK.exact,
    };
  }

  const queryTokens = tokenizeFeatureReferenceText(query);
  const titleTokens = tokenizeFeatureReferenceText(title);
  if (
    containsCommonFuzzyFunctionWord(queryTokens) ||
    !isAdmissibleFuzzyQuery(queryTokens)
  ) {
    return null;
  }
  if (queryTokens.length === 1 && titleTokens.length > 1) return null;

  const isCompleteLeadingTokenSubset =
    queryTokens.length < titleTokens.length &&
    queryTokens.every((queryToken, index) => titleTokens[index] === queryToken);
  if (isCompleteLeadingTokenSubset) return null;

  const prefixToken = titleTokens[queryTokens.length - 1];
  const queryToken = queryTokens[queryTokens.length - 1];
  const hasPartialTrailingToken =
    prefixToken !== undefined &&
    queryToken !== undefined &&
    prefixToken.length > queryToken.length;
  if (title.startsWith(query) && hasPartialTrailingToken) {
    return {
      matchKind: "prefix",
      matchRank: FEATURE_REFERENCE_MATCH_RANK.prefix,
    };
  }
  const orderedTokenPrefixMatch = getOrderedTokenPrefixMatch(
    queryTokens,
    titleTokens
  );
  if (orderedTokenPrefixMatch?.hasPartialToken) {
    return {
      matchKind: "ordered-token-prefix",
      matchRank: FEATURE_REFERENCE_MATCH_RANK["ordered-token-prefix"],
    };
  }
  if (
    tokenSubsetMatch(queryTokens, titleTokens) &&
    !isCompleteLeadingTokenSubset
  ) {
    return {
      matchKind: "token-subset",
      matchRank: FEATURE_REFERENCE_MATCH_RANK["token-subset"],
    };
  }
  if (boundedTypoOrTranspositionMatch(queryTokens, titleTokens)) {
    return {
      matchKind: "typo",
      matchRank: FEATURE_REFERENCE_MATCH_RANK.typo,
    };
  }
  return null;
}

const getCandidateIdentity = (
  candidates: readonly FeatureReferenceCandidate[]
): string =>
  candidates
    .map((candidate) => candidate.id)
    .sort((first, second) => first.localeCompare(second))
    .join("\u0000");

const compareFeatureReferenceMatches = (
  first: FeatureReferenceTitleMatch,
  second: FeatureReferenceTitleMatch
): number => {
  if (first.matchRank !== second.matchRank) {
    return first.matchRank - second.matchRank;
  }

  const lengthDifference =
    second.end - second.start - (first.end - first.start);
  if (lengthDifference !== 0) return lengthDifference;

  if (first.start !== second.start) {
    return first.start - second.start;
  }

  const titleOrder = first.normalizedTitle.localeCompare(
    second.normalizedTitle
  );
  if (titleOrder !== 0) return titleOrder;

  return getCandidateIdentity(first.candidates).localeCompare(
    getCandidateIdentity(second.candidates)
  );
};

function findAllFeatureReferenceMatches(
  text: string,
  index: FeatureReferenceIndex
): FeatureReferenceTitleMatch[] {
  const matches: FeatureReferenceTitleMatch[] = [];
  const textTokens = getFeatureReferenceTextTokens(text);
  if (textTokens.length === 0) return matches;

  const maxTitleTokenCount = Math.max(
    1,
    ...[...index.groupsByNormalizedTitle.keys()].map(
      (normalizedTitle) => tokenizeFeatureReferenceText(normalizedTitle).length
    )
  );

  for (const [normalizedTitle, candidates] of index.groupsByNormalizedTitle) {
    for (
      let startTokenIndex = 0;
      startTokenIndex < textTokens.length;
      startTokenIndex += 1
    ) {
      const lastTokenIndex = Math.min(
        textTokens.length - 1,
        startTokenIndex + maxTitleTokenCount - 1
      );

      for (
        let endTokenIndex = startTokenIndex;
        endTokenIndex <= lastTokenIndex;
        endTokenIndex += 1
      ) {
        const start = textTokens[startTokenIndex]?.start;
        const end = textTokens[endTokenIndex]?.end;
        if (start === undefined || end === undefined) continue;
        if (!hasFeatureReferenceTokenBoundaries(text, start, end)) continue;

        const matchedText = text.slice(start, end);
        const classification = classifyFeatureReferenceQuery(
          matchedText,
          normalizedTitle
        );
        if (!classification) continue;

        matches.push({
          normalizedTitle,
          matchedText,
          start,
          end,
          ...classification,
          candidates: [...candidates],
        });
      }
    }
  }

  return matches;
}

const rangesOverlap = (
  first: FeatureReferenceTitleMatch,
  second: FeatureReferenceTitleMatch
): boolean => first.start < second.end && second.start < first.end;

export function selectLongestOverlappingFeatureReferenceMatches(
  matches: readonly FeatureReferenceTitleMatch[]
): FeatureReferenceTitleMatch[] {
  const strongestFirst = [...matches].sort(compareFeatureReferenceMatches);

  const selected: FeatureReferenceTitleMatch[] = [];
  for (const candidate of strongestFirst) {
    if (
      !selected.some((selectedCandidate) =>
        rangesOverlap(candidate, selectedCandidate)
      )
    ) {
      selected.push(candidate);
    }
  }

  return selected.sort((first, second) => {
    if (first.start !== second.start) {
      return first.start - second.start;
    }
    return first.end - second.end;
  });
}

export function findCompletedFeatureReferenceMatches(
  text: string,
  index: FeatureReferenceIndex
): FeatureReferenceTitleMatch[] {
  return selectLongestOverlappingFeatureReferenceMatches(
    findAllFeatureReferenceMatches(text, index)
  );
}

export function findLongestOverlappingFeatureReferenceMatch(
  text: string,
  index: FeatureReferenceIndex
): FeatureReferenceTitleMatch | null {
  return (
    findCompletedFeatureReferenceMatches(
      text,
      index
    ).reduce<FeatureReferenceTitleMatch | null>((longest, candidate) => {
      if (!longest) {
        return candidate;
      }

      const candidateLength = candidate.end - candidate.start;
      const longestLength = longest.end - longest.start;
      return candidateLength > longestLength ? candidate : longest;
    }, null) ?? null
  );
}
