import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { KeyPairStore } from '../../credentials';
import { StructuredServerLogger } from '../logger';
import { canonicalizeJson, type CanonicalJsonValue } from '../../shared/canonical-json';
import { AuthorizationReplayStore } from './authorization-replay-store';
import { ExecutionGrantStore } from './execution-grant-store';
import { CURRENT_AGENT_OPERATIONS } from './types';

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

describe('durable controller authority stores', () => {
  it('separates a queued lock wait from storage work', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-lock-timing-'));
    try {
      const keyPairStore = Object.create(KeyPairStore.prototype) as KeyPairStore;
      vi.spyOn(keyPairStore, 'getAccountNamespace').mockReturnValue('test');
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      vi.spyOn(keyPairStore, 'getAuthorizationStateIntegrityKey').mockImplementation(async () => {
        await blocked;
        return Buffer.alloc(32, 7);
      });
      const logger = new StructuredServerLogger({ minLevel: 'debug', writeLine: () => {} });
      const debug = vi.spyOn(logger, 'debug');
      const store = new ExecutionGrantStore({ directory, keyPairStore, logger });
      const first = store.list();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const second = store.list();
      await new Promise((resolve) => setTimeout(resolve, 15));
      release();
      await Promise.all([first, second]);
      const storageStarts = debug.mock.calls.filter(([event]) => event.endsWith('storage.started'));
      expect(storageStarts).toHaveLength(2);
      expect(storageStarts[1]![1]!['lockWaitMs']).toBeGreaterThanOrEqual(10);
      expect(debug).toHaveBeenCalledWith('trigger-admission.execution-grant-store.storage.completed', expect.objectContaining({ storageMs: expect.any(Number), lockWaitMs: expect.any(Number) }));
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('shares one cold key read across grant and replay storage, retaining warm validation and restart replay', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-shared-key-'));
    try {
      const data = new Map<string, string>();
      const retrieve = vi.fn(async (key: string) => data.get(key) ?? null);
      const keyPairStore = new KeyPairStore({ namespaceOverride: 'test/', platformStoreOverride: {
        name: 'memory', isAvailable: async () => true, retrieve,
        store: async (key, value) => { data.set(key, value); },
        delete: async (key) => { data.delete(key); },
      } });
      const lines: string[] = [];
      const logger = new StructuredServerLogger({ minLevel: 'debug', writeLine: (line) => lines.push(line) });
      const options = { directory, keyPairStore, logger, now: () => 1_700_000_000_000 };
      const grants = new ExecutionGrantStore(options);
      const replay = new AuthorizationReplayStore(options);
      await Promise.all([grants.create(grantInput), replay.consume('nonce')]);
      const input = { grantId: 'grant-1', machineId: 'machine-1', userId: 'user-1', organizationId: 'organization-1', actionType: 'TASK_MONITOR_START' as const, actionCategory: 'TASK_MONITOR' as const };
      await grants.admit(input);
      await grants.admit(input);
      expect(await replay.consume('nonce')).toBe(false);
      expect(retrieve).toHaveBeenCalledTimes(1);
      const restarted = new KeyPairStore({ namespaceOverride: 'test/', platformStoreOverride: {
        name: 'memory', isAvailable: async () => true, retrieve,
        store: async (key, value) => { data.set(key, value); },
        delete: async (key) => { data.delete(key); },
      } });
      expect(await new AuthorizationReplayStore({ ...options, keyPairStore: restarted }).consume('nonce')).toBe(false);
      await grants.revoke('grant-1');
      await expect(grants.admit(input)).rejects.toThrow('GRANT_NOT_ACTIVE');
      await fs.writeFile(replay.path, (await fs.readFile(replay.path, 'utf8')).replace('nonce', 'other'));
      await expect(replay.consume('other')).rejects.toThrow('integrity');
      expect(lines.some((line) => line.includes('storage.completed') && line.includes('lockWaitMs') && line.includes('storageMs'))).toBe(true);
      expect(lines.some((line) => line.includes('storage.failed'))).toBe(true);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('integrity-protects grants, survives a new owner instance, and serializes concurrent writes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-grants-'));
    const key = Buffer.alloc(32, 7);
    const first = new ExecutionGrantStore({
      directory,
      namespace: 'profile-a',
      integrityKey: key,
      now: () => 1_700_000_000_000,
    });
    const grants = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        first.create({ ...grantInput, grantId: `grant-${index}` }),
      ),
    );
    expect(new Set(grants.map((grant) => grant.grantId)).size).toBe(8);
    const second = new ExecutionGrantStore({
      directory,
      namespace: 'profile-a',
      integrityKey: key,
      now: () => 1_700_000_000_000,
    });
    expect((await second.list()).length).toBe(8);
    const admitted = await second.admit({
      grantId: grants[0]!.grantId,
      machineId: 'machine-1',
      userId: 'user-1',
      organizationId: 'organization-1',
      actionType: 'TASK_MONITOR_START',
      actionCategory: 'TASK_MONITOR',
    });
    expect(admitted.lastUsedAtMs).toBe(1_700_000_000_000);
    await expect(
      second.admit({
        grantId: grants[0]!.grantId,
        machineId: 'machine-1',
        userId: 'user-1',
        organizationId: 'organization-1',
        actionType: 'CLI_READ',
        actionCategory: 'CLI_READ',
      }),
    ).resolves.toMatchObject({ grantId: grants[0]!.grantId });

    await fs.writeFile(
      first.path,
      '{"schemaVersion":2,"namespace":"profile-a","grants":[],"integrity":"00"}',
    );
    await expect(second.list()).rejects.toThrow(/integrity|closed schema/u);
  });

  it('invalidates integrity-protected version 2 grants without wedging fresh admission', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-legacy-grants-'));
    const key = Buffer.alloc(32, 5);
    const store = new ExecutionGrantStore({
      directory,
      namespace: 'profile-a',
      integrityKey: key,
      now: () => 1_700_000_000_000,
    });
    const legacyGrant = {
      version: 2,
      grantId: 'legacy-grant',
      namespace: 'profile-a',
      scope: 'controller_device_window',
      controllerCredentialId: 'credential-1',
      controllerInstallationId: 'installation-1',
      machineId: 'machine-1',
      userId: 'user-1',
      organizationId: 'organization-1',
      cadence: 'ONE_DAY',
      policyRevision: 4,
      allowedActionCategories: ['CLI_READ'],
      issuedAtMs: 1_700_000_000_000,
      effectiveExpiresAtMs: 1_700_000_120_000,
      descriptorHash: 'b'.repeat(64),
      controllerCredentialFingerprint: `sha256:${'c'.repeat(64)}`,
      suspended: false,
      terminal: false,
      revoked: false,
      lastUsedAtMs: null,
    };
    const authenticatedPayload = {
      schemaVersion: 2,
      namespace: 'profile-a',
      grants: [legacyGrant],
    };
    const integrity = createHmac('sha256', key)
      .update(canonicalizeJson(authenticatedPayload))
      .digest('hex');
    await fs.writeFile(store.path, canonicalizeJson({ ...authenticatedPayload, integrity }));

    await expect(store.list()).resolves.toEqual([]);
    await expect(store.create(grantInput)).resolves.toMatchObject({
      version: 4,
      grantId: grantInput.grantId,
    });
  });

  it('durably removes a legacy browser-session grant during reconciliation', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-removed-cadence-'));
    const key = Buffer.alloc(32, 4);
    const store = new ExecutionGrantStore({
      directory,
      namespace: 'profile-a',
      integrityKey: key,
      now: () => 1_700_000_000_000,
    });
    await store.create(grantInput);
    const authenticatedFile = JSON.parse(await fs.readFile(store.path, 'utf8')) as {
      schemaVersion: number;
      namespace: string;
      grants: Array<Record<string, unknown>>;
      integrity: string;
    };
    authenticatedFile.grants[0]!['cadence'] = 'CURRENT_BROWSER_SESSION';
    const authenticatedPayload = {
      schemaVersion: authenticatedFile.schemaVersion,
      namespace: authenticatedFile.namespace,
      grants: authenticatedFile.grants,
    };
    authenticatedFile.integrity = createHmac('sha256', key)
      .update(canonicalizeJson(authenticatedPayload as unknown as CanonicalJsonValue))
      .digest('hex');
    await fs.writeFile(
      store.path,
      canonicalizeJson(authenticatedFile as unknown as CanonicalJsonValue),
    );

    await expect(store.list()).resolves.toEqual([]);
    const reconciled = JSON.parse(await fs.readFile(store.path, 'utf8')) as {
      grants: unknown[];
    };
    expect(reconciled.grants).toEqual([]);
  });

  it('retains installation identity separately for the same credential', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-installations-'));
    const store = new ExecutionGrantStore({
      directory,
      namespace: 'profile-a',
      integrityKey: Buffer.alloc(32, 9),
      now: () => 1_700_000_000_000,
    });
    const first = await store.create(grantInput);
    const second = await store.create({
      ...grantInput,
      grantId: 'grant-2',
      descriptor: { ...grantInput.descriptor, controllerInstallationId: 'installation-2' },
    });

    expect(first.controllerCredentialId).toBe(second.controllerCredentialId);
    expect(first.controllerInstallationId).toBe('installation-1');
    expect(second.controllerInstallationId).toBe('installation-2');
    expect((await store.list()).map((grant) => grant.controllerInstallationId)).toEqual([
      'installation-1',
      'installation-2',
    ]);
  });

  it('fails closed on expiry and machine, user, organization, or action-class substitution', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-bindings-'));
    let now = 1_700_000_000_000;
    const store = new ExecutionGrantStore({
      directory,
      namespace: 'profile-a',
      integrityKey: Buffer.alloc(32, 6),
      now: () => now,
    });
    await store.create(grantInput);
    const exact = {
      grantId: grantInput.grantId,
      machineId: 'machine-1',
      userId: 'user-1',
      organizationId: 'organization-1',
      actionType: 'CLI_READ' as const,
      actionCategory: 'CLI_READ' as const,
    };

    for (const substitution of [
      { machineId: 'machine-2' },
      { userId: 'user-2' },
      { organizationId: 'organization-2' },
      { actionCategory: 'APPLICATION_EFFECT' as const },
      { actionType: 'TASK_MONITOR_START' as const },
    ]) {
      await expect(store.admit({ ...exact, ...substitution })).rejects.toThrow(
        'GRANT_SCOPE_MISMATCH',
      );
    }

    now = grantInput.descriptor.effectiveExpiresAtMs;
    await expect(store.admit(exact)).rejects.toThrow('GRANT_NOT_ACTIVE');
  });

  it('retains replay identities across restart and does not compact unexpired entries', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-replay-'));
    const key = Buffer.alloc(32, 8);
    let now = 1_700_000_000_000;
    const first = new AuthorizationReplayStore({
      directory,
      namespace: 'profile-a',
      integrityKey: key,
      now: () => now,
    });
    expect(await first.consume('authorization-1')).toBe(true);
    expect(await first.consume('authorization-1')).toBe(false);
    expect(await first.consume('authorization-2')).toBe(true);
    const second = new AuthorizationReplayStore({
      directory,
      namespace: 'profile-a',
      integrityKey: key,
      now: () => now,
    });
    expect(await second.consume('authorization-1')).toBe(false);
    expect((await second.list()).map((record) => record.id)).toEqual([
      'authorization-1',
      'authorization-2',
    ]);
    now += 10 * 60 * 1000 + 1;
    expect(await second.consume('authorization-1')).toBe(true);
  });
});
