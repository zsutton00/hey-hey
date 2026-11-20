import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';

import type { ServerLogger } from '../../../server/logger';
import {
  acpResultSchemas,
  errorResponseSchema,
  inboundCallSchema,
  responseEnvelope,
  type AcpInboundCall,
} from './acp-schemas';

type AcpMethod = keyof typeof acpResultSchemas;
type AcpPermissionRequest = Extract<AcpInboundCall, { method: 'session/request_permission' }>;
type AcpUpdateParams = Extract<AcpInboundCall, { method: 'session/update' }>['params'];
type AcpOption = AcpPermissionRequest['params']['options'][number];

export interface AcpHttpServer {
  type: 'http';
  name: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
}

interface AcpSessionConfig {
  cwd: string;
  mcpServers: AcpHttpServer[];
}

export type AcpPromptContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export class AcpRequestError extends Error {
  constructor(
    readonly method: AcpMethod,
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'AcpRequestError';
  }
}

interface PendingRequest {
  method: AcpMethod;
  accept: (frame: unknown) => z.ZodError | null;
  reject: (error: Error) => void;
  recoverMalformedReply: () => void;
}

const frameDiscriminator = z.object({
  method: z.string().optional(),
  id: z.unknown().optional(),
  error: z.unknown().optional(),
});
const REQUEST_TIMEOUT_MS = 30_000;

export class AntigravityAcpClient {
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private readonly requests = new Map<number, PendingRequest>();
  private nextId = 0;
  private closed = false;

  constructor(
    cwd: string,
    private readonly logger: ServerLogger,
    private readonly onUpdate: (update: AcpUpdateParams) => void,
    private readonly onPermission: (request: AcpPermissionRequest) => void,
    launchArgs: string[] = [],
    executable = 'agy',
  ) {
    this.child = spawn(executable, ['acp', '--process-per-session', ...launchArgs], {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.child.on('spawn', () => logger.debug('antigravity.acp.spawn', { pid: this.child.pid }));
    this.child.on('error', (error) => this.close(error));
    this.child.stdin.on('error', (error) => this.close(error));
    this.child.on('exit', (code, signal) => {
      logger.debug('antigravity.acp.exit', { code, signal });
      this.close(new Error(`ACP exited (${code ?? signal})`));
    });

    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.receive(line));
  }

  initialize() {
    return this.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  }

  createSession(config: AcpSessionConfig) {
    return this.request('session/new', { ...config });
  }

  resumeSession(sessionId: string, config: AcpSessionConfig) {
    return this.request('session/resume', { sessionId, ...config });
  }

  setMode(sessionId: string, modeId: string) {
    return this.request('session/set_mode', { sessionId, modeId });
  }

  prompt(sessionId: string, prompt: AcpPromptContent[]) {
    return this.request('session/prompt', { sessionId, prompt });
  }

  cancel(sessionId: string): void {
    this.logger.debug('antigravity.acp.cancel', { sessionId });
    this.send({ method: 'session/cancel', params: { sessionId } });
  }

  respondToPermission(id: AcpPermissionRequest['id'], option: AcpOption | undefined): void {
    const outcome = option
      ? { outcome: 'selected', optionId: option.optionId }
      : { outcome: 'cancelled' };
    this.logger.debug('antigravity.acp.permission_response', { id, kind: option?.kind });
    this.send({ id, result: { outcome } });
  }

  dispose(): void {
    this.close(new Error('ACP client disposed'));
  }

  private close(error: Error): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.logger.debug('antigravity.acp.closed', { reason: error.message });
    for (const pending of this.requests.values()) {
      pending.reject(error);
    }
    this.requests.clear();
    this.child.kill();
  }

  private send(frame: Record<string, unknown>): void {
    if (this.closed) {
      throw new Error('ACP process is closed');
    }
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
  }

  private request<M extends AcpMethod>(
    method: M,
    params: Record<string, unknown>,
  ): Promise<z.output<(typeof acpResultSchemas)[M]>> {
    const id = ++this.nextId;
    const schema = responseEnvelope.extend({ result: z.unknown() });

    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timeout);
        this.requests.delete(id);
      };
      const recoverMalformedReply = () => {
        // Prompts are normally unbounded. Once a terminal reply is malformed,
        // allow a bounded window for a replacement without extending it on repeats.
        timeout ??= setTimeout(() => {
          this.requests
            .get(id)
            ?.reject(
              new Error(`ACP ${method} received a malformed reply and no valid replacement`),
            );
        }, REQUEST_TIMEOUT_MS);
        timeout.unref();
      };
      this.requests.set(id, {
        method,
        recoverMalformedReply,
        accept: (frame) => {
          const parsed = schema.safeParse(frame);
          if (!parsed.success) {
            return parsed.error;
          }
          const result = acpResultSchemas[method].safeParse(parsed.data.result);
          if (!result.success) {
            return result.error;
          }
          cleanup();
          resolve(result.data);
          return null;
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      if (method !== 'session/prompt') {
        timeout = setTimeout(
          () => this.requests.get(id)?.reject(new Error(`ACP ${method} timed out`)),
          REQUEST_TIMEOUT_MS,
        );
        timeout.unref();
      }

      this.logger.debug('antigravity.acp.request', { id, method });
      try {
        this.send({ id, method, params });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  private receive(line: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      this.logger.warn('antigravity.acp.invalid_json', { bytes: Buffer.byteLength(line) });
      return;
    }

    const shape = frameDiscriminator.safeParse(frame);
    if (!shape.success) {
      this.logInvalid(shape.error);
      return;
    }

    const { method, id, error } = shape.data;
    if (method !== undefined) {
      const parsed = inboundCallSchema.safeParse(frame);
      if (!parsed.success) {
        this.logInvalid(parsed.error, { id, method });
        return;
      }

      if (parsed.data.method === 'session/update') {
        this.onUpdate(parsed.data.params);
      } else {
        this.logger.debug('antigravity.acp.permission_request', {
          id,
          sessionId: parsed.data.params.sessionId,
        });
        this.onPermission(parsed.data);
      }
      return;
    }

    const pending = typeof id === 'number' ? this.requests.get(id) : undefined;
    if (!pending) {
      this.logger.warn('antigravity.acp.unmatched_response', { id });
      return;
    }

    this.logger.debug('antigravity.acp.response', { id, method: pending.method });
    if (error !== undefined) {
      const parsed = errorResponseSchema.safeParse(frame);
      if (!parsed.success) {
        this.logInvalid(parsed.error, { id, method: pending.method });
        pending.recoverMalformedReply();
        return;
      }
      pending.reject(
        new AcpRequestError(pending.method, parsed.data.error.code, parsed.data.error.message),
      );
      return;
    }

    const failure = pending.accept(frame);
    if (failure) {
      this.logInvalid(failure, { id, method: pending.method });
      pending.recoverMalformedReply();
    }
  }

  private logInvalid(error: z.ZodError, identity: Record<string, unknown> = {}): void {
    this.logger.warn('antigravity.acp.invalid_frame', {
      ...identity,
      issues: error.issues.map(({ code, path }) => ({ code, path })),
    });
  }
}
