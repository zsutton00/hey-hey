import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from '../../../server/logger';
import { isMintedUserMcpTool, loadClaudeUserMcpConfig } from './user-mcp-config';

describe('Claude user MCP config boundary', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'claude-user-mcp-'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('forwards only valid top-level entries unchanged and logs no credentials', async () => {
    const servers = {
      legacy: { command: 'node', args: ['token-secret'], env: { TOKEN: '${TOKEN}' } },
      stdio: { type: 'stdio', command: 'node', args: [], custom: { value: 'secret' } },
      http: {
        type: 'http',
        url: 'https://host.test/token-secret',
        headers: { Authorization: 'secret' },
      },
      sse: { type: 'sse', url: 'http://localhost:13001/sse' },
      variable: { type: 'http', url: '${MCP_URL}', headers: { Authorization: '${TOKEN}' } },
    };
    writeFileSync(
      join(directory, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          ...servers,
          invalid: { type: 'http', url: 123, headers: { Authorization: 'secret' } },
          badEnv: { command: 'node', env: { TOKEN: 123 } },
          array: [],
          unsupported: { type: 'sdk', command: 'node' },
          'heyhey-platform': { command: 'user-platform' },
          'heyhey-submission-tools': { command: 'user-submission' },
          'heyhey-browser': { command: 'user-browser' },
        },
        projects: { '/repo': { mcpServers: { local: { command: 'local' } } } },
        hooks: { secret: 'secret' },
        permissions: { allow: ['Write'] },
      }),
    );
    writeFileSync(
      join(directory, '.mcp.json'),
      JSON.stringify({ mcpServers: { repo: { command: 'repo' } } }),
    );
    const debug = vi.fn();
    const warn = vi.fn();
    const loaded = await loadClaudeUserMcpConfig({ ...NOOP_LOGGER, debug, warn });
    expect(loaded.mcpServers).toEqual(servers);
    expect(loaded.allowedTools).toEqual(Object.keys(servers).map((name) => `mcp__${name}`));
    expect(warn.mock.calls.map((call) => call[1])).toEqual([
      { serverName: 'invalid' },
      { serverName: 'badEnv' },
      { serverName: 'array' },
      { serverName: 'unsupported' },
      { serverName: 'heyhey-platform' },
      { serverName: 'heyhey-submission-tools' },
      { serverName: 'heyhey-browser' },
    ]);
    expect(JSON.stringify([debug.mock.calls, warn.mock.calls])).not.toContain('secret');
  });

  it.each(['{', 'null', '{"mcpServers": []}', '{"mcpServers": null}', '{}'])(
    'returns empty config for malformed or absent maps: %s',
    async (fixture) => {
      writeFileSync(join(directory, '.claude.json'), fixture);
      expect((await loadClaudeUserMcpConfig()).serverNames).toEqual([]);
    },
  );
  it('treats missing and unreadable files as no user servers', async () => {
    expect((await loadClaudeUserMcpConfig()).serverNames).toEqual([]);
    mkdirSync(join(directory, '.claude.json'));
    expect((await loadClaudeUserMcpConfig()).serverNames).toEqual([]);
  });
  it('matches the complete minted server name rather than a prefix neighbor', () => {
    expect(isMintedUserMcpTool('mcp__logs__query', ['logs'])).toBe(true);
    expect(isMintedUserMcpTool('mcp__logs-extra__query', ['logs'])).toBe(false);
    expect(isMintedUserMcpTool('mcp__heyhey-platform__delete_task', ['logs'])).toBe(false);
    expect(isMintedUserMcpTool('Write', ['logs'])).toBe(false);
  });
});
