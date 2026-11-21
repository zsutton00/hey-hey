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
import {
  AntigravityExecutionCaptureHooks,
  antigravityHookSettings,
} from '../antigravity/execution-capture-hooks';
import type { AcpInboundCall } from '../antigravity/acp-schemas';
import { ANTIGRAVITY_HOOK_MATCHER, type ExecutionCaptureSession } from './capture-session';
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
      ...(tool === 'Edit' ? { tool_input: { file_path: path.join(root, 'dirty.txt') } } : {}),
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
    expect(result.after!.entries.find((entry) => entry.path === 'delete.txt')?.hash).toBeNull();
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
      'pending',
    ]);
  });

  it('captures only status candidates in a populated repository, including dirty edits and reverts', async () => {
    const source = path.join(root, 'src');
    await fs.mkdir(source);
    await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        fs.writeFile(path.join(source, `module-${index}.ts`), `export const value = ${index};\n`),
      ),
    );
    await fs.writeFile(path.join(root, '.gitignore'), 'cache/\n');
    await exec('git', ['-C', root, 'add', 'src', '.gitignore']);
    await exec('git', [
      '-C',
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-qm',
      'populated source tree',
    ]);
    await fs.writeFile(path.join(root, 'src/module-1.ts'), 'pre-existing dirty content');
    const { recorder, session, launch, event } = await setup();
    const indexBefore = await fs.readFile(path.join(root, '.git/index'));
    await runHook(launch, event);
    const pending = (await recorder.store.read())[0]!;
    expect(pending.before!.entries.map((entry) => entry.path).sort()).toEqual([
      'dirty.txt',
      'src/module-1.ts',
    ]);
    expect(await fs.readFile(path.join(root, '.git/index'))).toEqual(indexBefore);
    await fs.writeFile(path.join(root, 'dirty.txt'), 'our change to dirty file');
    await exec('git', ['-C', root, 'restore', 'src/module-1.ts']);
    await fs.writeFile(path.join(root, 'src/module-2.ts'), 'our change to clean file');
    await fs.writeFile(path.join(root, 'new file\nwith newline.txt'), 'created');
    session.outcome(event.session_id, event.tool_use_id, 'success');
    await runHook(launch, { ...event, hook_event_name: 'PostToolUse', exit_code: 0 });
    const changes = (file: string) =>
      recorder.capturedFileChanges('run', 'run-turn', 'service', file);
    expect(changes('src/module-3.ts')).toEqual([]);
    expect(changes('dirty.txt')).toHaveLength(1);
    expect(
      (await recorder.readCapturedContent(changes('dirty.txt')[0]!.beforeHash!)).toString(),
    ).toBe('already dirty');
    expect(
      (await recorder.readCapturedContent(changes('src/module-1.ts')[0]!.afterHash!)).toString(),
    ).toBe('export const value = 1;\n');
    expect(
      (await recorder.readCapturedContent(changes('src/module-2.ts')[0]!.beforeHash!)).toString(),
    ).toBe('export const value = 2;\n');
    expect(changes('new file\nwith newline.txt')[0]!.beforeHash).toBeNull();
    await recorder.releaseTurn('run', 'run-turn');
    expect(await recorder.store.read()).toEqual([]);
  });

  it.each(['baseline-read', 'final-read', 'final-write', 'settlement-read'] as const)(
    'settles and closes while %s remains blocked, without accepting late evidence',
    async (stage) => {
      const { session, recorder, launch, event } = await setup('Edit');
      if (stage !== 'baseline-read') {
        await runHook(launch, event);
        await fs.writeFile(path.join(root, 'dirty.txt'), 'changed by tool');
      }
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let resumed = false;
      const realpath = fs.realpath.bind(fs);
      const open = fs.open.bind(fs);
      const filesystem =
        stage === 'final-write'
          ? vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
              const file = await open(...args);
              if (String(args[0]).includes(`${path.sep}observations${path.sep}`)) {
                const write = file.writeFile.bind(file);
                vi.spyOn(file, 'writeFile').mockImplementationOnce(async (...writeArgs) => {
                  await blocked;
                  resumed = true;
                  return write(...writeArgs);
                });
              }
              return file;
            })
          : vi.spyOn(fs, 'realpath').mockImplementationOnce(async (file) => {
              await blocked;
              resumed = true;
              return realpath(file);
            });
      try {
        const started = Date.now();
        if (stage === 'settlement-read') {
          session.outcome(event.session_id, event.tool_use_id, 'failure');
        } else {
          await runHook(launch, {
            ...event,
            hook_event_name: stage === 'baseline-read' ? 'PreToolUse' : 'PostToolUse',
          });
          expect(Date.now() - started).toBeLessThan(3000);
        }
        let settled = false;
        const ending = session.end().then(() => {
          settled = true;
        });
        await expect.poll(() => settled, { timeout: 3000 }).toBe(true);
        await ending;
        await session.close();
        expect(resumed).toBe(false);
        expect(recorder.capturedFileChanges('run', 'run-turn', 'service', 'dirty.txt')).toEqual([]);
        // Releasing a previously blocked OS call must not publish successful evidence.
        release();
        await expect.poll(() => resumed).toBe(true);
        await expect.poll(async () => (await recorder.store.read())[0]?.state).toBe('incomplete');
        expect((await recorder.store.read())[0]).toMatchObject({
          gaps: expect.arrayContaining(['interrupted']),
          after: null,
        });
      } finally {
        release();
        filesystem.mockRestore();
      }
    },
  );

  it('keeps status paths relative to a Service nested inside a git repository', async () => {
    const serviceRoot = path.join(root, 'nested');
    await fs.mkdir(serviceRoot);
    await fs.writeFile(path.join(serviceRoot, 'clean.txt'), 'baseline');
    await exec('git', ['-C', root, 'add', 'nested']);
    await exec('git', [
      '-C',
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-qm',
      'nested service',
    ]);
    root = serviceRoot;
    const { recorder, session, launch, event } = await setup();
    await runHook(launch, event);
    await fs.writeFile(path.join(root, 'clean.txt'), 'changed');
    session.outcome(event.session_id, event.tool_use_id, 'success');
    await runHook(launch, { ...event, hook_event_name: 'PostToolUse', exit_code: 0 });
    const [change] = recorder.capturedFileChanges('run', 'run-turn', 'service', 'clean.txt');
    expect(change).toBeDefined();
    expect((await recorder.readCapturedContent(change!.beforeHash!)).toString()).toBe('baseline');
    expect((await recorder.readCapturedContent(change!.afterHash!)).toString()).toBe('changed');
  });

  it('completes direct edits without changing git index or writing canonical facts', async () => {
    const { recorder, launch, event } = await setup('Edit');
    const indexBefore = await fs.readFile(path.join(root, '.git', 'index'));
    await runHook(launch, event);
    await fs.writeFile(path.join(root, 'dirty.txt'), 'direct edit');
    await runHook(launch, { ...event, hook_event_name: 'PostToolUse' });
    const observation = (await recorder.store.read())[0]!;
    expect(observation.state).toBe('completed');
    // An edit tool reads only the file it names, not the rest of the repository.
    expect(observation.before!.entries.map((entry) => entry.path)).toEqual(['dirty.txt']);
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(indexBefore);
    expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(['repo', 'evidence']));
    expect(await fs.readdir(path.join(directory, 'evidence'))).not.toContain('runs');
  });

  it('prunes ignored caches and applies nested, anchored and negated .gitignore rules', async () => {
    const { recorder, launch, event } = await setup('Bash');
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
    const { recorder, launch, event } = await setup('Bash');
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
    await expect.poll(async () => (await recorder.store.read())[0]?.state).toBe('incomplete');
    const result = (await recorder.store.read())[0]!;
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

type SessionUpdate = Extract<AcpInboundCall, { method: 'session/update' }>['params'];
interface AgyHookPayload {
  hookEventName: 'PreToolUse' | 'PostToolUse';
  conversationId: string;
  toolCall: { id: string; name: string; args: Record<string, unknown> };
  error?: string;
}
type RecordedStep =
  | { kind: 'update'; update: SessionUpdate }
  | { kind: 'hook'; hook: AgyHookPayload };
type RecordedLine =
  | { direction: 'hook'; frame: { payload: AgyHookPayload } }
  | { direction: 'agent->client'; frame: { method?: string; params: SessionUpdate } }
  | { direction: 'client->agent' | 'driver'; frame: unknown };

/** The scratch directory agy worked in when the hook-relay recording was made (redacted form). */
const RECORDED_ROOT = '/tmp/agy-capture-hook-relay-bRBjUT';

/**
 * The real agy hook-relay recording, in transcript order, with its directory moved to an alias
 * of `root`: agy named the workspace /tmp/..., which this host resolves to /private/tmp/....
 */
const recordedSteps = async (): Promise<RecordedStep[]> => {
  const alias = path.join(directory, 'workspace-alias');
  await fs.symlink(root, alias).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  });
  const text = await fs.readFile(
    'src/agent-runtime/node/__fixtures__/antigravity/hook-relay.ndjson',
    'utf8',
  );
  return text
    .split('\n')
    .filter(Boolean)
    .map((line): RecordedLine => JSON.parse(line.replaceAll(RECORDED_ROOT, alias)) as RecordedLine)
    .flatMap((entry): RecordedStep[] => {
      if (entry.direction === 'hook') {
        return [{ kind: 'hook', hook: entry.frame.payload }];
      }
      if (entry.direction === 'agent->client' && entry.frame.method === 'session/update') {
        return [{ kind: 'update', update: entry.frame.params }];
      }
      return [];
    });
};

