import { Entry } from '@napi-rs/keyring';

import { PermissionDeniedError, PlatformUnavailableError, StorageFailureError } from '../errors';
import type { PlatformStore } from './types';

const SERVICE = 'heyhey-cli';

export interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry;

const defaultEntryFactory: KeyringEntryFactory = (service, account) => new Entry(service, account);

const isNoEntry = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes('no matching entry') ||
    lower.includes('no entry') ||
    lower.includes('not found') ||
    lower.includes('could not be found')
  );
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

  constructor(private readonly entryFactory: KeyringEntryFactory = defaultEntryFactory) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async store(key: string, value: string): Promise<void> {
    try {
      this.entryFactory(SERVICE, key).setPassword(value);
    } catch (error) {
      throw classify(error, 'store');
    }
  }

  async retrieve(key: string): Promise<string | null> {
    try {
      const value = this.entryFactory(SERVICE, key).getPassword();
      return value ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNoEntry(message)) return null;
      throw classify(error, 'retrieve');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      this.entryFactory(SERVICE, key).deletePassword();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNoEntry(message)) return;
      throw classify(error, 'delete');
    }
  }
}
