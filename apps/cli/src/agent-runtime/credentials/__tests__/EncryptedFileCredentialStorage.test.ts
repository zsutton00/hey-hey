/** @vitest-environment node */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toAgentAccountId } from '../types';
import { EncryptedFileCredentialStorage } from '../storage/index';

describe('EncryptedFileCredentialStorage', () => {
  const tempDirs: string[] = [];

  const createTempHome = (): string => {
    const tempHome = mkdtempSync(join(tmpdir(), 'ui-common-cred-encrypted-'));
    tempDirs.push(tempHome);
    return tempHome;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores, lists, and retrieves encrypted credentials', async () => {
    const homeDir = createTempHome();
    const storage = new EncryptedFileCredentialStorage({
      heyHeyHomeDir: homeDir,
      passphrase: 'test-passphrase',
    });

    const accountId = toAgentAccountId('account-1');
    const now = Date.now();

    await storage.storeCredential({
      agentType: 'claude',
      accountId,
      accessToken: 'secret-access-token',
      refreshToken: 'refresh-token',
      idToken: null,
      tokenType: 'Bearer',
      scopes: ['scope:a', 'scope:b'],
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const metadata = await storage.listCredentials('claude');
    expect(metadata).toEqual([
      expect.objectContaining({
        agentType: 'claude',
        accountId,
      }),
    ]);

    const record = await storage.getCredential('claude', accountId);
    expect(record).toEqual(
      expect.objectContaining({
        accessToken: 'secret-access-token',
        refreshToken: 'refresh-token',
      }),
    );

    const encryptedDir = join(homeDir, 'credentials', 'encrypted');
    const indexContent = readFileSync(join(encryptedDir, 'index.json'), 'utf8');
    expect(indexContent).not.toContain('secret-access-token');

    const files = metadata.map(
      (item) =>
        `${item.agentType}-${Buffer.from(item.accountId, 'utf8').toString(
          'base64url',
        )}.credential.json`,
    );
    const credentialContent = readFileSync(join(encryptedDir, files[0]!), 'utf8');
    expect(credentialContent).not.toContain('secret-access-token');
  });

  it('deletes and clears credentials', async () => {
    const homeDir = createTempHome();
    const storage = new EncryptedFileCredentialStorage({
      heyHeyHomeDir: homeDir,
      passphrase: 'test-passphrase',
    });

    const accountId = toAgentAccountId('account-2');
    const now = Date.now();

    await storage.storeCredential({
      agentType: 'codex',
      accountId,
      accessToken: 'token',
      refreshToken: null,
      idToken: null,
      tokenType: null,
      scopes: [],
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(await storage.deleteCredential('codex', accountId)).toBe(true);
    expect(await storage.getCredential('codex', accountId)).toBeNull();

    await storage.storeCredential({
      agentType: 'codex',
      accountId,
      accessToken: 'token',
      refreshToken: null,
      idToken: null,
      tokenType: null,
      scopes: [],
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await storage.clearAll();
    expect(await storage.listCredentials()).toEqual([]);
  });

  it('serializes concurrent index mutations for mixed store/delete operations', async () => {
    const homeDir = createTempHome();
    const storage = new EncryptedFileCredentialStorage({
      heyHeyHomeDir: homeDir,
      passphrase: 'test-passphrase',
    });

    const now = Date.now();
    const accountToDelete = toAgentAccountId('account-delete');
    await storage.storeCredential({
      agentType: 'codex',
      accountId: accountToDelete,
      accessToken: 'seed-token',
      refreshToken: null,
      idToken: null,
      tokenType: null,
      scopes: [],
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const internals = storage as unknown as {
      readIndex: () => Promise<unknown>;
    };
    const originalReadIndex = internals.readIndex.bind(storage);
    let activeReads = 0;
    let maxActiveReads = 0;
    internals.readIndex = async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 10));
      try {
        return await originalReadIndex();
      } finally {
        activeReads -= 1;
      }
    };

    await Promise.all([
      storage.storeCredential({
        agentType: 'codex',
        accountId: toAgentAccountId('account-a'),
        accessToken: 'token-a',
        refreshToken: null,
        idToken: null,
        tokenType: null,
        scopes: ['scope:a'],
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      storage.storeCredential({
        agentType: 'codex',
        accountId: toAgentAccountId('account-b'),
        accessToken: 'token-b',
        refreshToken: null,
        idToken: null,
        tokenType: null,
        scopes: ['scope:b'],
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      storage.deleteCredential('codex', accountToDelete),
      storage.storeCredential({
        agentType: 'codex',
        accountId: toAgentAccountId('account-c'),
        accessToken: 'token-c',
        refreshToken: null,
        idToken: null,
        tokenType: null,
        scopes: ['scope:c'],
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const listed = await storage.listCredentials('codex');
    const listedAccountIds = listed.map((entry) => entry.accountId).sort();

    expect(maxActiveReads).toBe(1);
    expect(listedAccountIds).toEqual([
      toAgentAccountId('account-a'),
      toAgentAccountId('account-b'),
      toAgentAccountId('account-c'),
    ]);
  });
});
