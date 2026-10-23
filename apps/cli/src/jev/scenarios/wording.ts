import { z } from 'zod';
import {
  EDGE_RELATIONSHIPS,
  FOCAL_KINDS,
  RELATIONSHIPS,
  type CandidateKind,
  type FocalKind,
} from './scenarios';
import defaultWording from './wording.json';

/** A template with `{candidate}` and `{focal}` placeholders, each used exactly once. */
const relevanceQuestionSchema = z
  .string()
  .refine(
    (template) =>
      template.split('{candidate}').length === 2 && template.split('{focal}').length === 2,
    'relevanceQuestion must contain {candidate} and {focal} exactly once each',
  );

/** What each relationship means, with `{focal}` and `{candidate}` standing for the two nouns. */
const criteriaSchema = z.object(
  Object.fromEntries(
    RELATIONSHIPS.map((relationship) => [relationship, z.string().min(1)]),
  ) as Record<(typeof RELATIONSHIPS)[number], z.ZodString>,
);

/** Everything a relevance scenario says when the work being judged is of one kind. */
const focalWordingSchema = z.object({
  openingSentence: z.string().min(1),
  relevanceQuestion: relevanceQuestionSchema,
  criteria: criteriaSchema,
});

const relevanceWordingSchema = z.object(
  Object.fromEntries(FOCAL_KINDS.map((kind) => [kind, focalWordingSchema])) as Record<
    FocalKind,
    typeof focalWordingSchema
  >,
);

const openingSentencesSchema = z.object(
  Object.fromEntries(FOCAL_KINDS.map((kind) => [kind, z.string().min(1)])) as Record<
    FocalKind,
    z.ZodString
  >,
);

/** What each edge relationship means, with `{focal}` and `{candidate}` standing for the two nouns. */
const edgeCriteriaSchema = z.object(
  Object.fromEntries(
    EDGE_RELATIONSHIPS.map((relationship) => [relationship, z.string().min(1)]),
  ) as Record<(typeof EDGE_RELATIONSHIPS)[number], z.ZodString>,
);

export const edgesWordingSchema = z.object({
  openingSentence: openingSentencesSchema,
  // Older saved runs used this exact fixed question before it became editable.
  readMoreQuestion: relevanceQuestionSchema.default(
    'Would reading the full entity behind {candidate} help with the {focal}?',
  ),
  criteria: edgeCriteriaSchema,
});

/** What the read check asks of every entity it has read, and what each answer means. */
export const readCheckWordingSchema = z.object({
  openingSentence: openingSentencesSchema,
  question: relevanceQuestionSchema,
  criteria: z.object({ applies: z.string().min(1), does_not_apply: z.string().min(1) }),
});

export const wordingSchema = z.object({
  parent_requirements: relevanceWordingSchema,
  neighbourhood: relevanceWordingSchema,
  edges: edgesWordingSchema,
  hint_selection: relevanceWordingSchema,
  decision_selection: relevanceWordingSchema,
  read_check: readCheckWordingSchema,
});

export type Wording = z.infer<typeof wordingSchema>;
export type FocalWording = z.infer<typeof focalWordingSchema>;

/** The wording bundled with the CLI, validated when the module loads. */
export const DEFAULT_WORDING: Wording = wordingSchema.parse(defaultWording);

/** The scenarios whose wording carries a relevance question. */
export type RelevanceWordingId = Exclude<keyof Wording, 'edges' | 'read_check'>;

/**
 * The scenario whose wording each kind of candidate is asked in. In a one-request layout
 * every candidate is asked in its own kind's wording, whichever scenario sent the request.
 */
export const WORDING_SCENARIO_BY_KIND: Record<
  Exclude<CandidateKind, 'entity'>,
  RelevanceWordingId
> = {
  requirement: 'parent_requirements',
  ancestor: 'neighbourhood',
  ancestor_sibling: 'neighbourhood',
  sibling: 'neighbourhood',
  child: 'neighbourhood',
  linked: 'neighbourhood',
  mentioned: 'neighbourhood',
  hint: 'hint_selection',
  decision: 'decision_selection',
};
