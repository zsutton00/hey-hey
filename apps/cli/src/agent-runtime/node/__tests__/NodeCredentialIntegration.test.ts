/** @vitest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CredentialManager } from '../../credentials/index';
import type { CredentialStorageBackend } from '../../credentials/index';
import type { AgentCredentialRecord, AgentType } from '../../credentials/index';
import { toAgentAccountId } from '../../credentials/index';
import type { AgentMessage } from '../../core/index';
import { NodeAgentClient } from '../NodeAgentClient';

const collectMessages = async (stream: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> => {
  const messages: AgentMessage[] = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

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

describe('Node adapter credential integration', () => {
  const tempDirs: string[] = [];
  const originalHome = process.env['HEYHEY_HOME_DIR'];

  const createTempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-common-node-cred-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    process.env['HEYHEY_HOME_DIR'] = originalHome;

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('injects refreshed credential env vars and persists credential lifecycle metadata', async () => {
    const tempHome = createTempDir();
    process.env['HEYHEY_HOME_DIR'] = tempHome;

    const scriptPath = join(tempHome, 'mock-codex.mjs');
    writeFileSync(
      scriptPath,
      `
const args = process.argv.slice(2);
const promptIndex = args.indexOf("--prompt");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "session-cred-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", result: { prompt, envToken: process.env.OPENAI_API_KEY } }) + "\\n");
`,
      'utf8',
    );

    const manager = new CredentialManager({
      storage: createInMemoryStorage(),
    });

    await manager.storeCredential('codex', {
      accountId: toAgentAccountId('acct-codex'),
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      idToken: null,
      tokenType: 'Bearer',
      scopes: ['scope:codex'],
      expiresAt: Date.now() + 60 * 60_000,
    });

    const client = new NodeAgentClient({
      adapterId: 'codex',
      initOptions: {
        cwd: tempHome,
        startupTimeoutMs: 2_000,
        defaultTimeoutMs: 2_000,
      },
      adapterFactoryOptions: {
        codex: {
          command: process.execPath,
          baseArgs: [scriptPath],
          promptFlag: '--prompt',
          resumeFlag: '--resume',
          timeoutMs: 2_000,
          credentialBinding: {
            manager,
            accountId: 'acct-codex',
          },
        },
      },
    });

    const { stream, sessionIdPromise } = await client.runWithSession('hello');
    const messages = await collectMessages(stream);
    const sessionId = await sessionIdPromise;

    const resultMessage = messages.find((message) => message.type === 'result');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.content[0]?.payload).toEqual(
      expect.objectContaining({
        envToken: 'codex-access-token',
      }),
    );

    expect(sessionId).not.toBeNull();
    if (!sessionId) {
      throw new Error('Session id should be available');
    }

    const metadata = await client.getSessionMetadata(sessionId);
    expect(metadata?.credentialLifecycle).toEqual(
      expect.objectContaining({
        accountId: toAgentAccountId('acct-codex'),
        agentType: 'codex',
      }),
    );
  });
});
