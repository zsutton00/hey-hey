import path from 'node:path';

import { CorruptedDataError, StorageFailureError } from '../errors';
import { encrypt, isNodeError, readEncryptedFile, secureDelete, secureWrite } from '../file-crypto';
import { toBuffer, zeroBuffer } from '../utils';
import type { PlatformStore } from './types';

const FILE_SUFFIX = '.kp';

const filePathFor = (dir: string, key: string): string => {
  const safe = Buffer.from(key, 'utf8').toString('base64url');
  return path.join(dir, `${safe}${FILE_SUFFIX}`);
};

/**
 * Disk-backed `PlatformStore` explicitly injected by persistence tests.
 * Normal CLI use always selects the OS keyring backend.
 *
 * The payload envelope (AES-GCM + device-derived secret + PBKDF2) is the same
 * one the OAuth file store uses, with disjoint filespaces:
 *   - OAuth:   `<base64url(key)>.access.enc` / `.refresh.enc`
 *   - Keypair: `<base64url(account)>.kp`
 *
 * Removing the injected test directory removes its stored records.
 */
export class FilePlatformStore implements PlatformStore {
  readonly name = 'file';

  constructor(private readonly dir: string) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async store(key: string, value: string): Promise<void> {
    try {
      const buffer = toBuffer(value);
      const encrypted = await encrypt(buffer);
      await secureWrite(filePathFor(this.dir, key), encrypted);
      zeroBuffer(buffer);
    } catch (error) {
      throw new StorageFailureError('Failed to store credential in file backend.', error);
    }
  }

  async retrieve(key: string): Promise<string | null> {
    try {
      const decrypted = await readEncryptedFile(filePathFor(this.dir, key));
      const value = decrypted.toString('utf8');
      zeroBuffer(decrypted);
      return value;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      if (error instanceof CorruptedDataError) throw error;
      throw new StorageFailureError('Failed to retrieve credential from file backend.', error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await secureDelete(filePathFor(this.dir, key));
    } catch (error) {
      throw new StorageFailureError('Failed to delete credential from file backend.', error);
    }
  }
}
