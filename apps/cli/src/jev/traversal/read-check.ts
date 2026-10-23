import {
  READ_CHECK,
  judge,
  type Candidate,
  type Focal,
  type JevEvaluator,
  type Wording,
} from '../scenarios';
import { textForJev } from './entity-text';
import {
  JEV_MAX_CONCURRENT_REQUESTS,
  JEV_REQUEST_MAX_CHARS,
  mapConcurrently,
  packRequests,
} from './pack-requests';
import type { GraphReader, JevFailure, LoadedEntity, WalkUsage } from './types';
import { withAsk } from './walk';

export interface ReadCheckInput {
  client: JevEvaluator;
  model: string;
  wording: Wording;
  focal: Focal;
  /** What the user asked, judged alongside the focal. */
  ask: string;
  ids: readonly string[];
  reader: GraphReader;
  /** Overrides {@link JEV_REQUEST_MAX_CHARS}. */
  maxChars?: number;
  /** Cancels the Jev requests; the check then rejects. */
  signal?: AbortSignal;
}

export interface ReadCheckResult {
  /** Complete entities, as the reader returned them, that Jev judged as applying. */
  kept: LoadedEntity[];
  /** `applies` is Jev's probability that the entity applies. */
  dropped: { id: string; applies: number }[];
  /** Every entity checked, in the order given: kept or dropped, with Jev's `applies` (null when its request failed). */
  judged: { id: string; applies: number | null; kept: boolean }[];
  /** Requests Jev failed; every entity in them is in `kept`. */
  failures: { ids: string[]; failure: JevFailure }[];
  usage: WalkUsage;
}

/**
 * Load each entity and ask Jev whether it applies to the focal work and the user's ask. Jev
 * reads each entity without its Implementation section; the caller gets kept entities in full.
 * A failed request keeps every entity it carried and is reported, never retried or guessed.
 * An entity the reader cannot load rejects the whole check.
 */
export const readCheck = async (input: ReadCheckInput): Promise<ReadCheckResult> => {
  const { client, model, wording, reader, maxChars = JEV_REQUEST_MAX_CHARS, signal } = input;
  const focal = withAsk(input.focal, input.ask);
  const loaded = await Promise.all([...new Set(input.ids)].map((id) => reader.read(id)));
  signal?.throwIfAborted();
  const candidates: Candidate[] = loaded.map(({ id, text }) => ({
    id,
    kind: 'entity',
    text: textForJev(text),
  }));
  const requests = packRequests(READ_CHECK, focal, candidates, wording, maxChars);
  const results = await mapConcurrently(requests, JEV_MAX_CONCURRENT_REQUESTS, (batch) =>
    judge(client, model, READ_CHECK, focal, batch, wording, signal),
  );

  const keep = new Set<string>();
  const dropped: ReadCheckResult['dropped'] = [];
  const failures: ReadCheckResult['failures'] = [];
  const applies = new Map<string, number>();
  const usage: WalkUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  results.forEach((result, index) => {
    const batch = requests[index] ?? [];
    if (!result.ok) {
      for (const { id } of batch) keep.add(id);
      failures.push({ ids: batch.map(({ id }) => id), failure: result.failure });
      return;
    }
    usage.requests += 1;
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    for (const { id, applies: probability, choice } of result.judgments) {
      applies.set(id, probability);
      if (choice === 'applies') keep.add(id);
      else dropped.push({ id, applies: probability });
    }
  });
  return {
    kept: loaded.filter(({ id }) => keep.has(id)),
    dropped,
    judged: loaded.map(({ id }) => ({
      id,
      applies: applies.get(id) ?? null,
      kept: keep.has(id),
    })),
    failures,
    usage,
  };
};
