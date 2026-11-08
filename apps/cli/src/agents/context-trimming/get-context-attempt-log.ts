import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Focal, Tier } from '../../jev/scenarios';
import type { RecordedJevCall } from '../project-assistant/parent-requirements-attempt-log';

/** One entry of the narrowed result and how it was decided. */
export interface GetContextEntryRecord {
  section: string;
  position: number;
  tier: Tier;
  /** Jev's relevance for the entry; absent when the graph kept it in full without asking. */
  relevance?: number;
  judgedByDecisionModel: boolean;
  /** What Jev was shown for a judged entry, or the entry itself when it was kept without asking. */
  text: string;
}

/**
 * Everything one narrowed `get_context` call saw and decided, including entity text. It is
 * written to a local development file to compare runs, never to the structured logger. Sizes
 * are characters of the result text, not tokens.
 */
export interface GetContextNarrowedRecord {
  outcome: 'narrowed';
  at: string;
  /** Total Jev cost of this call in USD, from the token counts and the rates above. */
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  focalEntityId: string;
  focal: Focal;
  model: string;
  jevCalls: RecordedJevCall[];
  rawResultChars: number;
  narrowedResultChars: number;
  tierCounts: Record<Tier, number>;
  decisionModelDurationMs: number;
  entries: GetContextEntryRecord[];
}

/** A `get_context` call returned as the platform sent it, and why. */
export interface GetContextPassedThroughRecord {
  outcome: 'passed_through';
  at: string;
  focalEntityId: string;
  focal: Focal;
  model: string;
  reason: string;
  fields: Record<string, unknown>;
  /** Empty when the call gave up before asking Jev. */
  jevCalls: RecordedJevCall[];
}

/** A Turn whose `get_context` results are never narrowed, and why. Written once per Turn. */
export interface GetContextNotStartedRecord {
  outcome: 'not_started';
  at: string;
  promptType: string;
  focalEntityId: string | null;
  reason: string;
  fields: Record<string, unknown>;
}

export type GetContextAttemptRecord =
  | GetContextNarrowedRecord
  | GetContextPassedThroughRecord
  | GetContextNotStartedRecord;

/** One edge of the narrowed `get_edges` result and how it was decided. */
export interface GetEdgesEntryRecord {
  seedId: string;
  position: number;
  tier: Tier;
  /** Jev's relevance for the edge; absent when an edge of the focal work or an ancestor was kept without asking. */
  relevance?: number;
  judgedByDecisionModel: boolean;
  /** What Jev was shown for a judged edge, or the edge itself when it was kept without asking. */
  text: string;
}

/**
 * Everything one narrowed `get_edges` call saw and decided, including entity text, written to a
 * local development file like the `get_context` record. Sizes are characters of the result JSON.
 */
export interface GetEdgesNarrowedRecord {
  outcome: 'narrowed';
  at: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  focalEntityId: string;
  focal: Focal;
  model: string;
  jevCalls: RecordedJevCall[];
  rawResultChars: number;
  narrowedResultChars: number;
  tierCounts: Record<Tier, number>;
  decisionModelDurationMs: number;
  entries: GetEdgesEntryRecord[];
  /** The result the agent would get without narrowing. */
  rawResult: string;
  /** The result the agent got. */
  narrowedResult: string;
}

/** A `get_edges` call returned as the platform sent it, and why. */
export interface GetEdgesPassedThroughRecord {
  outcome: 'passed_through';
  at: string;
  focalEntityId: string;
  focal: Focal;
  model: string;
  reason: string;
  fields: Record<string, unknown>;
  /** Empty when the call gave up before asking Jev. */
  jevCalls: RecordedJevCall[];
}

export type GetEdgesAttemptRecord = GetEdgesNarrowedRecord | GetEdgesPassedThroughRecord;

/** Writes one file per call or Turn; the random suffix keeps concurrent or repeated ones apart. */
export const writeGraphResultAttemptRecord = async (
  dir: string,
  record: GetContextAttemptRecord | GetEdgesAttemptRecord,
): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const stamp = record.at.replace(/[:.]/g, '-');
  const subject = record.focalEntityId ?? 'no-focal';
  const file = path.join(dir, `${stamp}-${record.outcome}-${subject}-${randomUUID()}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
};
