import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CredentialStore, StorageFailureError } from '../store';
import { EncryptedCredentialFileStore } from '../fallback';

const credential = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: new Date().toISOString(),
  scope: ['profile'],
  tokenType: 'Bearer',
};

const tempDir = path.join(process.cwd(), 'tmp-credentials-store-test');

describe('CredentialStore', () => {
  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('round-trips a credential through the encrypted file store', async () => {
    const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
    await store.store('user:default', credential);
    await expect(store.retrieve('user:default')).resolves.toMatchObject({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
  });

  it('retrieve returns null when nothing is stored', async () => {
    const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
    await expect(store.retrieve('user:missing')).resolves.toBeNull();
  });

  it('delete removes both access and refresh entries', async () => {
    const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
    await store.store('user:default', credential);
    await store.delete('user:default');
    await expect(store.retrieve('user:default')).resolves.toBeNull();
  });

  describe('key validation', () => {
    it('rejects empty key', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      await expect(store.store('', credential)).rejects.toThrow('Key cannot be empty');
    });

    it('rejects key with null byte', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      await expect(store.store('user\0name', credential)).rejects.toThrow('invalid characters');
    });

    it('rejects key with slash', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      await expect(store.store('user/name', credential)).rejects.toThrow('invalid characters');
    });

    it('rejects key with backslash', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      await expect(store.store('user\\name', credential)).rejects.toThrow('invalid characters');
    });

    it('rejects key with shell metacharacters', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      for (const key of [
        'user`cmd',
        'user$var',
        'user;cmd',
        'user|cmd',
        'user&cmd',
        'user<f',
        'user>f',
        'user()',
      ]) {
        await expect(store.store(key, credential)).rejects.toThrow('shell metacharacters');
      }
    });

    it('rejects key longer than 255 characters', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      await expect(store.store('a'.repeat(256), credential)).rejects.toThrow(
        'cannot exceed 255 characters',
      );
    });

    it('accepts valid keys', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      for (const key of [
        'user:default',
        'user-123',
        'user_name',
        'user.name',
        'user@domain.com',
        'User123',
      ]) {
        await expect(store.store(key, credential)).resolves.toBeUndefined();
      }
    });

    it('validates key on retrieve', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      await expect(store.retrieve('user/name')).rejects.toThrow(StorageFailureError);
    });

    it('validates key on delete', async () => {
      const store = new CredentialStore(new EncryptedCredentialFileStore(tempDir));
      await expect(store.delete('user/name')).rejects.toThrow(StorageFailureError);
    });
  });
});
