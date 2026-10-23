/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';
import { CredentialError } from '../errors';
import { TokenRefreshService } from '../refresh/index';
import { createCodexCredentialRefresher, type AgentCredentialRefresher } from '../refresh/index';
import { toAgentAccountId } from '../types';

const baseCredential = {
  agentType: 'codex' as const,
  accountId: toAgentAccountId('refresh-account'),
  accessToken: 'old-token',
  refreshToken: 'refresh-token',
  idToken: null,
  tokenType: 'Bearer',
  scopes: ['scope:a'],
  expiresAt: Date.now() - 1,
  createdAt: Date.now() - 10_000,
  updatedAt: Date.now() - 10_000,
};

describe('credential refresh flows', () => {
  it('classifies codex HTTP 401 as INVALID_CREDENTIAL', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => {
      return new Response('unauthorized', { status: 401 });
    });

    const refresher = createCodexCredentialRefresher({
      fetchImplementation: fetchMock,
      tokenUrl: 'https://example.com/token',
      clientId: 'test-client',
    });

    await expect(refresher.refresh(baseCredential)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIAL',
    });
  });

  it('classifies codex HTTP 400 invalid_grant as INVALID_CREDENTIAL', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });

    const refresher = createCodexCredentialRefresher({
      fetchImplementation: fetchMock,
      tokenUrl: 'https://example.com/token',
      clientId: 'test-client',
    });

    await expect(refresher.refresh(baseCredential)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIAL',
    });
  });

  it('retries RATE_LIMITED refresh failures with exponential backoff', async () => {
    let attempts = 0;
    const refresher: AgentCredentialRefresher = {
      async refresh() {
        attempts += 1;
        if (attempts < 3) {
          throw new CredentialError('RATE_LIMITED', 'rate limited', {
            statusCode: 429,
          });
        }

        return {
          accessToken: 'new-token',
          refreshToken: 'new-refresh-token',
          idToken: null,
          tokenType: 'Bearer',
          scopes: ['scope:a'],
          expiresAt: Date.now() + 60_000,
        };
      },
    };

    const service = new TokenRefreshService({
      refreshers: { codex: refresher },
      retryBackoff: {
        maxAttempts: 4,
        initialDelayMs: 1,
        maxDelayMs: 1,
        multiplier: 1,
        jitterRatio: 0,
      },
    });

    const refreshed = await service.refreshCredential(baseCredential);

    expect(refreshed.accessToken).toBe('new-token');
    expect(attempts).toBe(3);
  });

  it('returns REFRESH_FAILED when refresh exceeds timeout', async () => {
    const refresher: AgentCredentialRefresher = {
      async refresh(_credential, context) {
        await new Promise<void>((resolve, reject) => {
          context?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });

        return {
          accessToken: 'unreachable',
          refreshToken: null,
          idToken: null,
          tokenType: null,
          scopes: [],
          expiresAt: null,
        };
      },
    };

    const service = new TokenRefreshService({
      refreshers: { codex: refresher },
      timeoutMs: 10,
      retryBackoff: {
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
        multiplier: 1,
        jitterRatio: 0,
      },
    });

    await expect(service.refreshCredential(baseCredential)).rejects.toMatchObject({
      code: 'REFRESH_FAILED',
    });
  });
});
