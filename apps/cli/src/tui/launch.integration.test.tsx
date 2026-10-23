/**
 * The interactive launch end to end against fake TTY streams: real Ink, real
 * terminal capture and the real signal wiring around the foreground server
 * command. Only server startup and the Debug view model (to inject a render
 * failure) are replaced.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderFailure = vi.hoisted(() => ({ armed: false }));

vi.mock('./screens/debug/view-model', async (importActual) => {
  const actual = await importActual<typeof import('./screens/debug/view-model')>();
  return {
    ...actual,
    debugViewModel: (...args: Parameters<typeof actual.debugViewModel>) => {
      if (renderFailure.armed) throw new Error('debug view exploded');
      return actual.debugViewModel(...args);
    },
  };
});

import { LocalAgentServerStarter } from '../commands/server';
import type { LocalAgentServerRuntime } from '../server/local-agent-server-runtime';
import { runInteractiveServer } from './launch';
import { ControlledBrowserManager, FakeSources, session } from './presentation.test-support';

/** A TTY stdin in the shape Ink reads (mirrors ink-testing-library's). */
class FakeTtyStdin extends EventEmitter {
  public readonly isTTY = true;
  public readonly setRawMode = vi.fn();
  private pending: string | null = null;
  public readonly setEncoding = vi.fn();
  public readonly resume = vi.fn();
  public readonly pause = vi.fn();
  public readonly ref = vi.fn();
  public readonly unref = vi.fn();
  public read(): string | null {
    const data = this.pending;
    this.pending = null;
    return data;
  }
  public type(data: string): void {
    this.pending = data;
    this.emit('readable');
    this.emit('data', data);
  }
}

