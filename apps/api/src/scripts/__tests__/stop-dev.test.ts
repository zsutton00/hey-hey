import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { stopDevServer } = require('../../../scripts/stop-dev.js') as {
  stopDevServer(options: Record<string, unknown>): Promise<string>;
};

describe('stop-dev', () => {
  let checkout: string;
  let lockPath: string;

  beforeEach(() => {
    checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'api-stop-dev-'));
    lockPath = path.join(checkout, '.tmp', 'api-dev.pid.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(checkout, { recursive: true, force: true });
  });

  const writeLock = (pid = 1234, cwd = checkout) => {
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid, cwd, startedAt: new Date().toISOString() })}\n`,
    );
  };

  it('stops the lock owner gracefully and removes its lock', async () => {
    writeLock();
    let running = true;
    const sendSignal = jest.fn(() => {
      running = false;
    });

    await expect(
      stopDevServer({
        cwd: checkout,
        getListeningPids: () => [],
        getProcessCommand: () => 'node scripts/run-dev.js',
        isRunning: () => running,
        sendSignal,
        sleep: async () => undefined,
        output: jest.fn(),
      }),
    ).resolves.toBe('stopped');

    expect(sendSignal).toHaveBeenCalledWith(1234, 'SIGTERM');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('removes a stale lock without signaling another process', async () => {
    writeLock();
    const sendSignal = jest.fn();

    await expect(
      stopDevServer({
        cwd: checkout,
        getListeningPids: () => [],
        isRunning: () => false,
        sendSignal,
        output: jest.fn(),
      }),
    ).resolves.toBe('not-running');

    expect(sendSignal).not.toHaveBeenCalled();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('does not signal a reused PID', async () => {
    writeLock();
    const sendSignal = jest.fn();

    await expect(
      stopDevServer({
        cwd: checkout,
        getListeningPids: () => [],
        getProcessCommand: () => 'node unrelated-service.js',
        isRunning: () => true,
        sendSignal,
        output: jest.fn(),
      }),
    ).resolves.toBe('not-running');

    expect(sendSignal).not.toHaveBeenCalled();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('forces a validated launcher to stop after the graceful timeout', async () => {
    writeLock();
    let running = true;
    const sendSignal = jest.fn((_pid: number, signal: string) => {
      if (signal === 'SIGKILL') running = false;
    });

    await expect(
      stopDevServer({
        cwd: checkout,
        getListeningPids: () => [],
        getProcessCommand: () => 'node scripts/run-dev.js',
        getDescendantPids: () => [2345],
        isRunning: () => running,
        sendSignal,
        sleep: async () => undefined,
        timeoutMs: 0,
        output: jest.fn(),
      }),
    ).resolves.toBe('stopped');

    expect(sendSignal).toHaveBeenNthCalledWith(1, 1234, 'SIGTERM');
    expect(sendSignal).toHaveBeenCalledWith(2345, 'SIGKILL');
    expect(sendSignal).toHaveBeenCalledWith(1234, 'SIGKILL');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('preserves the lock when forced shutdown cannot stop the owner', async () => {
    writeLock();

    await expect(
      stopDevServer({
        cwd: checkout,
        getListeningPids: () => [],
        getProcessCommand: () => 'node scripts/run-dev.js',
        getDescendantPids: () => [],
        isRunning: () => true,
        sendSignal: jest.fn(),
        sleep: async () => undefined,
        timeoutMs: 0,
        forceTimeoutMs: 0,
        output: jest.fn(),
      }),
    ).rejects.toThrow('remained alive after forced shutdown');

    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('kills the process listening on port 3000 without a matching lock', async () => {
    let running = true;
    const sendSignal = jest.fn(() => {
      running = false;
    });

    await expect(
      stopDevServer({
        cwd: checkout,
        getListeningPids: () => [5678],
        isRunning: () => running,
        sendSignal,
        sleep: async () => undefined,
        output: jest.fn(),
      }),
    ).resolves.toBe('stopped');

    expect(sendSignal).toHaveBeenCalledWith(5678, 'SIGTERM');
  });

  it('ignores a lock owned by another checkout and still clears port 3000', async () => {
    writeLock(1234, path.join(checkout, 'different'));
    let running = true;
    const sendSignal = jest.fn(() => {
      running = false;
    });

    await expect(
      stopDevServer({
        cwd: checkout,
        getListeningPids: () => [5678],
        isRunning: () => running,
        sendSignal,
        sleep: async () => undefined,
        output: jest.fn(),
      }),
    ).resolves.toBe('stopped');

    expect(sendSignal).toHaveBeenCalledWith(5678, 'SIGTERM');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
