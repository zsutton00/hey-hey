import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenCodeServerProcess } from './opencode-server-launcher';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function provider() {
  const child = new ChildProcess();
  const stdout = new PassThrough();
  Object.defineProperty(child, 'stdout', { value: stdout });
  const kill = vi.spyOn(child, 'kill').mockImplementation(() => {
    // Node's killed flag means a signal was delivered, even if it is ignored.
    Object.defineProperty(child, 'killed', { value: true, configurable: true });
    return true;
  });
  spawn.mockImplementation(() => {
    queueMicrotask(() => stdout.write('listening on http://127.0.0.1:1234'));
    return child;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('healthy')),
  );
  const server = await OpenCodeServerProcess.launch({ directory: '/tmp' });
  return { server, child, kill };
}

it('forces a provider ignoring SIGTERM and waits for confirmed exit before resolving', async () => {
  vi.useFakeTimers();
  const { server, child, kill } = await provider();
  let complete = false;
  const stopping = server.stop().then(() => {
    complete = true;
  });
  expect(kill).toHaveBeenCalledWith('SIGTERM');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(kill).toHaveBeenCalledWith('SIGKILL');
  expect(complete).toBe(false);
  Object.defineProperty(child, 'signalCode', { value: 'SIGKILL' });
  child.emit('exit', null, 'SIGKILL');
  await stopping;
  expect(complete).toBe(true);
  await server.stop();
  expect(kill).toHaveBeenCalledTimes(2);
});

it('rejects unconfirmed termination and permits a later shutdown retry', async () => {
  vi.useFakeTimers();
  const { server, child } = await provider();
  const failed = expect(server.stop()).rejects.toThrow('exit could not be confirmed');
  await vi.advanceTimersByTimeAsync(10_000);
  await failed;
  const retry = server.stop();
  Object.defineProperty(child, 'signalCode', { value: 'SIGTERM' });
  child.emit('exit', null, 'SIGTERM');
  await retry;
});

it.each(['timeout', 'health-failure'] as const)(
  'confirms termination before rejecting a launch after %s',
  async (failure) => {
    vi.useFakeTimers();
    const child = new ChildProcess();
    const stdout = new PassThrough();
    Object.defineProperty(child, 'stdout', { value: stdout });
    const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
    spawn.mockImplementation(() => {
      if (failure === 'health-failure') {
        queueMicrotask(() => stdout.write('listening on http://127.0.0.1:1234'));
      }
      return child;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unhealthy', { status: 503 })),
    );
    let settled = false;
    const launching = OpenCodeServerProcess.launch({ directory: '/tmp' }).then(
      () => {
        throw new Error('Unexpected successful launch');
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);
    Object.defineProperty(child, 'signalCode', { value: 'SIGKILL' });
    child.emit('exit', null, 'SIGKILL');
    expect(await launching).toBeInstanceOf(Error);
    expect(settled).toBe(true);
  },
);
