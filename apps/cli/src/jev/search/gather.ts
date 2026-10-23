import type { Focal } from '../scenarios';
import type { GatherTrace } from '../trace';
import {
  labelOf,
  walk,
  type LevelLimit,
  type LoadedEntity,
  type WalkJev,
  type WalkResult,
  type WalkUsage,
} from '../traversal';
import { submitContextSearchesSchema } from './search-plan-prompt';
import { runSearchStage, type SearchStageInput, type SearchStageRecord } from './search-stage';

export interface GatherInput {
  focalId: string;
  focal: Focal;
  ask: string;
  /** The planned searches, validated here. */
  submission: unknown;
  executor: SearchStageInput['executor'];
  readerFor: SearchStageInput['readerFor'];
  jev: WalkJev;
  limits: readonly LevelLimit[];
  /** Hits kept per search. */
  maxResultsPerSearch: number;
  /** The turn's signal: cancelling it stops searches and Jev requests, and gather rejects. */
  signal?: AbortSignal;
}

/** Distinct entities one stage added, each counted at the first stage that reached it. */
export interface StageCounts {
  surfaced: number;
  opened: number;
  kept: number;
  elapsedMs: number;
  usage: WalkUsage;
}

export interface GatherCounts {
  search: StageCounts;
  /** One per hop the walk began, in order. */
  hops: StageCounts[];
  /** Jev requests and tokens across the search stage and every hop. */
  usage: WalkUsage;
}

export interface GatherResult {
  search: SearchStageRecord;
  /** Kept search results, then what the walk reached from them and the focal. */
  entities: LoadedEntity[];
  /** Always the walk's own result, with its failures; a failed Jev request never empties it. */
  walk: WalkResult;
  counts: GatherCounts;
  /** What happened at each step, gathered as the stages ran; the caller adds the run's identity. */
  trace: Pick<GatherTrace, 'steps' | 'expansionFailures' | 'returned'>;
}

/** Counts each id at the first stage that lists it and not again. */
const countOnce = (counted: Set<string>, ids: readonly string[]): number => {
  let fresh = 0;
  for (const id of ids) {
    if (!counted.has(id)) {
      counted.add(id);
      fresh += 1;
    }
  }
  return fresh;
};

/**
 * Everything gathered for a planned set of searches: the search stage, then the walk seeded
 * from the kept results. A Jev failure or an unreadable entity
 * is recorded in the result and the entities gathered so far are still returned.
 */
export const gather = async (input: GatherInput): Promise<GatherResult> => {
  const { searches } = submitContextSearchesSchema.parse(input.submission);
  const { client, model, wording } = input.jev;
  const searchStartedAt = Date.now();
  const stage = await runSearchStage({
    focalId: input.focalId,
    focal: input.focal,
    ask: input.ask,
    searches,
    maxResultsPerSearch: input.maxResultsPerSearch,
    executor: input.executor,
    readerFor: input.readerFor,
    jev: { client, model, wording },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const searchElapsedMs = Date.now() - searchStartedAt;
  const walked = await walk({
    focalId: input.focalId,
    focal: input.focal,
    ask: input.ask,
    reader: stage.reader,
    seedIds: stage.seeds.map(({ id }) => id),
    jev: input.jev,
    limits: input.limits,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const surfaced = new Set<string>();
  const opened = new Set<string>();
  const kept = new Set<string>();
  const search: StageCounts = {
    surfaced: countOnce(surfaced, stage.surfacedIds),
    opened: countOnce(opened, stage.openedIds),
    kept: countOnce(
      kept,
      stage.seeds.map(({ id }) => id),
    ),
    elapsedMs: searchElapsedMs,
    usage: stage.record.usage,
  };
  const hops = walked.levels.map(
    (level): StageCounts => ({
      surfaced: countOnce(surfaced, level.surfaced),
      opened: countOnce(opened, level.opened),
      kept: countOnce(kept, level.kept),
      elapsedMs: level.elapsedMs,
      usage: level.usage,
    }),
  );
  return {
    search: stage.record,
    entities: [...stage.seeds, ...walked.entities],
    walk: walked,
    trace: {
      steps: [...stage.trace, ...walked.hops],
      expansionFailures: walked.expansionFailures,
      returned: [
        ...stage.seeds.map((entity) => ({ ...labelOf(entity), via: 'search' })),
        ...walked.entities.map((entity) => ({
          ...labelOf(entity),
          via: `hop${String(entity.level)}`,
        })),
      ],
    },
    counts: {
      search,
      hops,
      usage: {
        requests: stage.record.usage.requests + walked.usage.requests,
        inputTokens: stage.record.usage.inputTokens + walked.usage.inputTokens,
        outputTokens: stage.record.usage.outputTokens + walked.usage.outputTokens,
      },
    },
  };
};
