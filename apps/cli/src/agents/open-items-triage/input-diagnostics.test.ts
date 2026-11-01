import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from '../../server/logger';
import { TriageInputDiagnostics } from './input-diagnostics';

afterEach(() => vi.restoreAllMocks());

describe('triage diagnostic files', () => {
  const metadata = {
    runId: 'test-run',
    projectId: 'test-project',
    requestKind: 'freshPass',
    mode: 'tidyUp',
  };

  it('captures all fetched types before filtering, without headers, in unique private files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'triage-diagnostics-'));
    try {
      const diagnostics = new TriageInputDiagnostics();
      const data = { events: [{ entityType: 'TASK' }, { entityType: 'AGENT_SESSION' }, null] };
      diagnostics.record('https://api.example/analytics/attention?offset=0&limit=50', 200, data);
      const writing = diagnostics.write(metadata, null, NOOP_LOGGER, directory);
      data.events.push({ entityType: 'PROPOSAL' });
      await writing;
      await diagnostics.write(metadata, null, NOOP_LOGGER, directory);
      const files = await readdir(directory);
      expect(files).toHaveLength(2);
      const dumps = await Promise.all(
        files.map(async (file) => {
          const path = join(directory, file);
          expect((await stat(path)).mode & 0o777).toBe(0o600);
          return JSON.parse(await readFile(path, 'utf8'));
        }),
      );
      expect(dumps.map((dump) => dump.reads[0].data.events.length).sort()).toEqual([3, 4]);
      expect(dumps[0]).toMatchObject({
        ...metadata,
        outcome: 'input_failed',
        input: null,
        reads: [{ path: '/analytics/attention', query: '?offset=0&limit=50', status: 200 }],
      });
      expect(dumps[0].reads[0]).not.toHaveProperty('headers');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('warns without rejecting when the destination cannot be written', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'triage-diagnostics-'));
    try {
      const file = join(directory, 'not-a-directory');
      await writeFile(file, '');
      const warn = vi.spyOn(NOOP_LOGGER, 'warn');
      await expect(
        new TriageInputDiagnostics().write(metadata, null, NOOP_LOGGER, file),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('open_items_triage.input.dump_failed', metadata);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
