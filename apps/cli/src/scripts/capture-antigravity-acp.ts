#!/usr/bin/env tsx
/**
 * Throwaway evidence-gathering driver for Antigravity's `agy acp` (Agent Client
 * Protocol over stdio). Runs named scenarios against a real, signed-in `agy`
 * and records every JSON-RPC frame in both directions as timestamped ndjson,
 * plus a metadata sidecar per scenario. Later stages build against these real
 * payloads instead of guesses.
 *
 * Intentionally hand-rolled: imports no runner code. Only the platform MCP
 * server config comes from the existing `buildMcpServerConfig`.
 *
 * Output (per scenario, under --out):
 *   <scenario>.ndjson      one line per frame: { ts, proc, direction, frame }
 *                          direction: client->agent | agent->client | agent-stderr
 *                                     | driver | hook
 *   <scenario>.meta.json   agy --version output, scenario, mode, cwd, outcome
 *
 * The transcripts contain live bearer tokens (the session/new MCP headers).
 * Write them somewhere uncommitted and redact before committing anything.
 *
 * Usage:
 *   tsx src/scripts/capture-antigravity-acp.ts --out <dir> --scenario <name>... [options]
 *   tsx src/scripts/capture-antigravity-acp.ts --help
 *
 * No agy version is pinned or checked; the version is recorded only as metadata.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { OAuthClient } from '../auth/index';
import { buildMcpServerConfig } from '../agents/mcp-server-config';
import { SCENARIOS } from './antigravity-capture-scenarios';

type ScenarioName = (typeof SCENARIOS)[number];

const isScenarioName = (value: string): value is ScenarioName =>
  (SCENARIOS as readonly string[]).includes(value);

/** `.tmp/` is gitignored in this repo; resolved against the cwd (apps/cli under pnpm). */
const DEFAULT_OUT = '.tmp/antigravity-capture';

const HELP = `Usage: tsx src/scripts/capture-antigravity-acp.ts --out <dir> --scenario <name>... [options]

Scenarios: ${SCENARIOS.join(', ')}  (or --scenario all)

Options:
  --out <dir>                 Transcript directory (default: ${DEFAULT_OUT}, which is gitignored).
                              WARNING: session/new frames contain live bearer headers. Never
                              commit raw output; redact first.
  --scenario <name>           Repeatable; "all" runs every scenario
  --agy-bin <path>            agy binary (default: agy)
  --mode <id>                 Approval mode set on every session (default: default)
  --plan-mode <id>            Mode id used by the plan scenario (default: plan)
  --cwd <dir>                 Working directory for every scenario (default: fresh temp dir each)
  --timeout <seconds>         Per-request timeout (default: 180)
  --project-id <id>           Platform MCP X-Project-ID header
  --service-id <id>           Platform MCP X-Service-ID header
  --agent-session-id <id>     Platform MCP X-Agent-Session-ID header
  --submission-mcp-url <url>  Add the heyhey-submission-tools HTTP MCP server (needs a live CLI registration token)
  --browser-mcp-url <url>     Add the heyhey-browser HTTP MCP server

  buildMcpServerConfig returns ONLY heyhey-platform. heyhey-submission-tools and heyhey-browser
  are mounted only when --submission-mcp-url / --browser-mcp-url are given; no URLs are invented.
  Without them the mcp-tools scenario has no submission tool to call. Each sidecar lists the
  servers actually mounted (mcpServersMounted) and which expected ones were missing.
  --submission-tool <name>    Submission tool the mcp-tools scenario asks for (default: create_report)
  --platform-tool <name>      Platform tool the mcp-tools scenario asks for (default: get_entity_identities)
  --tool-subset <a,b>         Tool names the mcp-subset scenario restricts the turn to (default: the platform tool)
  --hook-settings-path <path> Where hook-relay installs its settings file (default: <cwd>/.agy/settings.json)
  --hook-settings-template <file>  JSON template; "{{HOOK_COMMAND}}" is replaced by the relay command
  --no-mcp                    Skip platform MCP servers (only when sign-in is unavailable)
`;

