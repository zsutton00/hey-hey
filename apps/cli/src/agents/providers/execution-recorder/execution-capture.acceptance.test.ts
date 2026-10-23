import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolExecutionHookLaunch } from '../../../agent-runtime/index';
import { NOOP_LOGGER } from '../../../server/logger';
import { ExecutionRecorder } from './execution-recorder';
import { ContentSnapshot } from './content-snapshot';
import { CodexExecutionCaptureHooks } from '../codex/execution-capture-hooks';
import { ClaudeExecutionCaptureHooks } from '../claude/execution-capture-hooks';
import type { ExecutionCaptureSession } from './capture-session';
import type { HookInput } from './hook-channel';

const exec = promisify(execFile);
let directory: string;
let root: string;
const sessions: ExecutionCaptureSession[] = [];
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hh-evidence-')));
  root = path.join(directory, 'repo');
  await fs.mkdir(root);
  await exec('git', ['init', '-q', root]);
  await fs.writeFile(path.join(root, 'dirty.txt'), 'committed');
  await exec('git', ['-C', root, 'add', '.']);
  await exec('git', [
    '-C',
    root,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-qm',
    'fixture',
  ]);
  await fs.writeFile(path.join(root, 'dirty.txt'), 'already dirty');
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await fs.rm(directory, { recursive: true, force: true });
});

const runHook = (launch: ToolExecutionHookLaunch, event: HookInput): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', launch.command], {
      env: { ...process.env, ...launch.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 && output === ''
        ? resolve()
        : reject(new Error(`Hook changed output or status: ${code}`)),
    );
    child.stdin.end(JSON.stringify(event));
  });

