import { describe, expect, it } from 'vitest';
import type { AgentCredentialRecord } from '../../credentials/index';
import { toAgentAccountId } from '../../credentials/index';
import { buildCodexCredentialEnvironment, buildCodexExecArgs } from '../CodexExecAdapter';

const makeCredential = (): AgentCredentialRecord => ({
  agentType: 'codex',
  accountId: toAgentAccountId('default'),
  accessToken: 'token-123',
  refreshToken: null,
  idToken: null,
  tokenType: 'Bearer',
  scopes: [],
  expiresAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('CodexExecAdapter', () => {
  it('builds exec args for prompt runs', () => {
    expect(
      buildCodexExecArgs({
        prompt: 'Apply the requested change.',
        resumeSessionId: null,
      }),
    ).toEqual(['exec', '--full-auto', '--json', 'Apply the requested change.']);
  });

  it('includes extra writable directories for prompt runs', () => {
    expect(
      buildCodexExecArgs({
        prompt: 'Apply the requested change.',
        resumeSessionId: null,
        extraWritableDirs: ['/tmp/one', '/tmp/two'],
      }),
    ).toEqual([
      'exec',
      '--full-auto',
      '--json',
      '--add-dir',
      '/tmp/one',
      '--add-dir',
      '/tmp/two',
      'Apply the requested change.',
    ]);
  });

  it('builds exec args for resumed runs', () => {
    expect(
      buildCodexExecArgs({
        prompt: 'Continue from previous context.',
        resumeSessionId: 'session-1',
      }),
    ).toEqual([
      'exec',
      'resume',
      '--full-auto',
      '--json',
      'session-1',
      'Continue from previous context.',
    ]);
  });

  it('includes extra writable directories for resumed runs', () => {
    expect(
      buildCodexExecArgs({
        prompt: 'Continue from previous context.',
        resumeSessionId: 'session-1',
        extraWritableDirs: ['/tmp/one'],
      }),
    ).toEqual([
      'exec',
      'resume',
      '--full-auto',
      '--json',
      '--add-dir',
      '/tmp/one',
      'session-1',
      'Continue from previous context.',
    ]);
  });

  it('builds credential environment with token defaults', () => {
    expect(
      buildCodexCredentialEnvironment({
        credential: makeCredential(),
      }),
    ).toEqual({
      OPENAI_API_KEY: 'token-123',
      OPENAI_ACCESS_TOKEN: 'token-123',
      OPENAI_TOKEN_TYPE: 'Bearer',
    });
  });

  it('applies environment overrides after token defaults', () => {
    expect(
      buildCodexCredentialEnvironment({
        credential: makeCredential(),
        environmentOverrides: {
          OPENAI_TOKEN_TYPE: 'CustomType',
          EXTRA_VAR: 'enabled',
        },
      }),
    ).toEqual({
      OPENAI_API_KEY: 'token-123',
      OPENAI_ACCESS_TOKEN: 'token-123',
      OPENAI_TOKEN_TYPE: 'CustomType',
      EXTRA_VAR: 'enabled',
    });
  });
});
