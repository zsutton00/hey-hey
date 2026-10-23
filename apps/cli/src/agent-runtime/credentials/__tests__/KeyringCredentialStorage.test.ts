/** @vitest-environment node */

import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toAgentAccountId } from '../types';
import type { KeyringModule } from '../storage/index';
import { KeyringCredentialStorage } from '../storage/index';

const createInMemoryKeyring = (): KeyringModule => {
  const store = new Map<string, string>();

  return {
    async getPassword(service, account) {
      return store.get(`${service}:${account}`) ?? null;
    },
    async setPassword(service, account, password) {
      store.set(`${service}:${account}`, password);
    },
    async deletePassword(service, account) {
      const key = `${service}:${account}`;
      const hasKey = store.has(key);
      store.delete(key);
      return hasKey;
    },
  };
};

describe('KeyringCredentialStorage', () => {
  const tempDirs: string[] = [];

  const createTempHome = (): string => {
    const tempHome = mkdtempSync(join(tmpdir(), 'ui-common-cred-keyring-'));
    tempDirs.push(tempHome);
    return tempHome;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores and retrieves credentials through keyring backend', async () => {
    const homeDir = createTempHome();
    const keyring = createInMemoryKeyring();
    const storage = new KeyringCredentialStorage({
      heyHeyHomeDir: homeDir,
      keyringLoader: async () => keyring,
    });

    const accountId = toAgentAccountId('acct-keyring');
    const now = Date.now();

    await storage.storeCredential({
      agentType: 'codex',
      accountId,
      accessToken: 'keyring-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      tokenType: 'Bearer',
      scopes: ['scope:one'],
      expiresAt: now + 30_000,
      createdAt: now,
      updatedAt: now,
    });

    const record = await storage.getCredential('codex', accountId);
    expect(record).toEqual(
      expect.objectContaining({
        accessToken: 'keyring-token',
        refreshToken: 'refresh-token',
      }),
    );

    const listed = await storage.listCredentials('codex');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.accountId).toBe(accountId);

    const indexPath = join(homeDir, 'credentials', 'keyring', 'index.json');
    const indexContent = readFileSync(indexPath, 'utf8');
    expect(indexContent).not.toContain('keyring-token');
    expect(indexContent).not.toContain('refresh-token');

    expect(await storage.deleteCredential('codex', accountId)).toBe(true);
    expect(await storage.getCredential('codex', accountId)).toBeNull();
  });

  it('reports unavailable keyring when loader returns null', async () => {
    const storage = new KeyringCredentialStorage({
      heyHeyHomeDir: createTempHome(),
      keyringLoader: async () => null,
    });

    expect(await storage.isAvailable()).toBe(false);
    await expect(
      storage.storeCredential({
        agentType: 'claude',
        accountId: toAgentAccountId('acct'),
        accessToken: 'token',
        refreshToken: null,
        idToken: null,
        tokenType: null,
        scopes: [],
        expiresAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ).rejects.toThrow('OS keyring is unavailable');
  });

  it('serializes concurrent index mutations for mixed store/delete operations', async () => {
    const homeDir = createTempHome();
    const keyring = createInMemoryKeyring();
    const storage = new KeyringCredentialStorage({
      heyHeyHomeDir: homeDir,
      keyringLoader: async () => keyring,
    });

    const now = Date.now();
    const accountToDelete = toAgentAccountId('acct-delete');
    await storage.storeCredential({
      agentType: 'claude',
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
        agentType: 'claude',
        accountId: toAgentAccountId('acct-a'),
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
        agentType: 'claude',
        accountId: toAgentAccountId('acct-b'),
        accessToken: 'token-b',
        refreshToken: null,
        idToken: null,
        tokenType: null,
        scopes: ['scope:b'],
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      storage.deleteCredential('claude', accountToDelete),
      storage.storeCredential({
        agentType: 'claude',
        accountId: toAgentAccountId('acct-c'),
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

    const listed = await storage.listCredentials('claude');
    const listedAccountIds = listed.map((entry) => entry.accountId).sort();

    expect(maxActiveReads).toBe(1);
    expect(listedAccountIds).toEqual([
      toAgentAccountId('acct-a'),
      toAgentAccountId('acct-b'),
      toAgentAccountId('acct-c'),
    ]);
  });
});
