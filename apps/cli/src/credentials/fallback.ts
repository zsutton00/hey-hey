import os from 'node:os';
import path from 'node:path';

import { CorruptedDataError, SerializationError, StorageFailureError } from './errors';
import { encrypt, isNodeError, readEncryptedFile, secureDelete, secureWrite } from './file-crypto';
import { toBuffer, zeroBuffer } from './utils';

const baseDir = (): string => {
  if (process.platform === 'win32') {
    return path.join(
      process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'heyhey',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'heyhey');
  }
  return path.join(os.homedir(), '.config', 'heyhey');
};

const keyToFilename = (key: string, kind: 'access' | 'refresh'): string => {
  const safe = Buffer.from(key, 'utf8').toString('base64url');
  return `${safe}.${kind}.enc`;
};

export class EncryptedCredentialFileStore {
  constructor(private readonly directory: string = baseDir()) {}

  async store(key: string, kind: 'access' | 'refresh', payload: string): Promise<void> {
    try {
      const dir = this.directory;
      const filePath = path.join(dir, keyToFilename(key, kind));
      const buffer = toBuffer(payload);
      const encrypted = await encrypt(buffer);
      await secureWrite(filePath, encrypted);
      zeroBuffer(buffer);
    } catch (error) {
      throw new StorageFailureError(
        'Failed to store credential in encrypted local storage.',
        error,
      );
    }
  }

  async retrieve(key: string, kind: 'access' | 'refresh'): Promise<string | null> {
    const dir = this.directory;
    const filePath = path.join(dir, keyToFilename(key, kind));
    try {
      const decrypted = await readEncryptedFile(filePath);
      const value = decrypted.toString('utf8');
      zeroBuffer(decrypted);
      return value;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      if (error instanceof CorruptedDataError) throw error;
      throw new StorageFailureError(
        'Failed to retrieve credential from encrypted local storage.',
        error,
      );
    }
  }

  async deleteKind(key: string, kind: 'access' | 'refresh'): Promise<void> {
    const dir = this.directory;
    const filePath = path.join(dir, keyToFilename(key, kind));
    try {
      await secureDelete(filePath);
    } catch (error) {
      throw new StorageFailureError(
        'Failed to delete credential from encrypted local storage.',
        error,
      );
    }
  }

  async delete(key: string): Promise<void> {
    const dir = this.directory;
    const accessPath = path.join(dir, keyToFilename(key, 'access'));
    const refreshPath = path.join(dir, keyToFilename(key, 'refresh'));
    try {
      await secureDelete(accessPath);
      await secureDelete(refreshPath);
    } catch (error) {
      throw new StorageFailureError(
        'Failed to delete credential from encrypted local storage.',
        error,
      );
    }
  }

  async serialize<T>(value: T): Promise<string> {
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw new SerializationError('Failed to serialize credential payload.', error);
    }
  }

  async parse<T>(value: string, parser: (input: unknown) => T): Promise<T> {
    try {
      return parser(JSON.parse(value));
    } catch (error) {
      throw new SerializationError('Failed to parse credential payload.', error);
    }
  }
}
