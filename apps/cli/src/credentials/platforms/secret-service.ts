import {
  DefaultCollectionMissingError,
  PermissionDeniedError,
  PlatformUnavailableError,
  StorageFailureError,
  StorageLockedError,
} from '../errors';

/**
 * Failure kinds the bus adapter can establish from D-Bus error names or transport errors.
 * `no-service`: no session bus or no Secret Service owner. `no-object`: the service answered
 * that the addressed object does not exist. Anything else stays `other`, never guessed.
 */
export type SecretServiceBusFailureKind = 'no-service' | 'no-object' | 'other';

export class SecretServiceBusError extends Error {
  constructor(
    readonly kind: SecretServiceBusFailureKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SecretServiceBusError';
  }
}

/** The external boundary: org.freedesktop.secrets on the session bus. Responses arrive validated. */
export interface SecretServiceBus {
  /** Object path behind a collection alias; `/` means the alias is unset. */
  readAlias(alias: string): Promise<string>;
  readCollection(path: string): Promise<{ locked: boolean; label: string }>;
  /** Resolves after the service (and, when needed, the native prompt) finished. */
  unlock(path: string, signal: AbortSignal): Promise<'unlocked' | 'dismissed'>;
  close(): void;
}

export type DefaultCollectionState =
  | { kind: 'ready'; path: string; label: string }
  | { kind: 'locked'; path: string; label: string }
  | { kind: 'no-service'; reason: string }
  | { kind: 'no-default'; why: 'alias-unset' | 'collection-missing'; path: string }
  | { kind: 'unknown'; reason: string };

const NO_COLLECTION = '/';
const PROMPT_TIMEOUT_MS = 120_000;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Reads and unlocks whichever collection the desktop currently resolves as "default". */
export class SecretServiceDefaultCollection {
  constructor(
    private readonly openBus: () => Promise<SecretServiceBus>,
    private readonly promptTimeoutMs: number = PROMPT_TIMEOUT_MS,
  ) {}

  async inspect(): Promise<DefaultCollectionState> {
    let bus: SecretServiceBus;
    try {
      bus = await this.openBus();
    } catch (error) {
      return this.fromFailure(error);
    }
    try {
      return await this.inspectWith(bus);
    } finally {
      bus.close();
    }
  }

  /** Inspects, runs the native unlock flow when needed, and throws the specific cause otherwise. */
  async ensureUsable(): Promise<{ path: string; label: string }> {
    const first = await this.inspect();
    if (first.kind === 'ready') {
      return first;
    }
    if (first.kind !== 'locked') {
      throw this.toError(first);
    }

    await this.unlockNatively(first.path);
    const second = await this.inspect();
    if (second.kind === 'ready') {
      return second;
    }
    if (second.kind === 'locked') {
      throw new StorageLockedError(
        `The default keyring "${second.label}" is still locked after the unlock prompt.`,
      );
    }
    throw this.toError(second);
  }

  private async inspectWith(bus: SecretServiceBus): Promise<DefaultCollectionState> {
    let path: string;
    try {
      path = await bus.readAlias('default');
    } catch (error) {
      return this.fromFailure(error);
    }
    if (path === NO_COLLECTION) {
      return { kind: 'no-default', why: 'alias-unset', path };
    }

    try {
      const collection = await bus.readCollection(path);
      return { kind: collection.locked ? 'locked' : 'ready', path, label: collection.label };
    } catch (error) {
      if (error instanceof SecretServiceBusError && error.kind === 'no-object') {
        return { kind: 'no-default', why: 'collection-missing', path };
      }
      return this.fromFailure(error);
    }
  }

  private async unlockNatively(path: string): Promise<void> {
    let bus: SecretServiceBus;
    try {
      bus = await this.openBus();
    } catch (error) {
      throw this.toError(this.fromFailure(error));
    }
    try {
      const signal = AbortSignal.timeout(this.promptTimeoutMs);
      const outcome = await bus.unlock(path, signal);
      if (outcome === 'dismissed') {
        throw new PermissionDeniedError('The keyring unlock prompt was dismissed or cancelled.');
      }
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new StorageLockedError('The keyring unlock prompt was not answered in time.', error);
      }
      throw this.toError(this.fromFailure(error));
    } finally {
      bus.close();
    }
  }

  private fromFailure(error: unknown): DefaultCollectionState {
    if (error instanceof SecretServiceBusError && error.kind === 'no-service') {
      return { kind: 'no-service', reason: describe(error) };
    }
    return { kind: 'unknown', reason: describe(error) };
  }

  private toError(state: DefaultCollectionState): Error {
    switch (state.kind) {
      case 'ready':
        return new StorageFailureError('Protected storage is ready; no failure to describe.');
      case 'no-service':
        return new PlatformUnavailableError(
          `The Secret Service is not reachable on the session bus: ${state.reason}`,
        );
      case 'no-default':
        return new DefaultCollectionMissingError(
          state.why === 'alias-unset'
            ? 'No keyring is selected as the default.'
            : `The default keyring points at ${state.path}, which does not exist.`,
        );
      case 'locked':
        return new StorageLockedError(`The default keyring "${state.label}" is locked.`);
      case 'unknown':
        return new StorageFailureError(
          `The Secret Service could not be inspected: ${state.reason}`,
        );
    }
  }
}