interface Options {
  out: string;
  scenarios: ScenarioName[];
  agyBin: string;
  mode: string;
  planMode: string;
  cwd: string | null;
  timeoutMs: number;
  projectId: string | undefined;
  serviceId: string | undefined;
  agentSessionId: string | undefined;
  submissionMcpUrl: string | undefined;
  browserMcpUrl: string | undefined;
  submissionTool: string;
  platformTool: string;
  toolSubset: string[] | null;
  hookSettingsPath: string | null;
  hookSettingsTemplate: string | null;
  noMcp: boolean;
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      scenario: { type: 'string', multiple: true },
      'agy-bin': { type: 'string' },
      mode: { type: 'string' },
      'plan-mode': { type: 'string' },
      cwd: { type: 'string' },
      timeout: { type: 'string' },
      'project-id': { type: 'string' },
      'service-id': { type: 'string' },
      'agent-session-id': { type: 'string' },
      'submission-mcp-url': { type: 'string' },
      'browser-mcp-url': { type: 'string' },
      'submission-tool': { type: 'string' },
      'platform-tool': { type: 'string' },
      'tool-subset': { type: 'string' },
      'hook-settings-path': { type: 'string' },
      'hook-settings-template': { type: 'string' },
      'no-mcp': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const requested = values.scenario ?? [];
  if (requested.length === 0) {
    throw new Error('at least one --scenario is required');
  }
  const names = requested.includes('all') ? [...SCENARIOS] : requested;
  const scenarios = names.map((name) => {
    if (!isScenarioName(name)) {
      throw new Error(`Unknown scenario: ${name}`);
    }
    return name;
  });

  const platformTool = values['platform-tool'] ?? 'get_entity_identities';
  return {
    out: resolve(values.out ?? DEFAULT_OUT),
    scenarios,
    agyBin: values['agy-bin'] ?? 'agy',
    mode: values.mode ?? 'default',
    planMode: values['plan-mode'] ?? 'plan',
    cwd: values.cwd ? resolve(values.cwd) : null,
    timeoutMs: Number(values.timeout ?? '180') * 1000,
    projectId: values['project-id'],
    serviceId: values['service-id'],
    agentSessionId: values['agent-session-id'],
    submissionMcpUrl: values['submission-mcp-url'],
    browserMcpUrl: values['browser-mcp-url'],
    submissionTool: values['submission-tool'] ?? 'create_report',
    platformTool,
    toolSubset: values['tool-subset']
      ? values['tool-subset'].split(',').map((name) => name.trim())
      : null,
    hookSettingsPath: values['hook-settings-path'] ? resolve(values['hook-settings-path']) : null,
    hookSettingsTemplate: values['hook-settings-template']
      ? resolve(values['hook-settings-template'])
      : null,
    noMcp: values['no-mcp'] ?? false,
  };
}

// ---------------------------------------------------------------------------
// Transcript + JSON-RPC connection
// ---------------------------------------------------------------------------

type Direction = 'client->agent' | 'agent->client' | 'agent-stderr' | 'driver' | 'hook';

class Transcript {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  }

  write(proc: number, direction: Direction, frame: unknown): void {
    const line = { ts: new Date().toISOString(), proc, direction, frame };
    appendFileSync(this.path, `${JSON.stringify(line)}\n`);
  }
}

type JsonRpcId = string | number;
interface JsonRpcFrame {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type PermissionPolicy = 'allow_once' | 'allow_always' | 'reject';

interface PermissionOption {
  optionId: string;
  kind: string;
  name?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

interface TerminalState {
  proc: ChildProcess;
  output: string;
  exitCode: number | null;
  signal: string | null;
  exited: Promise<void>;
}

/** One `agy acp` process. `proc` is its ordinal inside the scenario (resume uses two). */
class AcpConnection {
  permissionPolicy: PermissionPolicy = 'allow_once';
  readonly permissionRequests: unknown[] = [];
  /** Counts session/update frames; the cancel scenario waits for the first one. */
  updateCount = 0;

  private readonly child: ChildProcess;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly terminals = new Map<string, TerminalState>();
  private nextId = 1;
  private exited = false;

  constructor(
    private readonly opts: Options,
    private readonly transcript: Transcript,
    private readonly proc: number,
    private readonly cwd: string,
  ) {
    this.child = spawn(opts.agyBin, ['acp'], {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.on('error', (error) => this.failAll(new Error(`agy spawn error: ${error.message}`)));
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      this.transcript.write(this.proc, 'driver', { event: 'agy-exit', code, signal });
      this.failAll(new Error(`agy acp exited (code=${String(code)} signal=${String(signal)})`));
    });
    // A write to a dead agy raises EPIPE asynchronously; without a listener it would crash the whole run.
    this.child.stdin?.on('error', (error) => {
      this.transcript.write(this.proc, 'driver', {
        event: 'agy-stdin-error',
        message: error.message,
      });
      this.failAll(new Error(`agy stdin error: ${error.message}`));
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.transcript.write(this.proc, 'agent-stderr', chunk.toString());
    });

    if (!this.child.stdout) {
      throw new Error('agy stdout missing');
    }
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) =>
      this.onLine(line),
    );
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;

