import type { CredentialPathOptions } from '../paths';
import type { CredentialStorageBackend } from './CredentialStorageBackend';
import {
  KeyringCredentialStorage,
  type KeyringCredentialStorageOptions,
} from './KeyringCredentialStorage';
import {
  EncryptedFileCredentialStorage,
  type EncryptedFileCredentialStorageOptions,
} from './EncryptedFileCredentialStorage';

export interface CredentialStorageFactoryOptions extends CredentialPathOptions {
  preferredBackend?: ('auto' | 'keyring' | 'encrypted-file') | undefined;
  keyring?: Omit<KeyringCredentialStorageOptions, 'heyHeyHomeDir'> | undefined;
  encryptedFile?: Omit<EncryptedFileCredentialStorageOptions, 'heyHeyHomeDir'> | undefined;
}

export interface CredentialStorageResolution {
  backend: CredentialStorageBackend;
  usingFallback: boolean;
}

const buildKeyringBackend = (options: CredentialStorageFactoryOptions): KeyringCredentialStorage =>
  new KeyringCredentialStorage({
    heyHeyHomeDir: options.heyHeyHomeDir,
    ...(options.keyring ?? {}),
  });

const buildEncryptedBackend = (
  options: CredentialStorageFactoryOptions,
): EncryptedFileCredentialStorage =>
  new EncryptedFileCredentialStorage({
    heyHeyHomeDir: options.heyHeyHomeDir,
    ...(options.encryptedFile ?? {}),
  });

export const createCredentialStorage = async (
  options: CredentialStorageFactoryOptions = {},
): Promise<CredentialStorageResolution> => {
  const preferred = options.preferredBackend ?? 'auto';

  if (preferred === 'encrypted-file') {
    return {
      backend: buildEncryptedBackend(options),
      usingFallback: false,
    };
  }

  const keyringBackend = buildKeyringBackend(options);
  const keyringAvailable = await keyringBackend.isAvailable();

  if (preferred === 'keyring') {
    if (!keyringAvailable) {
      throw new Error('OS keyring is unavailable on this machine');
    }

    return {
      backend: keyringBackend,
      usingFallback: false,
    };
  }

  if (keyringAvailable) {
    return {
      backend: keyringBackend,
      usingFallback: false,
    };
  }

  return {
    backend: buildEncryptedBackend(options),
    usingFallback: true,
  };
};
