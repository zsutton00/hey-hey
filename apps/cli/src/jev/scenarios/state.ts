import { createHash } from 'node:crypto';
import type { EntryType } from '@typesafe-ai/sdk';
import { canonicalizeJsonObject } from '../../shared/canonical-json';
import type { JevQuestion } from '../client';
import {
  type Candidate,
  type CandidateKind,
  type Focal,
  type FocalKind,
  type FocalParent,
  type Scenario,
} from './scenarios';
import { DEFAULT_WORDING, WORDING_SCENARIO_BY_KIND, type Wording } from './wording';

/** Where each kind of candidate sits in the state, and how the questions name it. */
const CANDIDATE_GROUPS: Record<CandidateKind, { stateKey: string; noun: string }> = {
  requirement: { stateKey: 'requirements', noun: 'requirement' },
  ancestor: { stateKey: 'ancestors', noun: 'ancestor feature' },
  ancestor_sibling: { stateKey: 'ancestor_siblings', noun: 'sibling of an ancestor feature' },
  sibling: { stateKey: 'siblings', noun: 'sibling' },
  child: { stateKey: 'children', noun: 'child' },
  linked: { stateKey: 'edges', noun: 'linked entity' },
  mentioned: { stateKey: 'mentions', noun: 'mentioned entity' },
  hint: { stateKey: 'hints', noun: 'implementation hint' },
  decision: { stateKey: 'decisions', noun: 'project decision' },
  entity: { stateKey: 'entities', noun: 'item' },
};

const FOCAL_NOUNS: Record<FocalKind, string> = {
  task: 'task',
  feature: 'feature',
  mockup: 'mockup',
  diagram: 'diagram',
  question: 'question',
};

const CONFLICT_QUESTION_PREFIX = 'conflict:';

/** Id of the conflict question that accompanies a candidate's relevance question. */
export const conflictQuestionId = (candidateId: string): string =>
  `${CONFLICT_QUESTION_PREFIX}${candidateId}`;

const CONFLICT_LEAD: Record<FocalKind, string> = {
  task: 'Does implementing the task break, contradict or undo',
  feature: 'Does delivering the feature break, contradict or undo',
  mockup: 'Does the design the mockup shows break, contradict or undo',
  diagram: 'Does the structure the diagram shows break, contradict or undo',
  question: 'Does the question assume something that contradicts',
};

const assertCandidates = (scenario: Scenario, candidates: readonly Candidate[]): void => {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!scenario.candidateKinds.includes(candidate.kind)) {
      throw new Error(`Scenario ${scenario.id} does not take ${candidate.kind} candidates`);
    }
    for (const questionId of [candidate.id, conflictQuestionId(candidate.id)]) {
      if (seen.has(questionId)) {
        throw new Error(`Scenario ${scenario.id} has colliding candidate id ${candidate.id}`);
      }
      seen.add(questionId);
    }
  }
};

/** Named by what the parent is, so the wording can point at it without guessing. */
const PARENT_STATE_KEYS: Record<FocalParent['kind'], string> = {
  feature: 'parent_feature',
  plan: 'parent_plan',
};

const parentState = (parent: FocalParent | undefined): Record<string, Record<string, string>> =>
  parent
    ? { [PARENT_STATE_KEYS[parent.kind]]: { name: parent.name, description: parent.description } }
    : {};

/** What fills `{parent}` in an opening sentence: the work's parent, or that it has none. */
const parentSentence = (focal: Focal): string => {
  if (focal.kind === 'feature' || focal.kind === 'question') return '';
  const noun = FOCAL_NOUNS[focal.kind];
  switch (focal.parent?.kind) {
    case 'feature':
      return `The ${noun} sits under the feature described by state.parent_feature.description.`;
    case 'plan':
      return `The ${noun} is part of the plan described by state.parent_plan.description, which frames it.`;
    case undefined:
      return `The ${noun} has no parent feature or plan, so judge against the ${noun} and the ask alone.`;
  }
};

/** An opening sentence with its `{parent}` placeholder filled for this focal. */
export const openingFor = (template: string, focal: Focal): string =>
  template.replaceAll('{parent}', () => parentSentence(focal));

