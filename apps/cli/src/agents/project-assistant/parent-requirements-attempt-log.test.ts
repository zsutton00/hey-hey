import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { JevInput, JevResult } from '../../jev/client';
import {
  writeAttemptRecord,
  type ParentRequirementsAttemptRecord,
} from './parent-requirements-attempt-log';

const input: JevInput = { model: 'jev-test', state: {}, questions: {} };
const succeeded = (inputTokens: number, outputTokens: number): JevResult => ({
  ok: true,
  model: 'jev-test',
  answers: {},
  usage: { inputTokens, outputTokens },
  durationMs: 5,
});
const failed: JevResult = { ok: false, failure: { code: 'TIMEOUT', message: 'slow' } };

describe('parent requirements attempt log', () => {
  let dir = '';
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('leads with the total Jev cost and tokens across all calls, ignoring failed calls', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'parent-log-'));
    const record: ParentRequirementsAttemptRecord = {
      at: '2026-11-05T00:00:00.000Z',
      focalEntityId: 'focal',
      parentFeatureId: 'parent',
      outcome: 'filtered',
      jevCalls: [
        { input, result: succeeded(10_000, 50) },
        { input, result: failed },
        { input, result: succeeded(20_000, 10) },
      ],
      fullLoad: 'full',
      filteredLoad: 'filtered',
    };

    const file = await writeAttemptRecord(dir, 'session-1', record);
    const logged = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

    expect(Object.keys(logged).slice(0, 5)).toEqual([
      'at',
      'sessionId',
      'costUsd',
      'inputTokens',
      'outputTokens',
    ]);
    expect(logged['inputTokens']).toBe(30_000);
    expect(logged['outputTokens']).toBe(60);
    expect(logged['costUsd']).toBeCloseTo(0.00126, 8);
  });
});
