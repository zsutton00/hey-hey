import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { ProviderProcessContainment } from '../../workspace-write-boundary';

const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_POLL_MAX_ATTEMPTS = 150; // 30s total
const STARTUP_OUTPUT_TIMEOUT_MS = 30_000;

// Anchors filesystem lookups on the cli package root. This module runs from
// <cli>/src/agents/ under tsx during local dev, but is collapsed into the
// bundled <cli>/dist/index.mjs by the esbuild build — different __dirname
// depths that both resolve to the same cli root here.
const resolveCliRoot = (): string =>
  path.basename(__dirname) === 'dist'
    ? path.resolve(__dirname, '..')
    : path.resolve(__dirname, '../..');

export const resolveOpencodeBinary = (): string => {
  const envPath = process.env['OPENCODE_BIN_PATH']?.trim();
  if (envPath) {
    return envPath;
  }

  // Sibling-repo fallback for local dev monorepo layout.
  // This assumes the opencode repo is a sibling of the hey-hey repo.
  const siblingRepo = path.resolve(
    resolveCliRoot(),
    '../../opencode/packages/opencode/bin/opencode',
  );
  if (fs.existsSync(siblingRepo)) {
    return siblingRepo;
  }

  // Global fallback
  return 'opencode';
};

export const pollHealth = async (
  baseUrl: string,
  signal: AbortSignal,
  maxAttempts: number = HEALTH_POLL_MAX_ATTEMPTS,
  pollIntervalMs: number = HEALTH_POLL_INTERVAL_MS,
): Promise<void> => {
  let lastNonOkStatus: number | null = null;
  let lastNonOkContentType: string | null = null;
  let lastNonOkBodyPreview: string | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) {
      throw new Error('Health check aborted');
    }

    try {
      const response = await fetch(`${baseUrl}/health`, { signal });
      signal.throwIfAborted();
      if (response.ok) {
        // The opencode serve SPA server returns 200 OK with text/html for
        // unmatched routes (including /health). Accept any 2xx response
        // as "server is up" rather than requiring {"healthy": true} JSON.
        return;
      }
      lastNonOkStatus = response.status;
      lastNonOkContentType = response.headers.get('content-type');
      lastNonOkBodyPreview = await response
        .text()
        .catch(() => '(failed to read body)')
        .then((t) => t.slice(0, 200));
    } catch (err) {
      signal.throwIfAborted();
      lastError = err instanceof Error ? err.message : String(err);
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(new Error('Health check aborted'));
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, pollIntervalMs);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    });
  }

  throw new Error(
    `OpenCode server at ${baseUrl} did not become healthy within ${maxAttempts * pollIntervalMs}ms.` +
      (lastNonOkStatus !== null
        ? ` Last response: ${lastNonOkStatus} ${lastNonOkContentType ?? '(no content-type)'} body="${lastNonOkBodyPreview ?? ''}".`
        : lastError !== null
          ? ` Last fetch error: ${lastError}.`
          : ' No responses received.'),
  );
};

export const buildOpenCodeSpawnCommand = (
  binary: string,
  args: readonly string[],
  containment?: ProviderProcessContainment,
): { command: string; args: string[]; env: NodeJS.ProcessEnv } => {
  if (!containment) {
    return { command: binary, args: Array.from(args), env: { ...process.env } };
  }
  return {
    command: containment.command,
    args: [...containment.argsPrefix, binary, ...args],
    env: { ...process.env, ...containment.env },
  };
};

/**
 * Names only, never values: which credential sources the spawned OpenCode
 * server will see. Used to diagnose a Run authenticating differently from the
 * user's terminal.
 */
export const describeOpenCodeCredentialSources = (
  env: NodeJS.ProcessEnv,
): {
  xdgDataHome: string;
  authFilePresent: boolean;
  authProviderIds: string[];
  apiKeyEnvNames: string[];
} => {
  const xdgDataHome = env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share');
  const authFile = path.join(xdgDataHome, 'opencode', 'auth.json');
  const apiKeyEnvNames = Object.keys(env)
    .filter((name) => name.endsWith('_API_KEY') && env[name])
    .sort();
  let raw: string;
  try {
    raw = fs.readFileSync(authFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { xdgDataHome, authFilePresent: false, authProviderIds: [], apiKeyEnvNames };
    }
    throw error;
  }
  return {
    xdgDataHome,
    authFilePresent: true,
    authProviderIds: Object.keys(JSON.parse(raw) as Record<string, unknown>).sort(),
    apiKeyEnvNames,
  };
};

