import { describe, expect, it, vi } from 'vitest';
import {
  toAgentAccountId,
  type AgentCredentialInput,
  type AgentCredentialRecord,
  type AgentType,
  type CredentialManager,
  type CredentialPrompter,
} from '@hey-hey/ui-common/agents';
import { runCredentialCommand } from './provider-credential-refresh';

type StoreCredential = Pick<CredentialManager, 'storeCredential'>['storeCredential'];

const createStoredRecord = (
  agentType: AgentType,
  credential: AgentCredentialInput,
): AgentCredentialRecord => ({
  agentType,
  accountId:
    typeof credential.accountId === 'string'
      ? toAgentAccountId(credential.accountId)
      : credential.accountId,
  accessToken: credential.accessToken,
  refreshToken: credential.refreshToken ?? null,
  idToken: credential.idToken ?? null,
  tokenType: credential.tokenType ?? null,
  scopes: [...credential.scopes],
  expiresAt: credential.expiresAt,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const createManager = (storeCredential?: StoreCredential) => ({
  manager: {
    storeCredential:
      storeCredential ??
      (async (agentType, credential) => createStoredRecord(agentType, credential)),
  },
});

const createPrompter = (
  promptSecret: Pick<CredentialPrompter, 'promptSecret'>['promptSecret'] = vi.fn(
    async () => 'token-123',
  ),
): Pick<CredentialPrompter, 'promptSecret'> => ({
  promptSecret,
});

describe('runCredentialCommand', () => {
  it('stores refreshed credential for explicit provider/account', async () => {
    const storeCredential = vi.fn<StoreCredential>(async (agentType, credential) =>
      createStoredRecord(agentType, credential),
    );
    const log = vi.fn();
    const logError = vi.fn();

    const ok = await runCredentialCommand(
      ['refresh', '--provider', 'claude', '--account', 'acct-1'],
      {
        resolveCredentialManager: async () => createManager(storeCredential),
        prompter: createPrompter(vi.fn(async () => 'token-123')),
        log,
        logError,
      },
    );

    expect(ok).toBe(true);
    expect(storeCredential).toHaveBeenCalledWith('claude', {
      accountId: 'acct-1',
      accessToken: 'token-123',
      refreshToken: null,
      idToken: null,
      tokenType: 'Bearer',
      scopes: [],
      expiresAt: null,
    });
    expect(log).toHaveBeenCalledWith('Refreshing Claude credential for account acct-1...');
    expect(logError).not.toHaveBeenCalled();
  });

  it('uses provider default account when --account is omitted', async () => {
    const originalAccount = process.env['HEYHEY_CLAUDE_ACCOUNT_ID'];
    process.env['HEYHEY_CLAUDE_ACCOUNT_ID'] = 'claude-default';
    const storeCredential = vi.fn<StoreCredential>(async (agentType, credential) =>
      createStoredRecord(agentType, credential),
    );

    try {
      const ok = await runCredentialCommand(['refresh', '--provider', 'claude'], {
        resolveCredentialManager: async () => createManager(storeCredential),
        prompter: createPrompter(vi.fn(async () => 'token-123')),
      });

      expect(ok).toBe(true);
      expect(storeCredential).toHaveBeenCalledWith(
        'claude',
        expect.objectContaining({ accountId: 'claude-default' }),
      );
    } finally {
      if (originalAccount === undefined) {
        delete process.env['HEYHEY_CLAUDE_ACCOUNT_ID'];
      } else {
        process.env['HEYHEY_CLAUDE_ACCOUNT_ID'] = originalAccount;
      }
    }
  });

  it('fails when required provider option is missing', async () => {
    const logError = vi.fn();

    const ok = await runCredentialCommand(['refresh'], {
      logError,
    });

    expect(ok).toBe(false);
    expect(logError).toHaveBeenCalledWith('Missing required option "--provider".');
  });

  it('fails when provider is invalid', async () => {
    const logError = vi.fn();

    const ok = await runCredentialCommand(['refresh', '--provider', 'other'], {
      logError,
    });

    expect(ok).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      'Unsupported provider "other". Expected "claude", "codex", or "opencode".',
    );
  });

  it('fails when token input is empty', async () => {
    const logError = vi.fn();

    const ok = await runCredentialCommand(['refresh', '--provider', 'codex'], {
      resolveCredentialManager: async () => createManager(),
      prompter: createPrompter(vi.fn(async () => '   ')),
      logError,
    });

    expect(ok).toBe(false);
    expect(logError).toHaveBeenCalledWith('Credential refresh failed: API key cannot be empty.');
  });

  it('returns false when prompt is cancelled', async () => {
    const logError = vi.fn();

    const ok = await runCredentialCommand(['refresh', '--provider', 'codex'], {
      resolveCredentialManager: async () => createManager(),
      prompter: createPrompter(
        vi.fn(async () => {
          throw new Error('input interrupted by user');
        }),
      ),
      logError,
    });

    expect(ok).toBe(false);
    expect(logError).toHaveBeenCalledWith('Credential refresh cancelled.');
  });
});
