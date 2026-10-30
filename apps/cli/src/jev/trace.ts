import { z } from 'zod';

/** An entity as a reader of the trace sees it: never an id alone. */
export const entityLabelSchema = z.object({
  id: z.string().min(1),
  /** Its kind: task, feature, design_doc, ... */
  type: z.string().min(1),
  /** Empty when the platform returned the entity without a title. */
  title: z.string(),
});
export type EntityLabel = z.infer<typeof entityLabelSchema>;

export const usageSchema = z.object({
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

/** Exact candidate text and outcome. Optional text/decision allow older trace files to load. */
export const judgedSchema = z.object({
  entity: entityLabelSchema,
  applies: z.number().nullable(),
  kept: z.boolean(),
  text: z.string().optional(),
  decision: z.enum(['keep', 'drop', 'kept-on-failure']).optional(),
  excerpt: z
    .object({
      partial: z.boolean(),
      paragraphs: z.array(z.number()),
      totalParagraphs: z.number(),
      source: z.enum(['spans', 'full']),
      fullReason: z.enum(['no-spans', 'weak-spans', 'text-mismatch']).optional(),
    })
    .optional(),
});
export type Judged = z.infer<typeof judgedSchema>;

/** A Jev request that failed, and what gathering did with the entities it carried. */
export const jevFailureTraceSchema = z.object({
  step: z.enum(['score', 'keep']),
  entities: z.array(entityLabelSchema),
  code: z.string(),
  message: z.string(),
  providerStatus: z.number().optional(),
  providerDetail: z.string().optional(),
  errorDetail: z.string().optional(),
  /** A failed keep check keeps every entity; a failed score ends the walk at that hop. */
  next: z.enum(['kept-all', 'walk-ended']),
});
export type JevFailureTrace = z.infer<typeof jevFailureTraceSchema>;

/** One entity opened in full, or the error that left it unread and skipped. */
export const readEntrySchema = z.object({
  entity: entityLabelSchema,
  error: z.string().nullable(),
});
export type ReadEntry = z.infer<typeof readEntrySchema>;

export const searchStepSchema = z.discriminatedUnion('outcome', [
  z.object({
    kind: z.literal('search'),
    outcome: z.literal('hits'),
    query: z.string(),
    types: z.array(z.string()).nullable(),
    hits: z.array(entityLabelSchema),
    ms: z.number(),
  }),
  z.object({
    kind: z.literal('search'),
    outcome: z.literal('error'),
    query: z.string(),
    types: z.array(z.string()).nullable(),
    error: z.string(),
    ms: z.number(),
  }),
]);

export const searchKeepStepSchema = z.object({
  kind: z.literal('search-keep'),
  read: z.array(readEntrySchema),
  judged: z.array(judgedSchema),
  failures: z.array(jevFailureTraceSchema),
  usage: usageSchema,
  ms: z.number(),
});

export const hopCandidateSchema = z.object({
  entity: entityLabelSchema,
  /** The entity whose edges or mentions led here. */
  from: z.string(),
  /** Jev's probability that reading it is worth it; null when scoring failed. */
  score: z.number().nullable(),
  /** Whether the hop's cap and minimum score let it through to be read. */
  picked: z.boolean(),
});

export const hopStepSchema = z.object({
  kind: z.literal('hop'),
  level: z.number().int().positive(),
  candidates: z.array(hopCandidateSchema),
  read: z.array(readEntrySchema),
  judged: z.array(judgedSchema),
  failures: z.array(jevFailureTraceSchema),
  usage: usageSchema,
  ms: z.number(),
});
export type HopStep = z.infer<typeof hopStepSchema>;

/** An entity whose edges could not be read, so its neighbours were not considered. */
export const expansionFailureSchema = z.object({
  /** The hop whose frontier this fed; 1 for the focal and the kept search results. */
  forHop: z.number().int().positive(),
  entity: z.string(),
  error: z.string(),
});
export type ExpansionFailure = z.infer<typeof expansionFailureSchema>;

export const stepSchema = z.union([searchStepSchema, searchKeepStepSchema, hopStepSchema]);
export type Step = z.infer<typeof stepSchema>;

export const gatherTraceSchema = z.object({
  runId: z.string().min(1),
  turnId: z.string().min(1),
  /** 1 for the first gathering of the turn. */
  round: z.number().int().positive(),
  focal: entityLabelSchema,
  ask: z.string(),
  caps: z.object({
    maxSearches: z.number().int().positive(),
    maxResultsPerSearch: z.number().int().positive(),
    hops: z.array(z.object({ max: z.number().int().positive(), minScore: z.number() })),
  }),
  steps: z.array(stepSchema),
  expansionFailures: z.array(expansionFailureSchema),
  /** What went into Project Assistant's prompt, and the stage that reached it. */
  returned: z.array(entityLabelSchema.extend({ via: z.string() })),
});
export type GatherTrace = z.infer<typeof gatherTraceSchema>;
