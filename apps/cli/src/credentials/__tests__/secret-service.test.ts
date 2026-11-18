import { describe, expect, it } from 'vitest';

import {
  DefaultCollectionMissingError,
  PermissionDeniedError,
  PlatformUnavailableError,
  StorageFailureError,
  StorageLockedError,
} from '../errors';
import {
  SecretServiceBusError,
  SecretServiceDefaultCollection,
  type SecretServiceBus,
} from '../platforms/secret-service';

interface FakeDesktop {
  /** Alias target; "/" models "no default selected". */
  defaultPath: string;
  /** Collections that exist; each with its lock state. */
  collections: Map<string, { locked: boolean; label: string }>;
  unlockOutcome?: 'unlocked' | 'dismissed' | 'hang';
  aliasFailure?: SecretServiceBusError;
}

const collectionFor = (desktop: FakeDesktop) =>
  new SecretServiceDefaultCollection(() => {
    const bus: SecretServiceBus = {
      readAlias() {
        return desktop.aliasFailure
          ? Promise.reject(desktop.aliasFailure)
          : Promise.resolve(desktop.defaultPath);
      },
      readCollection(path) {
        const found = desktop.collections.get(path);
        return found
          ? Promise.resolve(found)
          : Promise.reject(new SecretServiceBusError('no-object', 'UnknownObject'));
      },
      async unlock(path, signal) {
        if (desktop.unlockOutcome === 'hang') {
          await new Promise((_, reject) => {
            signal.addEventListener('abort', () =>
              reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
            );
          });
        }
        if (desktop.unlockOutcome === 'dismissed') {
          return 'dismissed';
        }
        const found = desktop.collections.get(path);
        if (found) {
          found.locked = false;
        }
        return 'unlocked';
      },
      close: () => undefined,
    };
    return Promise.resolve(bus);
  }, 20);

describe('default Secret Service collection', () => {
  it('reports no default, not a missing "login", when a populated keyring is not selected', async () => {
    const desktop: FakeDesktop = {
      defaultPath: '/',
      collections: new Map([
        ['/org/freedesktop/secrets/collection/work', { locked: false, label: 'work' }],
      ]),
    };

    await expect(collectionFor(desktop).inspect()).resolves.toMatchObject({
      kind: 'no-default',
      why: 'alias-unset',
    });
    await expect(collectionFor(desktop).ensureUsable()).rejects.toBeInstanceOf(
      DefaultCollectionMissingError,
    );
  });

  it('reports the reported desktop state: default alias points at a login collection that is absent', async () => {
    const desktop: FakeDesktop = {
      defaultPath: '/org/freedesktop/secrets/collection/login',
      collections: new Map(),
    };

    await expect(collectionFor(desktop).inspect()).resolves.toMatchObject({
      kind: 'no-default',
      why: 'collection-missing',
    });
  });

  it('uses a custom-named default as-is', async () => {
    const path = '/org/freedesktop/secrets/collection/u_5fmine';
    const desktop: FakeDesktop = {
      defaultPath: path,
      collections: new Map([[path, { locked: false, label: 'mine' }]]),
    };

    await expect(collectionFor(desktop).ensureUsable()).resolves.toMatchObject({
      path,
      label: 'mine',
    });
  });

  it('unlocks a locked default through the native prompt', async () => {
    const path = '/org/freedesktop/secrets/collection/login';
    const desktop: FakeDesktop = {
      defaultPath: path,
      collections: new Map([[path, { locked: true, label: 'Login' }]]),
      unlockOutcome: 'unlocked',
    };

    await expect(collectionFor(desktop).ensureUsable()).resolves.toMatchObject({ label: 'Login' });
  });

  it('keeps a dismissed prompt distinct from absent storage', async () => {
    const path = '/org/freedesktop/secrets/collection/login';
    const desktop: FakeDesktop = {
      defaultPath: path,
      collections: new Map([[path, { locked: true, label: 'Login' }]]),
      unlockOutcome: 'dismissed',
    };

    await expect(collectionFor(desktop).ensureUsable()).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('reports a locked store when the prompt is never answered', async () => {
    const path = '/org/freedesktop/secrets/collection/login';
    const desktop: FakeDesktop = {
      defaultPath: path,
      collections: new Map([[path, { locked: true, label: 'Login' }]]),
      unlockOutcome: 'hang',
    };

    await expect(collectionFor(desktop).ensureUsable()).rejects.toBeInstanceOf(StorageLockedError);
  });

  it('reports an unreachable service and preserves unknown failures as unknown', async () => {
    const noService: FakeDesktop = {
      defaultPath: '/',
      collections: new Map(),
      aliasFailure: new SecretServiceBusError('no-service', 'ServiceUnknown'),
    };
    const odd: FakeDesktop = {
      defaultPath: '/',
      collections: new Map(),
      aliasFailure: new SecretServiceBusError('other', 'Something odd'),
    };

    await expect(collectionFor(noService).ensureUsable()).rejects.toBeInstanceOf(
      PlatformUnavailableError,
    );
    await expect(collectionFor(odd).ensureUsable()).rejects.toBeInstanceOf(StorageFailureError);
  });
});
