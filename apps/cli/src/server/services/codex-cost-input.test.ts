import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as filesystem from 'node:fs/promises';
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof filesystem>();
  return { ...original, copyFile: vi.fn(original.copyFile) };
});
import { CodexCostInput } from './codex-cost-input';
import {
  createCcusageSessionJsonReader,
  resolveCcusageLauncher,
  SessionCostAdapter,
} from './session-cost-adapter';

let home: string;
beforeEach(async () => {
  const original = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.copyFile).mockReset().mockImplementation(original.copyFile);
  home = await mkdtemp(path.join(tmpdir(), 'cost-input-test-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});
const metadata = (id: string, parent?: string) =>
  JSON.stringify({
    timestamp: '2026-09-28T10:00:00Z',
    type: 'session_meta',
    payload: { id, ...(parent ? { forked_from_id: parent } : {}) },
  });
const file = async (relative: string, content: string) => {
  const target = path.join(home, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
};

describe('CodexCostInput', () => {
  it('falls back and cleans the snapshot when a selected file changes during copying', async () => {
    const original = await file('sessions/rollout-child.jsonl', metadata('child'));
    const copy = (await vi.importActual<typeof filesystem>('node:fs/promises')).copyFile;
    let temporaryFile = '';
    vi.mocked(filesystem.copyFile).mockImplementation(async (source, destination, mode) => {
      await copy(source, destination, mode);
      if (source === original) {
        temporaryFile = destination.toString();
        await writeFile(original, metadata('child') + '\n');
      }
    });
    await new CodexCostInput().read(['child'], { CODEX_HOME: home }, async (env, restricted) => {
      expect(restricted).toBe(false);
      expect(env['CODEX_HOME']).toBe(home);
      return '';
    });
    expect(temporaryFile).not.toBe('');
    await expect(access(temporaryFile)).rejects.toThrow();
  });

  it('falls back when rollout filenames no longer identify their metadata session', async () => {
    await file('sessions/rollout-child.jsonl', metadata('different'));
    await new CodexCostInput().read(['child'], { CODEX_HOME: home }, async (_env, restricted) => {
      expect(restricted).toBe(false);
      return '';
    });
  });

  it('isolates simultaneous input snapshots owned by the same reader', async () => {
    await file('sessions/rollout-one.jsonl', metadata('one'));
    await file('sessions/rollout-two.jsonl', metadata('two'));
    const owner = new CodexCostInput();
    const roots: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all(
      ['one', 'two'].map((id) =>
        owner.read([id], { CODEX_HOME: home }, async (env, restricted) => {
          expect(restricted).toBe(true);
          const root = env['CODEX_HOME']!;
          roots.push(root);
          if (roots.length === 2) release();
          await bothStarted;
          expect(await readdir(path.join(root, 'sessions'))).toEqual([`rollout-${id}.jsonl`]);
          return '';
        }),
      ),
    );
    expect(new Set(roots).size).toBe(2);
    for (const root of roots) await expect(access(root)).rejects.toThrow();
  });

  it('copies only the selected lineage, keeps archive precedence and all pricing roots, then cleans up', async () => {
    await file('sessions/2026/rollout-child.jsonl', metadata('child', 'parent'));
    await file('archived_sessions/2026/rollout-child.jsonl', 'duplicate must be ignored');
    await file(
      'archived_sessions/2025/rollout-parent.jsonl',
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'parent',
          source: { subagent: { thread_spawn: { parent_thread_id: 'root' } } },
        },
      }),
    );
    await file('sessions/2025/rollout-root.jsonl', metadata('root'));
    await file('sessions/unrelated.jsonl', 'not parsed');
    await file('config.toml', 'service_tier = "priority"');
    const otherHome = path.join(home, 'other');
    await file('other/config.toml', 'service_tier = "standard"');
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: `${home},${otherHome}` };
    let roots: string[] = [];
    const result = await new CodexCostInput().read(['child'], env, async (scoped, restricted) => {
      expect(restricted).toBe(true);
      roots = scoped['CODEX_HOME']!.split(',');
      expect(scoped['PATH']).toBe(env['PATH']);
      expect(await readFile(path.join(roots[0]!, 'config.toml'), 'utf8')).toContain('priority');
      expect(await readFile(path.join(roots[1]!, 'config.toml'), 'utf8')).toContain('standard');
      expect(await readdir(path.join(roots[0]!, 'sessions/2026'))).toEqual(['rollout-child.jsonl']);
      await expect(access(path.join(roots[0]!, 'sessions/unrelated.jsonl'))).rejects.toThrow();
      await access(path.join(roots[0]!, 'archived_sessions/2025/rollout-parent.jsonl'));
      await access(path.join(roots[0]!, 'sessions/2025/rollout-root.jsonl'));
      return 'report';
    });
    expect(result).toBe('report');
    for (const root of roots) await expect(access(root)).rejects.toThrow();
    expect(env['CODEX_HOME']).toBe(`${home},${otherHome}`);
  });

  it.each(['missing-parent', 'bad-metadata', 'unresolved-session'])(
    'uses original inputs when scope is uncertain: %s',
    async (reason) => {
      await file(
        'sessions/rollout-child.jsonl',
        reason === 'bad-metadata' ? '{invalid' : metadata('child', 'missing'),
      );
      const env = { CODEX_HOME: home };
      const execute = vi.fn(async (actual, restricted) => {
        expect(actual).toBe(env);
        expect(restricted).toBe(false);
        return 'full report';
      });
      await new CodexCostInput().read(
        [reason === 'unresolved-session' ? 'not-here' : 'child'],
        env,
        execute,
      );
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('does not build a partial selection when one batch identity is unresolved', async () => {
    await file('sessions/rollout-child.jsonl', metadata('child'));
    await new CodexCostInput().read(
      ['child', 'missing'],
      { CODEX_HOME: home },
      async (env, restricted) => {
        expect(restricted).toBe(false);
        expect(env['CODEX_HOME']).toBe(home);
        return '';
      },
    );
  });

  it('keeps distinct roots and all files matching an identity instead of silently dropping duplicates', async () => {
    await file('a/sessions/rollout-child.jsonl', metadata('child'));
    await file('b/sessions/rollout-child.jsonl', metadata('child'));
    await new CodexCostInput().read(
      ['child'],
      { CODEX_HOME: `${home}/a,${home}/b` },
      async (env, restricted) => {
        expect(restricted).toBe(true);
        for (const root of env['CODEX_HOME']!.split(','))
          await access(path.join(root, 'sessions/rollout-child.jsonl'));
        return '';
      },
    );
  });

  it('supports direct input directories and cyclic lineage without escaping discovered files', async () => {
    await file('rollout-child.jsonl', metadata('child', 'parent'));
    await file('rollout-parent.jsonl', metadata('parent', 'child'));
    await new CodexCostInput().read(['child'], { CODEX_HOME: home }, async (env, restricted) => {
      expect(restricted).toBe(true);
      expect(await readdir(path.join(env['CODEX_HOME']!, 'sessions'))).toHaveLength(2);
      return '';
    });
    await new CodexCostInput().read(
      ['../outside'],
      { CODEX_HOME: home },
      async (_env, restricted) => {
        expect(restricted).toBe(false);
        return '';
      },
    );
  });

  it('cleans restricted files after reader failure without retrying the failed command', async () => {
    await file('sessions/rollout-child.jsonl', metadata('child'));
    let root = '';
    const execute = vi.fn(async (env) => {
      root = env.CODEX_HOME;
      throw new Error('command failed');
    });
    await expect(
      new CodexCostInput().read(['child'], { CODEX_HOME: home }, execute),
    ).rejects.toThrow('command failed');
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(access(root)).rejects.toThrow();
  });

  it('falls back for symlinked inputs instead of silently omitting possible history', async () => {
    const target = await file('original.jsonl', metadata('child'));
    await mkdir(path.join(home, 'sessions'));
    await symlink(target, path.join(home, 'sessions/rollout-child.jsonl'));
    await new CodexCostInput().read(['child'], { CODEX_HOME: home }, async (_env, restricted) => {
      expect(restricted).toBe(false);
      return '';
    });
  });

  it('matches the installed ccusage full report for a resumed fork, through the production adapter', async () => {
    const usage = (timestamp: string, input: number) =>
      JSON.stringify({
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            model: 'gpt-5',
            last_token_usage: {
              input_tokens: input,
              cached_input_tokens: 0,
              output_tokens: 10,
              reasoning_output_tokens: 0,
              total_tokens: input + 10,
            },
          },
        },
      });
    const inherited = usage('2026-08-13T10:00:00Z', 200);
    await file('sessions/rollout-parent.jsonl', [metadata('parent'), inherited].join('\n'));
    await file(
      'sessions/rollout-child.jsonl',
      [
        metadata('child', 'parent'),
        inherited,
        usage('2026-09-28T12:00:00Z', 300),
        usage('2026-09-29T12:00:00Z', 400),
      ].join('\n'),
    );
    await file(
      'sessions/unrelated.jsonl',
      [metadata('unrelated'), usage('2026-09-28T15:00:00Z', 10000)].join('\n'),
    );
    await file('config.toml', 'service_tier = "priority"');
    const launcher = await file(
      'launcher.cjs',
      `const {spawnSync}=require('node:child_process'); const r=spawnSync(process.execPath,[${JSON.stringify(resolveCcusageLauncher())},...process.argv.slice(2),'--offline'],{stdio:'inherit'}); process.exit(r.status ?? 1);`,
    );
    vi.stubEnv('CODEX_HOME', home);
    const reader = createCcusageSessionJsonReader(() => launcher);
    const full = JSON.parse(await reader('codex'));
    const restricted = JSON.parse(await reader('codex', undefined, { sessionIds: ['child'] }));
    expect(restricted.sessions).toHaveLength(2);
    const expected = full.sessions.find(
      (row: { sessionId: string }) => row.sessionId === 'rollout-child',
    );
    expect(
      restricted.sessions.find((row: { sessionId: string }) => row.sessionId === 'rollout-child'),
    ).toEqual(expected);
    expect(expected.costUSD).toBeGreaterThan(0);
    expect(
      await new SessionCostAdapter(reader).read({
        providerId: 'codex',
        providerSessionId: 'child',
      }),
    ).toMatchObject({ state: 'available', amountUsd: expected.costUSD });
  });
});
