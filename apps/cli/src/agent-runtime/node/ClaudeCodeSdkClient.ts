import type { RunAttachmentContent } from '../../../../../packages/ui-common/src/utils/run-attachment-format';
/**
 * Claude Code SDK Client.
 *
 * Spawns `claude` with stream-json I/O and communicates via stdin/stdout
 * using JSON lines. Manages process lifecycle and exposes startSession(),
 * continueSession(), and onEvent() for driving interactive sessions.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { toolExecutionHookSettings, type ToolExecutionHookLaunch } from '../tool-execution-hooks';

import {
  contextDataSchema,
  usageDataSchema,
  type ContextData,
  type UsageData,
} from './controlRequestSchemas';

export type { UsageData, UsageWindow } from './controlRequestSchemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCodeSessionConfig {
  /** Explicit launch choice, overriding any saved Claude fast-mode preference. */
  fastMode: boolean;
  toolExecutionHooks?: ToolExecutionHookLaunch | undefined;
  attachments?: readonly RunAttachmentContent[] | undefined;
  prompt: string;
  cwd: string;
  permissionMode?: ('default' | 'acceptEdits' | 'bypassPermissions' | 'plan') | undefined;
  model?: string | undefined;
  /**
   * Reasoning effort id passed as --effort to the Claude CLI. It is one of the
   * `supportedEffortLevels` Claude reported for the model, passed through as-is.
   */
  reasoningEffort?: string | undefined;
  mcpServers?: Record<string, unknown> | undefined;
  allowedTools?: string[] | undefined;
  /** Ignore MCP servers from user and project configuration. */
  strictMcpConfig?: boolean;
  /**
   * Structural allowlist for the agent's built-in tool surface, passed as
   * `--tools <names...>` to the Claude CLI. When set, the agent's built-in
   * tools are restricted to exactly this list — every other built-in (Edit,
   * Write, NotebookEdit, …) is structurally absent, not just denied at
   * permission time. Use for sessions that must be read-only by construction
   * rather than by prompt discipline. Distinct from `allowedTools`: that is a
   * pre-approval list (anything in it skips the permission prompt); this is a
   * tool-surface restriction (anything NOT in it is unreachable).
   */
  builtinTools?: string[] | undefined;
  /** Full replacement for the provider default system prompt. */
  systemPrompt?: string | undefined;
  appendSystemPrompt?: string | undefined;
  /** When set, passes --resume <id> to restore a previous conversation. */
  resumeSessionId?: string | undefined;
  /** Repository write boundary enforced for the entire Claude process tree. */
  workspaceContainment?: ClaudeCodeWorkspaceContainment | undefined;
}

type ClaudeCodeSandboxFilesystemSettings = {
  readonly allowWrite: readonly string[];
  readonly denyWrite?: readonly string[];
  readonly allowRead?: readonly string[] | undefined;
};

type ClaudeCodeSandboxNetworkSettings = {
  readonly allowUnixSockets: readonly string[];
};

/**
 * Claude's native sandbox, the only OS containment for the Claude process
 * tree. Always enabled and fail-closed: the turn fails if the sandbox cannot
 * start, and Bash can never fall back to running unsandboxed.
 */
export type ClaudeCodeSandboxSettings = {
  readonly enabled: true;
  readonly failIfUnavailable: true;
  readonly allowUnsandboxedCommands: false;
  readonly excludedCommands?: readonly string[] | undefined;
  readonly filesystem: ClaudeCodeSandboxFilesystemSettings;
  readonly network?: ClaudeCodeSandboxNetworkSettings | undefined;
};

export interface ClaudeCodeWorkspaceContainment {
  readonly additionalDirectories: readonly string[];
  readonly settings: { readonly sandbox: ClaudeCodeSandboxSettings };
  readonly settingSources: readonly string[];
}

const resultEventSchema = z
  .object({
    type: z.literal('result'),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    num_turns: z.number().optional(),
    result: z.unknown().optional(),
    errors: z.array(z.string()).optional(),
    session_id: z.string().optional(),
  })
  .passthrough();

