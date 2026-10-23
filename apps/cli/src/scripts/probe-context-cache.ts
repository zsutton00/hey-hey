#!/usr/bin/env tsx
/**
 * Decisive probe for the "does get_context_usage cache on first call?" question.
 *
 * Spawns ONE long-lived `claude` child (stream-json), then within that single
 * process:
 *   1. captures get_context_usage          -> totalTokens BEFORE
 *   2. sends a prompt that grows context    (awaits `result`)
 *   3. captures get_context_usage again      -> totalTokens AFTER
 *
 * If AFTER > BEFORE, the CLI recomputes per call (no first-call cache) — the
 * live runner path would report a growing number and the stale capsule label is
 * a UI-side fetch-once problem. If AFTER == BEFORE, the CLI froze the value at
 * the first call — "first call wins" is real and lives inside Claude Code's own
 * get_context_usage, which our long-lived per-Run child shares across reads.
 *
 * Usage:
 *   tsx src/scripts/probe-context-cache.ts [--cwd <dir>] [--model <m>] [--resume <id>]
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

interface Args {
  cwd: string;
  model: string | null;
  resume: string | null;
  timeoutMs: number;
  claudeBin: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cwd: process.cwd(),
    model: null,
    resume: null,
    timeoutMs: 180_000,
    claudeBin: 'claude',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      i++;
      return v;
    };
    switch (a) {
      case '--cwd':
        args.cwd = next();
        break;
      case '--model':
        args.model = next();
        break;
      case '--resume':
        args.resume = next();
        break;
      case '--timeout':
        args.timeoutMs = Number(next()) * 1000;
        break;
      case '--claude-bin':
        args.claudeBin = next();
        break;
      default:
        if (a !== undefined) throw new Error(`Unknown arg: ${a}`);
    }
  }
  return args;
}

interface Pending {
  requestId: string;
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

class Probe {
  private readonly args: Args;
  private proc: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingCapture: Pending | null = null;
  private pendingResult: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(args: Args) {
    this.args = args;
  }

  async run(): Promise<{ before: number; after: number }> {
    this.spawn();
    this.timeoutHandle = setTimeout(() => {
      const err = new Error(`probe timed out after ${this.args.timeoutMs}ms`);
      this.pendingResult?.reject(err);
      this.pendingCapture?.reject(err);
      this.shutdown();
    }, this.args.timeoutMs);

    const before = await this.capture();
    console.log(`[probe] BEFORE totalTokens = ${before['totalTokens'] as number}`);

    await this.sendAndAwaitResult(
      'Write a detailed 600-word explanation of how TCP congestion control works. Be thorough.',
    );

    const after = await this.capture();
    console.log(`[probe] AFTER  totalTokens = ${after['totalTokens'] as number}`);

    return {
      before: before['totalTokens'] as number,
      after: after['totalTokens'] as number,
    };
  }

  private spawn(): void {
    const claudeArgs = [
      '--print',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ];
    if (this.args.model) claudeArgs.push('--model', this.args.model);
    if (this.args.resume) claudeArgs.push('--resume', this.args.resume);

    const env = { ...process.env };
    delete env['CLAUDECODE'];

    this.proc = spawn(this.args.claudeBin, claudeArgs, {
      cwd: this.args.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.trim().length > 0) process.stderr.write(`[claude stderr] ${text}`);
    });
    this.proc.on('exit', (code) => {
      const err = new Error(`claude exited (code=${String(code)})`);
      this.pendingResult?.reject(err);
      this.pendingCapture?.reject(err);
      this.cleanup();
    });
    if (!this.proc.stdout) throw new Error('claude stdout missing');
    this.readline = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.readline.on('line', (line) => this.handleLine(line));
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = parsed['type'] as string | undefined;

    if (type === 'control_response') {
      const resp = parsed['response'] as Record<string, unknown> | undefined;
      if (!resp) return;
      const reqId = resp['request_id'] as string | undefined;
      if (!reqId || !this.pendingCapture || reqId !== this.pendingCapture.requestId) return;
      if (resp['subtype'] === 'success') {
        this.pendingCapture.resolve((resp['response'] as Record<string, unknown>) ?? {});
      } else {
        this.pendingCapture.reject(
          new Error(`control_response error: ${String(resp['error'] ?? 'unknown')}`),
        );
      }
      this.pendingCapture = null;
      return;
    }

    if (type === 'control_request') {
      const req = parsed['request'] as Record<string, unknown> | undefined;
      const reqId = parsed['request_id'] as string | undefined;
      if (req && reqId && req['subtype'] === 'can_use_tool') {
        this.write({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: reqId,
            response: { behavior: 'allow', updatedInput: req['input'] ?? {} },
          },
        });
      }
      return;
    }

    if (type === 'result') {
      this.pendingResult?.resolve();
      this.pendingResult = null;
    }
  }

  private async sendAndAwaitResult(prompt: string): Promise<void> {
    this.write({ type: 'user', message: { role: 'user', content: prompt } });
    await new Promise<void>((resolve, reject) => {
      this.pendingResult = { resolve, reject };
    });
  }

  private async capture(): Promise<Record<string, unknown>> {
    const requestId = `req_${randomUUID()}`;
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingCapture = { requestId, resolve, reject };
      this.write({ type: 'control_request', request_id: requestId, request: { subtype: 'get_context_usage' } });
    });
  }

  private write(obj: unknown): void {
    if (!this.proc?.stdin?.writable) throw new Error('stdin not writable');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  shutdown(): void {
    try {
      this.proc?.stdin?.end();
    } catch {
      // best-effort
    }
    setTimeout(() => {
      if (this.proc && !this.proc.killed) this.proc.kill('SIGTERM');
    }, 500);
  }

  private cleanup(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.readline?.close();
    this.readline = null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const probe = new Probe(args);
  try {
    const { before, after } = await probe.run();
    const delta = after - before;
    console.log('');
    console.log(`[probe] delta = ${delta}`);
    if (delta > 0) {
      console.log('[probe] VERDICT: get_context_usage RECOMPUTES per call (no first-call cache).');
    } else {
      console.log('[probe] VERDICT: get_context_usage FROZE at first call (first-call cache real).');
    }
  } finally {
    probe.shutdown();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`probe failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
