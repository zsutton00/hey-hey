import {
  buildQuestions,
  buildState,
  type Candidate,
  type Focal,
  type Scenario,
  type Wording,
} from '../scenarios';

/**
 * Characters one Jev request may carry, state and questions together. Jev rejects input over its
 * 64,000-token limit with HTTP 400 max_tokens_exceeded; 80,000 characters is about 20,000 tokens at four
 * characters per token, a third of that limit.
 */
export const JEV_REQUEST_MAX_CHARS = 80_000;

/** Most Jev requests in flight at once. */
export const JEV_MAX_CONCURRENT_REQUESTS = 5;

/** The most candidates one request carries; a larger request overruns Jev's output limit and fails the same way. */
export const JEV_REQUEST_MAX_CANDIDATES = 50;

const requestSize = (
  scenario: Scenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
): number =>
  JSON.stringify(buildState(scenario, focal, candidates, wording)).length +
  JSON.stringify(buildQuestions(scenario, focal, candidates, wording)).length;

/**
 * The fewest requests that each stay under `max` characters and the candidate limit, largest candidates placed first. Within a
 * request candidates keep the caller's order, so the same input builds the same requests.
 */
export const packRequests = (
  scenario: Scenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
  max: number,
): Candidate[][] => {
  const shared = requestSize(scenario, focal, [], wording);
  const sized = candidates.map((candidate, order) => ({
    candidate,
    order,
    size: requestSize(scenario, focal, [candidate], wording) - shared,
  }));
  const requests: { items: typeof sized; size: number }[] = [];
  for (const item of [...sized].sort((a, b) => b.size - a.size)) {
    const request = requests.find(
      ({ size, items }) => size + item.size <= max && items.length < JEV_REQUEST_MAX_CANDIDATES,
    );
    if (request) {
      request.items.push(item);
      request.size += item.size;
    } else {
      // An entity too large on its own still gets its own request; Jev's failure keeps it.
      requests.push({ items: [item], size: shared + item.size });
    }
  }
  return requests.map(({ items }) =>
    items.sort((a, b) => a.order - b.order).map(({ candidate }) => candidate),
  );
};

/** Maps `items` with at most `limit` calls in flight; results are in input order. */
export const mapConcurrently = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
