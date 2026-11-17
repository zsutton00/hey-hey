import { afterEach, describe, expect, it, vi } from 'vitest';

import { openSessionSecretServiceBus, type DBusNativeModule } from '../platforms/dbus-native-bus';
import { SecretServiceBusError, SecretServiceDefaultCollection } from '../platforms/secret-service';
import { DefaultCollectionMissingError, PermissionDeniedError } from '../errors';
import { KeyringPlatformStore, type KeyringEntryFactory } from '../platforms/keyring';

type Listener = (message: { path?: string; member?: string; body?: unknown }) => void;
interface Call {
  member: string;
  path: string;
  body?: unknown[] | undefined;
}

/**
 * A scripted org.freedesktop.secrets service behind the dbus-native call surface. Reply shapes
 * follow the Secret Service specification: ReadAlias -> path, Properties.Get -> variant,
 * Unlock -> [unlocked paths, prompt path], Prompt.Completed -> [dismissed, result].
 */
const fakeDesktop = (options: {
  alias: string;
  collections: Record<string, { locked: boolean; label: string }>;
  prompt?: 'accept' | 'dismiss';
}): { module: DBusNativeModule; calls: Call[] } => {
  const calls: Call[] = [];
  const listeners: Listener[] = [];
  const module: DBusNativeModule = {
    sessionBus: () => ({
      invoke(message, callback) {
        calls.push({ member: message.member, path: message.path, body: message.body });
        if (message.member === 'ReadAlias') {
          callback(null, options.alias);
          return;
        }
        if (message.member === 'Get') {
          const collection = options.collections[message.path];
          if (!collection) {
            callback(['org.freedesktop.DBus.Error.UnknownObject', 'no such object']);
            return;
          }
          const property = (message.body as string[])[1];
          callback(
            null,
            property === 'Locked'
              ? [[{ type: 'b' }], [collection.locked]]
              : [[{ type: 's' }], [collection.label]],
          );
          return;
        }
        if (message.member === 'Unlock') {
          callback(null, [[], '/org/freedesktop/secrets/prompt/p1']);
          return;
        }
        if (message.member === 'Prompt') {
          callback(null);
          const dismissed = options.prompt === 'dismiss';
          if (!dismissed) {
            for (const collection of Object.values(options.collections)) {
              collection.locked = false;
            }
          }
          queueMicrotask(() =>
            listeners.forEach((listener) =>
              listener({
                path: '/org/freedesktop/secrets/prompt/p1',
                member: 'Completed',
                body: [dismissed, [[{ type: 's' }], ['']]],
              }),
            ),
          );
          return;
        }
        callback(['org.freedesktop.DBus.Error.UnknownMethod', message.member]);
      },
      addMatch: (_rule, callback) => callback(null),
      connection: {
        on: (event: string, listener: Listener) => {
          if (event === 'message') {
            listeners.push(listener);
          }
        },
        off: (_event, listener) => {
          listeners.splice(listeners.indexOf(listener), 1);
        },
        end: () => undefined,
      },
    }),
  };
  return { module, calls };
};

const collectionFor = (module: DBusNativeModule): SecretServiceDefaultCollection =>
  new SecretServiceDefaultCollection(() =>
    openSessionSecretServiceBus(() => Promise.resolve(module)),
  );

const LOGIN = '/org/freedesktop/secrets/collection/login';

describe('D-Bus adapter against the Secret Service call surface', () => {
  it('maps a missing default collection object to "no default", never a guessed collection', async () => {
    const { module, calls } = fakeDesktop({
      alias: LOGIN,
      collections: {
        '/org/freedesktop/secrets/collection/other': { locked: false, label: 'other' },
      },
    });

    await expect(collectionFor(module).ensureUsable()).rejects.toBeInstanceOf(
      DefaultCollectionMissingError,
    );
    expect(calls.every((call) => call.path !== '/org/freedesktop/secrets/collection/other')).toBe(
      true,
    );
  });

  it('reads a custom-named default through the alias', async () => {
    const path = '/org/freedesktop/secrets/collection/u_5fmine';
    const { module } = fakeDesktop({
      alias: path,
      collections: { [path]: { locked: false, label: 'mine' } },
    });

    await expect(collectionFor(module).ensureUsable()).resolves.toMatchObject({
      path,
      label: 'mine',
    });
  });

  it('completes the native prompt and re-inspects the unlocked collection', async () => {
    const { module, calls } = fakeDesktop({
      alias: LOGIN,
      collections: { [LOGIN]: { locked: true, label: 'Login' } },
      prompt: 'accept',
    });

    await expect(collectionFor(module).ensureUsable()).resolves.toMatchObject({ label: 'Login' });
    expect(calls.map((call) => call.member)).toContain('Prompt');
  });

  it('reports a dismissed prompt as denied access', async () => {
    const { module } = fakeDesktop({
      alias: LOGIN,
      collections: { [LOGIN]: { locked: true, label: 'Login' } },
      prompt: 'dismiss',
    });

    await expect(collectionFor(module).ensureUsable()).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('treats a session bus that cannot connect as an unreachable service', async () => {
    const module: DBusNativeModule = {
      sessionBus: () => {
        throw new Error('connect ENOENT /run/user/1000/bus');
      },
    };

    await expect(collectionFor(module).inspect()).resolves.toMatchObject({ kind: 'no-service' });
  });
});

describe('Linux readiness when the D-Bus client cannot be loaded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not block healthy storage: the real write/read probe decides', async () => {
    const data = new Map<string, string>();
    const factory: KeyringEntryFactory = (_service, account) => ({
      setPassword: (value) => void data.set(account, value),
      getPassword: () => data.get(account) ?? null,
      deletePassword: () => data.delete(account),
    });
    const missingClient = new SecretServiceDefaultCollection(() =>
      Promise.reject(new SecretServiceBusError('client-unavailable', 'Cannot find package')),
    );
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const store = new KeyringPlatformStore(factory, 'svc', missingClient);

    await expect(store.ensureReady('ns/')).resolves.toBeUndefined();
    expect(data.size).toBe(0);
  });
});
