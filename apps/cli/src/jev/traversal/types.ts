import type { Candidate } from '../scenarios';
import type { JevResult } from '../client';

/** An entity the walk can read: its kind (task, feature, design_doc, ...) and its id. */
export interface EntityRef {
  id: string;
  kind: string;
}

/** An entity named with its title, as search hits and candidates are. */
export interface TitledRef extends EntityRef {
  title: string;
}

/** A candidate with the entity behind it, which the reader needs to load it. */
export interface FoundCandidate {
  candidate: Candidate;
  ref: TitledRef;
}

/** An entity read in full. */
export interface LoadedEntity extends TitledRef {
  text: string;
}

/**
 * How the Read check and Edges evaluations reach the graph, so one judgment serves live reads and a
 * saved snapshot. Both calls reject when the entity cannot be read.
 */
export interface GraphReader {
  read(id: string): Promise<LoadedEntity>;
  /** The entity's edges (`linked`) and the entities it mentions (`mentioned`), without duplicates. */
  candidates(id: string): Promise<FoundCandidate[]>;
}

export type JevFailure = Extract<JevResult, { ok: false }>['failure'];

export interface WalkUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}
