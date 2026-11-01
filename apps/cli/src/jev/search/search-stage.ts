import type { Focal } from '../scenarios';
import type { EntityLabel, ReadEntry } from '../trace';
import {
  labelOf,
  readCheck,
  readCheckTrace,
  type EntityRef,
  type GraphReader,
  type LoadedEntity,
  type ReadCheckInput,
  type ReadCheckResult,
  type TitledRef,
  type WalkUsage,
} from '../traversal';
import type { Step } from '../trace';
import type { PlannedSearch, SearchExecutor } from './search-executor';

export interface SearchStageInput {
  focalId: string;
  /** The original focal work; every result is judged against it, never against a search query. */
  focal: Focal;
  /** The user's original request. */
  ask: string;
  searches: readonly PlannedSearch[];
  /** Each search keeps at most this many hits, in the order the search returned them. */
  maxResultsPerSearch: number;
  executor: SearchExecutor;
  /** Builds the reader over the focal and the surfaced entities; the walk reuses it afterwards. */
  readerFor: (known: readonly EntityRef[]) => GraphReader;
  jev: Omit<ReadCheckInput, 'focal' | 'ask' | 'ids' | 'reader' | 'signal'>;
  /** Cancels searches and Jev requests; the stage then rejects instead of recording failures. */
  signal?: AbortSignal;
}

export interface SearchStageRecord {
  /** Every planned search in order: its hit count, or why it failed and surfaced nothing. */
  searches: ({ query: string; hits: number } | { query: string; error: string })[];
  /** Distinct entities across every search, the focal excluded. */
  surfaced: number;
  /** Distinct entities read and sent to Jev: every surfaced entity that could be read. */
  opened: number;
  /** Surfaced entities that could not be read; they were skipped and the rest carried on. */
  unreadable: { id: string; error: string }[];
  kept: number;
  dropped: ReadCheckResult['dropped'];
  /** Jev requests that failed; every entity in them was kept. */
  failures: ReadCheckResult['failures'];
  usage: WalkUsage;
}

export interface SearchStageResult {
  /** Read-and-kept entities: where the walk starts from. */
  seeds: LoadedEntity[];
  hits: ReadonlyMap<string, TitledRef>;
  /** Every distinct entity the searches returned, the focal excluded. */
  surfacedIds: string[];
  /** The surfaced entities that were read and sent to Jev. */
  openedIds: string[];
  reader: GraphReader;
  record: SearchStageRecord;
  /** Each search, then the keep step, as they happened. */
  trace: Extract<Step, { kind: 'search' | 'search-keep' }>[];
}

/**
 * Run every planned search, merge the hits by entity id, and let Jev's read check decide which
 * to keep. Counts come from what ran, not from anything the agent says it read. A failed search
 * is recorded and the others carry on; a failed Jev request keeps its entities and is recorded.
 */
export const runSearchStage = async (input: SearchStageInput): Promise<SearchStageResult> => {
  const surfaced = new Map<string, TitledRef>();
  const searches: SearchStageRecord['searches'] = [];
  const trace: SearchStageResult['trace'] = [];
  for (const planned of input.searches) {
    const searchStartedAt = Date.now();
    const types = planned.types ?? null;
    let hits: TitledRef[];
    try {
      hits = await input.executor.search(planned, input.signal);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      searches.push({ query: planned.query, error: message });
      trace.push({
        kind: 'search',
        outcome: 'error',
        query: planned.query,
        types,
        error: message,
        ms: Date.now() - searchStartedAt,
      });
      continue;
    }
    hits = hits.slice(0, input.maxResultsPerSearch);
    searches.push({ query: planned.query, hits: hits.length });
    trace.push({
      kind: 'search',
      outcome: 'hits',
      query: planned.query,
      types,
      hits: hits.map(labelOf),
      ms: Date.now() - searchStartedAt,
    });
    for (const hit of hits) {
      if (hit.id === input.focalId) {
        continue;
      }
      const previous = surfaced.get(hit.id);
      if (!previous || (!previous.matchSpans?.length && hit.matchSpans?.length)) {
        surfaced.set(hit.id, hit);
      } else if (previous.indexedText === hit.indexedText && hit.matchSpans) {
        surfaced.set(hit.id, {
          ...previous,
          matchSpans: [...(previous.matchSpans ?? []), ...hit.matchSpans],
        });
      }
    }
  }
  const keepStartedAt = Date.now();
  const reader = input.readerFor([...surfaced.values()]);
  const ids = [...surfaced.keys()];
  // An unreadable hit is recorded and skipped; it never sinks the other results.
  const unreadable: SearchStageRecord['unreadable'] = [];
  const labels = new Map<string, EntityLabel>([...surfaced].map(([id, hit]) => [id, labelOf(hit)]));
  const read: ReadEntry[] = [];
  const readable = await Promise.all(
    ids.map(async (id) => {
      try {
        const entity = await reader.read(id);
        labels.set(id, labelOf(entity));
        return id;
      } catch (error) {
        input.signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        unreadable.push({ id, error: message });
        return undefined;
      }
    }),
  );
  const openedIds = readable.filter((id) => id !== undefined);
  for (const id of ids) {
    const unread = unreadable.find((entry) => entry.id === id);
    const entity = labels.get(id);
    if (entity) read.push({ entity, error: unread?.error ?? null });
  }
  const check = await readCheck({
    ...input.jev,
    focal: input.focal,
    ask: input.ask,
    ids: openedIds,
    hits: surfaced,
    reader,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const checked = readCheckTrace(check, labels);
  trace.push({
    kind: 'search-keep',
    read,
    judged: checked.judged,
    failures: checked.failures,
    usage: check.usage,
    ms: Date.now() - keepStartedAt,
  });
  return {
    seeds: check.kept,
    hits: surfaced,
    trace,
    surfacedIds: ids,
    openedIds,
    reader,
    record: {
      searches,
      surfaced: ids.length,
      opened: openedIds.length,
      unreadable,
      kept: check.kept.length,
      dropped: check.dropped,
      failures: check.failures,
      usage: check.usage,
    },
  };
};
