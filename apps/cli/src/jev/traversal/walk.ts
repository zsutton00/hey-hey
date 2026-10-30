import { EDGES, judge, type Focal } from '../scenarios';
import type { EntityLabel, ExpansionFailure, HopStep } from '../trace';
import {
  JEV_MAX_CONCURRENT_REQUESTS,
  JEV_REQUEST_MAX_CHARS,
  mapConcurrently,
  packRequests,
} from './pack-requests';
import { readCheck } from './read-check';
import { jevFailureTrace, labelLookup, labelOf, readCheckTrace } from './trace-entries';
import type {
  FoundCandidate,
  JevFailure,
  WalkedEntity,
  WalkFailure,
  WalkInput,
  WalkLevel,
  WalkResult,
  WalkUsage,
} from './types';

/** The focal as Jev judges it at every level: the work itself, with the user's ask alongside. */
export const withAsk = (focal: Focal, ask: string): Focal =>
  focal.kind === 'question' || ask.trim() === '' ? focal : { ...focal, ask };

/**
 * Walk the graph outward from the focal, level by level. Each level scores the frontier's
 * candidates for whether reading them is worth it, reads the best within the level's limit, and
 * has Jev keep or drop what it read. Only kept entities are returned and lead to the next
 * frontier. Every score is against the original focal and ask. A Jev failure or an unreadable
 * entity is recorded and never discards what was gathered; no score is made up.
 */
