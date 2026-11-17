import { randomUUID } from 'node:crypto';

import { Entry } from '@napi-rs/keyring';

import {
  isCredentialError,
  PermissionDeniedError,
  PlatformUnavailableError,
  StorageFailureError,
} from '../errors';
import { openSessionSecretServiceBus } from './dbus-native-bus';
import { SecretServiceDefaultCollection } from './secret-service';
import type { PlatformStore } from './types';

const SERVICE = 'heyhey-cli';

export interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry;

const defaultEntryFactory: KeyringEntryFactory = (service, account) => new Entry(service, account);

/**
 * Only the binding's own "entry absent" answer counts as ordinary absence. Generic
 * "not found" wording is deliberately excluded: a missing D-Bus object or collection is an
 * infrastructure failure that must not look like an empty store.
 */
const isNoEntry = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes('no matching entry') || lower.includes('no entry');
};

const isPermissionDenied = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes('denied') ||
    lower.includes('not authorized') ||
    lower.includes('user interaction is not allowed')
  );
};

const isUnavailable = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes('platform failure') ||
    lower.includes('no storage access') ||
    lower.includes('service unavailable') ||
    lower.includes('secret service')
  );
};

const classify = (error: unknown, op: 'store' | 'retrieve' | 'delete'): Error => {
  const message = error instanceof Error ? error.message : String(error);
  if (isPermissionDenied(message)) {
    return new PermissionDeniedError(
      'Permission denied: keychain access requires user approval.',
      error,
    );
  }
  if (isUnavailable(message)) {
    return new PlatformUnavailableError('OS keychain unavailable.', error);
  }
  return new StorageFailureError(`Failed to ${op} credential in OS keychain.`, error);
};

export class KeyringPlatformStore implements PlatformStore {
  readonly name = 'os-keyring';

  private readonly defaultCollection: SecretServiceDefaultCollection;

  constructor(
    private readonly entryFactory: KeyringEntryFactory = defaultEntryFactory,
    private readonly service: string = SERVICE,
    defaultCollection: SecretServiceDefaultCollection = new SecretServiceDefaultCollection(
      openSessionSecretServiceBus,
    ),
  ) {
    this.defaultCollection = defaultCollection;
  }

  /**
   * Proves the store can really hold a credential: resolves and (natively) unlocks the Linux
   * default collection, then writes, reads back and removes one unique non-secret entry.
   * Only that diagnostic entry is ever cleaned up.
   */
  async ensureReady(accountPrefix: string): Promise<void> {
    if (process.platform === 'linux') {
      await this.defaultCollection.ensureUsable();
    }

    const account = `${accountPrefix}diagnostic/${randomUUID()}`;
    const marker = 'heyhey-storage-check';
    try {
      await this.store(account, marker);
      const read = await this.retrieve(account);
      if (read !== marker) {
        throw new StorageFailureError('Protected storage did not return the diagnostic entry.');
      }
    } finally {
      await this.delete(account).catch((cleanupError: unknown) => {
        console.error(
          `[credentials] diagnostic_cleanup_failed code=${
            isCredentialError(cleanupError) ? cleanupError.code : 'UNKNOWN'
          } reason=${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      });
    }
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async store(key: string, value: string): Promise<void> {
    try {
      this.entryFactory(this.service, key).setPassword(value);
    } catch (error) {
      throw await this.refine(classify(error, 'store'));
    }
  }

  async retrieve(key: string): Promise<string | null> {
    try {
      const value = this.entryFactory(this.service, key).getPassword();
      return value ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNoEntry(message)) return null;
      throw await this.refine(classify(error, 'retrieve'));
    }
  }

  async delete(key: string): Promise<void> {
    try {
      this.entryFactory(this.service, key).deletePassword();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNoEntry(message)) return;
      throw await this.refine(classify(error, 'delete'));
    }
  }

  /**
   * A generic binding failure on Linux is re-examined against the Secret Service so the error
   * names what is actually wrong. If the inspection proves nothing, the original error stands.
   */
  private async refine(original: Error): Promise<Error> {
    if (process.platform !== 'linux' || original instanceof PermissionDeniedError) {
      return original;
    }
    const state = await this.defaultCollection.inspect().catch(() => null);
    if (state === null || state.kind === 'ready' || state.kind === 'unknown') {
      return original;
    }
    return this.defaultCollection
      .ensureUsable()
      .then(() => original)
      .catch((diagnosis: unknown) => (diagnosis instanceof Error ? diagnosis : original));
  }
}
