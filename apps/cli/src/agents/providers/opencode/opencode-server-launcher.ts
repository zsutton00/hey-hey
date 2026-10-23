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
      lastError = err instanceof Error ? err.message : String(err);
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, pollIntervalMs);
      signal.addEventListener('abort', () => clearTimeout(t), { once: true });
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
  private constructor(
    public readonly baseUrl: string,
    public readonly directory: string,
    private readonly child: ChildProcess,
  ) {}

  public static async launch(input: {
    directory: string;
    signal?: AbortSignal;
    containment?: ProviderProcessContainment;
  }): Promise<OpenCodeServerProcess> {
    const binary = resolveOpencodeBinary();
    const args = ['serve', '--port', '0', '--hostname', '127.0.0.1'];
    const launch = buildOpenCodeSpawnCommand(binary, args, input.containment);

    const child = spawn(launch.command, launch.args, {
      cwd: input.directory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: launch.env,
    });

    let baseUrl: string | null = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const startupPromise = new Promise<void>((resolve, reject) => {
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
        if (match && match[1]) {
          baseUrl = match[1];
          clearTimeout(timeout);
          child.stdout?.off('data', onData);
          resolve();
        }
      };

      child.stdout?.on('data', onData);

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn opencode serve: ${err.message}`, { cause: err }));
      });

      child.on('exit', (code) => {
        if (!baseUrl) {
          clearTimeout(timeout);
          reject(
            new Error(
              `OpenCode server exited with code ${String(code)} before reporting its URL. stderr: ${stderrBuffer.slice(-500)}`,
            ),
          );
        }
      });

      input.signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('OpenCode server startup aborted'));
      });
    });

    try {
      await startupPromise;
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    }

    if (!baseUrl) {
      child.kill('SIGTERM');
      throw new Error('OpenCode server base URL was not resolved after startup');
    }

    await pollHealth(baseUrl, input.signal ?? new AbortController().signal);
    return new OpenCodeServerProcess(baseUrl, input.directory, child);
  }

  public async stop(): Promise<void> {
    this.child.kill('SIGTERM');
    // Give the process a graceful window, then force-kill.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (!this.child.killed) {
          this.child.kill('SIGKILL');
        }
        resolve();
      }, 5_000);
      this.child.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
