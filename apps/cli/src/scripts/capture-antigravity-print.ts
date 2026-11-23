#!/usr/bin/env tsx
/**
 * Throwaway evidence-gathering driver for Antigravity's print mode (`agy -p`).
 * Records the model list, skills list and plan quota reads exactly as `agy`
 * emits them: stdout, stderr, exit code and duration, one JSON record per read.
 *
 * Imports no runner code. Records `agy --version` only as metadata; no version
 * is pinned or checked.
 *
 * Output under --out:
 *   <label>-<read>.json    { read, label, argv, stdout, stderr, exitCode, signal, durationMs, ... }
 *   <label>.meta.json      agy --version output, label, signed-out flag, read outcomes
 *
 * `--label` tags a snapshot, so quota can be compared around an ACP run:
 *   --label quota-before --read quota   ... run the ACP driver ...   --label quota-after --read quota
 *
 * Signed-out capture: `--signed-out` runs `agy` with ONLY HOME and the XDG_* dirs
 * redirected to an empty temp directory. It does NOT isolate the macOS Keychain (or any
 * other OS credential store), so agy may still find a real sign-in. The recorded output
 * MUST be checked to confirm it really is the not-signed-in failure. The real credential
 * store is never read. The org-policy-denied case cannot be forced from here; run the
 * reads from an account the organisation denies and use `--label org-policy-denied`.
 *
 * Usage:
 *   tsx src/scripts/capture-antigravity-print.ts --out <dir> [--read models|skills|quota]... [options]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const READS = ['models', 'skills', 'quota'] as const;
type ReadName = (typeof READS)[number];

const isReadName = (value: string): value is ReadName =>
  (READS as readonly string[]).includes(value);

/**
 * Default argv per read. The slash prompts and `--output-format json` come from the
 * changelog, not from a verified run, so each is overridable with `--<read>-args`
 * and the argv actually used is stored in every record.
 */
const DEFAULT_ARGS: Record<ReadName, string[]> = {
  models: ['-p', '/models', '--output-format', 'json'],
  skills: ['-p', '/skills', '--output-format', 'json'],
  quota: ['-p', '/quota', '--output-format', 'json'],
};

const HELP = `Usage: tsx src/scripts/capture-antigravity-print.ts --out <dir> [options]

Options:
  --out <dir>             Output directory (default: .tmp/antigravity-capture, gitignored)
  --read <name>           models | skills | quota; repeatable (default: all three)
  --label <text>          Snapshot tag used in file names (default: snapshot), e.g. quota-before
  --agy-bin <path>        agy binary (default: agy)
  --cwd <dir>             Working directory for agy (default: $PWD)
  --signed-out            Redirect ONLY HOME and XDG_* to an empty dir. No Keychain isolation on
                          macOS, so agy may still be signed in: check the recorded output is
                          really the not-signed-in failure.
  --timeout <seconds>     Per-read timeout (default: 120)
  --models-args <args>    Override argv for the models read (whitespace-separated)
  --skills-args <args>    Override argv for the skills read
  --quota-args <args>     Override argv for the quota read
`;

interface Options {
  out: string;
  reads: ReadName[];
  label: string;
  agyBin: string;
  cwd: string;
  signedOut: boolean;
  timeoutMs: number;
  argv: Record<ReadName, string[]>;
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      read: { type: 'string', multiple: true },
      label: { type: 'string' },
      'agy-bin': { type: 'string' },
      cwd: { type: 'string' },
      'signed-out': { type: 'boolean' },
      timeout: { type: 'string' },
      'models-args': { type: 'string' },
      'skills-args': { type: 'string' },
      'quota-args': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const reads = (values.read ?? [...READS]).map((name) => {
    if (!isReadName(name)) {
      throw new Error(`Unknown read: ${name}`);
    }
    return name;
  });
  const override = (raw: string | undefined, fallback: string[]): string[] =>
    raw ? raw.split(/\s+/u).filter(Boolean) : fallback;

  return {
    out: resolve(values.out ?? '.tmp/antigravity-capture'),
    reads,
    label: values.label ?? 'snapshot',
    agyBin: values['agy-bin'] ?? 'agy',
    cwd: resolve(values.cwd ?? process.cwd()),
    signedOut: values['signed-out'] ?? false,
    timeoutMs: Number(values.timeout ?? '120') * 1000,
    argv: {
      models: override(values['models-args'], DEFAULT_ARGS.models),
      skills: override(values['skills-args'], DEFAULT_ARGS.skills),
      quota: override(values['quota-args'], DEFAULT_ARGS.quota),
    },
  };
}

interface RunRecord {
  argv: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  spawnError: string | null;
}

