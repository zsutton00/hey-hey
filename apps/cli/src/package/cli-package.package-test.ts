/**
 * Package integration: launches the built, published artifact (`dist/index.mjs`)
 * as a child process. Run after `pnpm build` with `pnpm test:package`.
 *
 * No user credentials or live services are touched: a test loader substitutes
 * the keyring, OAuth files use a temporary home, and every `fetch` is refused at
 * the network boundary, and the platform URL points at a closed local port.
 */

import { execFile, spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const cliRoot = path.resolve(__dirname, '../..');
const artifact = path.join(cliRoot, 'dist/index.mjs');
const ESC = '\u001B';

interface PackageJson {
  version: string;
  bin: Record<string, string>;
  main: string;
  files: string[];
}

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

let sandbox: string;
let offlinePreload: string;
let pkg: PackageJson;

const isolatedEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  // Only what Node needs to run; nothing from the user's Hey Hey profile.
  for (const key of ['PATH', 'SYSTEMROOT', 'TMPDIR', 'TEMP', 'TMP']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: sandbox,
    USERPROFILE: sandbox,
    XDG_CONFIG_HOME: path.join(sandbox, 'xdg'),
    HEYHEY_SESSION_DIR: path.join(sandbox, 'sessions'),
    HEYHEY_CONFIG_DIR: path.join(sandbox, 'config'),
    HEYHEY_API_URL: 'http://127.0.0.1:9',
    HEYHEY_SERVER_PORT: '0',
    NO_COLOR: '1',
  };
};

/** Runs the artifact with piped (non-TTY) stdio and the offline preload. */
const runCli = (args: string[], timeoutMs = 30_000): Promise<Result> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', offlinePreload, artifact, ...args], {
      cwd: sandbox,
      env: isolatedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`heyhey ${args.join(' ')} did not exit within ${String(timeoutMs)}ms`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

beforeAll(async () => {
  await access(artifact).catch(() => {
    throw new Error(`${artifact} is missing; run \`pnpm build\` before \`pnpm test:package\`.`);
  });
  pkg = JSON.parse(await readFile(path.join(cliRoot, 'package.json'), 'utf8')) as PackageJson;
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'heyhey-package-'));
  offlinePreload = path.join(sandbox, 'offline.mjs');
  const keyringModule = `
    const records = new Map();
    export class Entry {
      constructor(service, account) { this.key = JSON.stringify([service, account]); }
      getPassword() { return records.get(this.key) ?? null; }
      setPassword(value) { records.set(this.key, value); }
      deletePassword() { return records.delete(this.key); }
    }
  `;
  await writeFile(
    path.join(sandbox, 'keyring-loader.mjs'),
    `export async function resolve(specifier, context, nextResolve) {
      if (specifier === '@napi-rs/keyring') {
        return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(keyringModule)}`)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }`,
  );
  await writeFile(
    offlinePreload,
    "import { register } from 'node:module';\n" +
      "register(new URL('./keyring-loader.mjs', import.meta.url), import.meta.url);\n" +
      'globalThis.fetch = async (input) => {\n' +
      '  throw new TypeError(`fetch failed (offline package test: ${String(input)})`);\n' +
      '};\n',
  );
});

afterAll(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

describe('published artifact shape', () => {
  it('is the package bin and main, executable, with a node hashbang', async () => {
    expect(pkg.bin['heyhey']).toBe('dist/index.mjs');
    expect(pkg.main).toBe('dist/index.mjs');
    expect(pkg.files).toEqual(['dist']);
    const source = await readFile(artifact, 'utf8');
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    if (process.platform !== 'win32') {
      expect((await stat(artifact)).mode & fsConstants.S_IXUSR).toBeTruthy();
    }
  });

  it('is self-contained ESM: only Node builtins and the native keyring stay external', async () => {
    // esbuild parses the artifact, so imports quoted inside strings are not counted.
    const external = new Set<string>();
    await build({
      entryPoints: [artifact],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
      plugins: [
        {
          name: 'record-imports',
          setup: (recorder) => {
            // esbuild filters are Go regular expressions, so no `u` flag.
            recorder.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === 'entry-point') return undefined;
              external.add(args.path);
              return { path: args.path, external: true };
            });
          },
        },
      ],
    });
    const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
    expect([...external].filter((specifier) => !builtins.has(specifier))).toEqual([
      '@napi-rs/keyring',
    ]);
    const source = await readFile(artifact, 'utf8');
    // CJS dependencies run through the banner's createRequire, not a global.
    expect(source).toContain('const require = __heyheyCreateRequire(import.meta.url);');
  });

  it('loads the native keyring dependency from where the artifact resolves it', async () => {
    // Loads the addon without reading or writing any credential.
    const probe = [
      "import { createRequire } from 'node:module';",
      `const require = createRequire(${JSON.stringify(artifact)});`,
      "const keyring = require('@napi-rs/keyring');",
      "process.stdout.write(typeof keyring.Entry + ' ' + require.resolve('@napi-rs/keyring'));",
    ].join('\n');
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', probe], {
      env: isolatedEnv(),
    });
    const [entryType, resolved] = stdout.split(' ');
    expect(entryType).toBe('function');
    expect(resolved).toContain(`${path.sep}@napi-rs${path.sep}keyring${path.sep}`);
  });
});

describe('direct commands from the artifact', () => {
  it('prints the package version', async () => {
    const result = await runCli(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('prints help describing the default menu and the direct commands', async () => {
    const result = await runCli(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: heyhey [command] [options]');
    expect(result.stdout).toContain('In an interactive terminal it');
    for (const command of ['login', 'logout', 'pair', 'controllers', 'status']) {
      expect(result.stdout).toMatch(new RegExp(`^\\s+${command}\\s`, 'mu'));
    }
    expect(result.stdout).not.toContain(ESC);
  });

  it('runs as an executable through its hashbang', async () => {
    if (process.platform === 'win32') return;
    const { stdout } = await execFileAsync(artifact, ['--version'], { env: isolatedEnv() });
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('reports status without credentials, as plain lines', async () => {
    const result = await runCli(['status']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Account authentication: not authenticated');
    expect(result.stdout).toContain('Execution readiness: blocked');
    expect(result.stdout + result.stderr).not.toContain(ESC);
  });

  it('logs out cleanly when not signed in', async () => {
    const result = await runCli(['logout']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Not currently authenticated.');
  });

  it('shows controllers usage and rejects unknown commands', async () => {
    const usage = await runCli(['controllers']);
    expect(usage.stdout + usage.stderr).toContain('Usage: heyhey controllers <list|add|revoke>');
    const unknown = await runCli(['definitely-not-a-command']);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout + unknown.stderr).toContain('Unknown command');
  });
});

describe('default command without a terminal', () => {
  it('keeps line output, never draws the menu, and exits with a readable startup failure', async () => {
    const result = await runCli([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Failed to run local agent server');
    // Structured log lines, one JSON object per line.
    const lines = result.stdout.split('\n').filter((line) => line.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();
    // No Ink frame, cursor control or alternate screen.
    expect(result.stdout + result.stderr).not.toContain(ESC);
    expect(result.stdout).not.toContain('SESSIONS ON THIS MACHINE');
  });
});