const focalState = (focal: Focal): Record<string, Record<string, string>> => {
  switch (focal.kind) {
    case 'task':
      return {
        task: {
          name: focal.name,
          description: focal.description,
          acceptance_criteria: focal.acceptanceCriteria,
        },
        ...parentState(focal.parent),
      };
    case 'feature':
      return { focal: { name: focal.name, description: focal.description } };
    case 'mockup':
      return {
        focal: { name: focal.name, description: focal.description },
        ...parentState(focal.parent),
      };
    case 'diagram':
      return {
        focal: { name: focal.name, description: focal.description },
        // Numbered so two elements with the same name stay separate entries.
        diagram_elements: Object.fromEntries(
          focal.elements.map((element, index) => [
            `${String(index + 1)}. ${element.name}`,
            element.description,
          ]),
        ),
        ...parentState(focal.parent),
      };
    case 'question':
      return { focal: { description: focal.text } };
  }
};

/** The state a request carries: the focal work plus candidate text grouped by kind. */
export const buildState = (
  scenario: Scenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording = DEFAULT_WORDING,
): EntryType => {
  assertCandidates(scenario, candidates);
  const state = focalState(focal);
  if (focal.kind !== 'question' && focal.ask?.trim()) state['ask'] = { text: focal.ask };
  if (scenario.id === 'edges')
    state['about'] = { text: openingFor(wording.edges.openingSentence[focal.kind], focal) };
  if (scenario.id === 'read_check') {
    state['about'] = { text: openingFor(wording.read_check.openingSentence[focal.kind], focal) };
  }
  for (const { kind, id, text } of candidates) {
    const { stateKey } = CANDIDATE_GROUPS[kind];
    state[stateKey] = { ...state[stateKey], [id]: text };
  }
  return state;
};

/**
 * One request, one question per candidate (id = candidate id). Relevance scenarios add a
 * conflict question per candidate under `conflictQuestionId`; the other scenarios ask one.
 */
export const buildQuestions = (
  scenario: Scenario,
  focal: Focal,
  candidates: readonly Candidate[],
  wording: Wording,
): Record<string, JevQuestion> => {
  assertCandidates(scenario, candidates);
  const focalNoun = FOCAL_NOUNS[focal.kind];
  const questions: Record<string, JevQuestion> = {};
  for (const candidate of candidates) {
    const { stateKey, noun } = CANDIDATE_GROUPS[candidate.kind];
    const subject = `the ${noun} under state.${stateKey}.${candidate.id}`;
    if (scenario.decision === 'relevance') {
      // assertCandidates already refused this; the check narrows the kind for the wording lookup.
      if (candidate.kind === 'entity') {
        throw new Error(`Scenario ${scenario.id} does not take entity candidates`);
      }
      const {
        openingSentence: opening,
        relevanceQuestion,
        criteria,
      } = wording[WORDING_SCENARIO_BY_KIND[candidate.kind]][focal.kind];
      questions[candidate.id] = {
        type: 'choice',
        instructions: `${openingFor(opening, focal)} ${relevanceQuestion
          .replace('{candidate}', () => subject)
          .replace('{focal}', () => focalNoun)}`,
        criteria: Object.fromEntries(
          Object.entries(criteria).map(([relationship, template]) => [
            relationship,
            template.replaceAll('{focal}', () => focalNoun).replaceAll('{candidate}', () => noun),
          ]),
        ),
      };
      questions[conflictQuestionId(candidate.id)] = {
        type: 'noul',
        instructions: `${openingFor(opening, focal)} ${CONFLICT_LEAD[focal.kind]} what ${subject} states?`,
      };
    } else if (scenario.decision === 'applies') {
      const { question, criteria } = wording.read_check;
      questions[candidate.id] = {
        type: 'choice',
        instructions: question
          .replace('{candidate}', () => subject)
          .replace('{focal}', () => focalNoun),
        criteria: Object.fromEntries(
          Object.entries(criteria).map(([answer, template]) => [
            answer,
            template.replaceAll('{focal}', () => focalNoun).replaceAll('{candidate}', () => noun),
          ]),
        ),
      };
    } else {
      const { readMoreQuestion, criteria } = wording.edges;
      questions[candidate.id] = {
        type: 'choice',
        instructions: readMoreQuestion
          .replace('{candidate}', () => subject)
          .replace('{focal}', () => focalNoun),
        criteria: Object.fromEntries(
          Object.entries(criteria).map(([relationship, template]) => [
            relationship,
            template.replaceAll('{focal}', () => focalNoun).replaceAll('{candidate}', () => noun),
          ]),
        ),
      };
    }
  }
  return questions;
};

/** Stable across key order, so consumers can cache responses by it. */
export const cacheKey = (
  state: EntryType,
  questions: Record<string, JevQuestion>,
  model: string,
): string =>
  createHash('sha256').update(canonicalizeJsonObject({ model, state, questions })).digest('hex');
