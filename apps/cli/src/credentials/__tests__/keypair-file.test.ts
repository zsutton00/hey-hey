import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KeyPairStore } from '../keypair';
import { FilePlatformStore } from '../platforms/file';
import type { PlatformStore } from '../platforms/types';

const MACHINE_ID = 'machine-abc';

describe('KeyPairStore — file backend parity', () => {
  let tmpDir: string;
  let platformStore: PlatformStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-kp-file-'));
    platformStore = new FilePlatformStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates an Ed25519 keypair, persists the PKCS8 PEM, and round-trips signatures', async () => {
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

    const { publicKey } = await keypair.generateAndStoreKeyPair(MACHINE_ID);
    const storedPem = await keypair.loadPrivateKey(MACHINE_ID);
    expect(storedPem).not.toBeNull();
    expect(storedPem).toContain('BEGIN PRIVATE KEY');

    const parsedPrivate = createPrivateKey(storedPem as string);
    expect(parsedPrivate.asymmetricKeyType).toBe('ed25519');

    const message = Buffer.from('hello');
    const signature = sign(null, message, parsedPrivate);
    const parsedPublic = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
    expect(verify(null, message, parsedPublic, signature)).toBe(true);
  });

  it('setCurrentMachineId persists and loadCurrentMachineId reads it back', async () => {
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await keypair.setCurrentMachineId(MACHINE_ID);
    await expect(keypair.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
  });

  it('storeMachineCredential persists and loadMachineCredential reads it back', async () => {
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await keypair.storeMachineCredential(MACHINE_ID, 'machine-token-xyz');
    await expect(keypair.loadMachineCredential(MACHINE_ID)).resolves.toBe('machine-token-xyz');
  });

  it('storeServerSigningPublicKey persists and loadServerSigningPublicKey reads it back', async () => {
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await keypair.storeServerSigningPublicKey(MACHINE_ID, 'base64-key-payload');
    await expect(keypair.loadServerSigningPublicKey(MACHINE_ID)).resolves.toBe(
      'base64-key-payload',
    );
  });

  it('reads keypair material persisted by an earlier store instance (restart parity)', async () => {
    const before = new KeyPairStore({ platformStoreOverride: platformStore });
    await before.generateAndStoreKeyPair(MACHINE_ID);
    await before.storeMachineCredential(MACHINE_ID, 'durable-token');
    await before.storeServerSigningPublicKey(MACHINE_ID, 'durable-key');
    await before.setCurrentMachineId(MACHINE_ID);

    // Fresh store instance over the SAME on-disk directory simulates a process
    // restart — the AES-GCM envelope must be deterministic for the device.
    const afterRestart = new KeyPairStore({
      platformStoreOverride: new FilePlatformStore(tmpDir),
    });
    await expect(afterRestart.loadPrivateKey(MACHINE_ID)).resolves.toContain('BEGIN PRIVATE KEY');
    await expect(afterRestart.loadMachineCredential(MACHINE_ID)).resolves.toBe('durable-token');
    await expect(afterRestart.loadServerSigningPublicKey(MACHINE_ID)).resolves.toBe('durable-key');
    await expect(afterRestart.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
  });

  it('returns null for keys never written', async () => {
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await expect(keypair.loadPrivateKey('unknown-machine')).resolves.toBeNull();
    await expect(keypair.loadMachineCredential('unknown-machine')).resolves.toBeNull();
    await expect(keypair.loadServerSigningPublicKey('unknown-machine')).resolves.toBeNull();
    await expect(keypair.loadCurrentMachineId()).resolves.toBeNull();
  });

  it('writes a separate filespace from OAuth (.kp suffix, base64url-encoded account)', async () => {
    const keypair = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'localhost:3000/e2e/',
    });
    await keypair.setCurrentMachineId(MACHINE_ID);

    const expectedAccount = `localhost:3000/e2e/current/machine_id`;
    const expectedFile = `${Buffer.from(expectedAccount, 'utf8').toString('base64url')}.kp`;
    const entries = await fs.readdir(tmpDir);
    expect(entries).toContain(expectedFile);
    expect(entries.every((entry) => entry.endsWith('.kp'))).toBe(true);
  });

  it('namespacing keeps prod and --local keypair material disjoint on disk', async () => {
    const prod = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: '',
    });
    const local = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'localhost:3000/',
    });

    await prod.setCurrentMachineId('prod-machine');
    await prod.storeServerSigningPublicKey('prod-machine', 'prod-key');
    await local.setCurrentMachineId('local-machine');
    await local.storeServerSigningPublicKey('local-machine', 'local-key');

    await expect(prod.loadCurrentMachineId()).resolves.toBe('prod-machine');
    await expect(prod.loadServerSigningPublicKey('prod-machine')).resolves.toBe('prod-key');
    await expect(local.loadCurrentMachineId()).resolves.toBe('local-machine');
    await expect(local.loadServerSigningPublicKey('local-machine')).resolves.toBe('local-key');
  });

  it('removing the injected directory removes all test credential records', async () => {
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await keypair.generateAndStoreKeyPair(MACHINE_ID);
    await keypair.storeMachineCredential(MACHINE_ID, 'token');
    await keypair.storeServerSigningPublicKey(MACHINE_ID, 'key');
    await keypair.setCurrentMachineId(MACHINE_ID);

    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });

    const reloaded = new KeyPairStore({
      platformStoreOverride: new FilePlatformStore(tmpDir),
    });
    await expect(reloaded.loadPrivateKey(MACHINE_ID)).resolves.toBeNull();
    await expect(reloaded.loadMachineCredential(MACHINE_ID)).resolves.toBeNull();
    await expect(reloaded.loadServerSigningPublicKey(MACHINE_ID)).resolves.toBeNull();
    await expect(reloaded.loadCurrentMachineId()).resolves.toBeNull();
  });

  it('writes files with 0o600 perms inside a 0o700 directory', async () => {
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await keypair.setCurrentMachineId(MACHINE_ID);

    const dirStat = await fs.stat(tmpDir);
    expect(dirStat.mode & 0o777).toBe(0o700);

    const entries = await fs.readdir(tmpDir);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const stat = await fs.stat(path.join(tmpDir, entry));
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });
});
