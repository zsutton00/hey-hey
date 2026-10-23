import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildOpenCodeSpawnCommand,
  describeOpenCodeCredentialSources,
  pollHealth,
} from './opencode-server-launcher';

describe('pollHealth', () => {
  it('resolves immediately when /health returns 200 OK with text/html', async () => {
    global.fetch = vi.fn(async () => {
      return new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await expect(
      pollHealth('http://127.0.0.1:9999', controller.signal, 3, 10),
    ).resolves.toBeUndefined();
  });

  it('resolves immediately when /health returns 200 OK with JSON healthy:true', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ healthy: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await expect(
      pollHealth('http://127.0.0.1:9999', controller.signal, 3, 10),
    ).resolves.toBeUndefined();
  });

  it('throws with diagnostic info when /health never returns 2xx', async () => {
    global.fetch = vi.fn(async () => {
      return new Response('not ready', { status: 503 });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await expect(pollHealth('http://127.0.0.1:9999', controller.signal, 3, 10)).rejects.toThrow(
      /Last response: 503/,
    );
  });

  it('throws with diagnostic info when fetch repeatedly fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('Connection refused');
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await expect(pollHealth('http://127.0.0.1:9999', controller.signal, 3, 10)).rejects.toThrow(
      /Last fetch error: Connection refused/,
    );
  });
});

describe('buildOpenCodeSpawnCommand', () => {
  it('wraps the complete OpenCode server tree in the Run process containment', () => {
    expect(
      buildOpenCodeSpawnCommand('/bin/opencode', ['serve', '--port', '0'], {
        command: process.execPath,
        argsPrefix: ['/sandbox/srt.js', '--settings', '/run/settings.json'],
        env: { RUN_CONTAINED: 'true' },
      }),
    ).toMatchObject({
      command: process.execPath,
      args: [
        '/sandbox/srt.js',
        '--settings',
        '/run/settings.json',
        '/bin/opencode',
        'serve',
        '--port',
        '0',
      ],
      env: { RUN_CONTAINED: 'true' },
    });
  });
});

describe('describeOpenCodeCredentialSources', () => {
  it('reports provider IDs and API key variable names without values', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-creds-'));
    fs.mkdirSync(path.join(dataHome, 'opencode'));
    fs.writeFileSync(
      path.join(dataHome, 'opencode', 'auth.json'),
      JSON.stringify({ opencode: { type: 'api', key: 'secret-value' } }),
    );
    const result = describeOpenCodeCredentialSources({
      XDG_DATA_HOME: dataHome,
      OPENAI_API_KEY: 'secret-env-value',
      EMPTY_API_KEY: '',
      PATH: '/bin',
    });
    expect(result).toEqual({
      xdgDataHome: dataHome,
      authFilePresent: true,
      authProviderIds: ['opencode'],
      apiKeyEnvNames: ['OPENAI_API_KEY'],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports a missing auth file', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-creds-'));
    expect(describeOpenCodeCredentialSources({ XDG_DATA_HOME: dataHome })).toMatchObject({
      authFilePresent: false,
      authProviderIds: [],
    });
  });
});
