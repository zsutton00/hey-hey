import type { RunAttachmentContent } from '../../../../../packages/ui-common/src/utils/run-attachment-format';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ToolExecutionHookLaunch } from '../tool-execution-hooks';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

import type { ContextData } from './controlRequestSchemas';

export type CodexSdkTokenUsage = {
  inputTokens: number | null;
  outputTokens: number;
  cacheCreationInputTokens: null;
  cacheReadInputTokens: number | null;
  cacheAvailability: 'partial' | 'unsupported';
};

export type CodexSdkTokenUsageHandler = (usage: CodexSdkTokenUsage) => void;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodexSdkSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type CodexSdkServiceTier = 'priority' | 'default';

export type CodexSdkConfigValue =
  | string
  | number
  | boolean
  | null
  | CodexSdkConfigValue[]
  | { [key: string]: CodexSdkConfigValue };

export type CodexSdkConfigOverrides = { [key: string]: CodexSdkConfigValue };

export interface CodexSdkSkillTurnInput {
  type: 'skill';
  name: string;
  path: string;
}

export interface CodexSdkSessionConfig {
  /** Environment for an already installed, natively trusted capture hook. */
  toolExecutionHooks?: ToolExecutionHookLaunch | undefined;
  attachments?: readonly RunAttachmentContent[] | undefined;
  prompt: string;
  /** Replaces Codex's built-in base instructions when minting a fresh thread. */
  baseInstructions?: string | undefined;
  /** Locally resolved Skill input to place before the optional text prompt. */
  skill?: CodexSdkSkillTurnInput | undefined;
  /** Stable-first structured input. Codex uses prefix caching automatically. */
  structuredInput?: readonly CodexSdkTextInput[] | undefined;
  cwd: string;
  extraWritableDirs?: readonly string[] | undefined;
  /**
   * Per-thread sandbox policy. Forwarded as `sandbox` on the `thread/start`
   * (and `thread/resume`) ClientRequest params. When omitted, the codex
   * app-server picks the user's configured default. Use `"read-only"` to
   * structurally prevent the agent from modifying the filesystem.
   */
  sandbox?: CodexSdkSandboxMode | undefined;
  /**
   * Codex model id. Forwarded as `model` on the `thread/start` /
   * `thread/resume` ClientRequest params; the codex app-server's user-configured
   * default is used when omitted.
   */
  model?: string | undefined;
  /**
   * Per-thread Codex service tier. Forwarded as `serviceTier` on
   * `thread/start` / `thread/resume`; the codex app-server's user-configured
   * default remains authoritative when omitted.
   */
  serviceTier?: CodexSdkServiceTier | undefined;
  /**
   * Per-thread Codex app-server config overrides. Forwarded as `config` on
   * `thread/start` / `thread/resume`; use this for config-backed capabilities
   * such as MCP servers that are not top-level thread params.
   */
  config?: CodexSdkConfigOverrides | undefined;
  /**
   * Reasoning effort level. Forwarded as `effort` on the `turn/start`
   * ClientRequest the client writes after `thread/started`. The codex app-server
   * protocol exposes `effort` on `turn/start` only — not on `thread/start` or
   * `thread/resume` — so this overrides effort for the first (and only) turn
   * this bootstrap session runs. Omit to defer to the codex app-server's
   * user-configured default.
   */
  effort?: string | undefined;
}

export interface CodexSdkTextInput {
  readonly text: string;
  readonly cacheBreakpoint: boolean;
}

export type CodexSdkEvent = {
  method: string;
  params?: Record<string, unknown> | undefined;
};

export type CodexSdkServerRequest = {
  id: string | number;
  method: string;
  params?: Record<string, unknown> | undefined;
};

export type CodexSdkEventHandler = (event: CodexSdkEvent) => void;
export type CodexSdkServerRequestHandler = (request: CodexSdkServerRequest) => void;

export interface CodexSdkRootTurnIdentity {
  readonly threadId: string;
  readonly turnId: string;
}

/**
 * Client information sent during the initialize handshake.
 */
export interface CodexSdkClientInfo {
  /**
   * Identifier for the client (used for OpenAI Compliance Logs Platform).
   */
  name: string;
  /**
   * Human-readable title for the client.
   */
  title?: (string | null) | undefined;
  /**
   * Client version string.
   */
  version: string;
}

