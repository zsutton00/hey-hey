import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Focal, Tier } from '../../jev/scenarios';
import type { RecordedJevCall } from '../project-assistant/parent-requirements-attempt-log';

/** Jev's price per million tokens in USD: input is billed, output is free (structured decisions). */
export const JEV_INPUT_USD_PER_MTOK = 0.042;
export const JEV_OUTPUT_USD_PER_MTOK = 0;

export const jevCostUsd = (usage: { inputTokens: number; outputTokens: number }): number =>
  (usage.inputTokens * JEV_INPUT_USD_PER_MTOK + usage.outputTokens * JEV_OUTPUT_USD_PER_MTOK) /
  1_000_000;

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
export interface GetContextAttemptRecord {
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

/** Writes one file per call; the random suffix keeps concurrent or repeated calls apart. */
export const writeGetContextAttemptRecord = async (
  dir: string,
  record: GetContextAttemptRecord,
): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const stamp = record.at.replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${record.focalEntityId}-${randomUUID()}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
};
