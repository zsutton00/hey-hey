import { describe, expect, it } from 'vitest';

import { PermissionDeniedError, PlatformUnavailableError, StorageFailureError } from '../errors';
import { KeyringPlatformStore } from '../platforms/keyring';
import type { KeyringEntry, KeyringEntryFactory } from '../platforms/keyring';

const makeFakeKeyring = () => {
  const data = new Map<string, string>();
  const factory: KeyringEntryFactory = (_service, account): KeyringEntry => ({
    setPassword(password) {
      data.set(account, password);
    },
    getPassword() {
      return data.get(account) ?? null;
    },
    deletePassword() {
      return data.delete(account);
    },
  });
  return { factory, data };
};

const throwingFactory =
  (error: Error): KeyringEntryFactory =>
  () => ({
    setPassword() {
      throw error;
    },
    getPassword() {
      throw error;
    },
    deletePassword() {
      throw error;
    },
  });

describe('KeyringPlatformStore', () => {
  it('stores and retrieves a value via the keyring binding', async () => {
    const { factory } = makeFakeKeyring();
    const store = new KeyringPlatformStore(factory);

    await store.store('machine-1/private_key', 'secret-pem');
    await expect(store.retrieve('machine-1/private_key')).resolves.toBe('secret-pem');
  });

  it('retrieve returns null when the entry is absent', async () => {
    const { factory } = makeFakeKeyring();
    const store = new KeyringPlatformStore(factory);
    await expect(store.retrieve('missing')).resolves.toBeNull();
  });

  it('retrieve treats a NoEntry error as a missing entry', async () => {
    const store = new KeyringPlatformStore(throwingFactory(new Error('No matching entry found')));
    await expect(store.retrieve('any')).resolves.toBeNull();
  });

  it('delete is a no-op when the entry is absent', async () => {
    const store = new KeyringPlatformStore(throwingFactory(new Error('No matching entry found')));
    await expect(store.delete('any')).resolves.toBeUndefined();
  });

  it('classifies permission errors as PermissionDeniedError', async () => {
    const store = new KeyringPlatformStore(throwingFactory(new Error('Access denied by user')));
    await expect(store.store('k', 'v')).rejects.toThrow(PermissionDeniedError);
  });

  it('classifies platform-failure errors as PlatformUnavailableError', async () => {
    const store = new KeyringPlatformStore(
      throwingFactory(new Error('Platform failure: secret service')),
    );
    await expect(store.store('k', 'v')).rejects.toThrow(PlatformUnavailableError);
  });

  it('classifies unknown failures as StorageFailureError', async () => {
    const store = new KeyringPlatformStore(throwingFactory(new Error('Something else broke')));
    await expect(store.store('k', 'v')).rejects.toThrow(StorageFailureError);
  });

  it('never echoes the secret into the thrown error message', async () => {
    const secret = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n';
    const store = new KeyringPlatformStore(throwingFactory(new Error('Storage backend error')));
    await expect(store.store('k', secret)).rejects.toMatchObject({
      message: expect.not.stringContaining('BEGIN PRIVATE KEY'),
    });
  });

  it('does not treat a missing D-Bus object as an absent credential', async () => {
    const store = new KeyringPlatformStore(
      throwingFactory(new Error('Object not found at /org/freedesktop/secrets/collection/login')),
    );
    await expect(store.retrieve('any')).rejects.toBeInstanceOf(Error);
    await expect(store.delete('any')).rejects.toBeInstanceOf(Error);
  });

  it('proves write and read capability with a scoped diagnostic entry it removes again', async () => {
    const { factory, data } = makeFakeKeyring();
    data.set('keep/private_key', 'existing-secret');
    const store = new KeyringPlatformStore(factory);

    await store.ensureReady('ns/');

    expect([...data.keys()]).toEqual(['keep/private_key']);
  });

  it('fails readiness when the store accepts a write it cannot read back', async () => {
    const factory: KeyringEntryFactory = () => ({
      setPassword() {},
      getPassword: () => null,
      deletePassword: () => false,
    });

    await expect(new KeyringPlatformStore(factory).ensureReady('ns/')).rejects.toBeInstanceOf(
      StorageFailureError,
    );
  });
});