    // Send first: if agy is gone this rejects before any timer or pending entry exists to leak.
    try {
      this.send({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    return new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`${method} timed out after ${this.opts.timeoutMs}ms`));
      }, this.opts.timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  note(event: string, detail: Record<string, unknown> = {}): void {
    this.transcript.write(this.proc, 'driver', { event, ...detail });
    console.log(`[${event}] ${JSON.stringify(detail)}`);
  }

  async close(): Promise<void> {
    for (const terminal of this.terminals.values()) {
      terminal.proc.kill('SIGTERM');
    }
    if (this.exited) {
      return;
    }
    this.child.stdin?.end();
    await new Promise<void>((resolveClose) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGTERM');
        resolveClose();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }

  private send(frame: JsonRpcFrame): void {
    if (this.exited || !this.child.stdin?.writable) {
      throw new Error('agy stdin is not writable');
    }
    this.transcript.write(this.proc, 'client->agent', frame);
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    let frame: JsonRpcFrame;
    try {
      frame = JSON.parse(trimmed) as JsonRpcFrame;
    } catch (error) {
      // Keep the raw line: a non-JSON line on stdout is itself evidence.
      this.transcript.write(this.proc, 'agent->client', { unparsable: trimmed });
      this.note('unparsable-stdout-line', { reason: String(error) });
      return;
    }
    this.transcript.write(this.proc, 'agent->client', frame);

    if (frame.method !== undefined && frame.id !== undefined) {
      void this.handleAgentRequest(frame.id, frame.method, frame.params ?? {});
      return;
    }
    if (frame.method === 'session/update') {
      this.updateCount++;
      return;
    }
    if (frame.id !== undefined) {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        return;
      }
      this.pending.delete(frame.id);
      if (frame.error) {
        pending.reject(
          new Error(`${pending.method} -> ${frame.error.code}: ${frame.error.message}`),
        );
      } else {
        pending.resolve(frame.result);
      }
    }
  }

  private async handleAgentRequest(
    id: JsonRpcId,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      const result = await this.answerAgentRequest(method, params);
      this.send({ jsonrpc: '2.0', id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.note('agent-request-refused', { method, message });
      try {
        this.send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
      } catch (sendError) {
        // agy is gone or stdin is closed: record it instead of throwing out of an un-awaited promise.
        this.note('agent-request-reply-failed', { method, message: String(sendError) });
      }
    }
  }

  private async answerAgentRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'session/request_permission':
        return this.answerPermission(params);
      case 'fs/read_text_file':
        return { content: readFileSync(String(params['path']), 'utf8') };
      case 'fs/write_text_file':
        return this.writeInsideCwd(params);
      case 'terminal/create':
        return this.createTerminal(params);
      case 'terminal/output':
        return this.terminalOutput(String(params['terminalId']));
      case 'terminal/wait_for_exit':
        return this.waitForTerminal(String(params['terminalId']));
      case 'terminal/kill':
        this.getTerminal(String(params['terminalId'])).proc.kill('SIGTERM');
        return {};
      case 'terminal/release':
        this.terminals.delete(String(params['terminalId']));
        return {};
      default:
        throw new Error(`driver does not implement client method ${method}`);
    }
  }