class FakeTtyStdout extends EventEmitter {
  public readonly isTTY = true;
  public columns = 100;
  public rows = 30;
  public readonly frames: string[] = [];
  /** An own property, so capture can replace and restore it exactly. */
  public readonly write = (chunk: string | Uint8Array): boolean => {
    this.frames.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  public text(): string {
    return this.frames.join('');
  }
}

class FakeStderr extends EventEmitter {
  public readonly isTTY = true;
  public readonly lines: string[] = [];
  /** An own property, so capture can replace and restore it exactly. */
  public readonly write = (chunk: string | Uint8Array): boolean => {
    this.lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
}

/** The console method currently installed (capture swaps it while the menu runs). */
const consoleMethod = (name: 'log' | 'error'): unknown => Reflect.get(console, name);

/** The `write` currently installed on a process stream. */
const streamWrite = (name: 'stdout' | 'stderr'): unknown => Reflect.get(process[name], 'write');

const tick = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const replaceProcessStream = (
  name: 'stdin' | 'stdout' | 'stderr',
  value: unknown,
): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, name);
  Object.defineProperty(process, name, { configurable: true, enumerable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(process, name, descriptor);
  };
};

/** The launch's own handler (Ink adds a signal-exit handler of its own). */
const LAUNCH_HANDLER: Partial<Record<NodeJS.Signals, string>> = {
  SIGINT: 'onSigint',
  SIGTERM: 'onSigterm',
};

const launchListeners = (event: NodeJS.Signals): Array<() => void> =>
  process.listeners(event).filter((listener) => listener.name === LAUNCH_HANDLER[event]) as Array<
    () => void
  >;

const addedListener = (event: NodeJS.Signals): (() => void) => {
  const added = launchListeners(event);
  expect(added).toHaveLength(1);
  return added[0] as () => void;
};

const launch = () => {
  const stdin = new FakeTtyStdin();
  const stdout = new FakeTtyStdout();
  const stderr = new FakeStderr();
  const restores = [
    replaceProcessStream('stdin', stdin),
    replaceProcessStream('stdout', stdout),
    replaceProcessStream('stderr', stderr),
  ];
  const originalWrites = { stdout: stdout.write, stderr: stderr.write };
  const originalConsole = { log: consoleMethod('log'), error: consoleMethod('error') };

  const fake = new FakeSources();
  fake.sessionList = [session()];
  fake.activeWork = 1;
  const close = vi.fn(() => Promise.resolve());
  vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockResolvedValue({
    url: 'http://localhost:3847',
    presentationSources: fake.sources,
    projectBrowsers: new ControlledBrowserManager(),
    close,
  } as unknown as LocalAgentServerRuntime);

  const running = runInteractiveServer({});
  return {
    stdin,
    stdout,
    stderr,
    fake,
    close,
    running,
    originalWrites,
    originalConsole,
    restoreStreams: () => {
      for (const restore of restores.reverse()) restore();
    },
  };
};

describe('runInteractiveServer on a terminal', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    renderFailure.armed = false;
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    vi.restoreAllMocks();
  });

  it('owns the terminal while running, keeps work going after cancel, and restores everything on confirmed quit', async () => {
    const t = launch();
    cleanups.push(t.restoreStreams);
    await vi.waitFor(() => expect(t.stdout.text()).toMatch(/SESSIONS ON THIS MACHINE +1/u), {
      timeout: 5_000,
    });
    expect(t.stdin.setRawMode).toHaveBeenCalledWith(true);
    // Stray output is captured instead of corrupting the frame.
    console.log('stray third-party log');
    process.stderr.write('stray stderr\n');
    expect(t.stdout.text()).not.toContain('stray third-party log');
    expect(t.stderr.lines.join('')).not.toContain('stray stderr');

    const sigint = addedListener('SIGINT');
    sigint();
    await vi.waitFor(
      () => expect(t.stdout.text()).toContain('1 session is working'),
      { timeout: 5_000 },
    );
    // Inputs reach the state machine synchronously; wait for the resulting frame.
    const beforeCancel = t.stdout.frames.length;
    t.stdin.type('n');
    await vi.waitFor(() => expect(t.stdout.frames.length).toBeGreaterThan(beforeCancel), {
      timeout: 5_000,
    });
    expect(t.close).not.toHaveBeenCalled();

    sigint();
    await tick();
    sigint();
    await expect(t.running).resolves.toBe(true);
    expect(t.close).toHaveBeenCalledTimes(1);

    expect(t.stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(streamWrite('stdout')).toBe(t.originalWrites.stdout);
    expect(streamWrite('stderr')).toBe(t.originalWrites.stderr);
    expect(consoleMethod('log')).toBe(t.originalConsole.log);
    expect(launchListeners('SIGINT')).toHaveLength(0);
    expect(launchListeners('SIGTERM')).toHaveLength(0);
  });

  it('survives a render failure: restores the terminal, keeps the server running until shutdown is requested', async () => {
    const t = launch();
    cleanups.push(t.restoreStreams);
    await vi.waitFor(() => expect(t.stdout.text()).toContain('SESSIONS ON THIS MACHINE'), {
      timeout: 5_000,
    });
    const sigint = addedListener('SIGINT');

    renderFailure.armed = true;
    t.stdin.type('d');
    await vi.waitFor(
      () =>
        expect(t.stderr.lines.join('')).toContain(
          'The Hey Hey terminal view stopped after an error (debug view exploded)',
        ),
      { timeout: 5_000 },
    );
    expect(t.stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(streamWrite('stdout')).toBe(t.originalWrites.stdout);
    expect(consoleMethod('log')).toBe(t.originalConsole.log);
    expect(t.close).not.toHaveBeenCalled();

    // The server keeps observing its sources while no view is shown.
    t.fake.register(session({ runId: 'run-2' }));
    await tick();
    expect(t.close).not.toHaveBeenCalled();

    // With no view to confirm in, Ctrl+C stops through the normal shutdown.
    sigint();
    await expect(t.running).resolves.toBe(true);
    expect(t.close).toHaveBeenCalledTimes(1);
    expect(launchListeners('SIGINT')).toHaveLength(0);
  });

  it('stops without asking on SIGTERM and follows terminal resizes', async () => {
    const t = launch();
    cleanups.push(t.restoreStreams);
    await vi.waitFor(() => expect(t.stdout.text()).toContain('SESSIONS ON THIS MACHINE'), {
      timeout: 5_000,
    });
    t.stdout.columns = 40;
    t.stdout.rows = 10;
    t.stdout.emit('resize');
    await vi.waitFor(() => expect(t.stdout.text()).toContain('Terminal too small'), {
      timeout: 5_000,
    });

    addedListener('SIGTERM')();
    await expect(t.running).resolves.toBe(true);
    expect(t.close).toHaveBeenCalledTimes(1);
    expect(t.stdout.listenerCount('resize')).toBe(0);
    expect(t.stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