/**
 * Capabilities declared during initialize.
 */
export interface CodexSdkInitializeCapabilities {
  /**
   * Opt into receiving experimental API methods and fields.
   */
  experimentalApi?: boolean | undefined;
  /**
   * Opt into `attestation/generate` requests for upstream `x-oai-attestation`.
   */
  requestAttestation?: boolean | undefined;
  /**
   * Exact notification method names to suppress for this connection.
   */
  optOutNotificationMethods?: (readonly string[] | null) | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGTERM_GRACE_MS = 3_000;

// Upper bound on how long {@link CodexSdkClient.compact} waits for the
// `thread/compacted` notification after submitting `thread/compact/start`.
const COMPACT_DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Pending compact() wait exceeded its bounded timeout. */
export class CodexCompactTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Compact request timed out after ${String(timeoutMs)}ms`);
    this.name = 'CodexCompactTimeoutError';
  }
}

/**
 * `getContextUsage()` was called before any usable `thread/tokenUsage/updated`
 * notification had arrived, or no valid active-context total was available.
 */
export class CodexNoContextSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexNoContextSnapshotError';
  }
}

const isConfigRecord = (
  value: CodexSdkConfigValue | undefined,
): value is { [key: string]: CodexSdkConfigValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeExtraWritableDirs = (extraWritableDirs: readonly string[] | undefined): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const dir of extraWritableDirs ?? []) {
    const trimmed = dir.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
};

const mergeExtraWritableDirsIntoConfig = (
  config: CodexSdkConfigOverrides | undefined,
  extraWritableDirs: readonly string[] | undefined,
): CodexSdkConfigOverrides | undefined => {
  const normalizedExtraWritableDirs = normalizeExtraWritableDirs(extraWritableDirs);
  if (normalizedExtraWritableDirs.length === 0) {
    return config;
  }

  const sandboxWorkspaceWrite = isConfigRecord(config?.['sandbox_workspace_write'])
    ? config['sandbox_workspace_write']
    : {};
  const configuredWritableRoots = Array.isArray(sandboxWorkspaceWrite['writable_roots'])
    ? sandboxWorkspaceWrite['writable_roots'].filter(
        (value): value is string => typeof value === 'string',
      )
    : [];

  return {
    ...(config ?? {}),
    sandbox_workspace_write: {
      ...sandboxWorkspaceWrite,
      writable_roots: Array.from(
        new Set([...configuredWritableRoots, ...normalizedExtraWritableDirs]),
      ),
    },
  };
};

interface PendingCompactRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface TokenUsageSnapshot {
  totalTokens: number;
  modelContextWindow: number;
}

interface RootTurnIdentity {
  threadId: string | null;
  turnId: string | null;
}

class CodexRequestSettlement {
  private root: RootTurnIdentity = { threadId: null, turnId: null };

  begin(threadId: string | null): void {
    this.root = { threadId, turnId: null };
  }

  observeRootThread(threadId: string): boolean {
    if (this.root.threadId === null) {
      this.root = { threadId, turnId: null };
    }
    return this.root.threadId === threadId;
  }

  observeTurnStarted(params: Record<string, unknown> | undefined): boolean {
    const threadId = readTrimmedString(params?.['threadId']);
    const turn = isRecord(params?.['turn']) ? params['turn'] : null;
    const turnId = readTrimmedString(params?.['turnId']) ?? readTrimmedString(turn?.['id']);
    if (threadId === null || turnId === null || threadId !== this.root.threadId) {
      return true;
    }
    return this.observeTurnStartResponse(turnId);
  }

  observeTurnStartResponse(turnId: string): boolean {
    if (this.root.threadId === null) {
      return false;
    }
    if (this.root.turnId === null) {
      this.root = { threadId: this.root.threadId, turnId };
      return true;
    }
    return this.root.turnId === turnId;
  }

  rootIdentity(): CodexSdkRootTurnIdentity | null {
    return this.root.threadId !== null && this.root.turnId !== null
      ? { threadId: this.root.threadId, turnId: this.root.turnId }
      : null;
  }

  acceptsTerminal(params: Record<string, unknown> | undefined): boolean {
    const threadId = readTrimmedString(params?.['threadId']);
    const turn = isRecord(params?.['turn']) ? params['turn'] : null;
    const turnId = readTrimmedString(params?.['turnId']) ?? readTrimmedString(turn?.['id']);
    return (
      threadId !== null &&
      turnId !== null &&
      threadId === this.root.threadId &&
      turnId === this.root.turnId
    );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readTrimmedString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const readNonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0
    ? value
    : null;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class CodexSdkClient {
  private commandOverride: string | null = null;
  private sessionId: string | null = null;
  private eventHandler: CodexSdkEventHandler | null = null;
  private serverRequestHandler: CodexSdkServerRequestHandler | null = null;
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingResolve: ((value: void) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  private activeAbortCleanup: (() => void) | null = null;
  private requestIdCounter = 0;
  private pendingAttachments: readonly RunAttachmentContent[] = [];
  private pendingPrompt: string | null = null;
  private pendingSkill: CodexSdkSkillTurnInput | null = null;
  private pendingStructuredInput: readonly CodexSdkTextInput[] | null = null;
  private pendingEffort: string | null = null;
  private pendingThreadRequestIds = new Set<number>();
  private pendingTurnStartRequestId: number | null = null;
  private pendingCompactRequests: Array<PendingCompactRequest> = [];
  private tokenUsageSnapshot: TokenUsageSnapshot | null = null;
  private tokenUsageHandler: CodexSdkTokenUsageHandler | null = null;
  private latestModel: string = '';
  private resolvePendingOnTokenUsageSnapshot = false;
  private readonly requestSettlement = new CodexRequestSettlement();
  /**
   * Resolved when the initialize response arrives.
   */
  private handshakeResolve: ((value: void) => void) | null = null;
  private handshakeReject: ((reason: Error) => void) | null = null;

  setCommand(command: string): void {
    this.commandOverride = command;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getRootTurnIdentity(): CodexSdkRootTurnIdentity | null {
    return this.requestSettlement.rootIdentity();
  }

  onEvent(handler: CodexSdkEventHandler | null): void {
    this.eventHandler = handler;
  }

  onTokenUsage(handler: CodexSdkTokenUsageHandler | null): void {
    this.tokenUsageHandler = handler;
  }

  onServerRequest(handler: CodexSdkServerRequestHandler | null): void {
    this.serverRequestHandler = handler;
  }

  async startSession(
    config: CodexSdkSessionConfig,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<void> {
    return this.bootstrapSession(config, options, null, () => {
      const configOverrides = mergeExtraWritableDirsIntoConfig(
        config.config,
        config.extraWritableDirs,
      );
      const requestId = this.writeRequest('thread/start', {
        cwd: config.cwd,
        ...(config.baseInstructions ? { baseInstructions: config.baseInstructions } : {}),
        ...(config.sandbox ? { sandbox: config.sandbox } : {}),
        ...(config.model ? { model: config.model } : {}),
        ...(config.serviceTier ? { serviceTier: config.serviceTier } : {}),
        ...(configOverrides ? { config: configOverrides } : {}),
      });
      if (requestId !== null) {
        this.pendingThreadRequestIds.add(requestId);
      }
    });
  }

  /**
   * Resume an existing Codex session by its native thread id. Spawns the
   * app-server, submits `thread/resume` carrying `threadId`, then relies on the
   * same `thread/started`→`turn/start` path as a fresh session to send the new
   * prompt and resolve on the next `turn/completed`.
   */
  async resumeSession(
    threadId: string,
    config: CodexSdkSessionConfig,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<void> {
    return this.bootstrapSession(config, options, threadId, () => {
      const configOverrides = mergeExtraWritableDirsIntoConfig(
        config.config,
        config.extraWritableDirs,
      );
      const requestId = this.writeRequest('thread/resume', {
        threadId,
        ...(config.sandbox ? { sandbox: config.sandbox } : {}),
        ...(config.model ? { model: config.model } : {}),
        ...(config.serviceTier ? { serviceTier: config.serviceTier } : {}),
        ...(configOverrides ? { config: configOverrides } : {}),
      });
      if (requestId !== null) {
        this.pendingThreadRequestIds.add(requestId);
      }
    });
  }

  /**
   * Resume an existing Codex thread only long enough to read replayed context
   * usage. Unlike {@link resumeSession}, this never sends `turn/start`; it
   * resolves when `thread/tokenUsage/updated` provides a usable context/window
   * snapshot.
   */
  async getContextUsageByResume(
    threadId: string,
    config: CodexSdkSessionConfig,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<ContextData> {
    if (this.process) {
      throw new Error('Session already active. Call disconnect() first.');
    }

    this.sessionId = null;
    this.requestIdCounter = 0;
    this.pendingAttachments = [];
    this.pendingPrompt = null;
    this.pendingSkill = null;
    this.pendingStructuredInput = null;
    this.pendingEffort = null;
    this.pendingThreadRequestIds.clear();
    this.pendingTurnStartRequestId = null;
    this.tokenUsageSnapshot = null;
    this.latestModel = '';
    this.resolvePendingOnTokenUsageSnapshot = true;
    this.spawnProcess(config);
    this.setupReadline();
    this.setupSignalHandler(options?.signal);

    try {
      await this.waitForInitializedResult(() => {
        const configOverrides = mergeExtraWritableDirsIntoConfig(
          config.config,
          config.extraWritableDirs,
        );
        const requestId = this.writeRequest('thread/resume', {
          threadId,
          ...(config.sandbox ? { sandbox: config.sandbox } : {}),
          ...(config.model ? { model: config.model } : {}),
          ...(config.serviceTier ? { serviceTier: config.serviceTier } : {}),
          ...(configOverrides ? { config: configOverrides } : {}),
        });
        if (requestId !== null) {
          this.pendingThreadRequestIds.add(requestId);
        }
      });
      return this.getContextUsage();
    } finally {
      this.resolvePendingOnTokenUsageSnapshot = false;
    }
  }

  /**
   * Perform the initialize → initialized handshake required by the Codex
   * app-server protocol. Must be called before any other request on a new
   * connection.
   *
   * Sequence:
   * 1. Send `initialize` request with clientInfo
   * 2. Wait for response (carries server metadata: userAgent, codexHome, etc.)
   * 3. Send `initialized` notification
   *
   * Any request sent before this handshake is rejected with "Not initialized".
   */
  private async performHandshake(): Promise<void> {
    const clientInfo: CodexSdkClientInfo = {
      name: 'hey_hey_cli',
      title: 'Hey Hey CLI',
      version: '0.1.0',
    };
    const capabilities: CodexSdkInitializeCapabilities = {
      experimentalApi: false,
      requestAttestation: false,
    };

    // Send initialize request and wait for response
    const handshakePromise = new Promise<void>((resolve, reject) => {
      this.handshakeResolve = resolve;
      this.handshakeReject = reject;
      this.writeRequest('initialize', {
        clientInfo,
        capabilities,
      });
    });

    await handshakePromise;

    // Send initialized notification
    this.writeNotification('initialized');
  }

  private async bootstrapSession(
    config: CodexSdkSessionConfig,
    options: { signal?: AbortSignal | undefined } | undefined,
    rootThreadId: string | null,
    sendInitial: () => void,
  ): Promise<void> {
    if (this.process) {
      throw new Error('Session already active. Call disconnect() first.');
    }

    this.sessionId = null;
    this.requestIdCounter = 0;
    this.pendingPrompt = config.prompt;
    this.pendingAttachments = config.attachments ?? [];
    this.pendingSkill = config.skill ?? null;
    this.pendingStructuredInput = config.structuredInput ?? null;
    this.pendingEffort = config.effort ?? null;
    this.pendingThreadRequestIds.clear();
    this.pendingTurnStartRequestId = null;
    this.tokenUsageSnapshot = null;
    this.latestModel = '';
    this.requestSettlement.begin(rootThreadId);
    this.spawnProcess(config);
    this.setupReadline();
    this.setupSignalHandler(options?.signal);

    return this.waitForInitializedResult(sendInitial);
  }

  private async waitForInitializedResult(sendInitial: () => void): Promise<void> {
    // Register the result before initialization and observe both promises
    // immediately. A spawn/pipe/handshake failure must reject the caller,
    // including when it happens before initialize has replied.
    const result = this.waitForResult();
    await Promise.all([result, this.performHandshake().then(sendInitial)]);
  }

  /**
   * Submit `thread/compact/start` to the running Codex app-server and wait for
   * the `thread/compacted` notification that signals the rewritten history
   * boundary. Rejects with {@link CodexCompactTimeoutError} if no boundary
   * arrives within `timeoutMs`. Throws with no active session or non-writable
   * stdin; rejects when a turn is in flight or the client is torn down.
   */
  async compact(options?: { timeoutMs?: number | undefined }): Promise<void> {
    if (!this.process || !this.sessionId) {
      throw new Error('No active session. Call startSession() first.');
    }
    if (!this.process.stdin?.writable) {
      throw new Error('Cannot compact: child stdin not writable');
    }
    if (this.pendingResolve !== null) {
      return Promise.reject(new Error('Cannot compact: a turn is in flight'));
    }

    // A pre-compaction reading must never be published as current context.
    this.tokenUsageSnapshot = null;
    const timeoutMs = options?.timeoutMs ?? COMPACT_DEFAULT_TIMEOUT_MS;

    return new Promise<void>((resolve, reject) => {
      const pending: PendingCompactRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removePendingCompact(pending);
          reject(new CodexCompactTimeoutError(timeoutMs));
        }, timeoutMs),
      };
      this.pendingCompactRequests.push(pending);

      this.writeRequest('thread/compact/start', { threadId: this.sessionId! });
    });
  }

  /**
   * Send a JSON-RPC ClientResponse for a ServerRequest the app-server is
   * blocked on (e.g. permission approvals). The `id` must match the request's
   * raw id. Throws when stdin is unavailable; never queues.
   */
  submitClientResponse(id: string | number, result: Record<string, unknown>): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable) {
      throw new Error('Cannot submit ClientResponse: child stdin not writable');
    }
    stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  async disconnect(): Promise<void> {
    this.sessionId = null;

    const proc = this.process;
    if (!proc) return;

    this.rejectPending(new Error('Disconnected'));
    this.rejectPendingCompactRequests(() => new Error('Disconnected'));

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

  private spawnProcess(config: CodexSdkSessionConfig): void {
    const targetCommand = this.commandOverride ? process.execPath : 'codex';
    const targetArgs = this.commandOverride ? [this.commandOverride] : ['app-server'];

    console.debug('[CodexSdkClient] process spawn started', {
      command: targetCommand,
      cwd: config.cwd,
    });

    this.process = spawn(targetCommand, targetArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd,
      ...(config.toolExecutionHooks
        ? { env: { ...process.env, ...config.toolExecutionHooks.environment } }
        : {}),
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes('Error') || text.includes('error')) {
        console.error('[CodexSdkClient] stderr:', text.trim());
      }
    });

    this.process.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      const error = new Error(
        `Process stdin error${err.code ? ` (${err.code})` : ''}: ${err.message}`,
      );
      this.rejectPending(error);
      this.rejectPendingCompactRequests(() => error);
    });

    this.process.on('exit', (code) => {
      this.rejectPending(new Error(`Process exited unexpectedly (code=${String(code)})`));
      this.rejectPendingCompactRequests(
        () => new Error(`Process exited unexpectedly (code=${String(code)})`),
      );
      this.cleanup();
    });

    this.process.on('error', (err) => {
      console.error('[CodexSdkClient] process spawn failed', {
        command: targetCommand,
        cwd: config.cwd,
        error: err.message,
      });
      this.rejectPending(new Error(`Process error: ${err.message}`));
      this.rejectPendingCompactRequests(() => new Error(`Process error: ${err.message}`));
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

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    // Distinguish JSON-RPC shapes by field presence:
    // - ServerRequest: has both method AND id
    // - Notification: has method, NO id
    // - Response: has id AND result, NO method (correlation reply to ClientRequest)
    // - Error: has error AND id, NO method (error reply to ClientRequest)

    const hasMethod = typeof parsed['method'] === 'string';
    const hasId = typeof parsed['id'] !== 'undefined';
    const hasResult = typeof parsed['result'] !== 'undefined';
    const hasError = typeof parsed['error'] !== 'undefined';

    if (hasMethod && hasId) {
      // ServerRequest — carries both method and id (permission/approval requests)
      this.serverRequestHandler?.({
        id: parsed['id'] as string | number,
        method: parsed['method'] as string,
        params: parsed['params'] as Record<string, unknown> | undefined,
      });
      return;
    }

    // Response or Error from the server — correlation replies to ClientRequests.
    // Most are dropped, but the initialize response is tracked for the handshake.
    if (hasResult || hasError) {
      // Check if this is the initialize response for the handshake
      const requestId = parsed['id'] as number;
      // The initialize request is always the first request, so its id is 1
      if (requestId === 1 && this.handshakeResolve !== null) {
        if (hasError) {
          const error = parsed['error'] as Record<string, unknown>;
          this.rejectPending(new Error(`Initialize failed: ${String(error['message'] ?? error)}`));
          return;
        }
        // Resolve the handshake - the response carries server metadata we don't need to store
        this.handshakeResolve();
        this.handshakeResolve = null;
        this.handshakeReject = null;
        console.debug('[CodexSdkClient] initialize handshake completed');
        return;
      }

      if (this.pendingThreadRequestIds.has(requestId)) {
        this.pendingThreadRequestIds.delete(requestId);
        if (hasError) {
          const error = parsed['error'] as Record<string, unknown>;
          this.rejectPending(
            new Error(`Thread request failed: ${String(error['message'] ?? error)}`),
          );
          return;
        }
        const threadId = this.readThreadIdFromResult(parsed['result']);
        if (threadId !== null) {
          this.startPendingTurn(threadId);
          return;
        }
      }

      if (requestId === this.pendingTurnStartRequestId) {
        this.pendingTurnStartRequestId = null;
        if (hasError) {
          const error = parsed['error'] as Record<string, unknown>;
          this.rejectPending(new Error(`Turn start failed: ${String(error['message'] ?? error)}`));
          return;
        }
        const turnId = this.readTurnIdFromResult(parsed['result']);
        if (turnId === null) {
          this.rejectPending(new Error('Turn start response did not include a turn id'));
          return;
        }
        if (!this.requestSettlement.observeTurnStartResponse(turnId)) {
          this.rejectPending(new Error('Turn start response did not match the active root turn'));
        }
        return;
      }

      console.debug('[CodexSdkClient] dropping server reply:', hasResult ? 'Response' : 'Error', {
        id: parsed['id'],
        ...(hasResult ? { result: parsed['result'] } : { error: parsed['error'] }),
      });
      return;
    }

    if (!hasMethod) {
      // Malformed: neither method nor result/error present
      console.warn('[CodexSdkClient] malformed message (no method, result, or error):', trimmed);
      return;
    }

    // ServerNotification — no id
    const event: CodexSdkEvent = {
      method: parsed['method'] as string,
      params: parsed['params'] as Record<string, unknown> | undefined,
    };

    if (event.method === 'thread/started') {
      const thread = (
        event.params as { thread?: { id?: string | undefined } | undefined } | undefined
      )?.thread;
      if (thread?.id) {
        this.startPendingTurn(thread.id);
      }
    }

    if (event.method === 'turn/started') {
      if (!this.requestSettlement.observeTurnStarted(event.params)) {
        this.rejectPending(
          new Error('Turn started notification did not match the active root turn'),
        );
        return;
      }
    }

    if (event.method === 'turn/completed' && this.requestSettlement.acceptsTerminal(event.params)) {
      this.resolvePending();
    }

    if (
      event.method === 'error' &&
      event.params?.['willRetry'] !== true &&
      this.requestSettlement.acceptsTerminal(event.params)
    ) {
      const error = isRecord(event.params?.['error']) ? event.params['error'] : null;
      this.rejectPending(
        new Error(readTrimmedString(error?.['message']) ?? 'Codex provider turn failed.'),
      );
    }

    if (event.method === 'thread/compacted' && event.params?.['threadId'] === this.sessionId) {
      // Explicit requests invalidate before submission; provider-initiated
      // compaction has no local request and invalidates at its boundary.
      if (this.pendingCompactRequests.length === 0) this.tokenUsageSnapshot = null;
      this.resolvePendingCompactRequests();
    }

    if (event.method === 'thread/tokenUsage/updated') {
      this.captureTokenUsageSnapshot(event.params);
    }

    if (event.method === 'thread/settings/updated') {
      this.captureModelFromSettings(event.params);
    }

    this.eventHandler?.(event);
  }

  private captureTokenUsageSnapshot(params: Record<string, unknown> | undefined): void {
    if (!this.sessionId || params?.['threadId'] !== this.sessionId) return;
    const tokenUsage = params && isRecord(params['tokenUsage']) ? params['tokenUsage'] : null;
    const last = tokenUsage && isRecord(tokenUsage['last']) ? tokenUsage['last'] : null;
    const total = tokenUsage && isRecord(tokenUsage['total']) ? tokenUsage['total'] : null;
    const activeContextTotal = last?.['totalTokens'];
    const window = tokenUsage?.['modelContextWindow'];

    if (total) {
      const outputTokens = readNonNegativeInteger(total['outputTokens']);
      const reportedInputTokens = readNonNegativeInteger(total['inputTokens']);
      const cacheReadInputTokens = readNonNegativeInteger(total['cachedInputTokens']);
      const hasContradictoryInputTotals =
        reportedInputTokens !== null &&
        cacheReadInputTokens !== null &&
        cacheReadInputTokens > reportedInputTokens;
      const usableCacheReadInputTokens = hasContradictoryInputTotals ? null : cacheReadInputTokens;
      if (outputTokens !== null) {
        this.tokenUsageHandler?.({
          inputTokens:
            reportedInputTokens !== null && usableCacheReadInputTokens !== null
              ? reportedInputTokens - usableCacheReadInputTokens
              : null,
          outputTokens,
          cacheCreationInputTokens: null,
          cacheReadInputTokens: usableCacheReadInputTokens,
          cacheAvailability: usableCacheReadInputTokens === null ? 'unsupported' : 'partial',
        });
      }
    }

    const contextTotal = readNonNegativeInteger(activeContextTotal);
    if (contextTotal === null) return;
    const reportedWindow = readNonNegativeInteger(window);
    this.tokenUsageSnapshot = {
      totalTokens: contextTotal,
      // ContextData uses zero for an unreported window. The publisher omits
      // it, allowing the capsule's contract-defined window fallback.
      modelContextWindow: reportedWindow ?? 0,
    };
    if (this.resolvePendingOnTokenUsageSnapshot) {
      this.resolvePending();
    }
  }

  private captureModelFromSettings(params: Record<string, unknown> | undefined): void {
    if (params?.['threadId'] !== this.sessionId) return;
    const model = (
      params as { threadSettings?: { model?: unknown | undefined } | undefined } | undefined
    )?.threadSettings?.model;
    if (typeof model === 'string') {
      this.latestModel = model;
    }
  }

  /**
   * Synthesize the {@link ContextData} shape from the most recently
   * observed `thread/tokenUsage/updated` (and optionally `thread/settings/updated`)
   * notifications. Throws when no active session exists or no usable token-usage
   * snapshot has arrived yet — the design doc forbids fabricating a zero
   * snapshot. Codex exposes only an active-context total for this purpose (no
   * per-category breakdown), so the
   * `categories`/`gridRows`/`memoryFiles`/`mcpTools`/`agents` arrays are empty
   * and `isAutoCompactEnabled` is false (compaction is driven by an explicit
   * `thread/compact/start` request, not auto-triggered).
   */
  getContextUsage(): ContextData {
    if (!this.process || !this.sessionId) {
      throw new Error('No active session. Call startSession() first.');
    }
    const snapshot = this.tokenUsageSnapshot;
    if (!snapshot) {
      throw new CodexNoContextSnapshotError(
        'No token usage snapshot observed yet on this session.',
      );
    }

    const totalTokens = snapshot.totalTokens;
    const maxTokens = snapshot.modelContextWindow;
    const percentage = maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0;

    return {
      categories: [],
      totalTokens,
      maxTokens,
      rawMaxTokens: maxTokens,
      percentage,
      gridRows: [],
      model: this.latestModel,
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: null,
    };
  }

  // -- Private: promise management ------------------------------------------

  private waitForResult(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  private resolvePending(): void {
    this.activeAbortCleanup?.();
    this.activeAbortCleanup = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject = null;
    resolve?.();
  }

  private rejectPending(error: Error): void {
    this.activeAbortCleanup?.();
    this.activeAbortCleanup = null;
    const reject = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    const rejectHandshake = this.handshakeReject;
    this.handshakeResolve = null;
    this.handshakeReject = null;
    reject?.(error);
    rejectHandshake?.(error);
  }

  private setupSignalHandler(signal?: AbortSignal): void {
    if (!signal) return;

    const onAbort = () => {
      this.rejectPending(new Error('Aborted'));
      this.rejectPendingCompactRequests(() => new Error('Aborted'));
      void this.disconnect();
    };

    signal.addEventListener('abort', onAbort);
    this.activeAbortCleanup = () => signal.removeEventListener('abort', onAbort);
  }

  // -- Private: writing -----------------------------------------------------

  private writeRequest(method: string, params: Record<string, unknown>): number | null {
    const stdin = this.process?.stdin;
    if (!stdin?.writable || stdin.destroyed) {
      this.rejectPending(new Error(`Cannot send ${method}: process stdin not writable`));
      return null;
    }
    const id = ++this.requestIdCounter;
    stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return id;
  }

  private readThreadIdFromResult(result: unknown): string | null {
    if (!result || typeof result !== 'object') {
      return null;
    }
    const thread = (result as { thread?: { id?: unknown | undefined } | undefined }).thread;
    return typeof thread?.id === 'string' && thread.id.length > 0 ? thread.id : null;
  }

  private readTurnIdFromResult(result: unknown): string | null {
    if (!result || typeof result !== 'object') {
      return null;
    }
    const turn = (result as { turn?: { id?: unknown | undefined } | undefined }).turn;
    return typeof turn?.id === 'string' && turn.id.length > 0 ? turn.id : null;
  }

  private startPendingTurn(threadId: string): void {
    if (!this.requestSettlement.observeRootThread(threadId)) {
      return;
    }
    this.sessionId = threadId;
    if (
      this.pendingPrompt === null &&
      this.pendingSkill === null &&
      this.pendingStructuredInput === null
    ) {
      return;
    }

    const attachments = this.pendingAttachments;
    this.pendingAttachments = [];
    const prompt = this.pendingPrompt;
    const skill = this.pendingSkill;
    const structuredInput = this.pendingStructuredInput;
    const effort = this.pendingEffort;
    this.pendingPrompt = null;
    this.pendingSkill = null;
    this.pendingStructuredInput = null;
    this.pendingEffort = null;
    this.pendingTurnStartRequestId = this.writeRequest('turn/start', {
      threadId,
      input: [
        ...(skill ? [skill] : []),
        ...(structuredInput
          ? structuredInput.map((item) => ({
              type: 'text' as const,
              text: item.text,
              text_elements: [],
            }))
          : prompt !== null
            ? [{ type: 'text' as const, text: prompt, text_elements: [] }]
            : []),
        ...codexAttachmentInput(attachments),
      ],
      ...(effort ? { effort } : {}),
    });
  }

  /**
   * Send a JSON-RPC notification (message without an `id` field).
   * Used for the `initialized` notification in the handshake.
   */
  private writeNotification(method: string, params?: Record<string, unknown>): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable || stdin.destroyed) {
      throw new Error(`Cannot send ${method}: process stdin not writable`);
    }
    stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  // -- Private: pending compact management ------------------------------------

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

  // -- Private: cleanup -------------------------------------------------------

  private cleanup(): void {
    this.readline?.close();
    this.readline = null;
    this.process = null;
    this.pendingAttachments = [];
    this.pendingPrompt = null;
    this.pendingSkill = null;
    this.pendingStructuredInput = null;
    this.pendingEffort = null;
    this.pendingThreadRequestIds.clear();
    this.pendingTurnStartRequestId = null;
    this.tokenUsageSnapshot = null;
    this.latestModel = '';
    this.resolvePendingOnTokenUsageSnapshot = false;
    this.handshakeResolve = null;
    this.handshakeReject = null;
    this.rejectPendingCompactRequests(() => new Error('Disconnected'));
  }
}

export function codexAttachmentInput(attachments: readonly RunAttachmentContent[]) {
  return attachments.map((content) =>
    content.kind === 'text'
      ? {
          type: 'text' as const,
          text: 'File: ' + content.fileName + '\n' + content.text,
          text_elements: [],
        }
      : {
          type: 'image' as const,
          url: 'data:' + content.mediaType + ';base64,' + content.data,
        },
  );
}