  private answerPermission(params: Record<string, unknown>): unknown {
    this.permissionRequests.push(params);
    const options = (params['options'] as PermissionOption[] | undefined) ?? [];
    const wantedKind = this.permissionPolicy === 'reject' ? 'reject_once' : this.permissionPolicy;
    const chosen =
      options.find((option) => option.kind === wantedKind) ??
      (this.permissionPolicy === 'reject'
        ? options.find((option) => option.kind.startsWith('reject'))
        : undefined);

    this.note('permission-decision', {
      policy: this.permissionPolicy,
      offered: options.map((option) => option.kind),
      chosen: chosen?.optionId ?? null,
    });

    if (!chosen) {
      // No matching option offered: cancelling is the only truthful answer, and is itself evidence.
      return { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
  }

  /** The client-side write path: refuses anything outside the scenario cwd and says so in the transcript. */
  private writeInsideCwd(params: Record<string, unknown>): unknown {
    const target = resolve(String(params['path']));
    const inside = target === this.cwd || target.startsWith(this.cwd + sep);
    this.note('fs-write-request', { path: target, insideCwd: inside });
    if (!inside) {
      throw new Error(`driver refused write outside cwd: ${target}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, String(params['content'] ?? ''));
    return {};
  }

  private createTerminal(params: Record<string, unknown>): unknown {
    const command = String(params['command']);
    const args = ((params['args'] as string[] | undefined) ?? []).map(String);
    const terminalId = `term-${randomUUID()}`;
    this.note('terminal-create', { command, args, terminalId });

    const proc = spawn(command, args, {
      cwd: typeof params['cwd'] === 'string' ? params['cwd'] : this.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const state: TerminalState = {
      proc,
      output: '',
      exitCode: null,
      signal: null,
      exited: new Promise<void>((resolveExit) => {
        proc.on('error', (error) => {
          state.output += `spawn error: ${error.message}\n`;
          state.exitCode = 127;
          resolveExit();
        });
        proc.on('exit', (code, signal) => {
          state.exitCode = code;
          state.signal = signal;
          resolveExit();
        });
      }),
    };
    const collect = (chunk: Buffer): void => {
      state.output += chunk.toString();
    };
    proc.stdout?.on('data', collect);
    proc.stderr?.on('data', collect);
    this.terminals.set(terminalId, state);
    return { terminalId };
  }

  private getTerminal(terminalId: string): TerminalState {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`unknown terminal ${terminalId}`);
    }
    return terminal;
  }

  private terminalOutput(terminalId: string): unknown {
    const terminal = this.getTerminal(terminalId);
    const exited = terminal.exitCode !== null || terminal.signal !== null;
    return {
      output: terminal.output,
      truncated: false,
      ...(exited ? { exitStatus: { exitCode: terminal.exitCode, signal: terminal.signal } } : {}),
    };
  }

  private async waitForTerminal(terminalId: string): Promise<unknown> {
    const terminal = this.getTerminal(terminalId);
    await terminal.exited;
    return { exitCode: terminal.exitCode, signal: terminal.signal };
  }
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

interface AcpMcpServer {
  type: 'http';
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

const httpServerEntrySchema = z
  .object({ type: z.literal('http'), url: z.string(), headers: z.record(z.string()).optional() })
  .passthrough();

const EXPECTED_MCP_SERVERS = ['heyhey-platform', 'heyhey-submission-tools', 'heyhey-browser'];

const toAcpHeaders = (headers: Record<string, string> | undefined) =>
  Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }));

async function buildAcpMcpServers(opts: Options): Promise<AcpMcpServer[]> {
  if (opts.noMcp) {
    console.warn('[mcp] --no-mcp: sessions are created WITHOUT platform MCP servers');
    return [];
  }

  const config = await buildMcpServerConfig(
    new OAuthClient(),
    {
      projectId: opts.projectId,
      serviceId: opts.serviceId,
      agentSessionId: opts.agentSessionId,
    },
    { useCase: 'coding' },
  );

  const servers: AcpMcpServer[] = Object.entries(config.mcpServers).map(([name, entry]) => {
    const http = parseBoundary(`buildMcpServerConfig[${name}]`, httpServerEntrySchema, entry);
    return { type: 'http', name, url: http.url, headers: toAcpHeaders(http.headers) };
  });

  // The submission-tools server only exists while a CLI run holds a registration token,
  // so it is supplied by URL rather than built here.
  if (opts.submissionMcpUrl) {
    servers.push({
      type: 'http',
      name: 'heyhey-submission-tools',
      url: opts.submissionMcpUrl,
      headers: [],
    });
  }
  if (opts.browserMcpUrl) {
    servers.push({ type: 'http', name: 'heyhey-browser', url: opts.browserMcpUrl, headers: [] });
  }
  return servers;
}

// ---------------------------------------------------------------------------
// Scenario plumbing
// ---------------------------------------------------------------------------

interface ScenarioContext {
  opts: Options;
  transcript: Transcript;
  cwd: string;
  mcpServers: AcpMcpServer[];
  /** Mode set on every session in this scenario. */
  mode: string;
  /** Free-form observations copied to the sidecar. */
  observations: Record<string, unknown>;
  connect: (proc: number) => Promise<AcpConnection>;
}

const INITIALIZE_PARAMS = {
  protocolVersion: 1,
  // Advertise fs + terminal so the transcript shows whether agy routes writes through the client.
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
  clientInfo: { name: 'hey-hey-capture', title: 'Hey Hey capture driver', version: '0.0.0' },
};

async function initialize(
  conn: AcpConnection,
  ctx: ScenarioContext,
  observationKey = 'initializeResult',
): Promise<void> {
  const result = await conn.request('initialize', INITIALIZE_PARAMS);
  ctx.observations[observationKey] = result;
}

const sessionModesSchema = z
  .object({ availableModes: z.array(z.object({ id: z.string() }).passthrough()).optional() })
  .passthrough();
type SessionModes = z.infer<typeof sessionModesSchema>;

const newSessionResponseSchema = z
  .object({ sessionId: z.string(), modes: sessionModesSchema.nullish() })
  .passthrough();
const resumeResponseSchema = z
  .object({ modes: sessionModesSchema.nullish() })
  .passthrough()
  .nullable();

/** Validates an agent response once at the boundary; a malformed one fails naming the method. */
function parseBoundary<T>(
  method: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${method}: malformed response (${issues}); raw=${JSON.stringify(value)}`);
  }
  return parsed.data;
}

/** Creates a session with the platform MCP servers, then sets the approval mode explicitly. */
async function newSession(
  conn: AcpConnection,
  ctx: ScenarioContext,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const raw = await conn.request('session/new', {
    cwd: ctx.cwd,
    mcpServers: ctx.mcpServers,
    ...extra,
  });
  ctx.observations['sessionNew'] = raw;
  const response = parseBoundary('session/new', newSessionResponseSchema, raw);

  await setMode(conn, ctx, response.sessionId, response.modes ?? undefined);
  return response.sessionId;
}

async function setMode(
  conn: AcpConnection,
  ctx: ScenarioContext,
  sessionId: string,
  modes: SessionModes | undefined,
): Promise<void> {
  const available = modes?.availableModes?.map((mode) => mode.id) ?? [];
  if (available.length > 0 && !available.includes(ctx.mode)) {
    // Still send it: the agent's rejection is the evidence we want.
    conn.note('mode-not-advertised', { wanted: ctx.mode, available });
  }
  conn.note('set-mode', { sessionId, mode: ctx.mode });
  await conn.request('session/set_mode', { sessionId, modeId: ctx.mode });
}

async function prompt(
  conn: AcpConnection,
  sessionId: string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  conn.note('prompt', { sessionId, text });
  return conn.request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text }],
    ...extra,
  });
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

