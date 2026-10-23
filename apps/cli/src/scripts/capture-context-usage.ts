#!/usr/bin/env tsx
/**
 * Throwaway evidence-gathering driver for the upstream
 * `control_request` subtype `get_context_usage`.
 *
 * Spawns `claude --output-format stream-json --input-format stream-json --print`,
 * optionally primes the session with one or more user prompts so the model has
 * actual conversation tokens to report on, then writes a single
 * `control_request` with subtype `get_context_usage` and awaits the matching
 * `control_response`. Writes the raw response payload (the `response.response`
 * object from the envelope) to disk and exits.
 *
 * This script is intentionally hand-rolled and does NOT use
 * `../agent-runtime/index` ClaudeCodeSdkClient — adding outbound
 * control-request plumbing to that client is out of scope for this task.
 *
 * Usage:
 *   tsx src/scripts/capture-context-usage.ts --out <path> [options]
 *
 * Options:
 *   --out <path>             Output JSON file (required)
 *   --cwd <dir>              Working directory for `claude` (default: $PWD)
 *   --profile <name>         Label written into the sidecar metadata file
 *   --prime <prompt>         Send a user prompt before capturing. Repeatable;
 *                            each prompt waits for `result` before the next.
 *   --mcp-config <path>      Forward --mcp-config <path> to claude (repeatable)
 *   --append-system-prompt <text>
 *   --resume <session-id>    Resume an existing session
 *   --model <model>          Override model
 *   --timeout <seconds>      Hard timeout (default: 180)
 *   --claude-bin <path>      Override `claude` binary
 *
 * Exits non-zero on timeout, error response, or process disconnect.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

interface CliArgs {
  out: string;
  cwd: string;
  profile: string | null;
  primes: string[];
  mcpConfigs: string[];
  appendSystemPrompt: string | null;
  resume: string | null;
  model: string | null;
  timeoutMs: number;
  claudeBin: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    out: '',
    cwd: process.cwd(),
    profile: null,
    primes: [],
    mcpConfigs: [],
    appendSystemPrompt: null,
    resume: null,
    model: null,
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
      case '--out':
        args.out = next();
        break;
      case '--cwd':
        args.cwd = next();
        break;
      case '--profile':
        args.profile = next();
        break;
      case '--prime':
        args.primes.push(next());
        break;
      case '--mcp-config':
        args.mcpConfigs.push(next());
        break;
      case '--append-system-prompt':
        args.appendSystemPrompt = next();
        break;
      case '--resume':
        args.resume = next();
        break;
      case '--model':
        args.model = next();
        break;
      case '--timeout':
        args.timeoutMs = Number(next()) * 1000;
        break;
      case '--claude-bin':
        args.claudeBin = next();
        break;
      case '--help':
      case '-h':
        console.log(
          'Usage: tsx src/scripts/capture-context-usage.ts --out <path> [--cwd <dir>] [--profile <name>] [--prime <prompt>]... [--mcp-config <path>]... [--append-system-prompt <text>] [--resume <session-id>] [--model <model>] [--timeout <seconds>] [--claude-bin <path>]',
        );
        process.exit(0);
      default:
        if (a !== undefined) throw new Error(`Unknown arg: ${a}`);
    }
  }

  if (!args.out) throw new Error('--out is required');
  return args;
}

interface PendingCapture {
  requestId: string;
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

class CaptureDriver {
  private readonly args: CliArgs;
  private proc: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private sessionId: string | null = null;
  private pendingCapture: PendingCapture | null = null;
  private pendingResult: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private exitedEarly = false;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(args: CliArgs) {
    this.args = args;
  }

  async run(): Promise<Record<string, unknown>> {
    this.spawnProcess();
    this.setupTimeout();

    for (const prime of this.args.primes) {
      await this.sendUserMessageAndAwaitResult(prime);
    }

    return await this.captureContextUsage();
  }

  private spawnProcess(): void {
    const claudeArgs: string[] = [
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
    if (this.args.appendSystemPrompt) {
      claudeArgs.push('--append-system-prompt', this.args.appendSystemPrompt);
    }
    for (const mcp of this.args.mcpConfigs) {
      claudeArgs.push('--mcp-config', mcp);
    }

    const env = { ...process.env };
    delete env['CLAUDECODE'];

    this.proc = spawn(this.args.claudeBin, claudeArgs, {
      cwd: this.args.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.trim().length > 0) {
        process.stderr.write(`[claude stderr] ${text}`);
      }
    });

    this.proc.on('exit', (code) => {
      this.exitedEarly = true;
      const err = new Error(`claude process exited (code=${String(code)})`);
      this.pendingResult?.reject(err);
      this.pendingCapture?.reject(err);
      this.cleanup();
    });

    this.proc.on('error', (err) => {
      this.exitedEarly = true;
      const wrapped = new Error(`claude process error: ${err.message}`);
      this.pendingResult?.reject(wrapped);
      this.pendingCapture?.reject(wrapped);
      this.cleanup();
    });

    if (!this.proc.stdout) throw new Error('claude stdout missing');
    this.readline = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.readline.on('line', (line) => this.handleLine(line));
  }

  private setupTimeout(): void {
    this.timeoutHandle = setTimeout(() => {
      const err = new Error(`capture timed out after ${this.args.timeoutMs}ms`);
      this.pendingResult?.reject(err);
      this.pendingCapture?.reject(err);
      this.shutdown();
    }, this.args.timeoutMs);
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

    if (
      type === 'system' &&
      parsed['subtype'] === 'init' &&
      typeof parsed['session_id'] === 'string'
    ) {
      this.sessionId = parsed['session_id'] as string;
    }

    if (type === 'control_response') {
      const response = parsed['response'] as Record<string, unknown> | undefined;
      if (!response) return;
      const reqId = response['request_id'] as string | undefined;
      if (!reqId || !this.pendingCapture || reqId !== this.pendingCapture.requestId) return;
      if (response['subtype'] === 'success') {
        const payload = (response['response'] as Record<string, unknown> | undefined) ?? {};
        this.pendingCapture.resolve(payload);
      } else {
        const errMsg =
          typeof response['error'] === 'string' ? (response['error'] as string) : 'unknown error';
        this.pendingCapture.reject(new Error(`control_response error: ${errMsg}`));
      }
      this.pendingCapture = null;
      return;
    }

    if (type === 'control_request') {
      const request = parsed['request'] as Record<string, unknown> | undefined;
      const requestId = parsed['request_id'] as string | undefined;
      if (request && requestId && request['subtype'] === 'can_use_tool') {
        this.write({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: { behavior: 'allow', updatedInput: request['input'] ?? {} },
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

  private async sendUserMessageAndAwaitResult(prompt: string): Promise<void> {
    if (this.exitedEarly) throw new Error('process exited before priming');
    const userMsg = { type: 'user', message: { role: 'user', content: prompt } };
    this.write(userMsg);
    await new Promise<void>((resolve, reject) => {
      this.pendingResult = { resolve, reject };
    });
  }

  private async captureContextUsage(): Promise<Record<string, unknown>> {
    if (this.exitedEarly) throw new Error('process exited before capture');
    const requestId = `req_${randomUUID()}`;
    const envelope = {
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'get_context_usage' },
    };
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingCapture = { requestId, resolve, reject };
      this.write(envelope);
    });
  }

  private write(obj: unknown): void {
    if (!this.proc?.stdin?.writable) throw new Error('stdin not writable');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  getSessionId(): string | null {
    return this.sessionId;
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
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });

  const driver = new CaptureDriver(args);
  const startedAt = new Date().toISOString();
  try {
    const payload = await driver.run();
    const finishedAt = new Date().toISOString();
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    const meta = {
      profile: args.profile,
      cwd: args.cwd,
      startedAt,
      finishedAt,
      claudeSessionId: driver.getSessionId(),
      primes: args.primes,
      mcpConfigs: args.mcpConfigs,
      resume: args.resume,
      model: args.model,
      appendSystemPrompt: args.appendSystemPrompt,
    };
    const metaPath = outPath.replace(/\.json$/, '') + '.meta.json';
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    console.log(`captured: ${outPath}`);
    console.log(`metadata: ${metaPath}`);
  } finally {
    driver.shutdown();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`capture failed: ${msg}`);
    process.exit(1);
  },
);
