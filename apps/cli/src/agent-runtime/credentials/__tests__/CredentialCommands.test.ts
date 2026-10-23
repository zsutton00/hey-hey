/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { CredentialManager } from '../CredentialManager';
import { runCredentialCommand } from '../cli/credentialCommands';
import type { CredentialPrompter } from '../cli/interactivePrompt';
import type { CredentialStorageBackend } from '../storage/index';
import type { AgentCredentialRecord, AgentType } from '../types';

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
          ({ accessToken: _a, refreshToken: _r, idToken: _i, tokenType: _t, ...metadata }) =>
            metadata,
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

class BufferingOutput extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }

  toText(): string {
    return this.chunks.join('');
  }
}

const createPrompter = (answers: {
  prompt?: string[] | undefined;
  promptSecret?: string[] | undefined;
  confirm?: boolean[] | undefined;
}): CredentialPrompter => {
  const promptQueue = [...(answers.prompt ?? [])];
  const secretQueue = [...(answers.promptSecret ?? [])];
  const confirmQueue = [...(answers.confirm ?? [])];

  return {
    async prompt() {
      return promptQueue.shift() ?? '';
    },
    async promptSecret() {
      return secretQueue.shift() ?? '';
    },
    async confirm() {
      return confirmQueue.shift() ?? false;
    },
  };
};

describe('credential CLI commands', () => {
  it('adds, lists, and removes credentials through command handlers', async () => {
    const manager = new CredentialManager({
      storage: createInMemoryStorage(),
      now: () => 1_000,
    });

    const output = new BufferingOutput();

    await runCredentialCommand('add-credential', [], {
      manager,
      output,
      prompter: createPrompter({
        prompt: ['claude', 'acct-1', 'Bearer', 'scope:a,scope:b', ''],
        promptSecret: ['access-secret', 'refresh-secret', 'id-secret'],
      }),
      now: () => 1_000,
    });

    await runCredentialCommand('list-credentials', [], {
      manager,
      output,
      now: () => 1_000,
    });

    await runCredentialCommand('remove-credential', ['--agent', 'claude', '--account', 'acct-1'], {
      manager,
      output,
      prompter: createPrompter({ confirm: [true] }),
      now: () => 1_000,
    });

    const outputText = output.toText();

    expect(outputText).toContain('Stored claude credential for account acct-1.');
    expect(outputText).toContain('agent=claude account=acct-1');
    expect(outputText).toContain('Removed claude credential for account acct-1.');

    // Secret values must never be printed.
    expect(outputText).not.toContain('access-secret');
    expect(outputText).not.toContain('refresh-secret');
    expect(outputText).not.toContain('id-secret');
  });
});
