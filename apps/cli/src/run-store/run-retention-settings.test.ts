/** @vitest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RUN_RETENTION_DAYS, RunRetentionSettingsStore } from './run-retention-settings';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))));

describe('RunRetentionSettingsStore', () => {
  it('defaults to 30 days and preserves unrelated preferences when changed', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-settings-'));
    directories.push(baseDir);
    const store = new RunRetentionSettingsStore(baseDir);
    await expect(store.load()).resolves.toEqual({ enabled: true, days: DEFAULT_RUN_RETENTION_DAYS });
    await fs.writeFile(path.join(baseDir, 'preferences.json'), JSON.stringify({ providerPreference: 'codex' }));
    await store.set({ enabled: false });
    expect(JSON.parse(await fs.readFile(path.join(baseDir, 'preferences.json'), 'utf8'))).toEqual({
      providerPreference: 'codex',
      runRetention: { enabled: false },
    });
  });

  it('rejects non-positive periods', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-settings-invalid-'));
    directories.push(baseDir);
    const store = new RunRetentionSettingsStore(baseDir);
    await expect(store.set({ enabled: true, days: 0 })).rejects.toThrow('invalid');
  });
});