type ScenarioFn = (ctx: ScenarioContext) => Promise<void>;

async function withConnection(
  ctx: ScenarioContext,
  body: (conn: AcpConnection) => Promise<void>,
): Promise<void> {
  const conn = await ctx.connect(0);
  try {
    await initialize(conn, ctx);
    await body(conn);
  } finally {
    await conn.close();
  }
}

const quick: ScenarioFn = (ctx) =>
  withConnection(ctx, async (conn) => {
    const sessionId = await newSession(conn, ctx);
    ctx.observations['promptResult'] = await prompt(
      conn,
      sessionId,
      'Reply with exactly the word "pong" and do not use any tools.',
    );
  });

const followUp: ScenarioFn = (ctx) =>
  withConnection(ctx, async (conn) => {
    const sessionId = await newSession(conn, ctx);
    await prompt(conn, sessionId, 'Remember the number 4217. Reply "ok" only.');
    ctx.observations['followUpResult'] = await prompt(
      conn,
      sessionId,
      'What number did I ask you to remember? Reply with the number only.',
    );
  });

/** Two processes: create and prompt in the first, then session/resume (not session/load) in a fresh one. */
const resume: ScenarioFn = async (ctx) => {
  const first = await ctx.connect(0);
  let sessionId: string;
  try {
    await initialize(first, ctx, 'initializeResultFirstProcess');
    sessionId = await newSession(first, ctx);
    await prompt(first, sessionId, 'Remember the number 4217. Reply "ok" only.');
  } finally {
    await first.close();
  }

  const second = await ctx.connect(1);
  try {
    await initialize(second, ctx, 'initializeResultResumedProcess');
    ctx.observations['resumeSessionId'] = sessionId;
    second.note('session-resume', { sessionId });
    const rawResumed = await second.request('session/resume', {
      sessionId,
      cwd: ctx.cwd,
      mcpServers: ctx.mcpServers,
    });
    ctx.observations['resumeResult'] = rawResumed;
    const resumed = parseBoundary('session/resume', resumeResponseSchema, rawResumed);

    // Resume restores the session, not its approval mode: set it again explicitly.
    await setMode(second, ctx, sessionId, resumed?.modes ?? undefined);
    ctx.observations['promptAfterResume'] = await prompt(
      second,
      sessionId,
      'What number did I ask you to remember? Reply with the number only.',
    );
  } finally {
    await second.close();
  }
};

