import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionDeniedError, PlatformUnavailableError, StorageFailureError } from '../errors';
import { accountNamespace, KeyPairStore } from '../keypair';
import { KeyringPlatformStore } from '../platforms/keyring';
import type { PlatformStore } from '../platforms/types';

const makeMemoryStore = (): PlatformStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    name: 'memory',
    data,
    isAvailable: async () => true,
    store: async (key, value) => {
      data.set(key, value);
    },
    retrieve: async (key) => data.get(key) ?? null,
    delete: async (key) => {
      data.delete(key);
    },
  };
};

const MACHINE_ID = 'machine-abc';

describe('KeyPairStore', () => {
  it('uses the OS keyring despite the former file override and propagates its failure', async () => {
    vi.stubEnv('HEYHEY_CREDENTIAL_DIR', '/unused-test-credential-directory');
    const retrieve = vi
      .spyOn(KeyringPlatformStore.prototype, 'retrieve')
      .mockRejectedValue(new PlatformUnavailableError('OS keychain unavailable.'));
    try {
      await expect(new KeyPairStore().loadCurrentMachineId()).rejects.toThrow(
        'OS keychain unavailable.',
      );
      expect(retrieve).toHaveBeenCalledOnce();
    } finally {
      retrieve.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('single-flights cold integrity-key initialization and returns isolated buffers on warm reads', async () => {
    const platformStore = makeMemoryStore();
    const retrieve = vi.spyOn(platformStore, 'retrieve');
    const store = vi.spyOn(platformStore, 'store');
    const owner = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'test/',
    });
    const keys = await Promise.all(
      Array.from({ length: 8 }, () => owner.getAuthorizationStateIntegrityKey()),
    );
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledTimes(1);
    expect(keys.every((key) => key.equals(keys[0]!))).toBe(true);
    keys[0]!.fill(0);
    expect(await owner.getAuthorizationStateIntegrityKey()).toEqual(keys[1]);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it('retries failed or invalid key reads and invalidates after replacement without crossing namespaces', async () => {
    const platformStore = makeMemoryStore();
    const retrieve = vi.spyOn(platformStore, 'retrieve').mockRejectedValueOnce(new Error('locked'));
    const owner = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'a/',
    });
    await expect(owner.getAuthorizationStateIntegrityKey()).rejects.toThrow('locked');
    await owner.storeAuthorizationStateIntegrityKey('invalid');
    await expect(owner.getAuthorizationStateIntegrityKey()).rejects.toThrow('invalid length');
    const replacement = Buffer.alloc(32, 8);
    await owner.storeAuthorizationStateIntegrityKey(replacement.toString('base64'));
    expect(await owner.getAuthorizationStateIntegrityKey()).toEqual(replacement);
    const other = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'b/',
    });
    expect(await other.getAuthorizationStateIntegrityKey()).not.toEqual(replacement);
    const next = Buffer.alloc(32, 9);
    await owner.storeAuthorizationStateIntegrityKey(next.toString('base64'));
    expect(await owner.getAuthorizationStateIntegrityKey()).toEqual(next);
    expect(retrieve).toHaveBeenCalledTimes(5);
  });

  it('retries failed initialization writes and lets replacement win over an in-flight cold read', async () => {
    const platformStore = makeMemoryStore();
    const store = vi.spyOn(platformStore, 'store').mockRejectedValueOnce(new Error('write failed'));
    const owner = new KeyPairStore({
      platformStoreOverride: platformStore,
      namespaceOverride: 'test/',
    });
    await expect(owner.getAuthorizationStateIntegrityKey()).rejects.toThrow('write failed');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.mockImplementation(async (account, key) => {
      await blocked;
      platformStore.data.set(account, key);
    });
    const initializing = owner.getAuthorizationStateIntegrityKey();
    const replacement = Buffer.alloc(32, 11);
    const replacing = owner.storeAuthorizationStateIntegrityKey(replacement.toString('base64'));
    release();
    await Promise.all([initializing, replacing]);
    expect(await owner.getAuthorizationStateIntegrityKey()).toEqual(replacement);
  });

  it('generates an Ed25519 keypair and persists the PKCS8 PEM under <machineId>/private_key', async () => {
    const platformStore = makeMemoryStore();
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

    const { publicKey } = await keypair.generateAndStoreKeyPair(MACHINE_ID);

    const storedPem = platformStore.data.get(`${MACHINE_ID}/private_key`);
    expect(storedPem).toBeDefined();
    expect(storedPem).toContain('BEGIN PRIVATE KEY');

    const parsedPrivate = createPrivateKey(storedPem as string);
    expect(parsedPrivate.asymmetricKeyType).toBe('ed25519');

    const message = Buffer.from('hello');
    const signature = sign(null, message, parsedPrivate);
    const parsedPublic = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
    expect(verify(null, message, parsedPublic, signature)).toBe(true);
  });

  it('setCurrentMachineId persists the machineId under current/machine_id and exposes it via loadCurrentMachineId', async () => {
    const platformStore = makeMemoryStore();
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

    await keypair.setCurrentMachineId(MACHINE_ID);

    expect(platformStore.data.get('current/machine_id')).toBe(MACHINE_ID);
    await expect(keypair.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
  });

  it('generateAndStoreKeyPair does not touch current/machine_id, preserving the previously paired machineId', async () => {
    const platformStore = makeMemoryStore();
    platformStore.data.set('current/machine_id', 'previously-paired-machine');
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

    await keypair.generateAndStoreKeyPair(MACHINE_ID);

    expect(platformStore.data.get('current/machine_id')).toBe('previously-paired-machine');
    await expect(keypair.loadCurrentMachineId()).resolves.toBe('previously-paired-machine');
  });

  it('loadPrivateKey returns the persisted PEM without regenerating', async () => {
    const platformStore = makeMemoryStore();
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

    await keypair.generateAndStoreKeyPair(MACHINE_ID);
    const first = await keypair.loadPrivateKey(MACHINE_ID);
    const second = await keypair.loadPrivateKey(MACHINE_ID);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(platformStore.data.get(`${MACHINE_ID}/private_key`)).toBe(first);
  });

  it('loadPrivateKey returns null when nothing has been stored for the machineId', async () => {
    const platformStore = makeMemoryStore();
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await expect(keypair.loadPrivateKey('unknown-machine')).resolves.toBeNull();
  });

  it('does not log or stringify the private key into console output', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const platformStore = makeMemoryStore();
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

    const { publicKey } = await keypair.generateAndStoreKeyPair(MACHINE_ID);
    expect(publicKey).toBeInstanceOf(Buffer);

    const storedPem = platformStore.data.get(`${MACHINE_ID}/private_key`) as string;
    const all = [
      ...consoleLog.mock.calls.flat(),
      ...consoleWarn.mock.calls.flat(),
      ...consoleError.mock.calls.flat(),
    ];
    for (const entry of all) {
      const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
      expect(text).not.toContain('BEGIN PRIVATE KEY');
      expect(text).not.toContain(storedPem);
    }

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('surfaces PermissionDeniedError from the platform store unchanged', async () => {
    const platformStore: PlatformStore = {
      name: 'denied',
      isAvailable: async () => true,
      store: async () => {
        throw new PermissionDeniedError('Permission denied');
      },
      retrieve: async () => null,
      delete: async () => {},
    };
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await expect(keypair.generateAndStoreKeyPair(MACHINE_ID)).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('surfaces PlatformUnavailableError from the platform store unchanged', async () => {
    const platformStore: PlatformStore = {
      name: 'unavailable',
      isAvailable: async () => false,
      store: async () => {
        throw new PlatformUnavailableError('OS keychain unavailable');
      },
      retrieve: async () => null,
      delete: async () => {},
    };
    const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
    await expect(keypair.generateAndStoreKeyPair(MACHINE_ID)).rejects.toThrow(
      PlatformUnavailableError,
    );
  });

  describe('machine credential', () => {
    it('persists the credential token under <machineId>/credential and reads it back', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

      await keypair.storeMachineCredential(MACHINE_ID, 'machine-token-xyz');

      expect(platformStore.data.get(`${MACHINE_ID}/credential`)).toBe('machine-token-xyz');
      await expect(keypair.loadMachineCredential(MACHINE_ID)).resolves.toBe('machine-token-xyz');
    });

    it('reads a credential persisted by an earlier store instance (restart)', async () => {
      const platformStore = makeMemoryStore();
      const beforeRestart = new KeyPairStore({ platformStoreOverride: platformStore });
      await beforeRestart.storeMachineCredential(MACHINE_ID, 'durable-token');

      const afterRestart = new KeyPairStore({ platformStoreOverride: platformStore });
      await expect(afterRestart.loadMachineCredential(MACHINE_ID)).resolves.toBe('durable-token');
    });

    it('stores the credential alongside the private key without overwriting it', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      await keypair.storeMachineCredential(MACHINE_ID, 'token-1');

      expect(platformStore.data.get(`${MACHINE_ID}/private_key`)).toBeDefined();
      expect(platformStore.data.get(`${MACHINE_ID}/credential`)).toBe('token-1');
      await expect(keypair.loadPrivateKey(MACHINE_ID)).resolves.not.toBeNull();
    });

    it('returns null when no credential has been stored for the machineId', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await expect(keypair.loadMachineCredential('unknown-machine')).resolves.toBeNull();
    });

    it('rejects an empty machineId on store and load', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await expect(keypair.storeMachineCredential('', 'token')).rejects.toThrow(
        StorageFailureError,
      );
      await expect(keypair.loadMachineCredential('')).rejects.toThrow(StorageFailureError);
    });
  });

  describe('server signing public key', () => {
    it('persists the key under <machineId>/server_signing_public_key and reads it back', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });

      await keypair.storeServerSigningPublicKey(MACHINE_ID, 'base64-key-payload');

      expect(platformStore.data.get(`${MACHINE_ID}/server_signing_public_key`)).toBe(
        'base64-key-payload',
      );
      await expect(keypair.loadServerSigningPublicKey(MACHINE_ID)).resolves.toBe(
        'base64-key-payload',
      );
    });

    it('reads a key persisted by an earlier store instance (restart)', async () => {
      const platformStore = makeMemoryStore();
      const beforeRestart = new KeyPairStore({ platformStoreOverride: platformStore });
      await beforeRestart.storeServerSigningPublicKey(MACHINE_ID, 'durable-key');

      const afterRestart = new KeyPairStore({ platformStoreOverride: platformStore });
      await expect(afterRestart.loadServerSigningPublicKey(MACHINE_ID)).resolves.toBe(
        'durable-key',
      );
    });

    it('returns null when no key has been stored for the machineId', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await expect(keypair.loadServerSigningPublicKey('unknown-machine')).resolves.toBeNull();
    });

    it('rejects an empty machineId on store and load', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await expect(keypair.storeServerSigningPublicKey('', 'key')).rejects.toThrow(
        StorageFailureError,
      );
      await expect(keypair.loadServerSigningPublicKey('')).rejects.toThrow(StorageFailureError);
    });
  });

  describe('backend namespacing (--local must not clobber prod)', () => {
    it('accountNamespace maps the prod/default backend to the empty (un-prefixed) namespace', () => {
      expect(accountNamespace(undefined)).toBe('');
      expect(accountNamespace('')).toBe('');
      expect(accountNamespace('https://heyhey.dev')).toBe('');
      expect(accountNamespace('https://heyhey.dev/api/v1')).toBe('');
    });

    it('accountNamespace scopes non-prod backends by host', () => {
      expect(accountNamespace('http://localhost:3000')).toBe('localhost:3000/');
      expect(accountNamespace('https://staging.heyhey.dev')).toBe('staging.heyhey.dev/');
      // Unparseable URL fails rather than guessing an environment.
      expect(() => accountNamespace('not-a-url')).toThrow(/not a valid URL/);
    });

    it('a --local pairing does not overwrite the prod machineId or signing key in a shared store', async () => {
      // Both backends write to the SAME underlying keychain (the real-world
      // failure mode): prod paired first, then a `--local` run pairs again.
      const platformStore = makeMemoryStore();
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

      // Prod's entries survive the local pairing untouched.
      await expect(prod.loadCurrentMachineId()).resolves.toBe('prod-machine');
      await expect(prod.loadServerSigningPublicKey('prod-machine')).resolves.toBe('prod-key');
      // Local resolves its own, disjoint entries.
      await expect(local.loadCurrentMachineId()).resolves.toBe('local-machine');
      await expect(local.loadServerSigningPublicKey('local-machine')).resolves.toBe('local-key');

      // The keychain accounts are physically distinct.
      expect(platformStore.data.get('current/machine_id')).toBe('prod-machine');
      expect(platformStore.data.get('localhost:3000/current/machine_id')).toBe('local-machine');
    });

    describe('HEYHEY_PROFILE appends a profile segment after the host namespace', () => {
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it('prod backend with a profile resolves to <profile>/', () => {
        vi.stubEnv('HEYHEY_PROFILE', 'e2e');
        expect(accountNamespace('https://heyhey.dev')).toBe('e2e/');
      });

      it('local backend with a profile resolves to localhost:3000/<profile>/', () => {
        vi.stubEnv('HEYHEY_PROFILE', 'e2e');
        expect(accountNamespace('http://localhost:3000')).toBe('localhost:3000/e2e/');
      });

      it('two profiles on the same local backend produce disjoint, non-overwriting keychain entries', async () => {
        // Both profiles write to the SAME underlying keychain; neither may
        // clobber the other's machineId or signing key.
        const platformStore = makeMemoryStore();

        vi.stubEnv('HEYHEY_PROFILE', 'alice');
        const alice = new KeyPairStore({
          platformStoreOverride: platformStore,
          namespaceOverride: accountNamespace('http://localhost:3000'),
        });
        vi.stubEnv('HEYHEY_PROFILE', 'bob');
        const bob = new KeyPairStore({
          platformStoreOverride: platformStore,
          namespaceOverride: accountNamespace('http://localhost:3000'),
        });

        await alice.setCurrentMachineId('alice-machine');
        await alice.storeServerSigningPublicKey('alice-machine', 'alice-key');
        await bob.setCurrentMachineId('bob-machine');
        await bob.storeServerSigningPublicKey('bob-machine', 'bob-key');

        await expect(alice.loadCurrentMachineId()).resolves.toBe('alice-machine');
        await expect(alice.loadServerSigningPublicKey('alice-machine')).resolves.toBe('alice-key');
        await expect(bob.loadCurrentMachineId()).resolves.toBe('bob-machine');
        await expect(bob.loadServerSigningPublicKey('bob-machine')).resolves.toBe('bob-key');

        expect(platformStore.data.get('localhost:3000/alice/current/machine_id')).toBe(
          'alice-machine',
        );
        expect(platformStore.data.get('localhost:3000/bob/current/machine_id')).toBe('bob-machine');
      });
    });

    it('prod (default namespace) keeps the original un-prefixed account layout', async () => {
      const platformStore = makeMemoryStore();
      const prod = new KeyPairStore({
        platformStoreOverride: platformStore,
        namespaceOverride: '',
      });

      await prod.generateAndStoreKeyPair(MACHINE_ID);
      await prod.storeMachineCredential(MACHINE_ID, 'token');

      expect(platformStore.data.has(`${MACHINE_ID}/private_key`)).toBe(true);
      expect(platformStore.data.has(`${MACHINE_ID}/credential`)).toBe(true);
    });
  });

  describe('machineId validation', () => {
    it('rejects an empty machineId on generate and load', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await expect(keypair.generateAndStoreKeyPair('')).rejects.toThrow(StorageFailureError);
      await expect(keypair.loadPrivateKey('')).rejects.toThrow(StorageFailureError);
    });

    it('rejects machineId with shell metacharacters', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      for (const bad of ['m;rm', 'm`cmd`', 'm$x', 'm|y', 'm&z', 'm(a)']) {
        await expect(keypair.generateAndStoreKeyPair(bad)).rejects.toThrow(StorageFailureError);
      }
    });

    it('rejects machineId with null byte or backslash', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await expect(keypair.generateAndStoreKeyPair('m\0id')).rejects.toThrow(StorageFailureError);
      await expect(keypair.generateAndStoreKeyPair('m\\id')).rejects.toThrow(StorageFailureError);
    });

    it('setCurrentMachineId rejects an empty or invalid machineId', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await expect(keypair.setCurrentMachineId('')).rejects.toThrow(StorageFailureError);
      await expect(keypair.setCurrentMachineId('m;rm')).rejects.toThrow(StorageFailureError);
      await expect(keypair.setCurrentMachineId('m\0id')).rejects.toThrow(StorageFailureError);
    });
  });

  describe('key rotation', () => {
    const LIVE = `${MACHINE_ID}/private_key`;
    const STAGE = `${MACHINE_ID}/private_key.next`;
    const COMMIT = `${MACHINE_ID}/private_key.commit`;

    /**
     * Asserts the keychain is in a single-usable-key terminal state: exactly the
     * live key, with no orphaned stage or commit marker. The contract is "never
     * zero usable keys or both live", so a half-finished swap must always resolve
     * to this shape.
     */
    const expectSingleUsableKey = (data: Map<string, string>, expectedLivePem: string): void => {
      expect(data.get(LIVE)).toBe(expectedLivePem);
      expect(data.has(STAGE)).toBe(false);
      expect(data.has(COMMIT)).toBe(false);
    };

    it('stageKeyRotation writes the new key to the stage and leaves the live key untouched', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      const livePem = platformStore.data.get(LIVE);

      const { publicKey } = await keypair.stageKeyRotation(MACHINE_ID);

      // Live key is unchanged; the new key only exists in the stage.
      expect(platformStore.data.get(LIVE)).toBe(livePem);
      const stagedPem = platformStore.data.get(STAGE);
      expect(stagedPem).toBeDefined();
      expect(stagedPem).not.toBe(livePem);
      // The returned public key matches the staged private key.
      const stagedPrivate = createPrivateKey(stagedPem as string);
      const message = Buffer.from('rotate');
      const signature = sign(null, message, stagedPrivate);
      const returnedPublic = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
      expect(verify(null, message, returnedPublic, signature)).toBe(true);
    });

    it('commitKeyRotation promotes the stage over the live key and clears stage + marker', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      await keypair.stageKeyRotation(MACHINE_ID);
      const stagedPem = platformStore.data.get(STAGE) as string;

      await keypair.commitKeyRotation(MACHINE_ID);

      expectSingleUsableKey(platformStore.data, stagedPem);
      await expect(keypair.loadPrivateKey(MACHINE_ID)).resolves.toBe(stagedPem);
    });

    it('commitKeyRotation throws when nothing is staged', async () => {
      const keypair = new KeyPairStore({ platformStoreOverride: makeMemoryStore() });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      await expect(keypair.commitKeyRotation(MACHINE_ID)).rejects.toThrow(/no staged key/u);
    });

    it('abortKeyRotation discards the stage and keeps the live key', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      const livePem = platformStore.data.get(LIVE) as string;
      await keypair.stageKeyRotation(MACHINE_ID);

      await keypair.abortKeyRotation(MACHINE_ID);

      expectSingleUsableKey(platformStore.data, livePem);
    });

    it('resumeKeyRotation rolls forward when the commit marker is present', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      await keypair.stageKeyRotation(MACHINE_ID);
      const stagedPem = platformStore.data.get(STAGE) as string;
      // Interrupted just after the marker landed, before promotion.
      platformStore.data.set(COMMIT, '1');

      await keypair.resumeKeyRotation(MACHINE_ID);

      expectSingleUsableKey(platformStore.data, stagedPem);
    });

    it('resumeKeyRotation rolls back when no commit marker is present', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      const livePem = platformStore.data.get(LIVE) as string;
      await keypair.stageKeyRotation(MACHINE_ID);
      // No marker → the rotation never committed; the old key is authoritative.

      await keypair.resumeKeyRotation(MACHINE_ID);

      expectSingleUsableKey(platformStore.data, livePem);
    });

    it('resumeKeyRotation is a no-op when no rotation is in flight', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      const livePem = platformStore.data.get(LIVE) as string;

      await keypair.resumeKeyRotation(MACHINE_ID);

      expectSingleUsableKey(platformStore.data, livePem);
    });

    // A crash during commitKeyRotation can land between any two keychain writes.
    // Whatever the interruption point, resuming with a fresh store must leave
    // exactly one usable key: the old key if the marker never landed, the new
    // key once it did.
    it.each([
      { crashOnOp: 1, expectNew: false, label: 'before the marker is written' },
      { crashOnOp: 2, expectNew: true, label: 'after the marker, before promotion' },
      { crashOnOp: 3, expectNew: true, label: 'after promotion, before clearing the stage' },
      { crashOnOp: 4, expectNew: true, label: 'after clearing the stage, before the marker' },
    ])(
      'crash-resume: an interrupted commit ($label) leaves exactly one usable key',
      async ({ crashOnOp, expectNew }) => {
        const platformStore = makeMemoryStore();
        let mutatingOps = 0;
        const crashingStore: PlatformStore = {
          ...platformStore,
          store: async (key, value) => {
            mutatingOps += 1;
            if (mutatingOps === crashOnOp) throw new Error('simulated crash');
            await platformStore.store(key, value);
          },
          delete: async (key) => {
            mutatingOps += 1;
            if (mutatingOps === crashOnOp) throw new Error('simulated crash');
            await platformStore.delete(key);
          },
        };

        const setup = new KeyPairStore({ platformStoreOverride: platformStore });
        await setup.generateAndStoreKeyPair(MACHINE_ID);
        const oldPem = platformStore.data.get(LIVE) as string;
        await setup.stageKeyRotation(MACHINE_ID);
        const newPem = platformStore.data.get(STAGE) as string;

        const crashed = new KeyPairStore({ platformStoreOverride: crashingStore });
        await expect(crashed.commitKeyRotation(MACHINE_ID)).rejects.toThrow('simulated crash');

        // Restart: a clean store finishes the swap deterministically.
        const resumed = new KeyPairStore({ platformStoreOverride: platformStore });
        await resumed.resumeKeyRotation(MACHINE_ID);

        expectSingleUsableKey(platformStore.data, expectNew ? newPem : oldPem);
      },
    );

    it('deleteMachineCredential erases every account this machine holds', async () => {
      const platformStore = makeMemoryStore();
      const keypair = new KeyPairStore({ platformStoreOverride: platformStore });
      await keypair.generateAndStoreKeyPair(MACHINE_ID);
      await keypair.storeMachineCredential(MACHINE_ID, 'token');
      await keypair.storeServerSigningPublicKey(MACHINE_ID, 'signing-key');
      await keypair.setCurrentMachineId(MACHINE_ID);
      await keypair.stageKeyRotation(MACHINE_ID);
      platformStore.data.set(COMMIT, '1');

      await keypair.deleteMachineCredential(MACHINE_ID);

      expect(platformStore.data.has(LIVE)).toBe(false);
      expect(platformStore.data.has(STAGE)).toBe(false);
      expect(platformStore.data.has(COMMIT)).toBe(false);
      expect(platformStore.data.has(`${MACHINE_ID}/credential`)).toBe(false);
      expect(platformStore.data.has(`${MACHINE_ID}/server_signing_public_key`)).toBe(false);
      expect(platformStore.data.has('current/machine_id')).toBe(false);
    });
  });
});
