import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexSdkClient } from '../CodexSdkClient';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codex-startup-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const request = (client: CodexSdkClient, mode: 'start' | 'resume' | 'context', cwd: string) => {
  const config = { prompt: '', cwd };
  switch (mode) {
    case 'start':
      return client.startSession(config);
    case 'resume':
      return client.resumeSession('fixture-thread', config);
    case 'context':
      return client.getContextUsageByResume('fixture-thread', config);
  }
};

const writeProvider = async (name: string, source: string): Promise<string> => {
  const script = path.join(root, name);
  await writeFile(script, source);
  return script;
};

const healthyProvider = `
  const { createInterface } = require('node:readline');
  const send = frame => process.stdout.write(JSON.stringify(frame) + '\\n');
  createInterface({ input: process.stdin }).on('line', line => {
    const frame = JSON.parse(line);
    if (frame.method === 'initialize') send({ id: frame.id, result: {} });
    if (frame.method === 'thread/start') {
      send({ id: frame.id, result: { thread: { id: 'healthy-thread' } } });
    }
    if (frame.method === 'turn/start') {
      send({ id: frame.id, result: { turn: { id: 'healthy-turn' } } });
      send({ method: 'turn/completed', params: {
        threadId: 'healthy-thread', turn: { id: 'healthy-turn' }
      } });
    }
  });
`;

describe.each(['start', 'resume', 'context'] as const)('Codex %s initialization', (mode) => {
  it.each(['missing cwd', 'missing executable'] as const)(
    'rejects %s without an unhandled rejection or blocking another client',
    async (failure) => {
      const script = await writeProvider('healthy.cjs', healthyProvider);
      const failing = new CodexSdkClient();
      const healthy = new CodexSdkClient();
      healthy.setCommand(script);
      if (failure === 'missing cwd') failing.setCommand(script);
      else vi.stubEnv('PATH', root);
      try {
        await Promise.all([
          expect(
            request(failing, mode, failure === 'missing cwd' ? path.join(root, 'missing') : root),
          ).rejects.toThrow(/Process error: spawn .* ENOENT/),
          expect(healthy.startSession({ prompt: '', cwd: root })).resolves.toBeUndefined(),
        ]);
      } finally {
        await Promise.all([failing.disconnect(), healthy.disconnect()]);
      }
    },
  );

  it('rejects an initialize error before any thread request', async () => {
    const script = await writeProvider(
      'initialize-error.cjs',
      `
        require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
          const frame = JSON.parse(line);
          if (frame.method !== 'initialize') throw new Error('Unexpected request');
          process.stdout.write(JSON.stringify({
            id: frame.id, error: { message: 'fixture handshake refused' }
          }) + '\\n');
        });
      `,
    );
    const client = new CodexSdkClient();
    client.setCommand(script);
    try {
      await expect(request(client, mode, root)).rejects.toThrow(
        'Initialize failed: fixture handshake refused',
      );
    } finally {
      await client.disconnect();
    }
  });

  it('rejects when the provider exits before answering initialize', async () => {
    const script = await writeProvider('exit.cjs', 'process.exit(17);');
    const client = new CodexSdkClient();
    client.setCommand(script);
    try {
      await expect(request(client, mode, root)).rejects.toThrow(
        'Process exited unexpectedly (code=17)',
      );
    } finally {
      await client.disconnect();
    }
  });
});