describe.each(['codex', 'claude'] as const)('%s execution capture', (provider) => {
  const setup = async (tool = 'Bash', runId = 'run') => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    const adapter =
      provider === 'codex'
        ? new CodexExecutionCaptureHooks(recorder, NOOP_LOGGER)
        : new ClaudeExecutionCaptureHooks(recorder, NOOP_LOGGER);
    const session = adapter.session;
    sessions.push(session);
    const launch = await session.start({
      sessionId: 'agent-session',
      runId,
      turnId: `${runId}-turn`,
      provider,
      roots: [{ serviceId: 'service', root }],
      harnessVersion: provider === 'codex' ? 'codex-cli 0.156.0' : '2.1.195 (Claude Code)',
    });
    expect(launch).toBeDefined();
    const toolName = tool === 'Edit' && provider === 'codex' ? 'apply_patch' : tool;
    const event: HookInput = {
      hook_event_name: 'PreToolUse',
      session_id: `${runId}-provider`,
      tool_use_id: `${runId}-call`,
      tool_name: toolName,
      ...(provider === 'codex' ? { turn_id: `${runId}-native-turn` } : {}),
    };
    if (adapter instanceof CodexExecutionCaptureHooks) {
      // PreToolUse is allowed before item/started; only root-turn identity exists yet.
      adapter.observe(
        { method: 'turn/started' },
        { threadId: event.session_id, turnId: event.turn_id! },
      );
    } else {
      adapter.observe({
        type: 'assistant',
        session_id: event.session_id,
        parent_tool_use_id: null,
        message: {
          content: [{ type: 'tool_use', id: event.tool_use_id, name: toolName, input: {} }],
        },
      });
    }
    return { recorder, session, launch: launch!, event };
  };

  it('captures exact dirty bytes, creation, deletion, binary bytes and failed-after-write scripts through the real command relay', async () => {
    const { recorder, launch, event, session } = await setup();
    await fs.writeFile(path.join(root, 'delete.txt'), 'remove me');
    await runHook(launch, event);
    const pending = (await recorder.store.read())[0]!;
    expect(pending.state).toBe('pending');
    const original = pending.before!.entries.find((entry) => entry.path === 'dirty.txt')!;
    expect((await recorder.store.readBlob(original.hash!)).toString()).toBe('already dirty');
    const command = spawn(
      process.execPath,
      [
        '-e',
        "require('fs').writeFileSync('dirty.txt','changed again');require('fs').writeFileSync('new.bin',Buffer.from([0,255,1]));require('fs').unlinkSync('delete.txt');process.stdout.write('unchanged output');process.exit(7)",
      ],
      { cwd: root },
    );
    let output = '';
    command.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    expect(await new Promise((resolve) => command.on('exit', resolve))).toBe(7);
    expect(output).toBe('unchanged output');
    session.outcome(event.session_id, event.tool_use_id, 'failure');
    await runHook(launch, {
      ...event,
      hook_event_name: provider === 'claude' ? 'PostToolUseFailure' : 'PostToolUse',
      exit_code: 7,
    });
    const result = (await recorder.store.read())[0]!;
    expect(result.outcome).toBe('failure');
    expect(result.gaps).toContain('writer_lifetime_unresolved');
    expect(result.after!.entries.some((entry) => entry.path === 'delete.txt')).toBe(false);
    const binary = result.after!.entries.find((entry) => entry.path === 'new.bin')!;
    expect(await recorder.store.readBlob(binary.hash!)).toEqual(Buffer.from([0, 255, 1]));
    expect(result.identity).toMatchObject({
      runId: 'run',
      sessionId: 'agent-session',
      turnId: 'run-turn',
      provider,
    });
    expect((await fs.readdir(path.join(directory, 'evidence'))).sort()).toEqual([
      'blobs',
      'observations',
    ]);
  });

  it('completes direct edits without changing git index or writing canonical facts', async () => {
    const { recorder, launch, event } = await setup('Edit');
    const indexBefore = await fs.readFile(path.join(root, '.git', 'index'));
    await runHook(launch, event);
    await fs.writeFile(path.join(root, 'dirty.txt'), 'direct edit');
    await runHook(launch, { ...event, hook_event_name: 'PostToolUse' });
    expect((await recorder.store.read())[0]!.state).toBe('completed');
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(indexBefore);
    expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(['repo', 'evidence']));
    expect(await fs.readdir(path.join(directory, 'evidence'))).not.toContain('runs');
  });

  it('prunes ignored caches and applies nested, anchored and negated .gitignore rules', async () => {
    const { recorder, launch, event } = await setup('Edit');
    await fs.writeFile(path.join(root, '.gitignore'), 'cache/\n*.generated\n/root-only.txt\n');
    await fs.mkdir(path.join(root, 'cache'));
    await fs.writeFile(path.join(root, 'cache', '.gitignore'), '!keep.txt\n');
    await fs.writeFile(path.join(root, 'cache', 'keep.txt'), 'ignored parent wins');
    await fs.writeFile(path.join(root, 'root-only.txt'), 'ignored');
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', '.gitignore'), '!keep.generated\n/local.txt\n');
    await fs.writeFile(path.join(root, 'src', 'keep.generated'), 'included');
    await fs.writeFile(path.join(root, 'src', 'drop.generated'), 'ignored');
    await fs.writeFile(path.join(root, 'src', 'local.txt'), 'ignored');
    await fs.writeFile(path.join(root, 'src', 'root-only.txt'), 'included');
    const readdir = vi.spyOn(fs, 'readdir');
    try {
      await runHook(launch, event);
      await fs.writeFile(path.join(root, 'cache', 'new.txt'), 'ignored after tool');
      await runHook(launch, { ...event, hook_event_name: 'PostToolUse' });
      const record = (await recorder.store.read())[0]!;
      for (const snapshot of [record.before!, record.after!]) {
        expect(snapshot.rootFailures).toEqual([]);
        expect(snapshot.entries.map((entry) => entry.path).sort()).toEqual([
          '.gitignore',
          'dirty.txt',
          'src/.gitignore',
          'src/keep.generated',
          'src/root-only.txt',
        ]);
      }
      expect(readdir.mock.calls.some(([directory]) => directory === path.join(root, 'cache'))).toBe(
        false,
      );
    } finally {
      readdir.mockRestore();
    }
  });

  it('retains the original identity through delayed completion', async () => {
    const { recorder, session, launch, event } = await setup();
    await runHook(launch, event);
    const command = spawn(
      process.execPath,
      ['-e', "setTimeout(()=>require('fs').writeFileSync('later.txt','later'),75)"],
      { cwd: root },
    );
    expect((await recorder.store.read())[0]!.state).toBe('pending');
    await new Promise((resolve) => command.on('exit', resolve));
    session.outcome(event.session_id, event.tool_use_id, 'success');
    await runHook(launch, { ...event, hook_event_name: 'PostToolUse', exit_code: 0 });
    const result = (await recorder.store.read())[0]!;
    expect(result.identity.toolCallId).toBe(event.tool_use_id);
    expect(result.after!.entries.some((entry) => entry.path === 'later.txt')).toBe(true);
  });

  it('preserves interrupted evidence across a recorder restart without upgrading it', async () => {
    const { recorder, session, launch, event } = await setup();
    await runHook(launch, event);
    await fs.writeFile(path.join(root, 'dirty.txt'), 'partial write');
    await session.end();
    const restored = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    const result = (await restored.store.read())[0]!;
    expect(result.state).toBe('incomplete');
    expect(result.gaps).toContain('interrupted');
    expect(result.before).not.toBeNull();
    expect(result.after).not.toBeNull();
    expect(await recorder.store.read()).toEqual(await restored.store.read());
  });

  it('persists overlap for both sessions sharing a repository', async () => {
    const first = await setup('Edit', 'first');
    const second = await setup('Edit', 'second');
    await Promise.all([runHook(first.launch, first.event), runHook(second.launch, second.event)]);
    await fs.writeFile(path.join(root, 'dirty.txt'), 'overlapping');
    await Promise.all([
      runHook(first.launch, { ...first.event, hook_event_name: 'PostToolUse' }),
      runHook(second.launch, { ...second.event, hook_event_name: 'PostToolUse' }),
    ]);
    const observations = await first.recorder.store.read();
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(observation.state).toBe('incomplete');
      expect(observation.gaps).toContain('overlap');
    }
  });

  it.each(['success', 'failure', 'denied'] as const)(
    'does not scan repositories during teardown for an unhooked %s',
    async (outcome) => {
      const { recorder, session, event } = await setup();
      // Native notifications can arrive even when the user has not installed or
      // trusted the hook. Such calls must not start retrospective content capture.
      session.admit(event.session_id, event.turn_id ?? null, event.tool_use_id, event.tool_name);
      session.outcome(event.session_id, event.tool_use_id, outcome);
      const capture = vi.spyOn(ContentSnapshot.prototype, 'capture');
      try {
        await session.end();
        expect(capture).not.toHaveBeenCalled();
        if (outcome === 'success') {
          expect(await recorder.store.read()).toEqual([]);
          return;
        }
        const [record] = await recorder.store.read();
        expect(record).toMatchObject({ state: 'incomplete', before: null, after: null, outcome });
        expect(record?.gaps).toContain('hook_not_observed');
        expect(record?.gaps).toContain('missing_baseline');
      } finally {
        capture.mockRestore();
      }
    },
  );

  it('retains denial distinctly and does not require a successful post hook', async () => {
    const { recorder, session, launch, event } = await setup('Edit');
    await runHook(launch, event);
    session.outcome(event.session_id, event.tool_use_id, 'denied');
    await session.end();
    const result = (await recorder.store.read())[0]!;
    expect(result.outcome).toBe('denied');
    expect(result.gaps).toContain('denied');
    expect(result.state).toBe('incomplete');
  });

  it('does not follow symlinks out of the selected root', async () => {
    const { recorder, launch, event } = await setup('Edit');
    await fs.writeFile(path.join(directory, 'outside'), 'outside contents');
    await fs.symlink(path.join(directory, 'outside'), path.join(root, 'escape'));
    await runHook(launch, event);
    await runHook(launch, { ...event, hook_event_name: 'PostToolUse' });
    const result = (await recorder.store.read())[0]!;
    expect(result.before!.entries.find((entry) => entry.path === 'escape')).toMatchObject({
      hash: null,
      gap: 'symlink',
    });
    expect(result.state).toBe('incomplete');
  });

  it('admits future provider versions and records unsupported tools without manufacturing a baseline', async () => {
    const { session, recorder, launch, event } = await setup();
    await runHook(launch, { ...event, tool_name: 'UnsupportedWriter' });
    await session.end();
    expect(
      await session.start({
        sessionId: 'session',
        runId: 'future',
        turnId: 'future-turn',
        provider,
        roots: [{ serviceId: 'service', root }],
        harnessVersion: '999.0.0',
      }),
    ).toBeDefined();
    expect(await recorder.store.read()).toEqual([]);
    const names = await fs.readdir(path.join(directory, 'evidence', 'coverage'));
    const reasons = await Promise.all(
      names.map(
        async (name) =>
          JSON.parse(await fs.readFile(path.join(directory, 'evidence', 'coverage', name), 'utf8'))
            .payload.reason,
      ),
    );
    expect(reasons).toContain('unsupported_tool');
    expect(reasons).not.toContain('unsupported_version');
  });

  it('keeps a disconnected pre-hook incomplete even when baseline capture finishes', async () => {
    const { session, recorder, event } = await setup('Edit');
    const abort = new AbortController();
    abort.abort();
    await session.handle(event, abort.signal);
    const result = (await recorder.store.read())[0]!;
    expect(result.state).toBe('incomplete');
    expect(result.gaps).toContain('interrupted');
  });

  it('rejects uncorrelated hook identities without manufacturing a baseline', async () => {
    const { recorder, launch, event } = await setup();
    await runHook(launch, { ...event, session_id: 'different-provider' });
    expect(await recorder.store.read()).toEqual([]);
    const coverageNames = await fs.readdir(path.join(directory, 'evidence', 'coverage'));
    expect(coverageNames.length).toBeGreaterThan(0);
  });
});
