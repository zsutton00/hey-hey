import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';

const CDP_HOST = '127.0.0.1';
/**
 * Chrome writes `DevToolsActivePort` only for `--remote-debugging-port=0`, so a launch on an
 * explicit port records the port here for later CLIs that adopt the still-open browser.
 */
const DEBUG_PORT_FILE = 'heyhey-debug-port';
/** Chrome's per-profile lock, a symlink to `<hostname>-<pid>` while that profile is open. */
const SINGLETON_LOCK_FILE = 'SingletonLock';
const PROBE_TIMEOUT_MS = 1_000;
const ENDPOINT_TIMEOUT_MS = 30_000;
const ENDPOINT_POLL_MS = 100;
/** Another process can take an allocated port before Chrome binds it, so a launch gets fresh ports. */
const MAX_PORT_ATTEMPTS = 3;
/** Chrome's stderr line when it could not bind `--remote-debugging-port`; it keeps running without a debugger. */
const DEBUG_PORT_UNAVAILABLE_STDERR = 'Cannot start http server for devtools';

export class ChromeNotFoundError extends Error {
  public readonly code = 'SHARED_BROWSER_CHROME_NOT_FOUND' as const;

  public constructor(public readonly searchedPaths: readonly string[]) {
    super(
      `Google Chrome is not installed. Install Chrome to use the shared browser (looked in: ${searchedPaths.join(', ')}).`,
    );
    this.name = 'ChromeNotFoundError';
  }
}

export class ChromeLaunchError extends Error {
  public readonly code = 'SHARED_BROWSER_LAUNCH_FAILED' as const;

  public constructor(message: string) {
    super(message);
    this.name = 'ChromeLaunchError';
  }
}

/** Chrome could not bind the debugging port it was given; a launch with a different port may succeed. */
class DebugPortUnavailableError extends ChromeLaunchError {
  public constructor(public readonly port: number) {
    super(`Chrome could not open its debugging endpoint on port ${String(port)}.`);
    this.name = 'DebugPortUnavailableError';
  }
}

export interface LaunchedChrome {
  /** Browser-level CDP WebSocket endpoint on localhost. */
  wsEndpoint: string;
  /** Terminates the Chrome process and resolves once it has exited. */
  kill: () => Promise<void>;
}

export interface ChromeLauncher {
  launch(userDataDir: string): Promise<LaunchedChrome>;
}

/** Candidate Chrome executables for the platform, most specific first. */
export const chromeExecutableCandidates = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] => {
  if (platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  if (platform === 'win32') {
    return [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']]
      .filter((root): root is string => Boolean(root))
      .map((root) => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const dirs = (env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
};

/** An unused loopback port. Port 0 is not passed to Chrome: it makes Chrome report `navigator.webdriver` as true. */
export const allocateDebugPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: CDP_HOST, port: 0 }, () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not determine the allocated debugging port.'));
      });
    });
  });

export const chromeLaunchArgs = (userDataDir: string, debugPort: number): string[] => [
  `--remote-debugging-address=${CDP_HOST}`,
  `--remote-debugging-port=${String(debugPort)}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
];

interface InstalledChromeLauncherOptions {
  candidates?: () => string[];
  fileExists?: (filePath: string) => boolean;
  spawnChrome?: (executable: string, args: string[]) => ChildProcess;
  endpointTimeoutMs?: number;
  allocatePort?: () => Promise<number>;
  /** The browser WebSocket path (`/devtools/browser/<id>`) served on the port, or null if nothing answers. */
  fetchBrowserPath?: (port: number) => Promise<string | null>;
  logger?: ServerLogger;
}

/** Chrome's own stderr is the only account of why it quit; keep its tail for the failure log. */
const STDERR_TAIL_CHARS = 4_000;

const fetchBrowserPath = async (port: number): Promise<string | null> => {
  try {
    const response = await fetch(`http://${CDP_HOST}:${String(port)}/json/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { webSocketDebuggerUrl?: unknown };
    return typeof body.webSocketDebuggerUrl === 'string'
      ? new URL(body.webSocketDebuggerUrl).pathname
      : null;
  } catch {
    return null;
  }
};

/** Launches the user's installed Chrome as a visible window with a localhost CDP endpoint. */
export class InstalledChromeLauncher implements ChromeLauncher {
  private readonly logger: ServerLogger;

