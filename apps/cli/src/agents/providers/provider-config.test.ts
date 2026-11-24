import { describe, expect, it, vi } from 'vitest';
import {
  buildCredentialRefreshCommand,
  extractCredentialLookupFromErrorMessage,
  resolveAgentAccountId,
  nativePermissionModeFor,
  resolveAgentProviderId,
  UnknownAgentProviderError,
  toProviderDisplayName,
} from './provider-config';

describe('provider-config', () => {
  it('maps providers to adapter ids', () => {
    expect(resolveAgentProviderId('claude')).toBe('claude');
    expect(resolveAgentProviderId('codex')).toBe('codex');
    expect(resolveAgentProviderId('opencode')).toBe('opencode');
    expect(resolveAgentProviderId('antigravity')).toBe('antigravity');
  });

  it.each(['claude_code', 'Codex CLI', 'codex-preview', 'unknown'])(
    'rejects the unknown provider id %s',
    (provider) => {
      expect(() => resolveAgentProviderId(provider)).toThrow(UnknownAgentProviderError);
    },
  );

  it('identifies Antigravity credentials and rejects unknown provider names', () => {
    expect(
      extractCredentialLookupFromErrorMessage('No Antigravity credential found for account google'),
    ).toEqual({ providerId: 'antigravity', accountId: 'google' });
    expect(() =>
      extractCredentialLookupFromErrorMessage('No Codex CLI credential found for account default'),
    ).toThrow(UnknownAgentProviderError);
  });

  it('uses the Antigravity account override', () => {
    vi.stubEnv('HEYHEY_ANTIGRAVITY_ACCOUNT_ID', 'google-account');
    try {
      expect(resolveAgentAccountId('antigravity')).toBe('google-account');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('formats provider labels', () => {
    expect(toProviderDisplayName('claude')).toBe('Claude');
    expect(toProviderDisplayName('codex')).toBe('Codex');
    expect(toProviderDisplayName('antigravity')).toBe('Antigravity');
  });

  it('builds credential refresh command', () => {
    expect(buildCredentialRefreshCommand('codex', 'acct-2')).toBe(
      'heyhey credential refresh --provider codex --account acct-2',
    );
  });

  it('extracts missing-credential lookup from adapter errors', () => {
    expect(
      extractCredentialLookupFromErrorMessage('No Claude credential found for account default'),
    ).toEqual({
      providerId: 'claude',
      accountId: 'default',
    });

    expect(
      extractCredentialLookupFromErrorMessage('No Codex credential found for account acct-2'),
    ).toEqual({
      providerId: 'codex',
      accountId: 'acct-2',
    });
  });

  it('returns null for non-matching messages', () => {
    expect(extractCredentialLookupFromErrorMessage('something else')).toBeNull();
  });

  it('resolves account id from env variables', () => {
    const originalAgent = process.env['HEYHEY_AGENT_ACCOUNT_ID'];
    const originalClaude = process.env['HEYHEY_CLAUDE_ACCOUNT_ID'];
    const originalCodex = process.env['HEYHEY_CODEX_ACCOUNT_ID'];

    process.env['HEYHEY_AGENT_ACCOUNT_ID'] = 'agent-default';
    process.env['HEYHEY_CLAUDE_ACCOUNT_ID'] = 'claude-specific';
    process.env['HEYHEY_CODEX_ACCOUNT_ID'] = 'codex-specific';

    try {
      expect(resolveAgentAccountId('claude')).toBe('claude-specific');
      expect(resolveAgentAccountId('codex')).toBe('codex-specific');
    } finally {
      if (originalAgent === undefined) {
        delete process.env['HEYHEY_AGENT_ACCOUNT_ID'];
      } else {
        process.env['HEYHEY_AGENT_ACCOUNT_ID'] = originalAgent;
      }

      if (originalClaude === undefined) {
        delete process.env['HEYHEY_CLAUDE_ACCOUNT_ID'];
      } else {
        process.env['HEYHEY_CLAUDE_ACCOUNT_ID'] = originalClaude;
      }

      if (originalCodex === undefined) {
        delete process.env['HEYHEY_CODEX_ACCOUNT_ID'];
      } else {
        process.env['HEYHEY_CODEX_ACCOUNT_ID'] = originalCodex;
      }
    }
  });
});

describe('nativePermissionModeFor', () => {
  it('reports auto for Claude and Codex and nothing for OpenCode', () => {
    expect(nativePermissionModeFor('claude')).toBe('auto');
    expect(nativePermissionModeFor('codex')).toBe('auto');
    expect(nativePermissionModeFor('opencode')).toBeNull();
    expect(nativePermissionModeFor('antigravity')).toBeNull();
  });
});