/** Runs the hook command exactly as installed in hooks.json, with no capture variables in scope. */
const runInstalledHook = (command: string, payload: AgyHookPayload): Promise<string> =>
  new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('HEY_HEY_CAPTURE_')),
    );
    const child = spawn('/bin/sh', ['-c', command], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`Hook exited with ${String(code)}`)),
    );
    child.stdin.end(JSON.stringify(payload));
  });

const coverageReasons = async (): Promise<string[]> => {
  const coverage = path.join(directory, 'evidence', 'coverage');
  const names = await fs.readdir(coverage).catch(() => []);
  return Promise.all(
    names.map(async (name) => {
      const text = await fs.readFile(path.join(coverage, name), 'utf8');
      return (JSON.parse(text) as { payload: { reason: string } }).payload.reason;
    }),
  );
};

describe('antigravity execution capture from the hook-relay recording', () => {
  const setup = async () => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    const adapter = new AntigravityExecutionCaptureHooks(recorder, NOOP_LOGGER);
    sessions.push(adapter.session);
    const launch = await adapter.session.start({
      sessionId: 'agent-session',
      runId: 'run',
      turnId: 'run-turn',
      provider: 'antigravity',
      roots: [{ serviceId: 'service', root }],
      harnessVersion: '1.5.13',
    });
    const settings = antigravityHookSettings(launch!)['hey-hey-capture']!;
    const command = settings.PreToolUse[0]!.hooks[0]!.command;
    return {
      recorder,
      adapter,
      launch,
      command,
      matcher: new RegExp(settings.PreToolUse[0]!.matcher),
    };
  };

  it('pairs each recorded hook with the ACP tool call of the same id', async () => {
    const { recorder, adapter, command, matcher } = await setup();
    const steps = await recordedSteps();
    const written = new Set<string>();
    for (const step of steps) {
      if (step.kind === 'update') {
        adapter.observe(step.update);
        continue;
      }
      const { hook } = step;
      // agy runs only the hooks whose matcher names the tool.
      if (!matcher.test(hook.toolCall.name)) {
        continue;
      }
      if (
        hook.hookEventName === 'PostToolUse' &&
        hook.toolCall.name === 'write_file' &&
        !written.has(hook.toolCall.id)
      ) {
        // What agy's write_file did between its hooks.
        await fs.writeFile(
          String(hook.toolCall.args['Path']),
          String(hook.toolCall.args['Content']),
        );
        written.add(hook.toolCall.id);
      }
      // Capture only observes: agy keeps its normal permission flow.
      expect(await runInstalledHook(command, hook)).toBe(
        hook.hookEventName === 'PreToolUse' ? '{"decision":"ask"}' : '{}',
      );
    }
    await adapter.session.end();

    const recordedCalls = steps.flatMap((step) =>
      step.kind === 'update' && step.update.update.sessionUpdate === 'tool_call'
        ? [{ id: step.update.update.toolCallId, name: step.update.update.name }]
        : [],
    );
    const observations = await recorder.store.read();
    // Repeated hook deliveries and the read-only call add nothing.
    expect(
      observations.map(({ identity }) => [identity.toolCallId, identity.toolName]).sort(),
    ).toEqual(
      recordedCalls
        .filter(({ name }) => name !== 'read_file')
        .map(({ id, name }) => [id, name === 'run_command' ? 'Bash' : 'Write'])
        .sort(),
    );
    for (const observation of observations) {
      expect(observation.identity).toMatchObject({
        provider: 'antigravity',
        providerSessionId: steps.find((step) => step.kind === 'hook')!.hook.conversationId,
      });
      expect(observation.outcome).toBe('success');
    }
    const write = observations.find(({ identity }) => identity.toolName === 'Write')!;
    const before = write.before!.entries.find((entry) => entry.path === 'hook-probe.txt');
    const after = write.after!.entries.find((entry) => entry.path === 'hook-probe.txt')!;
    expect(before?.hash ?? null).toBeNull();
    expect((await recorder.store.readBlob(after.hash!)).toString()).toBe('probe');
    expect(await coverageReasons()).not.toContain('identity_unresolved');
  });

  it('records an identity gap for a hook whose id no ACP tool call announced', async () => {
    const { recorder, adapter, command } = await setup();
    const steps = await recordedSteps();
    const recorded = steps.find(
      (step): step is Extract<RecordedStep, { kind: 'hook' }> =>
        step.kind === 'hook' && step.hook.toolCall.name === 'run_command',
    )!.hook;
    // The stream announced a different call, so the two must not be paired.
    adapter.observe({
      sessionId: recorded.conversationId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_announced_elsewhere',
        name: 'run_command',
        kind: 'execute',
      },
    });
    expect(await runInstalledHook(command, recorded)).toBe('{"decision":"ask"}');
    await adapter.session.end();

    expect(await recorder.store.read()).toEqual([]);
    expect(await coverageReasons()).toContain('identity_unresolved');
  });

  it('lets the session run without hooks when the hook file cannot be written, removing the old one', async () => {
    const { adapter, launch } = await setup();
    const launchDirectory = path.join(directory, 'launch');
    const stale = path.join(launchDirectory, '.agents', 'hooks.json');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, '{"stale":{}}', { mode: 0o400 });
    await expect(adapter.install(launchDirectory, launch)).resolves.toBeUndefined();

    await expect(fs.access(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await coverageReasons()).toContain('hook_not_observed');
  });

  it('refuses the launch when a hook file it cannot replace also cannot be removed', async () => {
    const { adapter, launch } = await setup();
    const launchDirectory = path.join(directory, 'launch');
    // A directory where the hook file belongs can be neither overwritten nor force-removed.
    await fs.mkdir(path.join(launchDirectory, '.agents', 'hooks.json'), { recursive: true });
    await expect(adapter.install(launchDirectory, launch)).rejects.toThrow();
  });

  it('records no file evidence for a write through a link leading out of the workspace', async () => {
    const { recorder, adapter, command } = await setup();
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, 'escape'));
    const steps = await recordedSteps();
    const announced = steps.find(
      (step): step is Extract<RecordedStep, { kind: 'update' }> =>
        step.kind === 'update' &&
        step.update.update.sessionUpdate === 'tool_call' &&
        step.update.update.name === 'write_file',
    )!.update;
    const recordedWrite = steps.find(
      (step): step is Extract<RecordedStep, { kind: 'hook' }> =>
        step.kind === 'hook' &&
        step.hook.hookEventName === 'PreToolUse' &&
        step.hook.toolCall.name === 'write_file',
    )!.hook;
    const escaping = {
      ...recordedWrite,
      toolCall: {
        ...recordedWrite.toolCall,
        args: { ...recordedWrite.toolCall.args, Path: path.join(root, 'escape', 'hook-probe.txt') },
      },
    };
    adapter.observe(announced);
    await runInstalledHook(command, escaping);
    await adapter.session.end();

    expect(await recorder.store.read()).toEqual([]);
    expect(await coverageReasons()).toContain('identity_unresolved');
  });
});