  public constructor(private readonly options: InstalledChromeLauncherOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  public resolveExecutable(): string {
    const candidates = (this.options.candidates ?? chromeExecutableCandidates)();
    const fileExists = this.options.fileExists ?? existsSync;
    const executable = candidates.find((candidate) => fileExists(candidate));
    if (!executable) throw new ChromeNotFoundError(candidates);
    return executable;
  }

  public async launch(userDataDir: string): Promise<LaunchedChrome> {
    const executable = this.resolveExecutable();
    this.logger.info('shared_browser.chrome.launch_requested', { executable, userDataDir });
    await fs.mkdir(userDataDir, { recursive: true, mode: 0o700 });
    const portFile = path.join(userDataDir, DEBUG_PORT_FILE);
    // Chrome hands a second launch on an open profile to the running instance and
    // exits, so a shared browser left open by an earlier CLI must be adopted, not relaunched.
    const running = await this.adoptRunning(userDataDir, portFile);
    if (running) return running;
    const lock = await fs.readlink(path.join(userDataDir, SINGLETON_LOCK_FILE)).catch(() => null);
    const holder = lockHolderPid(lock);
    if (holder !== null && isRunning(holder)) {
      // Launching would only hand off to the holder, opening a stray blank tab, then exit.
      this.logger.error('shared_browser.chrome.profile_locked', { userDataDir, lock, pid: holder });
      throw new ChromeLaunchError(
        `The shared browser for this project is already open (Chrome pid ${String(holder)}) but cannot be reached. Close that Chrome window and try again.`,
      );
    }
    if (lock) this.logger.info('shared_browser.chrome.stale_lock', { userDataDir, lock });

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.spawnWithFreshPort(executable, userDataDir, portFile);
      } catch (error) {
        if (!(error instanceof DebugPortUnavailableError) || attempt >= MAX_PORT_ATTEMPTS) {
          throw error;
        }
        this.logger.warn('shared_browser.chrome.port_retry', { attempt, port: error.port });
      }
    }
  }

  private async spawnWithFreshPort(
    executable: string,
    userDataDir: string,
    portFile: string,
  ): Promise<LaunchedChrome> {
    // A file left by an earlier launch would point at a dead port.
    await fs.rm(portFile, { force: true });
    const port = await (this.options.allocatePort ?? allocateDebugPort)();
    const spawnChrome =
      this.options.spawnChrome ??
      ((file: string, args: string[]) =>
        spawn(file, args, { stdio: ['ignore', 'ignore', 'pipe'] }));
    const args = chromeLaunchArgs(userDataDir, port);
    const child = spawnChrome(executable, args);
    this.logger.info('shared_browser.chrome.spawned', { pid: child.pid, port, args });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS);
    });
    child.once('exit', (code, signal) => {
      this.logger.info('shared_browser.chrome.exited', { pid: child.pid, code, signal, stderr });
    });
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    const kill = async (): Promise<void> => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exited;
    };

    try {
      const wsPath = await this.waitForEndpoint(child, port, () =>
        stderr.includes(DEBUG_PORT_UNAVAILABLE_STDERR),
      );
      await fs.writeFile(portFile, String(port));
      this.logger.info('shared_browser.chrome.endpoint_ready', { pid: child.pid, port, wsPath });
      return { wsEndpoint: `ws://${CDP_HOST}:${String(port)}${wsPath}`, kill };
    } catch (error) {
      this.logger.error('shared_browser.chrome.launch_failed', {
        pid: child.pid,
        port,
        exitCode: child.exitCode,
        signal: child.signalCode,
        message: error instanceof Error ? error.message : String(error),
        stderr,
      });
      await kill();
      throw error;
    }
  }

  private async adoptRunning(
    userDataDir: string,
    portFile: string,
  ): Promise<LaunchedChrome | null> {
    const contents = await fs.readFile(portFile, 'utf8').catch(() => null);
    const port = Number(contents?.trim());
    if (!Number.isInteger(port) || port <= 0) {
      this.logger.debug('shared_browser.chrome.adopt_skipped', {
        reason: 'no_port_file',
        portFile,
      });
      return null;
    }
    const wsPath = await (this.options.fetchBrowserPath ?? fetchBrowserPath)(port);
    if (!wsPath) {
      this.logger.info('shared_browser.chrome.adopt_skipped', { reason: 'endpoint_dead', port });
      return null;
    }
    const lock = await fs.readlink(path.join(userDataDir, SINGLETON_LOCK_FILE)).catch(() => null);
    const pid = lockHolderPid(lock);
    if (pid === null) {
      this.logger.warn('shared_browser.chrome.adopt_skipped', {
        reason: 'no_lock_pid',
        port,
        lock,
      });
      return null;
    }
    this.logger.info('shared_browser.chrome.adopted', { pid, port });
    return { wsEndpoint: `ws://${CDP_HOST}:${String(port)}${wsPath}`, kill: () => terminate(pid) };
  }

  /** Polls the requested port until Chrome serves its browser WebSocket path. */
  private async waitForEndpoint(
    child: ChildProcess,
    requestedPort: number,
    portRefused: () => boolean,
  ): Promise<string> {
    const deadline = Date.now() + (this.options.endpointTimeoutMs ?? ENDPOINT_TIMEOUT_MS);
    const spawnFailure: { error: Error | null } = { error: null };
    child.once('error', (error) => {
      spawnFailure.error = error;
    });
    while (Date.now() < deadline) {
      if (spawnFailure.error) {
        throw new ChromeLaunchError(`Chrome failed to start: ${spawnFailure.error.message}`);
      }
      if (portRefused()) throw new DebugPortUnavailableError(requestedPort);
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new ChromeLaunchError('Chrome exited before its debugging endpoint was ready.');
      }
      const wsPath = await (this.options.fetchBrowserPath ?? fetchBrowserPath)(requestedPort);
      if (wsPath) return wsPath;
      await new Promise((resolve) => setTimeout(resolve, ENDPOINT_POLL_MS));
    }
    throw new ChromeLaunchError('Timed out waiting for Chrome to open its debugging endpoint.');
  }
}

const lockHolderPid = (lock: string | null): number | null => {
  const pid = Number(lock?.slice(lock.lastIndexOf('-') + 1));
  return Number.isInteger(pid) && pid > 0 ? pid : null;
};

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stops an adopted Chrome, which is not this process's child, and waits for it to exit. */
const terminate = async (pid: number): Promise<void> => {
  if (!isRunning(pid)) return;
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + ENDPOINT_TIMEOUT_MS;
  while (isRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ENDPOINT_POLL_MS));
  }
};
