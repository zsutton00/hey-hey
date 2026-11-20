import { afterEach, expect, it, vi } from 'vitest';
import { KeyPairStore } from '../credentials/keypair';
import { KeyringPlatformStore, type KeyringEntryFactory } from '../credentials/platforms/keyring';
import { LocalKeyPairStore } from './local-key-pair-store';

afterEach(() => vi.unstubAllEnvs());

it('keeps local identity, rotation and integrity keys separate from foreign pairing records', async () => {
  const entries = new Map<string, string>();
  const accesses: string[] = [];
  const factory: KeyringEntryFactory = (service, account) => {
    const key = `${service}:${account}`;
    accesses.push(key);
    return {
      setPassword: (value) => {
        entries.set(key, value);
      },
      getPassword: () => entries.get(key) ?? null,
      deletePassword: () => entries.delete(key),
    };
  };
  const hosted = ['', 'staging.heyhey.dev/', 'localhost:3000/', 'localhost:3000/e2e/'].map(
    (namespaceOverride) =>
      new KeyPairStore({
        namespaceOverride,
        platformStoreOverride: new KeyringPlatformStore(factory),
      }),
  );
  for (const store of hosted) {
    await store.setCurrentMachineId('foreign-machine');
    await store.generateAndStoreKeyPair('foreign-machine');
    await store.storeMachineCredential('foreign-machine', 'foreign-token');
  }
  const foreign = new Map(entries);
  accesses.length = 0;
  vi.stubEnv('HEYHEY_API_URL', 'http://localhost:3000');
  vi.stubEnv('HEYHEY_PROFILE', 'e2e');
  const local = new LocalKeyPairStore(factory);
  await expect(local.loadCurrentMachineId()).resolves.toBeNull();
  await local.setCurrentMachineId('local-machine');
  await local.generateAndStoreKeyPair('local-machine');
  await local.storeMachineCredential('local-machine', 'local-token');
  const originalKey = await local.loadPrivateKey('local-machine');
  await local.stageKeyRotation('local-machine');
  await local.abortKeyRotation('local-machine');
  await expect(local.loadPrivateKey('local-machine')).resolves.toBe(originalKey);
  const integrityKey = await local.getAuthorizationStateIntegrityKey();

  vi.stubEnv('HEYHEY_API_URL', 'https://heyhey.dev');
  vi.stubEnv('HEYHEY_PROFILE', 'another');
  const restarted = new LocalKeyPairStore(factory);
  await expect(restarted.loadCurrentMachineId()).resolves.toBe('local-machine');
  await expect(restarted.getAuthorizationStateIntegrityKey()).resolves.toEqual(integrityKey);
  await restarted.deleteMachineCredential('local-machine');
  expect(accesses.every((key) => key.startsWith(`${LocalKeyPairStore.service}:`))).toBe(true);
  for (const [key, value] of foreign) {
    expect(entries.get(key)).toBe(value);
  }
  for (const store of hosted) {
    await expect(store.loadCurrentMachineId()).resolves.toBe('foreign-machine');
    await expect(store.loadMachineCredential('foreign-machine')).resolves.toBe('foreign-token');
  }
});
