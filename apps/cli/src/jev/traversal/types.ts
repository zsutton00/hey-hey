import type { UnifiedEmbeddingsSearchResult } from '../../shared/api/generated';
import type { ExcerptMetadata } from './excerpt';
import type { JevEvaluator, Candidate, Focal, Wording } from '../scenarios';
import type { JevResult } from '../client';
import type { ExpansionFailure, HopStep } from '../trace';

/** An entity the walk can read: its kind (task, feature, design_doc, ...) and its id. */
export interface EntityRef {
  id: string;
  kind: string;
}

/** An entity named with its title, as search hits and candidates are. */
export interface TitledRef extends EntityRef {
  title: string;
  matchSpans?: UnifiedEmbeddingsSearchResult['matchSpans'];
  indexedText?: string;
}

/** A candidate with the entity behind it, which the reader needs to load it. */
export interface FoundCandidate {
  candidate: Candidate;
  ref: TitledRef;
}

/** An entity read in full. */
export interface LoadedEntity extends TitledRef {
  text: string;
  excerpt?: ExcerptMetadata;
}

/**
 * The only way the walk reaches the graph, so one walk serves live reads and a saved snapshot.
 * Both calls reject when the entity cannot be read; the walk does not hide that.
 */
export interface GraphReader {
  read(id: string): Promise<LoadedEntity>;
  /** The entity's edges (`linked`) and the entities it mentions (`mentioned`), without duplicates. */
  candidates(id: string): Promise<FoundCandidate[]>;
}

/** What one level may take: at most `max` candidates, each scoring at least `minScore`. */
export interface LevelLimit {
  max: number;
  /** Probability that reading the candidate in full is worth it. The first level uses 0. */
  minScore: number;
}

export interface WalkJev {
  client: JevEvaluator;
  model: string;
  wording: Wording;
}

export interface WalkInput {
  focalId: string;
  focal: Focal;
  /** What the user asked, judged against at every level alongside the focal. */
  ask: string;
  reader: GraphReader;
  /**
   * Entities already read and kept before the walk, such as kept search results. They are not
   * judged again; their candidates join the focal's in the first frontier.
   */
  seedIds?: readonly string[];
  hits?: ReadonlyMap<string, TitledRef>;
  jev: WalkJev;
  limits: readonly LevelLimit[];
  /** Cancels the walk's Jev requests; the walk then rejects rather than recording a failure. */
  signal?: AbortSignal;
}

/** An entity the walk read and Jev kept. */
export interface WalkedEntity extends LoadedEntity {
  /** 1 for the focal's own neighbours. */
  level: number;
  /** Score before reading: probability that reading it in full was worth it. */
  readMore: number;
}

export interface WalkUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export type JevFailure = Extract<JevResult, { ok: false }>['failure'];

/** Something that went wrong in a level; the walk carried on with what it had. */
export type WalkFailure =
  /** A scoring failure ends the walk at that level; a keep failure kept every entity in `ids`. */
  | { kind: 'jev'; level: number; step: 'score' | 'keep'; ids: string[]; failure: JevFailure }
  /** The entity could not be read and was skipped. */
  | { kind: 'read'; level: number; id: string; error: string };

/** What one level did, by entity id so counts can be taken once per entity across levels. */
export interface WalkLevel {
  level: number;
  /** Candidates not yet read when the level began. */
  surfaced: string[];
  /** Candidates read successfully. */
  opened: string[];
  kept: string[];
  elapsedMs: number;
  /** Jev requests this level made. */
  usage: WalkUsage;
}

/** Always what the walk gathered, however it ended. */
export interface WalkResult {
  entities: WalkedEntity[];
  levels: WalkLevel[];
  failures: WalkFailure[];
  usage: WalkUsage;
  /** Each hop as it happened, for the run's trace. */
  hops: HopStep[];
  /** Entities whose edges could not be read, so their neighbours were never considered. */
  expansionFailures: ExpansionFailure[];
}
