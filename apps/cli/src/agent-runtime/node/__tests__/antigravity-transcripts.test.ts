/** @vitest-environment node */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../../../agents/providers/agent-event-redaction';
import { SCENARIOS } from '../../../scripts/antigravity-capture-scenarios';

const FIXTURE_DIR = join(process.cwd(), 'src/agent-runtime/node/__fixtures__/antigravity');
const PRINT_READS = ['models', 'skills', 'quota'] as const;
const PRINT_BATCHES: Record<string, readonly string[]> = {
  'quota-before': ['quota'],
  'quota-after': ['quota'],
  models: ['models', 'skills'],
  'signed-out': ['models', 'skills', 'quota'],
};
const DIRECTIONS = ['client->agent', 'agent->client', 'driver', 'hook'];

const fixtureFiles = readdirSync(FIXTURE_DIR);
const read = (name: string): string => readFileSync(join(FIXTURE_DIR, name), 'utf8');
const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(read(name)) as Record<string, unknown>;
const ndjsonLines = (name: string): string[] =>
  read(name)
    .split('\n')
    .filter((line) => line.trim().length > 0);

const SECRET_PATTERNS: Record<string, RegExp> = {
  'bearer token': /\bBearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/i,
  'JWT-shaped token': /\beyJ[A-Za-z0-9_-]{8,}/,
  'Authorization value': /"authorization"\s*:\s*"(?!\[REDACTED\])/i,
  'Authorization header pair':
    /"name"\s*:\s*"authorization"\s*,\s*"value"\s*:\s*"(?!\[REDACTED\])/i,
  'email address': /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
  'home directory': /\/(?:Users|home)\/(?!<user>)[^/\s"'\\]+/,
  'OAuth parameter': /[?&](?:state|code|code_challenge|client_id)=(?!\[REDACTED\])[^&\s"'\\]+/,
  'provider API key':
    /\b(?:ya29\.[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/,
};

describe('Antigravity captured transcripts', () => {
  describe.each(SCENARIOS)('ACP scenario %s', (scenario) => {
    it('has a transcript whose lines are direction-marked JSON-RPC frames', () => {
      expect(fixtureFiles).toContain(`${scenario}.ndjson`);

      const lines = ndjsonLines(`${scenario}.ndjson`);
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        const entry = JSON.parse(line) as { direction: string; frame: Record<string, unknown> };
        expect(DIRECTIONS).toContain(entry.direction);
        if (entry.direction === 'hook') {
          expect(scenario).toBe('hook-relay');
          expect(entry.frame).toMatchObject({
            ts: expect.any(String),
            payload: expect.any(Object),
          });
        }
        if (entry.direction === 'client->agent' || entry.direction === 'agent->client') {
          expect(entry.frame['jsonrpc']).toBe('2.0');
        }
      }
    });

    it('has a metadata sidecar recording the observed agy version', () => {
      const meta = readJson(`${scenario}.meta.json`) as {
        scenario: string;
        agyVersion: { output: string; exitCode: number };
      };

      expect(meta.scenario).toBe(scenario);
      expect(meta.agyVersion.exitCode).toBe(0);
      expect(meta.agyVersion.output).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe.each(Object.entries(PRINT_BATCHES))('print snapshot %s', (label, reads) => {
    it('has a record for exactly the reads its sidecar says were run', () => {
      const meta = readJson(`${label}.meta.json`) as {
        agyVersion: { stdout: string };
        outcomes: Record<string, { file: string; exitCode: number }>;
      };
      expect(meta.agyVersion.stdout).toMatch(/\d+\.\d+\.\d+/);
      expect(Object.keys(meta.outcomes).sort()).toEqual([...reads].sort());

      for (const readName of reads) {
        const file = `${label}-${readName}.json`;
        expect(fixtureFiles).toContain(file);

        const record = readJson(file);
        expect(record['read']).toBe(readName);
        expect(record['label']).toBe(label);
        expect(record).toHaveProperty('stdout');
        expect(record).toHaveProperty('stderr');
        expect(record['exitCode']).toBe(meta.outcomes[readName]?.exitCode);
      }
    });
  });

  it('captures the quota snapshots around the original scenario batch', () => {
    // The hook relay was captured separately the following day.
    const times = SCENARIOS.filter((scenario) => scenario !== 'hook-relay').map((scenario) => {
      const meta = readJson(`${scenario}.meta.json`) as { startedAt: string; finishedAt: string };
      return { start: Date.parse(meta.startedAt), finish: Date.parse(meta.finishedAt) };
    });
    const before = Date.parse(readJson('quota-before-quota.json')['capturedAt'] as string);
    const after = Date.parse(readJson('quota-after-quota.json')['capturedAt'] as string);

    expect(before).toBeLessThan(Math.min(...times.map((t) => t.start)));
    expect(after).toBeGreaterThan(Math.max(...times.map((t) => t.finish)));
  });

  it('covers quota before and after, and signed-out reads that failed to authenticate', () => {
    expect(fixtureFiles).toContain('quota-before-quota.json');
    expect(fixtureFiles).toContain('quota-after-quota.json');

    for (const name of PRINT_READS.map((r) => `signed-out-${r}.json`)) {
      const record = readJson(name) as { signedOut: boolean; exitCode: number };
      expect(record.signedOut).toBe(true);
      expect(record.exitCode).not.toBe(0);
    }
  });

  describe('redaction', () => {
    const captured = fixtureFiles.filter(
      (name) => name.endsWith('.json') || name.endsWith('.ndjson'),
    );

    it.each(Object.entries(SECRET_PATTERNS))('contains no %s in any file', (_label, pattern) => {
      const offenders = captured.filter((name) => pattern.test(read(name)));
      expect(offenders).toEqual([]);
    });
  });

  describe('credential guard', () => {
    const SYNTHETIC_KEYS = [
      `AIza${'a1B2c3D4e5'.repeat(4)}`,
      `ya29.${'a1B2c3D4e5'.repeat(3)}`,
      `sk-${'a1B2c3D4e5'.repeat(3)}`,
      `ghp_${'a1B2c3D4e5'.repeat(4)}`,
    ];

    it.each(SYNTHETIC_KEYS)('detects an unredacted key and accepts it once redacted: %s', (key) => {
      const text = `{"stdout":"key is ${key} here"}`;

      expect(SECRET_PATTERNS['provider API key']?.test(text)).toBe(true);
      expect(SECRET_PATTERNS['provider API key']?.test(redactSensitiveText(text))).toBe(false);
    });
  });
});
