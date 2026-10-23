export const INLINE_SEARCH_RESULTS_FRESHNESS = {
  settled: "settled",
  staleWhileUpdating: "stale-while-updating",
} as const;

export type InlineSearchResultsFreshness =
  (typeof INLINE_SEARCH_RESULTS_FRESHNESS)[keyof typeof INLINE_SEARCH_RESULTS_FRESHNESS];

export interface InlineSearchRequestId {
  readonly value: number;
}

export const createInlineSearchRequestId = (
  value: number
): InlineSearchRequestId => ({
  value,
});

export const isInlineSearchRequestIdCurrent = (
  current: InlineSearchRequestId,
  candidate: InlineSearchRequestId
): boolean => current.value === candidate.value;

export const canSelectInlineSearchResults = (
  freshness: InlineSearchResultsFreshness
): boolean => freshness === INLINE_SEARCH_RESULTS_FRESHNESS.settled;