function runAgy(opts: Options, args: string[], env: NodeJS.ProcessEnv): Promise<RunRecord> {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const record: RunRecord = {
      argv: [opts.agyBin, ...args],
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      durationMs: 0,
      timedOut: false,
      spawnError: null,
    };

    const child = spawn(opts.agyBin, args, {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      record.timedOut = true;
      child.kill('SIGTERM');
      // A child that ignores SIGTERM would hang the capture; escalate after a grace period.
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, opts.timeoutMs);
    let killTimer: NodeJS.Timeout | undefined;

    // Settle once, from whichever of `error` / `close` fires first: a missing binary may never emit `close`.
    let settled = false;
    const settle = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      record.durationMs = Date.now() - startedAt;
      resolveRun(record);
    };

    child.stdout.on('data', (chunk: Buffer) => (record.stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (record.stderr += chunk.toString()));
    child.on('error', (error) => {
      record.spawnError = error.message;
      console.error(`spawn error for ${record.argv.join(' ')}: ${error.message}`);
      settle();
    });
    child.on('close', (exitCode, signal) => {
      record.exitCode = exitCode;
      record.signal = signal;
      settle();
    });
  });
}

function buildEnv(opts: Options): { env: NodeJS.ProcessEnv; signedOutHome: string | null } {
  if (!opts.signedOut) {
    return { env: process.env, signedOutHome: null };
  }
  const emptyHome = mkdtempSync(join(tmpdir(), 'agy-signed-out-'));
  console.warn(
    `[signed-out] ONLY HOME/XDG_* redirected to ${emptyHome}; macOS Keychain is NOT isolated. Verify the output is really the not-signed-in failure.`,
  );
  const env = {
    ...process.env,
    HOME: emptyHome,
    XDG_CONFIG_HOME: join(emptyHome, '.config'),
    XDG_DATA_HOME: join(emptyHome, '.local', 'share'),
    XDG_CACHE_HOME: join(emptyHome, '.cache'),
    XDG_STATE_HOME: join(emptyHome, '.local', 'state'),
  };
  return { env, signedOutHome: emptyHome };
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));
  mkdirSync(opts.out, { recursive: true });
  const { env, signedOutHome } = buildEnv(opts);

  const version = await runAgy(opts, ['--version'], env);
  console.log(
    `agy --version: ${version.stdout.trim() || version.stderr.trim()} (exit ${String(version.exitCode)})`,
  );

  const outcomes: Record<string, { file: string; exitCode: number | null; error: string | null }> =
    {};
  const failed: ReadName[] = [];

  for (const read of opts.reads) {
    const file = join(opts.out, `${opts.label}-${read}.json`);
    console.log(`\n=== read ${read} (label=${opts.label}) ===`);
    try {
      const record = await runAgy(opts, opts.argv[read], env);
      const saved = {
        read,
        label: opts.label,
        signedOut: opts.signedOut,
        signedOutIsolation: opts.signedOut ? 'HOME and XDG_* only; Keychain not isolated' : null,
        cwd: opts.cwd,
        capturedAt: new Date().toISOString(),
        ...record,
      };
      writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
      // A non-zero exit is data, not a driver failure: the exact output is what we came for.
      const problem = record.spawnError ?? (record.timedOut ? 'timed out' : null);
      outcomes[read] = { file, exitCode: record.exitCode, error: problem };
      console.log(`exit=${String(record.exitCode)} duration=${record.durationMs}ms -> ${file}`);
      if (problem) {
        console.error(`read ${read} problem: ${problem}`);
        failed.push(read);
      }
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      outcomes[read] = { file, exitCode: null, error: message };
      console.error(`read ${read} FAILED: ${message}`);
      failed.push(read);
    }
  }

  const sidecar = {
    label: opts.label,
    signedOut: opts.signedOut,
    signedOutIsolation: opts.signedOut
      ? {
          applied: ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME'],
          redirectedTo: signedOutHome,
          keychainIsolated: false,
          note: 'Only HOME and XDG_* were redirected; the macOS Keychain was not isolated. Check the recorded stdout/stderr to confirm it is really the not-signed-in failure.',
        }
      : null,
    cwd: opts.cwd,
    agyVersion: {
      stdout: version.stdout,
      stderr: version.stderr,
      exitCode: version.exitCode,
      spawnError: version.spawnError,
    },
    argv: opts.argv,
    outcomes,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(opts.out, `${opts.label}.meta.json`), `${JSON.stringify(sidecar, null, 2)}\n`);

  console.log(
    `\nfinished: ${opts.reads.length - failed.length}/${opts.reads.length} reads recorded`,
  );
  if (failed.length > 0) {
    console.error(`problem reads: ${failed.join(', ')}`);
    process.exit(1);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(
      `capture failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    process.exit(1);
  },
);
