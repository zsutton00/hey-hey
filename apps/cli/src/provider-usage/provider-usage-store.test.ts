import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderUsageStore } from './provider-usage-store';
import { unreportedUsage, type ProviderUsage } from './provider-usage';
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-usage-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
const reading = (observedAt = '2026-10-11T00:00:00.000Z'): ProviderUsage => ({
  ...unreportedUsage('codex'),
  observedAt,
  fiveHour: { usedPercent: 0, resetsAt: null },
});
it('retains readings across restart and concurrent owners while rejecting stale reports', async () => {
  const first = new ProviderUsageStore(root);
  const second = new ProviderUsageStore(root);
  await Promise.all([first.save(reading()), second.save(reading('2026-10-10T00:00:00.000Z'))]);
  expect(await new ProviderUsageStore(root).read('codex')).toEqual({
    status: 'reported',
    usage: reading(),
  });
  await first.save(reading());
  expect((await first.read('opencode')).status).toBe('unreported');
});
it('preserves corrupt durable data and isolates its failure from other providers', async () => {
  await fs.mkdir(path.join(root, 'provider-usage'));
  const corrupt = path.join(root, 'provider-usage', 'codex.json');
  await fs.writeFile(corrupt, '{broken');
  const store = new ProviderUsageStore(root);
  expect((await store.read('codex')).status).toBe('storage_failure');
  await expect(store.save(reading())).rejects.toThrow();
  await store.save({ ...reading(), provider: 'opencode' });
  expect((await store.read('opencode')).status).toBe('reported');
  expect(await fs.readFile(corrupt, 'utf8')).toBe('{broken');
  await fs.rm(corrupt);
  await store.save(reading());
  expect((await store.read('codex')).status).toBe('reported');
});
it('recovers the write queue after failed atomic replacement without losing the last reading', async () => {
  const store = new ProviderUsageStore(root);
  await store.save(reading());
  const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'));
  await expect(store.save(reading('2026-10-12T00:00:00.000Z'))).rejects.toThrow('disk failure');
  expect(await store.read('codex')).toEqual({ status: 'reported', usage: reading() });
  rename.mockRestore();
  await store.save(reading('2026-10-13T00:00:00.000Z'));
  await store.flush();
  expect((await store.read('codex')).status).toBe('reported');
  expect(await fs.readdir(path.join(root, 'provider-usage'))).toEqual(['codex.json']);
});
it('separates data roots and resolves the active profile directory', async () => {
  const first = new ProviderUsageStore(path.join(root, 'first'));
  const second = new ProviderUsageStore(path.join(root, 'second'));
  await first.save(reading());
  expect((await second.read('codex')).status).toBe('unreported');
  vi.stubEnv('HEYHEY_SESSION_DIR', root);
  await new ProviderUsageStore().save(reading());
  expect((await new ProviderUsageStore(root).read('codex')).status).toBe('reported');
});
it('distinguishes an unreadable record from never-reported data', async () => {
  await fs.mkdir(path.join(root, 'provider-usage', 'codex.json'), { recursive: true });
  const store = new ProviderUsageStore(root);
  expect((await store.read('codex')).status).toBe('storage_failure');
  expect((await store.read('opencode')).status).toBe('unreported');
});
it('reads every stored provider while isolating an unreadable snapshot and ignoring Claude', async () => {
  const store = new ProviderUsageStore(root);
  await store.save(reading());
  await fs.mkdir(path.join(root, 'provider-usage', 'opencode.json'), { recursive: true });
  await fs.writeFile(path.join(root, 'provider-usage', 'claude.json'), '{}');

  const readings = await store.readAll();

  expect(readings).toEqual([
    { status: 'reported', usage: reading() },
    { status: 'storage_failure', provider: 'opencode' },
  ]);
});