/**
 * Outcome of one Claude turn, classified from its `result` event. A result
 * with `is_error === true` or a `subtype` other than `success` is a failed
 * turn, never a successful empty one.
 */
export type ClaudeCodeTurnResult =
  | {
      readonly ok: true;
      readonly subtype: 'success';
      readonly numTurns: number | null;
      readonly sessionId: string | null;
    }
  | {
      readonly ok: false;
      readonly subtype: string | null;
      readonly numTurns: number | null;
      readonly sessionId: string | null;
      readonly errors: readonly string[];
      /** Human-readable failure text for surfacing on the turn. */
      readonly errorText: string;
    };

export const classifyClaudeCodeResult = (event: ClaudeCodeSdkEvent): ClaudeCodeTurnResult => {
  const parsed = resultEventSchema.safeParse(event);
  if (!parsed.success) {
    return {
      ok: false,
      subtype: typeof event.subtype === 'string' ? event.subtype : null,
      numTurns: null,
      sessionId: typeof event.session_id === 'string' ? event.session_id : null,
      errors: [],
      errorText: 'Claude returned a malformed result event',
    };
  }
  const result = parsed.data;
  const numTurns = result.num_turns ?? null;
  const sessionId = result.session_id ?? null;
  if (result.is_error !== true && result.subtype === 'success') {
    return { ok: true, subtype: 'success', numTurns, sessionId };
  }
  const errors = result.errors ?? [];
  const errorText =
    errors.length > 0
      ? errors.join('\n')
      : typeof result.result === 'string' && result.result.length > 0
        ? result.result
        : `Claude run failed (subtype=${result.subtype ?? 'unknown'})`;
  return {
    ok: false,
    subtype: result.subtype ?? null,
    numTurns,
    sessionId,
    errors,
    errorText,
  };
};

export type ClaudeCodeSdkEvent = {
  type: string;
  subtype?: string | undefined;
  session_id?: string | undefined;
  [key: string]: unknown;
};

export type ClaudeCodeEventHandler = (event: ClaudeCodeSdkEvent) => void;

export type ClaudeCodePermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export type ClaudeCodePermissionHandler = (
  toolName: string,
  input: unknown,
) => Promise<ClaudeCodePermissionResult>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGTERM_GRACE_MS = 3_000;

