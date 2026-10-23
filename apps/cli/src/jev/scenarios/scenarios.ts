/**
 * Every scenario asks Jev the same question — which of these items is relevant to this
 * work? — and differs only in the candidates it feeds in. A scenario is data; the pure
 * builders in `state.ts` turn it into the Jev request.
 */

export const FOCAL_KINDS = ['task', 'feature', 'mockup', 'diagram', 'question'] as const;
export type FocalKind = (typeof FOCAL_KINDS)[number];

/** A Diagram Element, judged as part of the Diagram it belongs to. */
export interface DiagramElementText {
  name: string;
  description: string;
}

/**
 * What frames the work: the feature directly above it, or the plan a planned task belongs to.
 * Extra context Jev judges against, never a precondition for judging.
 */
export interface FocalParent {
  kind: 'feature' | 'plan';
  name: string;
  description: string;
}

type WorkFocal =
  | {
      kind: 'task';
      name: string;
      description: string;
      acceptanceCriteria: string;
      parent?: FocalParent;
    }
  | { kind: 'feature'; name: string; description: string }
  | {
      kind: 'mockup';
      name: string;
      description: string;
      parent?: FocalParent;
    }
  | {
      kind: 'diagram';
      name: string;
      description: string;
      /** The elements carry most of what a Diagram covers, so Jev reads them with it. */
      elements: readonly DiagramElementText[];
      parent?: FocalParent;
    };

/**
 * What Jev judges against. Work carries the user's ask, sent as its own section of the state;
 * a question already is the user's words.
 */
export type Focal = (WorkFocal & { ask?: string }) | { kind: 'question'; text: string };

export type CandidateKind =
  | 'requirement'
  | 'ancestor'
  | 'ancestor_sibling'
  | 'sibling'
  | 'child'
  | 'linked'
  | 'mentioned'
  | 'hint'
  /** An active project Decision, read in full. */
  | 'decision'
  /** An entity read in full, judged by the read check. */
  | 'entity';

export interface Candidate {
  /** Unique across the request; becomes both the state key and the question id. */
  id: string;
  kind: CandidateKind;
  text: string;
}

export const RELATIONSHIPS = ['implements', 'informs', 'same_feature_unrelated', 'other'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/**
 * What a linked or cited item is to the work, as far as the line shown can tell. The first
 * five suggest reading it in full, `possibly_connected` included because a missed read costs more
 * than a wasted one; `unrelated` and `other` do not.
 */
export const EDGE_RELATIONSHIPS = [
  'governs',
  'defines',
  'supplies',
  'reports_problem',
  'possibly_connected',
  'unrelated',
  'other',
] as const;
export type EdgeRelationship = (typeof EDGE_RELATIONSHIPS)[number];

/** The edge relationships that count toward reading the candidate in full. */
export const READ_RELATIONSHIPS = EDGE_RELATIONSHIPS.slice(0, 5);

interface ScenarioBase {
  candidateKinds: readonly CandidateKind[];
}

export interface RelevanceScenario extends ScenarioBase {
  id: 'parent_requirements' | 'neighbourhood' | 'hint_selection' | 'decision_selection';
  decision: 'relevance';
}

export interface ReadMoreScenario extends ScenarioBase {
  id: 'edges';
  decision: 'read_more';
}

/** Whether an entity already read in full applies to the work and the user's ask. */
export interface ReadCheckScenario extends ScenarioBase {
  id: 'read_check';
  decision: 'applies';
}

export type Scenario = RelevanceScenario | ReadMoreScenario | ReadCheckScenario;

export const PARENT_REQUIREMENTS: RelevanceScenario = {
  id: 'parent_requirements',
  decision: 'relevance',
  candidateKinds: ['requirement'],
};

export const NEIGHBOURHOOD: RelevanceScenario = {
  id: 'neighbourhood',
  decision: 'relevance',
  candidateKinds: ['ancestor', 'ancestor_sibling', 'sibling', 'child'],
};

export const EDGES: ReadMoreScenario = {
  id: 'edges',
  decision: 'read_more',
  candidateKinds: ['linked', 'mentioned'],
};

/**
 * The neighbourhood question asked of every kind of candidate in one request: the layout
 * the harness measures as its baseline and context trimming runs.
 */
export const CONTEXT_SELECTION: RelevanceScenario = {
  ...NEIGHBOURHOOD,
  candidateKinds: ['requirement', 'ancestor', 'ancestor_sibling', 'sibling', 'child', 'linked'],
};

/**
 * Which implementation hints apply to the work. Measured by the harness only; no production
 * path selects hints with Jev yet.
 */
export const HINT_SELECTION: RelevanceScenario = {
  id: 'hint_selection',
  decision: 'relevance',
  candidateKinds: ['hint'],
};

/**
 * Which of the project's Decisions apply to the work and the user's ask. Measured by the
 * harness only; no production path selects Decisions with Jev yet.
 */
export const DECISION_SELECTION: RelevanceScenario = {
  id: 'decision_selection',
  decision: 'relevance',
  candidateKinds: ['decision'],
};

export const READ_CHECK: ReadCheckScenario = {
  id: 'read_check',
  decision: 'applies',
  candidateKinds: ['entity'],
};

export const SCENARIOS = [
  PARENT_REQUIREMENTS,
  NEIGHBOURHOOD,
  EDGES,
  HINT_SELECTION,
  DECISION_SELECTION,
  READ_CHECK,
] as const;