export const walk = async (input: WalkInput): Promise<WalkResult> => {
  const { focalId, ask, reader, jev, limits, seedIds = [], signal } = input;
  const focal = withAsk(input.focal, ask);
  const seen = new Set<string>([focalId, ...seedIds]);
  const entities: WalkedEntity[] = [];
  const levels: WalkLevel[] = [];
  const failures: WalkFailure[] = [];
  const hops: HopStep[] = [];
  const expansionFailures: ExpansionFailure[] = [];
  const usage: WalkUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  const count = (record: WalkLevel, used: WalkUsage): void => {
    for (const total of [usage, record.usage]) {
      total.requests += used.requests;
      total.inputTokens += used.inputTokens;
      total.outputTokens += used.outputTokens;
    }
  };
  const result = (): WalkResult => ({
    entities,
    levels,
    failures,
    usage,
    hops,
    expansionFailures,
  });

  // A start whose candidates cannot be read is recorded; the other starts still lead somewhere.
  const starts = await Promise.all(
    [focalId, ...seedIds].map(async (id) => {
      try {
        return (await reader.candidates(id)).map((found) => ({ found, from: id }));
      } catch (error) {
        signal?.throwIfAborted();
        failures.push({ kind: 'read', level: 1, id, error: errorMessage(error) });
        expansionFailures.push({ forHop: 1, entity: id, error: errorMessage(error) });
        return [];
      }
    }),
  );
  let frontier: Reached[] = distinct(starts.flat());
  for (const [index, { max, minScore }] of limits.entries()) {
    const level = index + 1;
    const startedAt = Date.now();
    const reached = frontier.filter(({ found }) => !seen.has(found.candidate.id));
    if (reached.length === 0) break;
    const pool = reached.map(({ found }) => found.candidate);
    const record: WalkLevel = {
      level,
      surfaced: pool.map(({ id }) => id),
      opened: [],
      kept: [],
      elapsedMs: 0,
      usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
    };
    levels.push(record);
    const step: HopStep = {
      kind: 'hop',
      level,
      candidates: [],
      read: [],
      judged: [],
      failures: [],
      usage: record.usage,
      ms: 0,
    };
    hops.push(step);
    const labels = new Map<string, EntityLabel>(
      reached.map(({ found }) => [found.ref.id, labelOf(found.ref)]),
    );
    const candidateTrace = (scores: ReadonlyMap<string, number> | null, pickedIds: Set<string>) =>
      reached.map(({ found, from }) => ({
        entity: labelOf(found.ref),
        from,
        score: scores?.get(found.candidate.id) ?? null,
        picked: pickedIds.has(found.candidate.id),
      }));
    const finish = (): void => {
      record.elapsedMs = Date.now() - startedAt;
      step.ms = record.elapsedMs;
    };

    const scoring = await mapConcurrently(
      packRequests(EDGES, focal, pool, jev.wording, JEV_REQUEST_MAX_CHARS),
      JEV_MAX_CONCURRENT_REQUESTS,
      (batch) => judge(jev.client, jev.model, EDGES, focal, batch, jev.wording, signal),
    );
    const scoreFailure = scoring.find((result) => !result.ok);
    if (scoreFailure?.ok === false) {
      failures.push(jevFailure(level, 'score', pool, scoreFailure.failure));
      step.candidates = candidateTrace(null, new Set());
      step.failures.push(
        jevFailureTrace(
          'score',
          reached.map(({ found }) => labelOf(found.ref)),
          scoreFailure.failure,
          'walk-ended',
        ),
      );
      finish();
      break;
    }
    const scored = {
      judgments: scoring.flatMap((result) => (result.ok ? result.judgments : [])),
      usage: scoring.reduce<WalkUsage>(
        (total, result) =>
          result.ok
            ? {
                requests: total.requests + 1,
                inputTokens: total.inputTokens + result.usage.inputTokens,
                outputTokens: total.outputTokens + result.usage.outputTokens,
              }
            : total,
        { requests: 0, inputTokens: 0, outputTokens: 0 },
      ),
    };
    count(record, scored.usage);
    const readMoreOf = new Map(scored.judgments.map(({ id, readMore }) => [id, readMore]));
    const picked = pool
      .map((candidate) => ({ candidate, readMore: readMoreOf.get(candidate.id) ?? 0 }))
      .filter(({ readMore }) => readMore >= minScore)
      // Array.prototype.sort is stable, so equal scores keep the reader's order.
      .sort((a, b) => b.readMore - a.readMore)
      .slice(0, max);
    step.candidates = candidateTrace(
      new Map(scored.judgments.map(({ id, readMore }) => [id, readMore])),
      new Set(picked.map(({ candidate }) => candidate.id)),
    );

    const read = await Promise.all(
      picked.map(async ({ candidate, readMore }) => {
        try {
          return { ...(await reader.read(candidate.id)), readMore };
        } catch (error) {
          signal?.throwIfAborted();
          failures.push({ kind: 'read', level, id: candidate.id, error: errorMessage(error) });
          step.read.push({ entity: labelLookup(labels)(candidate.id), error: errorMessage(error) });
          return undefined;
        }
      }),
    );
    // An unreadable entity is skipped but still seen, so a later level does not retry it.
    for (const { candidate } of picked) seen.add(candidate.id);
    const loaded = read.filter((entity) => entity !== undefined);
    record.opened = loaded.map(({ id }) => id);
    for (const entity of loaded) {
      labels.set(entity.id, labelOf(entity));
      step.read.push({ entity: labelOf(entity), error: null });
    }
    if (loaded.length === 0) {
      finish();
      break;
    }

    const check = await readCheck({
      client: jev.client,
      model: jev.model,
      wording: jev.wording,
      focal: input.focal,
      ask,
      ids: record.opened,
      ...(input.hits ? { hits: input.hits } : {}),
      reader,
      ...(signal ? { signal } : {}),
    });
    count(record, check.usage);
    for (const { ids, failure } of check.failures) {
      failures.push({ kind: 'jev', level, step: 'keep', ids, failure });
    }
    const checked = readCheckTrace(check, labels);
    step.judged = checked.judged;
    step.failures.push(...checked.failures);
    const readMoreOfLoaded = new Map(loaded.map(({ id, readMore }) => [id, readMore]));
    const kept = check.kept.map(
      (entity): WalkedEntity => ({
        ...entity,
        level,
        readMore: readMoreOfLoaded.get(entity.id) ?? 0,
      }),
    );
    entities.push(...kept);
    record.kept = kept.map(({ id }) => id);

    if (level === limits.length) {
      finish();
      break;
    }
    const next = (
      await Promise.all(
        kept.map(async ({ id }) => {
          try {
            return (await reader.candidates(id)).map((found) => ({ found, from: id }));
          } catch (error) {
            signal?.throwIfAborted();
            failures.push({ kind: 'read', level, id, error: errorMessage(error) });
            expansionFailures.push({ forHop: level + 1, entity: id, error: errorMessage(error) });
            return [];
          }
        }),
      )
    ).flat();
    frontier = distinct(next);
    finish();
  }
  return result();
};

/** A candidate and the entity whose edges or mentions led to it. */
interface Reached {
  found: FoundCandidate;
  from: string;
}

/** Two entities can lead to the same one; a request takes each candidate once, under the first. */
const distinct = (reached: readonly Reached[]): Reached[] => [
  ...new Map(reached.map((item) => [item.found.candidate.id, item])).values(),
];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const jevFailure = (
  level: number,
  step: 'score' | 'keep',
  candidates: readonly { id: string }[],
  failure: JevFailure,
): WalkFailure => ({ kind: 'jev', level, step, ids: candidates.map(({ id }) => id), failure });