export class OpenCodeServerProcess {
  public baseUrl = '';
  private exited = false;
  private spawnFailed = false;
  private stopping: Promise<void> | undefined;

  private constructor(
    public readonly directory: string,
    private readonly child: ChildProcess,
  ) {
    child.once('exit', () => {
      this.exited = true;
    });
    child.on('error', () => {
      if (child.pid === undefined) {
        this.spawnFailed = true;
      }
    });
  }

  public static async launch(input: {
    directory: string;
    signal?: AbortSignal;
    containment?: ProviderProcessContainment;
    onSpawn?: (process: OpenCodeServerProcess) => void;
  }): Promise<OpenCodeServerProcess> {
    input.signal?.throwIfAborted();
    const launch = buildOpenCodeSpawnCommand(
      resolveOpencodeBinary(),
      ['serve', '--port', '0', '--hostname', '127.0.0.1'],
      input.containment,
    );
    const child = spawn(launch.command, launch.args, {
      cwd: input.directory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: launch.env,
    });
    const handle = new OpenCodeServerProcess(input.directory, child);
    try {
      input.onSpawn?.(handle);
      await handle.waitForReadiness(input.signal ?? new AbortController().signal);
      return handle;
    } catch (error) {
      // A rejected launch must never leave an unowned live process behind.
      await handle.stop();
      throw error;
    }
  }

  private async waitForReadiness(signal: AbortSignal): Promise<void> {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let cleanup = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              `OpenCode server startup timed out after ${STARTUP_OUTPUT_TIMEOUT_MS}ms. stderr: ${stderrBuffer.slice(-500)}`,
            ),
          );
        }, STARTUP_OUTPUT_TIMEOUT_MS);
        const onData = (chunk: Buffer) => {
          stdoutBuffer += chunk.toString('utf8');
          const match = stdoutBuffer.match(/listening on (http:\/\/[^:]+:(\d+))/);
          if (match?.[1]) {
            this.baseUrl = match[1];
            resolve();
          }
        };
        const onStderr = (chunk: Buffer) => {
          stderrBuffer += chunk.toString('utf8');
        };
        const onError = (error: Error) =>
          reject(new Error(`Failed to spawn opencode serve: ${error.message}`, { cause: error }));
        const onExit = (code: number | null) =>
          reject(
            new Error(
              `OpenCode server exited with code ${String(code)} before reporting its URL. stderr: ${stderrBuffer.slice(-500)}`,
            ),
          );
        const onAbort = () => reject(new Error('OpenCode server startup aborted'));
        cleanup = () => {
          clearTimeout(timeout);
          this.child.stdout?.off('data', onData);
          this.child.stderr?.off('data', onStderr);
          this.child.off('error', onError);
          this.child.off('exit', onExit);
          signal.removeEventListener('abort', onAbort);
          this.child.stdout?.resume();
          this.child.stderr?.resume();
        };
        this.child.stdout?.on('data', onData);
        this.child.stderr?.on('data', onStderr);
        this.child.once('error', onError);
        this.child.once('exit', onExit);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
        }
      });
    } finally {
      cleanup();
    }
    signal.throwIfAborted();
    await pollHealth(this.baseUrl, signal);
  }

  public stop(): Promise<void> {
    this.stopping ??= this.finishStop().catch((error: unknown) => {
      this.stopping = undefined;
      throw error;
    });
    return this.stopping;
  }

  private async finishStop(): Promise<void> {
    if (await this.terminate('SIGTERM')) {
      return;
    }
    if (!(await this.terminate('SIGKILL'))) {
      throw new Error(
        'OpenCode process exit could not be confirmed after SIGKILL. Retry shutdown.',
      );
    }
  }

  private terminate(signal: NodeJS.Signals): Promise<boolean> {
    if (
      this.exited ||
      this.spawnFailed ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    ) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve, reject) => {
      const onExit = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      const timeout = setTimeout(() => {
        this.child.off('exit', onExit);
        resolve(false);
      }, 5_000);
      this.child.once('exit', onExit);
      try {
        this.child.kill(signal);
      } catch (error) {
        clearTimeout(timeout);
        this.child.off('exit', onExit);
        reject(error);
      }
    });
  }
}
