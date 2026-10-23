import { describe, expect, it } from 'vitest';

import { generateMachineKeyPair, KeyPairStore } from '../keypair';
import { MemoryPlatformStore } from '../keypair.test-support';

const MACHINE_ID = '00000000-0000-4000-8000-000000000001';
const ENROLLMENT_ID = '00000000-0000-4000-8000-000000000002';

describe('machine enrollment credential ownership', () => {
  it('generates key material without writing credential state', () => {
    const generated = generateMachineKeyPair();

    expect(generated.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(generated.publicKey).toBeInstanceOf(Buffer);
  });

  it('stores private keys by machine ID and pending secrets by enrollment ID in the isolated namespace', async () => {
    const platformStore = new MemoryPlatformStore();
    const keyPairStore = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'profile-a/',
    });

    await keyPairStore.storePrivateKey(MACHINE_ID, 'private-key');
    await keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, 'device-secret');

    expect(platformStore.values.get(`profile-a/${MACHINE_ID}/private_key`)).toBe('private-key');
    expect(platformStore.values.get(`profile-a/${ENROLLMENT_ID}/pending_enrollment_secret`)).toBe(
      'device-secret',
    );
    await expect(keyPairStore.loadPrivateKey(MACHINE_ID)).resolves.toBe('private-key');
    await expect(keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID)).resolves.toBe(
      'device-secret',
    );
  });

  it('deletes only the pending enrollment secret when that enrollment is discarded', async () => {
    const platformStore = new MemoryPlatformStore();
    const keyPairStore = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'profile-a/',
    });

    await keyPairStore.storePrivateKey(MACHINE_ID, 'private-key');
    await keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, 'device-secret');
    await keyPairStore.deletePendingEnrollmentSecret(ENROLLMENT_ID);

    await expect(keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID)).resolves.toBeNull();
    await expect(keyPairStore.loadPrivateKey(MACHINE_ID)).resolves.toBe('private-key');
  });
});