// Upper bound on how long {@link ClaudeCodeSdkClient.compact} waits for the
// CLI's `compact_boundary` event after submitting `/compact` over stdin. Bounded
// because compaction runs inside the child's model loop — a wedged provider
// must not let the request hang forever.
const COMPACT_DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Pending compact() wait exceeded its bounded timeout. */
export class CompactTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Compact request timed out after ${String(timeoutMs)}ms`);
    this.name = 'CompactTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Outbound control_request errors
// ---------------------------------------------------------------------------

/** Base class for failures producing or completing an outbound control_request. */
export class ControlRequestError extends Error {
  constructor(
    message: string,
    readonly subtype: string,
  ) {
    super(message);
    this.name = 'ControlRequestError';
  }
}

/** The CLI returned a control_response with subtype === "error". */
export class ControlRequestRemoteError extends ControlRequestError {
  constructor(message: string, subtype: string) {
    super(message, subtype);
    this.name = 'ControlRequestRemoteError';
  }
}

/** The response payload failed zod validation at the SDK boundary. */
export class ControlRequestSchemaError extends ControlRequestError {
  constructor(
    message: string,
    subtype: string,
    readonly issues: ZodError['issues'],
  ) {
    super(message, subtype);
    this.name = 'ControlRequestSchemaError';
  }
}

/** Pending request was rejected because disconnect() was called. */
export class ControlRequestDisconnectedError extends ControlRequestError {
  constructor(subtype: string) {
    super(`Control request "${subtype}" aborted: client disconnected`, subtype);
    this.name = 'ControlRequestDisconnectedError';
  }
}

/** Pending request was rejected because the abort signal fired. */
export class ControlRequestAbortedError extends ControlRequestError {
  constructor(subtype: string) {
    super(`Control request "${subtype}" aborted`, subtype);
    this.name = 'ControlRequestAbortedError';
  }
}

interface PendingControlRequest {
  subtype: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingCompactRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ClaudeCodeSdkClient {
  private commandOverride: string | null = null;
  private sessionId: string | null = null;
  private eventHandler: ClaudeCodeEventHandler | null = null;
  private permissionHandler: ClaudeCodePermissionHandler | null = null;
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingResolve: ((value: ClaudeCodeTurnResult) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  private pendingPermissionAbort: AbortController | null = null;
  private activeAbortCleanup: (() => void) | null = null;
  private mcpConfigTempDir: string | null = null;
  private pendingControlRequests = new Map<string, PendingControlRequest>();
  private pendingCompactRequests: Array<PendingCompactRequest> = [];

  setCommand(command: string): void {
    this.commandOverride = command;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  onEvent(handler: ClaudeCodeEventHandler | null): void {
    this.eventHandler = handler;
  }

  onPermissionRequest(handler: ClaudeCodePermissionHandler | null): void {
    this.permissionHandler = handler;
  }

  async startSession(
    config: ClaudeCodeSessionConfig,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<ClaudeCodeTurnResult> {
    if (this.process) {
      throw new Error('Session already active. Call disconnect() first.');
    }

    this.sessionId = null;
    this.spawnProcess(config);
    this.setupReadline();
    this.setupSignalHandler(options?.signal);

    const userMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: claudeTurnContent(config.prompt, config.attachments),
      },
    });
    this.process!.stdin!.write(userMessage + '\n');

    return this.waitForResult();
  }

  /**
   * Connect to a session for read-only control requests without running a
   * turn. Spawns the CLI (typically with `resumeSessionId` set) and wires up
   * stdout/abort handling, but sends no user message — so the model never
   * produces a (billable) response.
   *
   * It deliberately does NOT wait for the `system/init` event: the CLI does
   * not emit `init` until it receives its first stdin line, and a control
   * request like {@link getContextUsage} provides exactly that. Waiting for
   * `init` here without writing anything would deadlock. Control requests
   * don't need the session id, so the caller can issue {@link getContextUsage}
   * immediately after this resolves, then must call {@link disconnect}.
   */
  async connectForControl(
    config: ClaudeCodeSessionConfig,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<void> {
    if (this.process) {
      throw new Error('Session already active. Call disconnect() first.');
    }

    this.sessionId = null;
    this.spawnProcess(config);
    this.setupReadline();
    this.setupSignalHandler(options?.signal);
  }

  async continueSession(
    prompt: string,
    options?: {
      signal?: AbortSignal | undefined;
      attachments?: readonly RunAttachmentContent[] | undefined;
    },
  ): Promise<ClaudeCodeTurnResult> {
    if (!this.process) {
      throw new Error('No active session. Call startSession() first.');
    }
    if (!this.sessionId) {
      throw new Error('No session ID captured. Cannot continue.');
    }

    this.setupSignalHandler(options?.signal);

    const userMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: claudeTurnContent(prompt, options?.attachments),
      },
    });
    this.process.stdin!.write(userMessage + '\n');

    return this.waitForResult();
  }

  /**
   * Ask the running CLI for its current context-window breakdown.
   *
   * Sends a `get_context_usage` control_request over stdin and resolves with
   * the parsed payload once the CLI replies with a matching control_response.
   * The payload is validated against the generated ContextData shape at
   * the SDK boundary — runner consumers can flow the returned value straight
   * into the OpenAPI response.
   */
  async getContextUsage(): Promise<ContextData> {
    if (!this.process) {
      throw new Error('No active session. Call startSession() first.');
    }

    const raw = await this.sendControlRequest('get_context_usage', {});
    return parseControlResponse('get_context_usage', contextDataSchema, raw);
  }

  /**
   * Ask the CLI for the structured `/usage` data, including claude.ai plan
   * rate-limit utilization. Sent with `skip_behaviors: true` so the CLI skips
   * its local transcript scan — callers here only need the plan limits.
   *
   * Rejects with {@link ControlRequestRemoteError} when the CLI refuses (e.g.
   * "get_usage is not supported in this context") and with
   * {@link ControlRequestSchemaError} when the experimental reply shape drifts.
   * Works after {@link connectForControl} as well as during a session.
   */
  async getUsage(): Promise<UsageData> {
    if (!this.process) {
      throw new Error('No active session. Call startSession() first.');
    }

    const raw = await this.sendControlRequest('get_usage', {
      skip_behaviors: true,
    });
    return parseControlResponse('get_usage', usageDataSchema, raw);
  }

  /**
   * Submit `/compact` to the running CLI and wait for the `compact_boundary`
   * provider event that marks the rewritten history boundary.
   *
   * Unlike {@link getContextUsage}, compaction isn't a control_request — the
   * CLI handles `/compact` as a slash command on a regular user message and
   * signals completion via the next `compact_boundary` event on stdout. The
   * promise resolves on that boundary, rejects with {@link CompactTimeoutError}
   * if it doesn't arrive within `timeoutMs`, and rejects with
   * {@link ControlRequestDisconnectedError}/{@link ControlRequestAbortedError}
   * (subtype `"compact"`) when the client is torn down or aborted mid-flight.
   */
  async compact(options?: { timeoutMs?: number | undefined }): Promise<void> {
    if (!this.process) {
      throw new Error('No active session. Call startSession() first.');
    }
    if (!this.process.stdin?.writable) {
      throw new Error('Cannot compact: child stdin not writable');
    }

    const timeoutMs = options?.timeoutMs ?? COMPACT_DEFAULT_TIMEOUT_MS;

    return new Promise<void>((resolve, reject) => {
      const pending: PendingCompactRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removePendingCompact(pending);
          reject(new CompactTimeoutError(timeoutMs));
        }, timeoutMs),
      };
      this.pendingCompactRequests.push(pending);

      const userMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: '/compact' },
      });
      this.process!.stdin!.write(userMessage + '\n');
    });
  }

  async disconnect(): Promise<void> {
    // A deliberate disconnect ends the session: the child process is gone and
    // its provider session is no longer resumable through this client, so
    // getSessionId() must report null. (Unexpected process exit/error routes
    // through cleanup() instead, which keeps the last-known id for diagnostics.)
    // Callers that need the id being torn down — the mcp-headers-stale recycle
    // path and the runner's per-Turn discard — read it before calling here.
    this.sessionId = null;

    const proc = this.process;
    if (!proc) return;

    this.rejectPending(new Error('Disconnected'));
    this.rejectPendingControlRequests((subtype) => new ControlRequestDisconnectedError(subtype));
    this.rejectPendingCompactRequests(() => new ControlRequestDisconnectedError('compact'));

    proc.kill('SIGTERM');

    const killed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, SIGTERM_GRACE_MS);

      proc.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!killed) {
      proc.kill('SIGKILL');
    }

    this.cleanup();
  }

  // -- Private: spawning ----------------------------------------------------

  private buildArgs(config: ClaudeCodeSessionConfig): string[] {
    const args: string[] = [
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (this.permissionHandler) {
      args.push('--permission-prompt-tool', 'stdio');
    }

    if (config.permissionMode) {
      args.push('--permission-mode', config.permissionMode);
    }

    if (config.model) {
      args.push('--model', config.model);
    }

    if (config.reasoningEffort) {
      args.push('--effort', config.reasoningEffort);
    }

    if (config.mcpServers) {
      const tempDir = mkdtempSync(join(tmpdir(), 'claude-mcp-'));
      this.mcpConfigTempDir = tempDir;
      const configPath = join(tempDir, 'mcp-servers.json');
      writeFileSync(configPath, JSON.stringify({ mcpServers: config.mcpServers }), 'utf8');
      args.push('--mcp-config', configPath);
    }

    if (config.strictMcpConfig) {
      args.push('--strict-mcp-config');
    }

    if (config.allowedTools && config.allowedTools.length > 0) {
      for (const tool of config.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }

    if (config.builtinTools) {
      // `--tools` restricts the agent's built-in tool surface to exactly the
      // names that follow. An empty list means "disable all built-ins" — the
      // Claude CLI requires a literal "" to signal that, so the empty-array
      // case still emits the flag rather than being silently dropped.
      if (config.builtinTools.length === 0) {
        args.push('--tools', '');
      } else {
        args.push('--tools', ...config.builtinTools);
      }
    }

    if (config.systemPrompt) {
      args.push('--system-prompt', config.systemPrompt);
    } else if (config.appendSystemPrompt) {
      args.push('--append-system-prompt', config.appendSystemPrompt);
    }

    if (config.resumeSessionId) {
      args.push('--resume', config.resumeSessionId);
    }

    if (config.workspaceContainment) {
      for (const directory of config.workspaceContainment.additionalDirectories) {
        args.push('--add-dir', directory);
      }
      args.push('--setting-sources', config.workspaceContainment.settingSources.join(','));
    }

    args.push(
      '--settings',
      JSON.stringify({
        ...config.workspaceContainment?.settings,
        fastMode: config.fastMode,
        ...(config.toolExecutionHooks
          ? {
              hooks: toolExecutionHookSettings('claude', config.toolExecutionHooks.command),
            }
          : {}),
      }),
    );
    return args;
  }

  private spawnProcess(config: ClaudeCodeSessionConfig): void {
    // Claude is spawned directly: its native sandbox (configured through
    // --settings) is the process-tree containment, and it keeps sessions in
    // the user's normal Claude config directory so resumes outlive the CLI.
    const command = this.commandOverride ? process.execPath : 'claude';
    const args = this.commandOverride
      ? [this.commandOverride, ...this.buildArgs(config)]
      : this.buildArgs(config);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...config.toolExecutionHooks?.environment,
    };
    delete env['CLAUDECODE'];

    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd,
      env,
    });
    this.process = proc;

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes('Error') || text.includes('error')) {
        console.error('[ClaudeCodeSdkClient] stderr:', text.trim());
      }
    });

    // `close` (not `exit`) fires only after stdout has drained, so a final
    // error `result` written just before the process exits is classified by
    // handleLine instead of being replaced by "Process exited unexpectedly".
    // The identity guard keeps a late close from tearing down a newer process.
    proc.on('close', (code) => {
      if (this.process !== proc) return;
      this.rejectPending(new Error(`Process exited unexpectedly (code=${String(code)})`));
      this.rejectPendingControlRequests((subtype) => new ControlRequestDisconnectedError(subtype));
      this.rejectPendingCompactRequests(() => new ControlRequestDisconnectedError('compact'));
      this.cleanup();
    });

    proc.on('error', (err) => {
      if (this.process !== proc) return;
      this.rejectPending(new Error(`Process error: ${err.message}`));
      this.rejectPendingControlRequests((subtype) => new ControlRequestDisconnectedError(subtype));
      this.rejectPendingCompactRequests(() => new ControlRequestDisconnectedError('compact'));
      this.cleanup();
    });
  }

  // -- Private: reading -----------------------------------------------------

  private setupReadline(): void {
    if (!this.process?.stdout) return;

    this.readline = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      this.handleLine(line);
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: ClaudeCodeSdkEvent;
    try {
      parsed = JSON.parse(trimmed) as ClaudeCodeSdkEvent;
    } catch {
      return;
    }

    if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
      this.sessionId = parsed.session_id;
    }

    if (parsed.type === 'control_request') {
      this.handleControlRequest(parsed);
      return;
    }

    if (parsed.type === 'control_response') {
      this.handleControlResponse(parsed);
      return;
    }

    if (parsed.type === 'control_cancel_request') {
      this.handleControlCancelRequest();
      return;
    }

    if (parsed.type === 'result') {
      console.log(
        `[ClaudeCodeSdkClient] result event received: hasPendingPermissionAbort=${Boolean(
          this.pendingPermissionAbort,
        )}`,
      );
      this.resolvePending(classifyClaudeCodeResult(parsed));
    }

    if (parsed.type === 'compact_boundary') {
      this.resolvePendingCompactRequests();
    }

    this.eventHandler?.(parsed);
  }

  // -- Private: control / permissions ---------------------------------------

  private handleControlRequest(event: ClaudeCodeSdkEvent): void {
    const request = event['request'] as Record<string, unknown> | undefined;
    if (!request || request['subtype'] !== 'can_use_tool') return;

    // request_id lives at the top level of the control_request event, not inside request
    const requestId = event['request_id'] as string;
    const toolName = request['tool_name'] as string;
    const toolInput = request['input'];

    console.log(
      `[ClaudeCodeSdkClient] control_request received: requestId=${requestId} tool=${toolName} hasHandler=${Boolean(
        this.permissionHandler,
      )} hasPendingAbort=${Boolean(this.pendingPermissionAbort)}`,
    );

    if (!this.permissionHandler) {
      this.writeControlResponse(requestId, {
        behavior: 'deny',
        message: 'No permission handler registered',
      });
      return;
    }

    const abortController = new AbortController();
    this.pendingPermissionAbort = abortController;

    this.permissionHandler(toolName, toolInput)
      .then((result) => {
        if (abortController.signal.aborted) {
          console.warn(
            `[ClaudeCodeSdkClient] permission handler resolved but aborted — dropping response: requestId=${requestId} tool=${toolName} behavior=${result.behavior}`,
          );
          return;
        }
        this.pendingPermissionAbort = null;

        console.log(
          `[ClaudeCodeSdkClient] permission handler resolved: requestId=${requestId} tool=${toolName} behavior=${result.behavior}`,
        );
        this.writeControlResponse(requestId, result);
      })
      .catch((err: Error) => {
        if (abortController.signal.aborted) {
          console.warn(
            `[ClaudeCodeSdkClient] permission handler rejected but aborted — dropping error: requestId=${requestId} tool=${toolName} error=${err.message}`,
          );
          return;
        }
        this.pendingPermissionAbort = null;
        console.error(
          `[ClaudeCodeSdkClient] permission handler rejected: requestId=${requestId} tool=${toolName} error=${err.message}`,
        );
        this.writeControlError(requestId, err.message);
      });
  }

  private handleControlCancelRequest(): void {
    console.log(
      `[ClaudeCodeSdkClient] control_cancel_request received: hasPendingAbort=${Boolean(
        this.pendingPermissionAbort,
      )}`,
    );
    this.pendingPermissionAbort?.abort();
    this.pendingPermissionAbort = null;
  }

  private writeControlResponse(requestId: string, result: ClaudeCodePermissionResult): void {
    if (!this.process?.stdin?.writable) return;

    const response = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: result,
      },
    });
    this.process.stdin.write(response + '\n');
  }

  private writeControlError(requestId: string, message: string): void {
    if (!this.process?.stdin?.writable) return;

    const response = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: message,
      },
    });
    this.process.stdin.write(response + '\n');
  }

  // -- Private: outbound control_request primitive --------------------------

  private sendControlRequest(
    subtype: string,
    requestPayload: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(
          new ControlRequestError(
            `Cannot send control_request "${subtype}": child stdin not writable`,
            subtype,
          ),
        );
        return;
      }

      const requestId = randomUUID();
      this.pendingControlRequests.set(requestId, {
        subtype,
        resolve,
        reject,
      });

      const line = JSON.stringify({
        type: 'control_request',
        request_id: requestId,
        request: { subtype, ...requestPayload },
      });

      console.log(
        `[ClaudeCodeSdkClient] control_request sent: requestId=${requestId} subtype=${subtype}`,
      );
      this.process.stdin.write(line + '\n');
    });
  }

  private handleControlResponse(event: ClaudeCodeSdkEvent): void {
    const response = event['response'] as
      | {
          subtype?: string | undefined;
          request_id?: string | undefined;
          response?: unknown | undefined;
          error?: string | undefined;
        }
      | undefined;
    if (!response || typeof response.request_id !== 'string') {
      console.warn('[ClaudeCodeSdkClient] control_response missing request_id — dropping');
      return;
    }

    const requestId = response.request_id;
    const pending = this.pendingControlRequests.get(requestId);
    if (!pending) {
      console.warn(
        `[ClaudeCodeSdkClient] control_response for unknown requestId=${requestId} — dropping`,
      );
      return;
    }

    this.pendingControlRequests.delete(requestId);

    if (response.subtype === 'success') {
      console.log(
        `[ClaudeCodeSdkClient] control_response resolved: requestId=${requestId} subtype=${pending.subtype}`,
      );
      pending.resolve(response.response);
      return;
    }

    const message =
      typeof response.error === 'string' && response.error.length > 0
        ? response.error
        : `Control request "${pending.subtype}" failed`;
    console.error(
      `[ClaudeCodeSdkClient] control_response rejected: requestId=${requestId} subtype=${pending.subtype} error=${message}`,
    );
    pending.reject(new ControlRequestRemoteError(message, pending.subtype));
  }

  private rejectPendingControlRequests(makeError: (subtype: string) => Error): void {
    if (this.pendingControlRequests.size === 0) return;

    const entries = Array.from(this.pendingControlRequests.values());
    this.pendingControlRequests.clear();
    for (const entry of entries) {
      entry.reject(makeError(entry.subtype));
    }
  }

  // -- Private: pending compact wait management -----------------------------

  private resolvePendingCompactRequests(): void {
    if (this.pendingCompactRequests.length === 0) return;
    const entries = this.pendingCompactRequests.splice(0);
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.resolve();
    }
  }

  private rejectPendingCompactRequests(makeError: () => Error): void {
    if (this.pendingCompactRequests.length === 0) return;
    const entries = this.pendingCompactRequests.splice(0);
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(makeError());
    }
  }

  private removePendingCompact(entry: PendingCompactRequest): void {
    const index = this.pendingCompactRequests.indexOf(entry);
    if (index >= 0) {
      this.pendingCompactRequests.splice(index, 1);
    }
  }

  // -- Private: promise management ------------------------------------------

  private waitForResult(): Promise<ClaudeCodeTurnResult> {
    return new Promise<ClaudeCodeTurnResult>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  private resolvePending(result: ClaudeCodeTurnResult): void {
    this.activeAbortCleanup?.();
    this.activeAbortCleanup = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject = null;
    resolve?.(result);
  }

  private rejectPending(error: Error): void {
    this.activeAbortCleanup?.();
    this.activeAbortCleanup = null;
    const reject = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    reject?.(error);
  }

  private setupSignalHandler(signal?: AbortSignal): void {
    if (!signal) return;

    const onAbort = () => {
      this.rejectPending(new Error('Aborted'));
      this.rejectPendingControlRequests((subtype) => new ControlRequestAbortedError(subtype));
      this.rejectPendingCompactRequests(() => new ControlRequestAbortedError('compact'));
      // Rejecting the pending promise only makes the runner stop listening; the
      // spawned claude subprocess keeps running (tools, edits, bash) until it is
      // killed. Tear it down so an aborted Turn actually halts the agent.
      void this.disconnect();
    };

    signal.addEventListener('abort', onAbort);
    this.activeAbortCleanup = () => signal.removeEventListener('abort', onAbort);
  }

  // -- Private: cleanup -----------------------------------------------------

  private cleanup(): void {
    this.readline?.close();
    this.readline = null;
    this.process = null;
    this.pendingPermissionAbort?.abort();
    this.pendingPermissionAbort = null;
    this.rejectPendingControlRequests((subtype) => new ControlRequestDisconnectedError(subtype));
    this.rejectPendingCompactRequests(() => new ControlRequestDisconnectedError('compact'));

    if (this.mcpConfigTempDir) {
      try {
        rmSync(this.mcpConfigTempDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      this.mcpConfigTempDir = null;
    }
  }
}

function parseControlResponse<T>(subtype: string, schema: z.ZodType<T>, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const summary = err.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new ControlRequestSchemaError(
        `${subtype} response failed schema validation: ${summary}`,
        subtype,
        err.issues,
      );
    }
    throw err;
  }
}

export function claudeTurnContent(
  prompt: string,
  attachments: readonly RunAttachmentContent[] = [],
) {
  if (attachments.length === 0) return prompt;
  return [
    { type: 'text' as const, text: prompt },
    ...attachments.map((content) =>
      content.kind === 'text'
        ? {
            type: 'text' as const,
            text: 'File: ' + content.fileName + '\n' + content.text,
          }
        : {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: content.mediaType,
              data: content.data,
            },
          },
    ),
  ];
}
