import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ControllerRegistryStore, type ControllerRegistryEntry } from '../controller-registry';
import { KeyPairStore } from '../keypair';
import { MemoryPlatformStore } from '../keypair.test-support';

const directories: string[] = [];

const makeEntry = (machineId: string): ControllerRegistryEntry => ({
  enrollmentId: `enrollment-${machineId}`,
  machineId,
  machineName: `machine-${machineId}`,
  osFamily: 'linux',
  cliVersion: '2.2.2',
  authorizationProtocolVersion: 2,
  accountId: 'account-1',
  organizationId: 'organization-1',
  controllerLabel: 'Alice laptop',
  controllerCredentialId: `credential-${machineId}`,
  controllerCredentialPublicKey: {
    kty: 'EC',
    crv: 'P-256',
    x: 'A'.repeat(43),
    y: 'B'.repeat(43),
  },
  controllerCredentialFingerprint: 'fingerprint-1',
  backupEligible: true,
  backupState: false,
  enrolledAt: '2026-08-12T20:00:00.000Z',
});

const makeStore = async (
  namespace = 'test/',
): Promise<{ store: ControllerRegistryStore; keyPairStore: KeyPairStore }> => {
  const directory = await fs.mkdtemp(path.join(process.cwd(), '.controller-registry-test-'));
  directories.push(directory);
  const keyPairStore = new KeyPairStore({
    platformStoreOverride: new MemoryPlatformStore(),
    namespaceOverride: namespace,
  });
  return { store: new ControllerRegistryStore({ keyPairStore, directory }), keyPairStore };
};

afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});

describe('ControllerRegistryStore', () => {
  it('writes an HMAC-protected closed-schema file with restrictive permissions and survives restart', async () => {
    const { store, keyPairStore } = await makeStore();
    await store.upsert(makeEntry('machine-1'));

    const stat = await fs.stat(store.path);
    expect(stat.mode & 0o777).toBe(0o600);
    const restarted = new ControllerRegistryStore({
      keyPairStore,
      filePath: store.path,
    });
    await expect(restarted.read()).resolves.toEqual({
      schemaVersion: 1,
      controllers: [makeEntry('machine-1')],
    });
    expect(restarted).toBeDefined();
  });

  it('rejects tampering and unknown fields after the process restarts', async () => {
    const { store } = await makeStore();
    await store.upsert(makeEntry('machine-1'));
    const original = await fs.readFile(store.path, 'utf8');
    const parsed = JSON.parse(original) as {
      contents: { controllers: ControllerRegistryEntry[]; schemaVersion: number };
    };
    const [firstController] = parsed.contents.controllers;
    if (!firstController) throw new Error('test fixture missing controller');
    firstController.controllerLabel = 'tampered';
    await fs.writeFile(store.path, JSON.stringify(parsed), { mode: 0o600 });
    await expect(store.read()).rejects.toThrow('integrity verification failed');

    await fs.writeFile(store.path, JSON.stringify({ ...parsed, extra: true }), { mode: 0o600 });
    await expect(store.read()).rejects.toThrow('closed schema');
  });

  it('serializes concurrent upserts without losing entries', async () => {
    const { store } = await makeStore();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => store.upsert(makeEntry(`machine-${String(index)}`))),
    );

    const contents = await store.read();
    expect(contents?.controllers).toHaveLength(12);
  });

  it('retains multiple controllers for one machine and removes only the selected controller', async () => {
    const { store } = await makeStore();
    const first = makeEntry('machine-1');
    const second: ControllerRegistryEntry = {
      ...first,
      enrollmentId: 'enrollment-machine-1-second',
      controllerLabel: 'Bob phone',
      controllerCredentialId: 'credential-machine-1-second',
      controllerCredentialPublicKey: {
        kty: 'EC',
        crv: 'P-256',
        x: 'C'.repeat(43),
        y: 'D'.repeat(43),
      },
      controllerCredentialFingerprint: 'fingerprint-2',
    };

    await store.upsert(first);
    await store.upsert(second);
    await expect(store.remove('machine-1', first.controllerCredentialId)).resolves.toBe(true);
    await expect(store.read()).resolves.toEqual({ schemaVersion: 1, controllers: [second] });
  });

  it('isolates registry files by namespace', async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), '.controller-registry-test-'));
    directories.push(directory);
    const platformStore = new MemoryPlatformStore();
    const first = new ControllerRegistryStore({
      keyPairStore: new KeyPairStore({
        platformStoreOverride: platformStore,
        namespaceOverride: 'one/',
      }),
      directory,
      namespaceOverride: 'one/',
    });
    const second = new ControllerRegistryStore({
      keyPairStore: new KeyPairStore({
        platformStoreOverride: platformStore,
        namespaceOverride: 'two/',
      }),
      directory,
      namespaceOverride: 'two/',
    });
    await first.upsert(makeEntry('machine-1'));

    await expect(second.read()).resolves.toBeNull();
    expect(first.path).not.toBe(second.path);
  });
});
