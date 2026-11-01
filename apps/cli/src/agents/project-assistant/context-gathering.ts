/**
 * Context gathering for Project Assistant, run in `prepare` before its session starts.
 *
 * A one-off, tool-free model call plans the searches, the application runs them, Jev keeps
 * results and the walk follows their edges. Every kept entity excerpt goes into the Project Assistant's
 * prompt without its Implementation section. Nothing here falls back: a failed plan, gather, trace write or oversize result throws.
 */

import type { ReadRestriction } from '../../shared/api/generated/api';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildSearchPlanPrompt,
  gather,
  MAX_CONTEXT_SEARCHES,
  submitContextSearchesSchema,
  type GatherResult,
  type SearchExecutor,
} from '../../jev/search';
import type { Focal } from '../../jev/scenarios';
import { appendGatherTraceFile } from '../../jev/trace-file';
import { textForJev } from '../../jev/traversal';
import type {
  EntityRef,
  GraphReader,
  LevelLimit,
  LoadedEntity,
  WalkJev,
} from '../../jev/traversal';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { recordJevCalls } from './parent-requirements-attempt-log';

/** First hop wide, second hop narrower and only for entities worth reading. */
export const CONTEXT_SEARCH_HOP_LIMITS: readonly LevelLimit[] = [
  { max: 8, minScore: 0 },
  { max: 4, minScore: 0.5 },
];

/** Hits kept from each search; with 8 searches this is about 200 entities to consider. */
export const CONTEXT_SEARCH_MAX_RESULTS = 25;

/** Cap on the formatted gathered entities placed in the prompt; exceeding it throws. */
export const GATHERED_CONTEXT_MAX_CHARS = 200_000;

export interface ContextSearchProject {
  organizationId: string;
  projectId: string;
  /** The Run's read restriction, carried into every search and read the gather makes. */
  readRestriction?: ReadRestriction | undefined;
}

/** What the application provides for gathering; defined only with a Jev key. */
export interface ContextGatheringDeps {
  jev: WalkJev;
  limits: readonly LevelLimit[];
  maxResultsPerSearch: number;
  executorFor: (project: ContextSearchProject) => SearchExecutor;
  readerFor: (
    project: ContextSearchProject,
    focal: EntityRef,
    known: readonly EntityRef[],
  ) => GraphReader;
  /** Directory of per-run trace files, one `<runId>.json`. */
  traceLogDir: string;
}

export interface GatherProjectContextArgs {
  deps: ContextGatheringDeps;
  handlerDeps: PromptTypeHandlerDeps;
  runId: string;
  turnId: string;
  project: ContextSearchProject;
  focalRef: EntityRef;
  focal: Focal;
  /** The user's original request; empty when there is none. */
  ask: string;
  /** The Project Assistant's prompt as it stands without the gathered entities. */
  promptContext: string;
  signal: AbortSignal;
  fullEntityIds?: readonly string[];
}

const formatEntities = (entities: readonly LoadedEntity[]): string =>
  entities.length === 0
    ? '## Gathered context\n\nThe searches gathered no entities.'
    : [
        `## Gathered context\n\nJev gathered ${String(entities.length)} entities for this request: kept search results, then what their edges led to. Entities may be partial excerpts. Open full entities before relying on governing requirements, resolving conflicts or proposing changes. Never infer omitted text is absent; do not open every excerpt by default.`,
        ...entities.map(
          ({ id, kind, title, text, excerpt }) =>
            `---\n${kind} ${id} — ${title}\n${excerpt?.partial ? `Excerpt — paragraphs ${excerpt.paragraphs.join(', ')} of ${String(excerpt.totalParagraphs)}; open the full entity with get_full_entity before relying on omitted text` : 'Complete content'}\n\n${textForJev(text)}`,
        ),
      ].join('\n\n');

/** The application's record of one run: counts per stage and what Jev or the reader could not do. */
const summarize = (result: GatherResult): Record<string, unknown> => ({
  searches: result.search.searches,
  // Each entity is counted once, at the first stage that reached it.
  counts: result.counts,
  jevFailures: [
    ...result.search.failures.map(({ ids, failure }) => ({
      stage: 'search',
      step: 'keep',
      entities: ids.length,
      code: failure.code,
      providerStatus: failure.providerStatus,
      errorDetail: failure.errorDetail,
    })),
    ...result.walk.failures.flatMap((failure) =>
      failure.kind === 'jev'
        ? [
            {
              stage: `hop ${String(failure.level)}`,
              step: failure.step,
              entities: failure.ids.length,
              code: failure.failure.code,
              providerStatus: failure.failure.providerStatus,
              errorDetail: failure.failure.errorDetail,
            },
          ]
        : [],
    ),
  ],
  unreadable: [
    ...result.search.unreadable.map(({ id, error }) => ({ stage: 'search', id, error })),
    ...result.walk.failures.flatMap((failure) =>
      failure.kind === 'read'
        ? [{ stage: `hop ${String(failure.level)}`, id: failure.id, error: failure.error }]
        : [],
    ),
  ],
  returned: result.entities.length,
});

const PLAN_LOG_CHARS = 4000;

/** Times the model is asked for a valid plan, including the first ask. */
const MAX_PLAN_ATTEMPTS = 3;

