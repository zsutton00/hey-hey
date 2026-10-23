import type { JevAnswer, JevClient, JevResult } from '../client';
import {
  EDGE_RELATIONSHIPS,
  READ_RELATIONSHIPS,
  RELATIONSHIPS,
  type EdgeRelationship,
  type Candidate,
  type Focal,
  type ReadCheckScenario,
  type ReadMoreScenario,
  type Relationship,
  type RelevanceScenario,
  type Scenario,
} from './scenarios';
import { buildQuestions, buildState, conflictQuestionId } from './state';
import type { Wording } from './wording';

type ChoiceAnswer = Extract<JevAnswer, { type: 'choice' }>;
type NoulAnswer = Extract<JevAnswer, { type: 'noul' }>;
type JevFailure = Extract<JevResult, { ok: false }>;
/** What `judge` needs of a client, so a consumer can put a cache in front of one. */
export type JevEvaluator = Pick<JevClient, 'evaluate'>;

export interface RelevanceJudgment {
  id: string;
  /** p(implements) + p(informs). */
  relevance: number;
  /** Probability that the focal work breaks, contradicts or undoes the candidate. */
  conflict: number;
  relationships: Record<Relationship, number>;
}

export interface ReadMoreJudgment {
  id: string;
  /** Probability that the candidate is connected to the work in a way worth reading. */
  readMore: number;
  /** Jev's whole split of confidence, so a high score can be traced to its cause. */
  relationships: Record<EdgeRelationship, number>;
}

export interface ReadCheckJudgment {
  id: string;
  /** Whichever of the two answers Jev found likelier. */
  choice: 'applies' | 'does_not_apply';
  /** Probability that the entity applies to the work and the ask. */
  applies: number;
}

export interface Judged<J> {
  ok: true;
  model: string;
  judgments: J[];
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

/** Null when the answer lacks a relationship the scenario asked about. */
export const relationshipsOf = (answer: ChoiceAnswer): Record<Relationship, number> | null => {
  const [implementsP, informsP, unrelatedP, otherP] = RELATIONSHIPS.map(
    (relationship) => answer.probabilities[relationship],
  );
  if (
    implementsP === undefined ||
    informsP === undefined ||
    unrelatedP === undefined ||
    otherP === undefined
  ) {
    return null;
  }
  return {
    implements: implementsP,
    informs: informsP,
    same_feature_unrelated: unrelatedP,
    other: otherP,
  };
};

export const relevanceOf = (relationships: Record<Relationship, number>): number =>
  relationships.implements + relationships.informs;

export const conflictOf = (answer: NoulAnswer): number => answer.noul;

const invalidResponse: JevFailure = {
  ok: false,
  failure: { code: 'INVALID_RESPONSE', message: 'Jev returned an invalid evaluation result.' },
};

const judgeRelevance = (
  answers: Record<string, JevAnswer>,
  candidates: readonly Candidate[],
): RelevanceJudgment[] | null => {
  const judgments: RelevanceJudgment[] = [];
  for (const { id } of candidates) {
    const relevance = answers[id];
    const conflict = answers[conflictQuestionId(id)];
    if (relevance?.type !== 'choice' || conflict?.type !== 'noul') return null;
    const relationships = relationshipsOf(relevance);
    if (!relationships) return null;
    judgments.push({
      id,
      relevance: relevanceOf(relationships),
      conflict: conflictOf(conflict),
      relationships,
    });
  }
  return judgments;
};

/** Null when the answer lacks an edge relationship the scenario asked about. */
export const edgeRelationshipsOf = (
  answer: ChoiceAnswer,
): Record<EdgeRelationship, number> | null => {
  const entries = EDGE_RELATIONSHIPS.map((name) => [name, answer.probabilities[name]] as const);
  if (entries.some(([, probability]) => probability === undefined)) return null;
  return Object.fromEntries(entries) as Record<EdgeRelationship, number>;
};

/** p(any relationship that suggests reading the candidate in full). */
export const readMoreOf = (relationships: Record<EdgeRelationship, number>): number =>
  READ_RELATIONSHIPS.reduce((sum, name) => sum + relationships[name], 0);

const judgeReadMore = (
  answers: Record<string, JevAnswer>,
  candidates: readonly Candidate[],
): ReadMoreJudgment[] | null => {
  const judgments: ReadMoreJudgment[] = [];
  for (const { id } of candidates) {
    const answer = answers[id];
    if (answer?.type !== 'choice') return null;
    const relationships = edgeRelationshipsOf(answer);
    if (!relationships) return null;
    judgments.push({ id, readMore: readMoreOf(relationships), relationships });
  }
  return judgments;
};

const judgeReadCheck = (
  answers: Record<string, JevAnswer>,
  candidates: readonly Candidate[],
): ReadCheckJudgment[] | null => {
  const judgments: ReadCheckJudgment[] = [];
  for (const { id } of candidates) {
    const answer = answers[id];
    if (answer?.type !== 'choice') return null;
    const applies = answer.probabilities['applies'];
    if (applies === undefined || answer.probabilities['does_not_apply'] === undefined) return null;
    judgments.push({
      id,
      choice: answer.choice === 'applies' ? 'applies' : 'does_not_apply',
      applies,
    });
  }
  return judgments;
};

/**
 * Ask Jev about every candidate in one request. A Jev failure comes back as the client's
 * own failure; an answer that does not fit the scenario is an INVALID_RESPONSE failure.
 * Neither produces a stand-in judgment.
 */
export function judge(
  client: JevEvaluator,
  model: string,
  scenario: RelevanceScenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
  signal?: AbortSignal,
): Promise<Judged<RelevanceJudgment> | JevFailure>;
export function judge(
  client: JevEvaluator,
  model: string,
  scenario: ReadMoreScenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
  signal?: AbortSignal,
): Promise<Judged<ReadMoreJudgment> | JevFailure>;
export function judge(
  client: JevEvaluator,
  model: string,
  scenario: ReadCheckScenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
  signal?: AbortSignal,
): Promise<Judged<ReadCheckJudgment> | JevFailure>;
export function judge(
  client: JevEvaluator,
  model: string,
  scenario: Scenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
  signal?: AbortSignal,
): Promise<
  Judged<RelevanceJudgment> | Judged<ReadMoreJudgment> | Judged<ReadCheckJudgment> | JevFailure
>;
export async function judge(
  client: JevEvaluator,
  model: string,
  scenario: Scenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
  signal?: AbortSignal,
): Promise<
  Judged<RelevanceJudgment> | Judged<ReadMoreJudgment> | Judged<ReadCheckJudgment> | JevFailure
> {
  const result = await client.evaluate(
    {
      model,
      state: buildState(scenario, focal, candidates, wording),
      questions: buildQuestions(scenario, focal, candidates, wording),
    },
    signal ? { signal } : undefined,
  );
  if (!result.ok) return result;
  const { ok, answers, ...meta } = result;
  if (scenario.decision === 'relevance') {
    const judgments = judgeRelevance(answers, candidates);
    return judgments ? { ok, ...meta, judgments } : invalidResponse;
  }
  if (scenario.decision === 'applies') {
    const judgments = judgeReadCheck(answers, candidates);
    return judgments ? { ok, ...meta, judgments } : invalidResponse;
  }
  const judgments = judgeReadMore(answers, candidates);
  return judgments ? { ok, ...meta, judgments } : invalidResponse;
}