const cancel: ScenarioFn = (ctx) =>
  withConnection(ctx, async (conn) => {
    const sessionId = await newSession(conn, ctx);
    // Handler attached at creation: if agy exits during the wait below, this must not be an unhandled rejection.
    const longTurn = prompt(
      conn,
      sessionId,
      'Count from 1 to 300, one number per line, with a one-sentence remark after each.',
    ).catch((error: unknown) => ({ error: String(error) }));

    // Cancel once the agent has visibly started streaming, or after 5s if it never does.
    const waitStart = Date.now();
    while (conn.updateCount === 0 && Date.now() - waitStart < 5000) {
      await sleep(100);
    }
    conn.note('cancel', { sessionId, updatesSeenBeforeCancel: conn.updateCount });
    conn.notify('session/cancel', { sessionId });

    ctx.observations['cancelledPromptResult'] = await longTurn;
    ctx.observations['promptAfterCancel'] = await prompt(
      conn,
      sessionId,
      'Reply with exactly the word "pong" and do not use any tools.',
    );
  });

const permissionScenario =
  (policy: PermissionPolicy): ScenarioFn =>
  (ctx) =>
    withConnection(ctx, async (conn) => {
      conn.permissionPolicy = policy;
      const sessionId = await newSession(conn, ctx);
      const target = join(ctx.cwd, 'permission-probe.txt');
      for (const attempt of [1, 2]) {
        // Two identical asks: allow_always should suppress the second request.
        ctx.observations[`attempt${attempt}`] = await prompt(
          conn,
          sessionId,
          `Run a shell command that writes the text "attempt ${attempt}" to ${target}, then tell me the result.`,
        );
      }
      ctx.observations['permissionRequestCount'] = conn.permissionRequests.length;
    });

const plan: ScenarioFn = (ctx) =>
  withConnection(ctx, async (conn) => {
    const sessionId = await newSession(conn, ctx);
    ctx.observations['promptResult'] = await prompt(
      conn,
      sessionId,
      'Plan how you would add a CHANGELOG.md to this directory. Do not create or change any files.',
    );
  });

const mcpTools: ScenarioFn = (ctx) =>
  withConnection(ctx, async (conn) => {
    const sessionId = await newSession(conn, ctx);
    ctx.observations['platformToolTurn'] = await prompt(
      conn,
      sessionId,
      `Call the MCP tool "${ctx.opts.platformTool}" from the heyhey-platform server (any valid arguments) and summarise what it returned.`,
    );
    ctx.observations['submissionToolTurn'] = await prompt(
      conn,
      sessionId,
      `Now call the MCP tool "${ctx.opts.submissionTool}" from the heyhey-submission-tools server and report the result.`,
    );
  });

/** ACP defines no per-turn tool subset; try `_meta` on session/new and the prompt and record what happens. */
const mcpSubset: ScenarioFn = (ctx) =>
  withConnection(ctx, async (conn) => {
    const subset = ctx.opts.toolSubset ?? [ctx.opts.platformTool];
    ctx.observations['toolSubset'] = subset;
    const meta = { _meta: { allowedTools: subset.map((name) => `mcp__heyhey-platform__${name}`) } };

    const sessionId = await newSession(conn, ctx, meta);
    ctx.observations['subsetTurn'] = await prompt(
      conn,
      sessionId,
      `List every MCP tool you can call, then try calling "get_context" and report whether you were allowed to.`,
      meta,
    );
  });

const writeOutside: ScenarioFn = (ctx) =>
  withConnection(ctx, async (conn) => {
    const sessionId = await newSession(conn, ctx);
    const outside = join(dirname(ctx.cwd), `outside-${randomUUID()}.txt`);
    ctx.observations['outsidePath'] = outside;
    ctx.observations['promptResult'] = await prompt(
      conn,
      sessionId,
      `Create the file ${outside} containing the text "outside". Report whether it worked.`,
    );
    ctx.observations['outsideFileExists'] = existsSync(outside);
  });

