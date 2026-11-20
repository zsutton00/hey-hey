/** @vitest-environment node */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../../scripts/antigravity-capture-scenarios';

const FIXTURE_DIR = join(process.cwd(), 'src/agent-runtime/node/__fixtures__/antigravity');
const PRINT_READS = ['models', 'skills', 'quota'] as const;
const PRINT_LABELS = ['quota-before', 'quota-after', 'models', 'signed-out'] as const;
const DIRECTIONS = ['client->agent', 'agent->client', 'driver'];

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
    /(?:ya29\.[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/,
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
        if (entry.direction !== 'driver') {
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

  describe.each(PRINT_LABELS)('print snapshot %s', (label) => {
    it('has a metadata sidecar and a parseable record for every read it ran', () => {
      const meta = readJson(`${label}.meta.json`) as { agyVersion: { stdout: string } };
      expect(meta.agyVersion.stdout).toMatch(/\d+\.\d+\.\d+/);

      const records = fixtureFiles.filter(
        (name) => name.startsWith(`${label}-`) && name.endsWith('.json'),
      );
      expect(records.length).toBeGreaterThan(0);

      for (const name of records) {
        const record = readJson(name);
        expect(PRINT_READS).toContain(record['read']);
        expect(record['label']).toBe(label);
        expect(record).toHaveProperty('stdout');
        expect(record).toHaveProperty('stderr');
        expect(typeof record['exitCode']).toBe('number');
      }
    });
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
});
