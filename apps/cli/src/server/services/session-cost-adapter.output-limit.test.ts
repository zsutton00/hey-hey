import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCcusageSessionJsonReader, SessionCostAdapter } from './session-cost-adapter';

describe('local cost report output limit', () => {
  it.each([17, 65])(
    'handles a %i MiB report while retaining a bounded local output limit',
    async (sizeMiB) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'context-cost-report-'));
      const launcher = path.join(directory, 'cost-fixture.cjs');
      try {
        await writeFile(
          launcher,
          `process.stdout.write(JSON.stringify({
        sessions: [{ sessionId: 'selected', costUSD: 2.5 }],
        padding: ' '.repeat(${sizeMiB} * 1024 * 1024)
      }));`,
        );
        const adapter = new SessionCostAdapter(createCcusageSessionJsonReader(() => launcher));
        const result = await adapter.read({ providerId: 'codex', providerSessionId: 'selected' });
        if (sizeMiB > 64) {
          expect(result).toMatchObject({ state: 'unavailable', reason: 'cost_source_unavailable' });
          return;
        }
        expect(result).toEqual({
          state: 'available',
          amountUsd: 2.5,
          currency: 'USD',
          source: 'ccusage',
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