const HOOK_RELAY_SOURCE = `#!/usr/bin/env node
// Appends each hook payload (stdin) to the capture log with a timestamp.
const { appendFileSync } = require('node:fs');
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { unparsable: raw }; }
  appendFileSync(process.argv[2], JSON.stringify({ ts: new Date().toISOString(), payload }) + '\\n');
});
`;

const DEFAULT_HOOK_TEMPLATE = {
  hooks: {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '{{HOOK_COMMAND}}' }] }],
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '{{HOOK_COMMAND}}' }] }],
  },
};

/** Keeps the relay's `{ ts, payload }` wrapper; a line that is not JSON is kept verbatim. */
function parseHookLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return { unparsable: line };
  }
}

/** Installs a hook settings file and copies each relayed payload into the transcript beside the ACP frames. */
const hookRelay: ScenarioFn = async (ctx) => {
  const relayDir = join(ctx.cwd, '.hook-relay');
  mkdirSync(relayDir, { recursive: true });
  const relayScript = join(relayDir, 'relay.js');
  const hookLog = join(relayDir, 'hooks.ndjson');
  writeFileSync(relayScript, HOOK_RELAY_SOURCE);
  writeFileSync(hookLog, '');

  const command = `node ${JSON.stringify(relayScript)} ${JSON.stringify(hookLog)}`;
  const template = ctx.opts.hookSettingsTemplate
    ? readFileSync(ctx.opts.hookSettingsTemplate, 'utf8')
    : JSON.stringify(DEFAULT_HOOK_TEMPLATE);
  const settingsPath = ctx.opts.hookSettingsPath ?? join(ctx.cwd, '.agy', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, template.replaceAll('{{HOOK_COMMAND}}', command));
  ctx.observations['hookSettingsPath'] = settingsPath;
  ctx.observations['hookSettingsFormat'] = ctx.opts.hookSettingsTemplate
    ? 'template-file'
    : 'assumed-claude-style (unverified against agy)';

  let copied = 0;
  // Never throws: it runs inside setInterval, where an exception would be uncaught and kill every remaining scenario.
  const copyNewHooks = (): void => {
    try {
      const raw = readFileSync(hookLog, 'utf8');
      const lines = raw.split('\n');
      // The last element is either '' (file ends in a newline) or a half-written line; leave it for the next tick.
      const complete = lines.slice(0, -1).filter(Boolean);
      for (const line of complete.slice(copied)) {
        ctx.transcript.write(0, 'hook', parseHookLine(line));
      }
      copied = complete.length;
    } catch (error) {
      ctx.transcript.write(0, 'driver', { event: 'hook-copy-failed', error: String(error) });
    }
  };
  const poll = setInterval(copyNewHooks, 200);

  try {
    await withConnection(ctx, async (conn) => {
      const sessionId = await newSession(conn, ctx);
      ctx.observations['promptResult'] = await prompt(
        conn,
        sessionId,
        `Use your shell tool to run "ls" in ${ctx.cwd}, then read ${join(ctx.cwd, 'hook-probe.txt')} if it exists.`,
      );
    });
  } finally {
    await sleep(500);
    clearInterval(poll);
    copyNewHooks();
    ctx.observations['hookPayloadCount'] = copied;
  }
};

const SCENARIO_FNS: Record<ScenarioName, ScenarioFn> = {
  quick,
  'follow-up': followUp,
  resume,
  cancel,
  'permission-allow-once': permissionScenario('allow_once'),
  'permission-allow-always': permissionScenario('allow_always'),
  'permission-reject': permissionScenario('reject'),
  plan,
  'mcp-tools': mcpTools,
  'mcp-subset': mcpSubset,
  'write-outside': writeOutside,
  'hook-relay': hookRelay,
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Settles exactly once: a spawn `error` (e.g. missing binary) resolves with the failure, and a later `close` is ignored. */
async function readAgyVersion(
  agyBin: string,
): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolveVersion) => {
    let settled = false;
    const settle = (value: { output: string; exitCode: number | null }): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolveVersion(value);
    };

    const child = spawn(agyBin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', (error) => {
      console.error(`agy --version spawn error: ${error.message}`);
      settle({ output: `spawn error: ${error.message}`, exitCode: null });
    });
    child.on('close', (exitCode) => settle({ output: output.trim(), exitCode }));
  });
}

