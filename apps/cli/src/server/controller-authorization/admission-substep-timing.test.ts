import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyPairStore } from '../../credentials';
import type { PlatformStore } from '../../credentials/platforms/types';
import { StructuredServerLogger } from '../logger';
import { AuthorizationReplayStore } from './authorization-replay-store';
import { ExecutionGrantStore } from './execution-grant-store';
import { CURRENT_AGENT_OPERATIONS } from './types';

const SLOW_MS = 60;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const grantInput = {
  grantId: 'grant-1',
  descriptor: {
    scope: 'controller_device_window' as const,
    controllerCredentialId: 'credential-1',
    controllerInstallationId: 'installation-1',
    machineId: 'machine-1',
    userId: 'user-1',
    organizationId: 'organization-1',
    cadence: 'FIVE_MINUTES' as const,
    policyRevision: 4,
    allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
    allowedActionCategories: new Set(['TASK_MONITOR' as const, 'CLI_READ' as const]),
    issuedAtMs: 1_700_000_000_000,
    effectiveExpiresAtMs: 1_700_000_300_000,
  },
  descriptorHash: 'b'.repeat(64),
  controllerCredentialFingerprint: `sha256:${'c'.repeat(64)}`,
};
const admitInput = {
  grantId: 'grant-1',
  machineId: 'machine-1',
  userId: 'user-1',
  organizationId: 'organization-1',
  actionType: 'TASK_MONITOR_START' as const,
  actionCategory: 'TASK_MONITOR' as const,
};

const memoryPlatformStore = (retrieveDelayMs = 0): PlatformStore => {
  const data = new Map<string, string>();
  return {
    name: 'memory',
    isAvailable: () => Promise.resolve(true),
    retrieve: async (key) => {
      await sleep(retrieveDelayMs);
      return data.get(key) ?? null;
    },
    store: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
};

const harness = async (retrieveDelayMs = 0) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-substep-timing-'));
  const keyPairStore = new KeyPairStore({
    namespaceOverride: 'test/',
    platformStoreOverride: memoryPlatformStore(retrieveDelayMs),
  });
  const entries: { event: string; fields: Record<string, unknown> }[] = [];
  const lines: string[] = [];
  const logger = new StructuredServerLogger({
    minLevel: 'debug',
    writeLine: (line) => lines.push(line),
  });
  const debug = logger.debug.bind(logger);
  vi.spyOn(logger, 'debug').mockImplementation((event, fields) => {
    entries.push({ event, fields: fields ?? {} });
    debug(event, fields);
  });
  const options = { directory, keyPairStore, logger, now: () => 1_700_000_000_000 };
  return {
    directory,
    grants: new ExecutionGrantStore(options),
    replay: new AuthorizationReplayStore(options),
    entries,
    lines,
    last: (event: string) => entries.filter((entry) => entry.event === event).at(-1)?.fields ?? {},
  };
};

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('admission storage substep attribution', () => {
  it('attributes a slow cold protected-key retrieval to the integrity key, not file I/O', async () => {
    const h = await harness(SLOW_MS);
    directories.push(h.directory);
    await h.grants.create(grantInput);
    const created = h.last('trigger-admission.execution-grant-store.storage.completed');
    expect(created['integrityKeySource']).toBe('created');
    expect(created['protectedKeyRetrieveMs']).toBeGreaterThanOrEqual(SLOW_MS - 5);
    expect(created['integrityKeyMs']).toBeGreaterThanOrEqual(SLOW_MS - 5);
    expect(created['fileReadMs']).toBeLessThan(SLOW_MS);

    await h.grants.admit(admitInput);
    const warm = h.last('trigger-admission.execution-grant-store.storage.completed');
    expect(warm['integrityKeySource']).toBe('shared');
    expect(warm['integrityKeyMs']).toBeLessThan(SLOW_MS);
    expect(warm['recordCount']).toBe(1);
  });

  it('attributes a slow grant file read to fileReadMs', async () => {
    const h = await harness();
    directories.push(h.directory);
    await h.grants.create(grantInput);
    const readFile = fs.readFile;
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof readFile>) => {
      await sleep(SLOW_MS);
      return readFile(...args);
    });
    await h.grants.admit(admitInput);
    const fields = h.last('trigger-admission.execution-grant-store.storage.completed');
    expect(fields['fileReadMs']).toBeGreaterThanOrEqual(SLOW_MS - 5);
    expect(fields['validationMs']).toBeLessThan(SLOW_MS);
    expect(fields['persistMs']).toBeLessThan(SLOW_MS);
  });

  it('attributes slow atomic replay persistence to persistMs and keeps the replay outcome', async () => {
    const h = await harness();
    directories.push(h.directory);
    const writeFile = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof writeFile>) => {
      await sleep(SLOW_MS);
      return writeFile(...args);
    });
    expect(await h.replay.consume('nonce-value')).toBe(true);
    const fields = h.last('trigger-admission.authorization-replay-store.storage.completed');
    expect(fields['persistMs']).toBeGreaterThanOrEqual(SLOW_MS - 5);
    expect(fields['fileReadMs']).toBeLessThan(SLOW_MS);
    expect(fields['serializeMs']).toBeLessThan(SLOW_MS);
    vi.mocked(fs.writeFile).mockRestore();
    expect(await h.replay.consume('nonce-value')).toBe(false);
    expect(h.lines.join('')).not.toContain('nonce-value');
  });

  it('reports validation time and preserves the storage failure on integrity rejection', async () => {
    const h = await harness();
    directories.push(h.directory);
    await h.replay.consume('first');
    await fs.writeFile(
      h.replay.path,
      (await fs.readFile(h.replay.path, 'utf8')).replace('first', 'other'),
    );
    await expect(h.replay.consume('second')).rejects.toThrow('integrity');
    const fields = h.last('trigger-admission.authorization-replay-store.storage.failed');
    expect(typeof fields['validationMs']).toBe('number');
    expect(typeof fields['fileReadMs']).toBe('number');
    expect(fields['persistMs']).toBe(0);
    expect(h.lines.join('')).not.toMatch(/"integrity":"|first|second/u);
  });
});
