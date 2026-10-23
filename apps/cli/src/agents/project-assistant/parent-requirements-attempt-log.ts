import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { JevInput, JevResult } from '../../jev/client';
import type { JevEvaluator } from '../../jev/scenarios';

/** One Jev round trip, exactly as sent and received. */
export interface RecordedJevCall {
  input: JevInput;
  result: JevResult;
}

/** Wraps an evaluator so the attempt log can hold every full request and response. */
export const recordJevCalls = (
  client: JevEvaluator,
): { evaluator: JevEvaluator; calls: RecordedJevCall[] } => {
  const calls: RecordedJevCall[] = [];
  return {
    calls,
    evaluator: {
      evaluate: async (input) => {
        const result = await client.evaluate(input);
        calls.push({ input, result });
        return result;
      },
    },
  };
};

/**
 * Everything one filtered-load attempt saw and decided, including entity text. It is written
 * to a local file for learning how the filter behaves, never to the structured logger.
 */
export interface ParentRequirementsAttemptRecord {
  at: string;
  focalEntityId: string;
  parentFeatureId: string;
  outcome: 'filtered' | 'unfiltered';
  unfilteredReason?: string;
  unfilteredFields?: Record<string, unknown>;
  error?: string;
  jevCalls: RecordedJevCall[];
  /** The full load Project Assistant gets without the filter. */
  fullLoad: string;
  /** The load it gets with the filter; absent when the attempt fell back. */
  filteredLoad?: string;
}

export const writeAttemptRecord = async (
  dir: string,
  record: ParentRequirementsAttemptRecord,
): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const stamp = record.at.replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${record.focalEntityId}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
};
