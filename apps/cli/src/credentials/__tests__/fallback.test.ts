import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncryptedCredentialFileStore } from '../fallback';

const tempDir = path.join(process.cwd(), 'tmp-credentials-test');

const keyToFilename = (key: string, kind: 'access' | 'refresh'): string => {
  const safe = Buffer.from(key, 'utf8').toString('base64url');
  return `${safe}.${kind}.enc`;
};

// Mirrors the v1 (hostname-derived) envelope so the migration path is tested
// against the exact bytes older CLIs wrote.
const legacyRecord = async (plaintext: string, hostname = os.hostname()): Promise<string> => {
  const pieces = [os.userInfo().username, hostname, os.homedir()];
  if (process.platform === 'linux') {
    pieces.push((await fs.readFile('/etc/machine-id', 'utf8')).trim());
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(pieces.join('|'), salt, 310_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
};

const encryptedFileStore = new EncryptedCredentialFileStore(tempDir);

describe('EncryptedCredentialFileStore', () => {
  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves encrypted payloads', async () => {
    await encryptedFileStore.store('user:default', 'access', JSON.stringify({ token: 'abc' }));
    const value = await encryptedFileStore.retrieve('user:default', 'access');
    expect(value).toBe(JSON.stringify({ token: 'abc' }));
  });

  it('deletes access and refresh payloads securely', async () => {
    await encryptedFileStore.store('user:delete', 'access', JSON.stringify({ token: 'abc' }));
    await encryptedFileStore.store('user:delete', 'refresh', JSON.stringify({ token: 'refresh' }));
    await encryptedFileStore.delete('user:delete');
    const access = await encryptedFileStore.retrieve('user:delete', 'access');
    const refresh = await encryptedFileStore.retrieve('user:delete', 'refresh');
    expect(access).toBeNull();
    expect(refresh).toBeNull();
  });

  it('throws on corrupted data', async () => {
    const filePath = path.join(tempDir, keyToFilename('user:corrupt', 'access'));
    await fs.writeFile(filePath, 'not-json');
    await expect(encryptedFileStore.retrieve('user:corrupt', 'access')).rejects.toThrow();
  });

  it('writes v2 records', async () => {
    await encryptedFileStore.store('user:v2', 'access', 'payload');
    const raw = await fs.readFile(path.join(tempDir, keyToFilename('user:v2', 'access')), 'utf8');
    expect(JSON.parse(raw) as { v: number }).toMatchObject({ v: 2 });
  });

  it('reads a legacy v1 record and re-saves it as v2 under the same file name', async () => {
    const filePath = path.join(tempDir, keyToFilename('user:legacy', 'access'));
    await fs.writeFile(filePath, await legacyRecord('legacy-token'), { mode: 0o600 });

    await expect(encryptedFileStore.retrieve('user:legacy', 'access')).resolves.toBe(
      'legacy-token',
    );
    const raw = await fs.readFile(filePath, 'utf8');
    expect(JSON.parse(raw) as { v: number }).toMatchObject({ v: 2 });
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);

    // A v2 record survives a hostname change.
    const hostname = vi.spyOn(os, 'hostname').mockReturnValue('Other-Host.local');
    try {
      await expect(encryptedFileStore.retrieve('user:legacy', 'access')).resolves.toBe(
        'legacy-token',
      );
    } finally {
      hostname.mockRestore();
    }
  });

  it('tells the user to log in again when a record cannot be decrypted', async () => {
    const filePath = path.join(tempDir, keyToFilename('user:moved', 'access'));
    await fs.writeFile(filePath, await legacyRecord('token', 'Some-Other-Host.local'));
    await expect(encryptedFileStore.retrieve('user:moved', 'access')).rejects.toThrow(
      /heyhey login/,
    );
  });
});
