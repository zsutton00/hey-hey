/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { CredentialManager } from '../CredentialManager';
import { TokenRefreshService } from '../refresh/index';
import type { CredentialStorageBackend } from '../storage/index';
import { toAgentAccountId, type AgentCredentialRecord, type AgentType } from '../types';

const createInMemoryStorage = (): CredentialStorageBackend => {
  const records = new Map<string, AgentCredentialRecord>();

  const key = (agentType: AgentType, accountId: string): string => `${agentType}:${accountId}`;

  return {
    kind: 'encrypted-file',
    async getCredential(agentType, accountId) {
      return records.get(key(agentType, accountId)) ?? null;
    },
    async storeCredential(credential) {
      records.set(key(credential.agentType, credential.accountId), credential);
    },
    async listCredentials(agentType) {
      return Array.from(records.values())
        .filter((credential) => (agentType ? credential.agentType === agentType : true))
        .map(
          ({
            accessToken: _access,
            refreshToken: _refresh,
            idToken: _id,
            tokenType: _type,
            ...metadata
          }) => metadata,
        );
    },
    async deleteCredential(agentType, accountId) {
      return records.delete(key(agentType, accountId));
    },
    async clearAll() {
      records.clear();
    },
  };
};

describe('CredentialManager', () => {
  it('stores credentials and refreshes them on demand', async () => {
    const storage = createInMemoryStorage();
    const now = Date.now();

    const refreshService = new TokenRefreshService({
      refreshers: {
        claude: {
          async refresh(credential) {
            return {
              accessToken: 'fresh-token',
              refreshToken: credential.refreshToken,
              idToken: credential.idToken,
              tokenType: credential.tokenType,
              scopes: credential.scopes,
              expiresAt: now + 120_000,
            };
          },
        },
      },
      retryBackoff: {
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
        multiplier: 1,
        jitterRatio: 0,
      },
    });

    const manager = new CredentialManager({
      storage,
      refreshService,
      refreshIfExpiringWithinMs: 60_000,
      now: () => now,
    });

    const events: string[] = [];
    manager.subscribe((event) => {
      events.push(event.type);
    });

    await manager.storeCredential('claude', {
      accountId: toAgentAccountId('acct-claude'),
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      idToken: null,
      tokenType: 'Bearer',
      scopes: ['scope:a'],
      expiresAt: now + 10_000,
    });

    const credential = await manager.getCredential('claude', toAgentAccountId('acct-claude'));

    expect(credential?.accessToken).toBe('fresh-token');
    expect(events).toEqual(['stored', 'refreshed']);

    const lifecycle = manager.getLifecycleMetadata('claude', toAgentAccountId('acct-claude'));
    expect(lifecycle).toEqual(
      expect.objectContaining({
        agentType: 'claude',
        accountId: toAgentAccountId('acct-claude'),
      }),
    );
  });

  it('updates lifecycle lastRefreshedAt for subsequent refreshes', async () => {
    const storage = createInMemoryStorage();
    let nowValue = 1_000_000;

    const refreshService = new TokenRefreshService({
      refreshers: {
        codex: {
          async refresh(credential) {
            return {
              accessToken: `fresh-token-${nowValue}`,
              refreshToken: credential.refreshToken,
              idToken: credential.idToken,
              tokenType: credential.tokenType,
              scopes: credential.scopes,
              expiresAt: nowValue + 120_000,
            };
          },
        },
      },
      retryBackoff: {
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
        multiplier: 1,
        jitterRatio: 0,
      },
    });

    const manager = new CredentialManager({
      storage,
      refreshService,
      now: () => nowValue,
    });

    const accountId = toAgentAccountId('acct-codex');
    await manager.storeCredential('codex', {
      accountId,
      accessToken: 'initial-token',
      refreshToken: 'refresh-token',
      idToken: null,
      tokenType: 'Bearer',
      scopes: ['scope:a'],
      expiresAt: nowValue + 10_000,
    });

    await manager.getCredential('codex', accountId, { forceRefresh: true });
    const firstLifecycle = manager.getLifecycleMetadata('codex', accountId);
    expect(firstLifecycle?.lastRefreshedAt).toBe(nowValue);

    nowValue += 5_000;

    await manager.getCredential('codex', accountId, { forceRefresh: true });
    const secondLifecycle = manager.getLifecycleMetadata('codex', accountId);
    expect(secondLifecycle?.lastRefreshedAt).toBe(nowValue);
  });
});