const describeFailure = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** `promptOnce` keeps no conversation, so the retry carries the rejected answer and why it was rejected. */
const buildPlanRetryPrompt = (planPrompt: string, answer: string, error: unknown): string =>
  [
    planPrompt,
    `## Your previous answer was rejected\n\n${answer}`,
    `## Why\n\n${error instanceof Error ? error.message : String(error)}`,
    'Answer again with only the corrected JSON object.',
  ].join('\n\n');

/**
 * Plans, runs and records the searches, and returns the section of kept entities for the prompt.
 * Every Jev request the run makes is saved beside the trace, whether the run succeeds or throws.
 */
export const gatherProjectContext = async (args: GatherProjectContextArgs): Promise<string> => {
  const recorder = recordJevCalls(args.deps.jev.client);
  try {
    return await gatherWithJev({
      ...args,
      deps: { ...args.deps, jev: { ...args.deps.jev, client: recorder.evaluator } },
    });
  } finally {
    if (recorder.calls.length > 0) {
      // Local file only: request content must never reach the structured logger.
      const file = path.join(
        args.deps.traceLogDir,
        `${args.runId}.${args.turnId}.jev-requests.json`,
      );
      await mkdir(args.deps.traceLogDir, { recursive: true });
      await writeFile(file, `${JSON.stringify(recorder.calls, null, 2)}\n`, 'utf8');
      args.handlerDeps.logger.info('project_assistant.context_gathering.jev_requests_saved', {
        runId: args.runId,
        turnId: args.turnId,
        file,
        requests: recorder.calls.length,
      });
    }
  }
};

const gatherWithJev = async (args: GatherProjectContextArgs): Promise<string> => {
  const { deps, handlerDeps, runId, turnId, project, focalRef, focal, ask, promptContext, signal } =
    args;

  const planPrompt = buildSearchPlanPrompt(promptContext, focal, ask);
  let submission: ReturnType<typeof submitContextSearchesSchema.parse> | undefined;
  let prompt = planPrompt;
  for (let attempt = 1; submission === undefined; attempt++) {
    const answer = await handlerDeps.promptOnce({
      prompt,
      // No endPhase: the state holds through the gather until the session's first event.
      startPhase: 'gathering_context',
    });
    handlerDeps.logger.info('project_assistant.context_gathering.plan_received', {
      runId,
      turnId,
      attempt,
      chars: answer.length,
      answer: answer.slice(0, PLAN_LOG_CHARS),
    });
    try {
      submission = submitContextSearchesSchema.parse(JSON.parse(answer));
    } catch (error) {
      const failure = describeFailure(error);
      handlerDeps.logger.error('project_assistant.context_gathering.plan_invalid', {
        runId,
        turnId,
        attempt,
        error: failure,
        answer: answer.slice(0, PLAN_LOG_CHARS),
      });
      if (attempt >= MAX_PLAN_ATTEMPTS) {
        throw error;
      }
      prompt = buildPlanRetryPrompt(planPrompt, answer, error);
    }
  }
  handlerDeps.logger.info('project_assistant.context_gathering.gather_started', {
    runId,
    turnId,
    searches: submission.searches.length,
  });

  let result: Awaited<ReturnType<typeof gather>>;
  try {
    result = await gather({
      focalId: focalRef.id,
      focal,
      ask,
      submission,
      executor: deps.executorFor(project),
      readerFor: (known) => deps.readerFor(project, focalRef, known),
      jev: deps.jev,
      limits: deps.limits,
      maxResultsPerSearch: deps.maxResultsPerSearch,
      signal,
    });
  } catch (error) {
    handlerDeps.logger.error('project_assistant.context_gathering.gather_failed', {
      runId,
      turnId,
      error: describeFailure(error),
    });
    throw error;
  }

  for (const step of result.trace.steps) {
    if (step.kind === 'search') {
      continue;
    }
    for (const judged of step.judged) {
      if (judged.excerpt?.fullReason) {
        handlerDeps.logger.info('project_assistant.context_gathering.full_document', {
          entityId: judged.entity.id,
          reason: judged.excerpt.fullReason,
        });
      }
    }
  }

  const stored = await handlerDeps.preparationRecords.appendGatherTrace(runId, {
    runId,
    turnId,
    focal: {
      id: focalRef.id,
      type: focalRef.kind,
      title: focal.kind === 'question' ? focal.text : focal.name,
    },
    ask,
    caps: {
      maxSearches: MAX_CONTEXT_SEARCHES,
      maxResultsPerSearch: deps.maxResultsPerSearch,
      hops: deps.limits.map(({ max, minScore }) => ({ max, minScore })),
    },
    ...result.trace,
  });
  const file = await appendGatherTraceFile(deps.traceLogDir, stored);
  const fullIds = new Set([focalRef.id, ...(args.fullEntityIds ?? [])]);
  const text = formatEntities(result.entities.filter(({ id }) => !fullIds.has(id)));
  // Written before the size check, so a run that fails on size still leaves what was gathered to read.
  const entitiesFile = path.join(deps.traceLogDir, `${runId}.${turnId}.entities.txt`);
  await writeFile(entitiesFile, text, 'utf8');
  handlerDeps.logger.info('project_assistant.context_gathered', {
    runId,
    turnId,
    file,
    entitiesFile,
    chars: text.length,
    ...summarize(result),
  });

  if (text.length > GATHERED_CONTEXT_MAX_CHARS) {
    throw new Error(
      `Gathered context is ${String(text.length)} characters, over the ${String(GATHERED_CONTEXT_MAX_CHARS)} character cap.`,
    );
  }
  return text;
};
