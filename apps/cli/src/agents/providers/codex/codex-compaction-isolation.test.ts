import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexSdkClient, CodexCompactTimeoutError } from '@hey-hey/ui-common/agents';
import { mapCodexEvent } from './codex-event-mapper';
import type { ProviderEventNormalizationConfig } from '../provider-event-normalization';

const baseConfig: ProviderEventNormalizationConfig = {
  validationMode: 'strict',
  maxDiffBlobBytes: 4096,
  trackTools: false,
};

describe('codex compaction round-trip', () => {
  const tempDirs: string[] = [];
  const clients: CodexSdkClient[] = [];

  const createClient = (): CodexSdkClient => {
    const client = new CodexSdkClient();
    clients.push(client);
    return client;
  };

  const createMockScript = (source: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-codex-compact-'));
    tempDirs.push(dir);
    const scriptPath = join(dir, 'mock-codex.mjs');
    const wrapped = [
      `process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");`,
      'setTimeout(() => {',
      source,
      '}, 10);',
    ].join('\n');
    writeFileSync(scriptPath, `#!/usr/bin/env node\n${wrapped}`, 'utf8');
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  };

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Inline stdin line-splitter: no imports, works in both CJS and ESM script modes.
  const stdinLineReaderScript = (respondToCompact = true): string => `
let _buf = '';
process.stdin.on('data', (chunk) => {
  _buf += chunk;
  const lines = _buf.split('\\n');
  _buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'thread/start') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: { thread: { id: 'thread-compact' } } }) + '\\n');
    }
    if (msg.method === 'turn/start') {
      const threadId = msg.params.threadId;
      const turn = { id: 'turn-compact' };
      process.stdout.write(JSON.stringify({ id: msg.id, result: { turn } }) + '\\n');
      process.stdout.write(JSON.stringify({ method: 'turn/started', params: { threadId, turn } }) + '\\n');
      process.stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId, turn } }) + '\\n');
    }
    if (msg.method === 'thread/compact/start' && ${respondToCompact}) {
      if (msg.params.threadId !== 'thread-compact') process.exit(1);
      process.stdout.write(JSON.stringify({ method: 'thread/compacted', params: { threadId: msg.params.threadId } }) + '\\n');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`;

  it('writes thread/compact/start ClientRequest with threadId to stdin', async () => {
    const scriptPath = createMockScript(stdinLineReaderScript());

    const client = createClient();
    client.setCommand(scriptPath);
    await client.startSession({ prompt: 'hello', cwd: process.cwd() });

    // compact() writes thread/compact/start to stdin; the script replies with thread/compacted.
    await client.compact();

    await client.disconnect();
  });

  it('compact() resolves to undefined when thread/compacted notification arrives', async () => {
    const scriptPath = createMockScript(stdinLineReaderScript());

    const client = createClient();
    client.setCommand(scriptPath);
    await client.startSession({ prompt: 'hello', cwd: process.cwd() });

    await expect(client.compact()).resolves.toBeUndefined();

    await client.disconnect();
  });

  it('thread/compacted maps to compact_boundary status event via mapCodexEvent', () => {
    const result = mapCodexEvent({
      provider: 'codex',
      runId: 'run-1',
      eventType: 'thread/compacted',
      timestamp: '2026-06-19T00:00:00.000Z',
      sessionId: 'thread-compact',
      agentId: 'agent-1',
      rawEvent: {},
      config: baseConfig,
    });

    expect(result.payload).toMatchObject({
      canonical_event_type: 'status',
      canonical_event: {
        status: { state: 'compact_boundary', phase: null, code: null, message: null },
      },
    });
    expect(result.resolvedEventType).toBe('thread/compacted');
    expect(result.isTerminal).toBeUndefined();
  });

  it('compact() rejects when a turn is in flight', async () => {
    // Script emits thread/started but never turn/completed — turn stays in flight.
    const scriptPath = createMockScript(`
process.stdout.write(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thread-busy' } } }) + '\\n');
setInterval(() => {}, 60_000);
`);

    const client = createClient();
    client.setCommand(scriptPath);

    const startPromise = client.startSession({ prompt: 'hello', cwd: process.cwd() });
    startPromise.catch(() => {});

    // Wait for thread/started to be processed so sessionId is set.
    await new Promise((r) => setTimeout(r, 200));

    await expect(client.compact()).rejects.toThrow('Cannot compact: a turn is in flight');

    await client.disconnect();
    await expect(startPromise).rejects.toThrow('Disconnected');
  });

  it('compact() rejects before any session is started', async () => {
    const client = createClient();
    await expect(client.compact()).rejects.toThrow('No active session');
  });

  it('compact() rejects with CodexCompactTimeoutError when no thread/compacted arrives', async () => {
    // Script completes the turn but never responds to thread/compact/start.
    const scriptPath = createMockScript(`
${stdinLineReaderScript(false)}
setInterval(() => {}, 60_000);
`);

    const client = createClient();
    client.setCommand(scriptPath);
    await client.startSession({ prompt: 'hello', cwd: process.cwd() });

    await expect(client.compact({ timeoutMs: 50 })).rejects.toBeInstanceOf(
      CodexCompactTimeoutError,
    );

    await client.disconnect();
  });
});
