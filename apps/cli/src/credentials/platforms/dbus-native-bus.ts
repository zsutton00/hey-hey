import { SecretServiceBusError, type SecretServiceBus } from './secret-service';

const SERVICE = 'org.freedesktop.secrets';
const SERVICE_PATH = '/org/freedesktop/secrets';
const SERVICE_IFACE = 'org.freedesktop.Secret.Service';
const COLLECTION_IFACE = 'org.freedesktop.Secret.Collection';
const PROMPT_IFACE = 'org.freedesktop.Secret.Prompt';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';
const NO_PROMPT = '/';

interface DBusMessage {
  type?: number;
  path?: string;
  interface?: string;
  member?: string;
  body?: unknown;
}

interface DBusNativeBus {
  invoke(
    message: {
      path: string;
      destination: string;
      interface: string;
      member: string;
      signature?: string;
      body?: unknown[];
    },
    callback: (error: unknown, result?: unknown) => void,
  ): void;
  addMatch(rule: string, callback: (error: unknown) => void): void;
  connection: {
    on(event: 'message', listener: (message: DBusMessage) => void): void;
    on(event: 'error', listener: (error: unknown) => void): void;
    off?(event: 'message', listener: (message: DBusMessage) => void): void;
    end(): void;
  };
}

interface DBusNativeModule {
  sessionBus(): DBusNativeBus;
}

const NO_SERVICE_NAMES = [
  'org.freedesktop.DBus.Error.ServiceUnknown',
  'org.freedesktop.DBus.Error.NameHasNoOwner',
  'org.freedesktop.DBus.Error.NoServer',
  'org.freedesktop.DBus.Error.NotSupported',
];
const NO_OBJECT_NAMES = [
  'org.freedesktop.DBus.Error.UnknownObject',
  'org.freedesktop.Secret.Error.NoSuchObject',
];

const errorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (Array.isArray(error)) {
    return error.map(String).join(' ');
  }
  return String(error);
};

const toBusError = (error: unknown): SecretServiceBusError => {
  const text = errorText(error);
  const transport = /ENOENT|ECONNREFUSED|DBUS_SESSION_BUS_ADDRESS|ENOTSOCK/.test(text);
  if (transport || NO_SERVICE_NAMES.some((name) => text.includes(name))) {
    return new SecretServiceBusError('no-service', text, error);
  }
  if (NO_OBJECT_NAMES.some((name) => text.includes(name))) {
    return new SecretServiceBusError('no-object', text, error);
  }
  return new SecretServiceBusError('other', text, error);
};

const isStringPath = (value: unknown): value is string => typeof value === 'string';

/** Property variants arrive as `[signature, [value]]`; reject anything else once, here. */
const variantValue = (result: unknown): unknown => {
  if (Array.isArray(result) && Array.isArray(result[1]) && result[1].length === 1) {
    return result[1][0];
  }
  throw new SecretServiceBusError('other', 'Unexpected D-Bus property reply shape.');
};

class DBusNativeSecretServiceBus implements SecretServiceBus {
  constructor(private readonly bus: DBusNativeBus) {
    bus.connection.on('error', () => undefined);
  }

  private call(
    path: string,
    iface: string,
    member: string,
    signature?: string,
    body?: unknown[],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.bus.invoke(
        {
          path,
          destination: SERVICE,
          interface: iface,
          member,
          ...(signature ? { signature, body: body ?? [] } : {}),
        },
        (error, result) => (error ? reject(toBusError(error)) : resolve(result)),
      );
    });
  }

  async readAlias(alias: string): Promise<string> {
    const result = await this.call(SERVICE_PATH, SERVICE_IFACE, 'ReadAlias', 's', [alias]);
    if (!isStringPath(result)) {
      throw new SecretServiceBusError('other', 'ReadAlias returned a non-path value.');
    }
    return result;
  }

  async readCollection(path: string): Promise<{ locked: boolean; label: string }> {
    const [locked, label] = await Promise.all(
      ['Locked', 'Label'].map(async (property) =>
        variantValue(
          await this.call(path, PROPERTIES_IFACE, 'Get', 'ss', [COLLECTION_IFACE, property]),
        ),
      ),
    );
    if (typeof locked !== 'boolean' || typeof label !== 'string') {
      throw new SecretServiceBusError('other', 'Collection properties had unexpected types.');
    }
    return { locked, label };
  }

  async unlock(path: string, signal: AbortSignal): Promise<'unlocked' | 'dismissed'> {
    const reply = await this.call(SERVICE_PATH, SERVICE_IFACE, 'Unlock', 'ao', [[path]]);
    const prompt: unknown = Array.isArray(reply) ? (reply as unknown[])[1] : undefined;
    if (!isStringPath(prompt)) {
      throw new SecretServiceBusError('other', 'Unlock returned an unexpected reply.');
    }
    if (prompt === NO_PROMPT) {
      return 'unlocked';
    }
    return this.runPrompt(prompt, signal);
  }

  private runPrompt(prompt: string, signal: AbortSignal): Promise<'unlocked' | 'dismissed'> {
    return new Promise((resolve, reject) => {
      const listener = (message: DBusMessage): void => {
        if (message.path !== prompt || message.member !== 'Completed') {
          return;
        }
        cleanup();
        const dismissed: unknown = Array.isArray(message.body)
          ? (message.body as unknown[])[0]
          : undefined;
        resolve(dismissed === true ? 'dismissed' : 'unlocked');
      };
      const onAbort = (): void => {
        cleanup();
        reject(signal.reason instanceof Error ? signal.reason : new Error('Prompt aborted.'));
      };
      const cleanup = (): void => {
        this.bus.connection.off?.('message', listener);
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.bus.connection.on('message', listener);
      this.bus.addMatch(
        `type='signal',interface='${PROMPT_IFACE}',member='Completed',path='${prompt}'`,
        (error) => {
          if (error) {
            cleanup();
            reject(toBusError(error));
            return;
          }
          this.call(prompt, PROMPT_IFACE, 'Prompt', 's', ['']).catch((promptError: unknown) => {
            cleanup();
            reject(toBusError(promptError));
          });
        },
      );
    });
  }

  close(): void {
    this.bus.connection.end();
  }
}

/**
 * Connects to the session bus with the maintained `@homebridge/dbus-native` client, loaded on
 * demand so non-Linux installs never touch it.
 */
export const openSessionSecretServiceBus = async (): Promise<SecretServiceBus> => {
  const specifier = '@homebridge/dbus-native';
  let module: DBusNativeModule;
  try {
    module = ((await import(specifier)) as { default: DBusNativeModule }).default;
  } catch (error) {
    throw new SecretServiceBusError(
      'other',
      `The D-Bus client could not be loaded: ${errorText(error)}`,
      error,
    );
  }
  try {
    return new DBusNativeSecretServiceBus(module.sessionBus());
  } catch (error) {
    throw toBusError(error);
  }
};