/** Returns true when the scenario completed. A failure is reported and recorded, never thrown. */
async function runScenario(
  name: ScenarioName,
  opts: Options,
  mcp: McpBuildResult,
  version: { output: string; exitCode: number | null },
): Promise<boolean> {
  const transcript = new Transcript(join(opts.out, `${name}.ndjson`));
  const cwd = opts.cwd ?? mkdtempSync(join(tmpdir(), `agy-capture-${name}-`));
  mkdirSync(cwd, { recursive: true });
  const mode = name === 'plan' ? opts.planMode : opts.mode;
  const observations: Record<string, unknown> = {};
  const startedAt = new Date().toISOString();
  const mcpServers = mcp.servers;

  console.log(`\n=== scenario ${name} (mode=${mode}, cwd=${cwd}) ===`);
  const ctx: ScenarioContext = {
    opts,
    transcript,
    cwd: resolve(cwd),
    mcpServers,
    mode,
    observations,
    connect: async (proc) => new AcpConnection(opts, transcript, proc, resolve(cwd)),
  };

  let error: string | null = null;
  try {
    if (mcp.error !== null && MCP_REQUIRED_SCENARIOS.includes(name)) {
      throw new Error(`scenario needs MCP servers but the MCP config failed: ${mcp.error}`);
    }
    await SCENARIO_FNS[name](ctx);
  } catch (caught) {
    error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    transcript.write(0, 'driver', { event: 'scenario-failed', error });
    console.error(`scenario ${name} FAILED: ${error}`);
  }

  const sidecar = {
    scenario: name,
    mode,
    cwd,
    agyVersion: version,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: error === null,
    error,
    mcpConfigError: mcp.error,
    mcpServersMounted: mcpServers.map((server) => ({
      name: server.name,
      url: server.url,
      headerNames: server.headers.map((header) => header.name),
    })),
    mcpServersMissing: EXPECTED_MCP_SERVERS.filter(
      (expected) => !mcpServers.some((server) => server.name === expected),
    ),
    mcpNote:
      'buildMcpServerConfig returns only heyhey-platform; heyhey-submission-tools and heyhey-browser are mounted only via --submission-mcp-url / --browser-mcp-url. A run with fewer than three servers is not the full set.',
    observations,
  };
  writeFileSync(join(opts.out, `${name}.meta.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`transcript: ${transcript.path}`);
  return error === null;
}

interface McpBuildResult {
  servers: AcpMcpServer[];
  /** Set when buildAcpMcpServers threw; scenarios that do not need MCP then run with no servers. */
  error: string | null;
}

const MCP_REQUIRED_SCENARIOS: readonly ScenarioName[] = ['mcp-tools', 'mcp-subset'];

async function tryBuildAcpMcpServers(opts: Options): Promise<McpBuildResult> {
  try {
    return { servers: await buildAcpMcpServers(opts), error: null };
  } catch (caught) {
    const error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    console.error(
      `[mcp] config failed; MCP scenarios will fail, others run with no servers: ${error}`,
    );
    return { servers: [], error };
  }
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));
  mkdirSync(opts.out, { recursive: true });
  console.warn(
    `\n!!! WARNING: transcripts in ${opts.out} contain LIVE BEARER TOKENS (session/new MCP headers). Do not commit them unredacted. !!!\n`,
  );

  const version = await readAgyVersion(opts.agyBin);
  console.log(`agy --version: ${version.output} (exit ${String(version.exitCode)})`);

  const mcp = await tryBuildAcpMcpServers(opts);
  const mcpServers = mcp.servers;
  console.log(`mcp servers: ${mcpServers.map((server) => server.name).join(', ') || '(none)'}`);
  const missing = EXPECTED_MCP_SERVERS.filter(
    (expected) => !mcpServers.some((server) => server.name === expected),
  );
  if (missing.length > 0) {
    console.warn(`[mcp] NOT mounted this run: ${missing.join(', ')}`);
  }

  const failed: ScenarioName[] = [];
  for (const name of opts.scenarios) {
    const ok = await runScenario(name, opts, mcp, version);
    if (!ok) {
      failed.push(name);
    }
  }

  console.log(`\nfinished: ${opts.scenarios.length - failed.length}/${opts.scenarios.length} ok`);
  if (failed.length > 0) {
    console.error(`failed scenarios: ${failed.join(', ')}`);
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
