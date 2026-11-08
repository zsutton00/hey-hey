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

/** Writes one file per call or Turn; the random suffix keeps concurrent or repeated ones apart. */
export const writeGetContextAttemptRecord = async (
  dir: string,
  record: GetContextAttemptRecord,
): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const stamp = record.at.replace(/[:.]/g, '-');
  const subject = record.focalEntityId ?? 'no-focal';
  const file = path.join(dir, `${stamp}-${record.outcome}-${subject}-${randomUUID()}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
};
