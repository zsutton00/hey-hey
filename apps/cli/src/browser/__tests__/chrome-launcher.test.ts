import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import {
  allocateDebugPort,
  chromeExecutableCandidates,
  chromeLaunchArgs,
  ChromeLaunchError,
  ChromeNotFoundError,
  InstalledChromeLauncher,
} from '../chrome-launcher';

class FakeChild extends EventEmitter {
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public kill(signal: NodeJS.Signals): boolean {
    this.signalCode = signal;
    this.emit('exit');
    return true;
  }
}

describe('InstalledChromeLauncher', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-launcher-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('binds the debugging endpoint to localhost on the given nonzero port with the project profile', () => {
    const args = chromeLaunchArgs('/profiles/p1', 52100);

    expect(args).toContain('--remote-debugging-address=127.0.0.1');
    expect(args).toContain('--remote-debugging-port=52100');
    expect(args).not.toContain('--remote-debugging-port=0');
    expect(args).toContain('--user-data-dir=/profiles/p1');
    expect(args.some((arg) => arg.startsWith('--headless'))).toBe(false);
  });

  it('adopts a shared Chrome still open on the profile instead of relaunching it', async () => {
    await fs.writeFile(path.join(dir, 'heyhey-debug-port'), '9333');
    await fs.symlink(`host-${String(process.pid)}`, path.join(dir, 'SingletonLock'));
    let spawned = false;
    const launcher = new InstalledChromeLauncher({
      candidates: () => ['/chrome'],
      fileExists: () => true,
      fetchBrowserPath: (port) => Promise.resolve(port === 9333 ? '/devtools/browser/abc' : null),
      spawnChrome: () => {
        spawned = true;
        return new FakeChild() as unknown as ChildProcess;
      },
    });

    const chrome = await launcher.launch(dir);

    expect(chrome.wsEndpoint).toBe('ws://127.0.0.1:9333/devtools/browser/abc');
    expect(spawned).toBe(false);
  });

  it('refuses to relaunch on a profile held by a Chrome it cannot reach', async () => {
    await fs.symlink(`host-${String(process.pid)}`, path.join(dir, 'SingletonLock'));
    let spawned = false;
    const launcher = new InstalledChromeLauncher({
      candidates: () => ['/chrome'],
      fileExists: () => true,
      spawnChrome: () => {
        spawned = true;
        return new FakeChild() as unknown as ChildProcess;
      },
    });

    await expect(launcher.launch(dir)).rejects.toThrow(/already open/u);
    expect(spawned).toBe(false);
  });

  it('throws ChromeNotFoundError when Chrome is not installed', async () => {
    const launcher = new InstalledChromeLauncher({
      candidates: () => ['/missing/chrome'],
      fileExists: () => false,
    });

    await expect(launcher.launch(dir)).rejects.toBeInstanceOf(ChromeNotFoundError);
  });

  it('lists the macOS app bundle and Windows install locations', () => {
    expect(chromeExecutableCandidates('darwin', {})).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
    expect(chromeExecutableCandidates('win32', { PROGRAMFILES: 'C:\\Program Files' })).toEqual([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]);
  });

  it('resolves the localhost WebSocket endpoint from the requested port and records it', async () => {
    const userDataDir = path.join(dir, 'p1');
    let spawnedArgs: string[] = [];
    const child = new FakeChild();
    const launcher = new InstalledChromeLauncher({
      candidates: () => ['/chrome'],
      fileExists: () => true,
      allocatePort: () => Promise.resolve(51234),
      fetchBrowserPath: () => Promise.resolve('/devtools/browser/abc'),
      spawnChrome: (_file, args) => {
        spawnedArgs = args;
        return child as unknown as ChildProcess;
      },
    });

    const launched = await launcher.launch(userDataDir);

    expect(launched.wsEndpoint).toBe('ws://127.0.0.1:51234/devtools/browser/abc');
    expect(spawnedArgs).toContain('--remote-debugging-port=51234');
    await expect(fs.readFile(path.join(userDataDir, 'heyhey-debug-port'), 'utf8')).resolves.toBe(
      '51234',
    );
    expect(spawnedArgs).toContain(`--user-data-dir=${userDataDir}`);
    await launched.kill();
    expect(child.signalCode).toBe('SIGTERM');
  });

  it('fails clearly when Chrome exits before the endpoint is ready', async () => {
    const child = new FakeChild();
    child.exitCode = 1;
    const launcher = new InstalledChromeLauncher({
      candidates: () => ['/chrome'],
      fileExists: () => true,
      allocatePort: () => Promise.resolve(51234),
      spawnChrome: () => child as unknown as ChildProcess,
    });

    await expect(launcher.launch(path.join(dir, 'p1'))).rejects.toBeInstanceOf(ChromeLaunchError);
  });

  it('retries with a fresh port when Chrome cannot bind the one it was given', async () => {
    const userDataDir = path.join(dir, 'p1');
    const ports = [51001, 51002];
    const spawnedPorts: string[] = [];
    const children: FakeChild[] = [];
    const launcher = new InstalledChromeLauncher({
      candidates: () => ['/chrome'],
      fileExists: () => true,
      allocatePort: () => Promise.resolve(ports.shift() ?? 0),
      fetchBrowserPath: (port) => Promise.resolve(port === 51002 ? '/devtools/browser/abc' : null),
      spawnChrome: (_file, args) => {
        const port = args.find((arg) => arg.startsWith('--remote-debugging-port='));
        spawnedPorts.push(port ?? '');
        const child = Object.assign(new FakeChild(), { stderr: new EventEmitter() });
        children.push(child);
        if (children.length === 1) {
          setTimeout(() => {
            child.stderr.emit('data', Buffer.from('Cannot start http server for devtools.\n'));
          }, 10);
        }
        return child as unknown as ChildProcess;
      },
    });

    const launched = await launcher.launch(userDataDir);

    expect(spawnedPorts).toEqual([
      '--remote-debugging-port=51001',
      '--remote-debugging-port=51002',
    ]);
    expect(children[0]?.signalCode).toBe('SIGTERM');
    expect(launched.wsEndpoint).toBe('ws://127.0.0.1:51002/devtools/browser/abc');
  });

  it('gives up after repeated port failures', async () => {
    let spawns = 0;
    const launcher = new InstalledChromeLauncher({
      candidates: () => ['/chrome'],
      fileExists: () => true,
      allocatePort: () => Promise.resolve(51001),
      spawnChrome: () => {
        spawns++;
        const child = Object.assign(new FakeChild(), { stderr: new EventEmitter() });
        setTimeout(() => {
          child.stderr.emit('data', Buffer.from('Cannot start http server for devtools.\n'));
        }, 5);
        return child as unknown as ChildProcess;
      },
    });

    await expect(launcher.launch(path.join(dir, 'p1'))).rejects.toThrow(/debugging port|port/u);
    expect(spawns).toBe(3);
  });
});

describe('allocateDebugPort', () => {
  it('returns a nonzero loopback port that is free to bind', async () => {
    const port = await allocateDebugPort();

    expect(port).toBeGreaterThan(0);
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port }, resolve);
    });
    await new Promise((resolve) => server.close(resolve));
  });
});
