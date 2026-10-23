/** @vitest-environment node */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toAgentSessionId, type AgentMessage } from '../../core/index';
import { createCodexExecClient } from '../CodexExecClient';

const collectMessages = async (stream: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> => {
  const messages: AgentMessage[] = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

describe('createCodexExecClient', () => {
  const tempDirs: string[] = [];

  const createTempCodexBinary = (source: string): string => {
    const directory = mkdtempSync(join(tmpdir(), 'ui-common-codex-exec-'));
    tempDirs.push(directory);

    const scriptPath = join(directory, 'mock-codex.mjs');
    writeFileSync(scriptPath, `#!/usr/bin/env node\n${source}`, 'utf8');
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  };

  afterEach(() => {
    for (const directory of tempDirs.splice(0, tempDirs.length)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates a runnable client with codex exec prompt semantics', async () => {
    const commandPath = createTempCodexBinary(`
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify({ type: "task_started", session_id: "sess-codex-exec-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_message", message: "hello from codex", session_id: "sess-codex-exec-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", result: { args }, session_id: "sess-codex-exec-1" }) + "\\n");
`);

    const client = createCodexExecClient({
      initOptions: {
        cwd: process.cwd(),
        startupTimeoutMs: 2_000,
        defaultTimeoutMs: 2_000,
      },
      codex: {
        command: commandPath,
        timeoutMs: 2_000,
      },
    });

    const { stream, sessionIdPromise } = await client.runWithSession('hello world');
    const messages = await collectMessages(stream);
    const sessionId = await sessionIdPromise;

    const assistant = messages.find((message) => message.type === 'assistant');
    const result = messages.find((message) => message.type === 'result');

    expect(assistant).toBeDefined();
    expect(sessionId).toBe('sess-codex-exec-1');
    expect(result?.content[0]?.payload).toEqual({
      args: ['exec', '--full-auto', '--json', 'hello world'],
    });
  });

  it('passes codex exec resume arguments when resuming a session', async () => {
    const commandPath = createTempCodexBinary(`
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify({ type: "result", result: { args }, session_id: "sess-codex-exec-2" }) + "\\n");
`);

    const client = createCodexExecClient({
      initOptions: {
        cwd: process.cwd(),
        startupTimeoutMs: 2_000,
        defaultTimeoutMs: 2_000,
      },
      codex: {
        command: commandPath,
        timeoutMs: 2_000,
      },
    });

    const { stream } = await client.resumeWithSession(
      toAgentSessionId('existing-session-1'),
      'continue here',
    );
    const messages = await collectMessages(stream);

    const result = messages.find((message) => message.type === 'result');
    expect(result?.content[0]?.payload).toEqual({
      args: ['exec', 'resume', '--full-auto', '--json', 'existing-session-1', 'continue here'],
    });
  });
});
