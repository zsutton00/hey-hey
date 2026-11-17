import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';
import type { ToolExecutionHookLaunch } from '../../../agent-runtime/index';
import { executionHookCommand } from './hook-command';
import type { ExecutionCaptureSession } from './capture-session';
import type { ServerLogger } from '../../../server/logger';

const hookInputSchema = z.object({
  hook_event_name: z.enum(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']),
  session_id: z.string().min(1),
  tool_use_id: z.string().min(1),
  tool_name: z.string().min(1),
  turn_id: z.string().min(1).optional(),
  exit_code: z.number().nullable().optional(),
  tool_input: z.unknown().optional(),
});
export type HookInput = z.infer<typeof hookInputSchema>;

/** Large enough for a whole apply_patch envelope; a bigger body aborts and the edit stays approximate. */
const MAX_HOOK_BODY_CHARACTERS = 4 * 1024 * 1024;

/**
 * The provider blocks the tool until this channel responds (capture is limited to two seconds),
 * so a slow response looks to the agent like a command that never returns.
 */
const SLOW_HOOK_MS = 2000;
const PENDING_HOOK_WARNING_INTERVAL_MS = 10000;

const hookSummary = (text: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = hookInputSchema.partial().safeParse(parsed);
    if (!result.success) {
      return { bodyCharacters: text.length };
    }
    return {
      hookEvent: result.data.hook_event_name,
      providerSessionId: result.data.session_id,
      providerTurnId: result.data.turn_id,
      toolCallId: result.data.tool_use_id,
      toolName: result.data.tool_name,
      bodyCharacters: text.length,
    };
  } catch {
    return { bodyCharacters: text.length, bodyParseable: false };
  }
};

/** Private per-provider-process channel. It accepts no cwd, roots, Run IDs, or file bytes. */
export class HookChannel {
  private server: http.Server | null = null;
  private launch: ToolExecutionHookLaunch | null = null;

  public constructor(
    private readonly session: ExecutionCaptureSession,
    private readonly logger: ServerLogger,
  ) {}

  public async open(): Promise<ToolExecutionHookLaunch> {
    if (this.launch) return this.launch;
    const token = randomBytes(32).toString('hex');
    const server = http.createServer((request, response) => {
      if (request.method !== 'POST' || request.headers.authorization !== token) {
        this.logger.warn('execution_capture.hook_request_rejected', {
          method: request.method,
          reason: request.method !== 'POST' ? 'method_not_allowed' : 'token_mismatch',
        });
        response.writeHead(403).end();
        return;
      }
      const receivedAt = Date.now();
      let summary: Record<string, unknown> = {};
      const pendingWarning = setInterval(() => {
        this.logger.warn('execution_capture.hook_response_pending', {
          ...summary,
          pendingMs: Date.now() - receivedAt,
          bodyComplete: request.complete,
        });
      }, PENDING_HOOK_WARNING_INTERVAL_MS);
      pendingWarning.unref();
      const abort = new AbortController();
      const deadline = setTimeout(() => {
        this.logger.warn('execution_capture.hook_response_timeout', {
          ...summary,
          elapsedMs: Date.now() - receivedAt,
          reason: 'capture-budget-exceeded',
        });
        abort.abort();
        clearInterval(pendingWarning);
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      }, SLOW_HOOK_MS);
      deadline.unref();
      response.on('close', () => {
        clearInterval(pendingWarning);
        clearTimeout(deadline);
        if (!response.writableEnded) {
          this.logger.warn('execution_capture.hook_client_disconnected', {
            ...summary,
            elapsedMs: Date.now() - receivedAt,
          });
          abort.abort();
        }
      });
      let text = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        text += chunk;
        if (text.length > MAX_HOOK_BODY_CHARACTERS) {
          this.logger.warn('execution_capture.hook_body_too_large', {
            bodyCharacters: text.length,
            limit: MAX_HOOK_BODY_CHARACTERS,
          });
          abort.abort();
          request.destroy();
        }
      });
      request.on('error', (error) => {
        this.logger.warn('execution_capture.hook_request_error', {
          ...summary,
          elapsedMs: Date.now() - receivedAt,
          error,
        });
        abort.abort();
      });
      request.on('end', () => {
        summary = hookSummary(text);
        this.logger.debug('execution_capture.hook_request_received', {
          ...summary,
          bodyReadMs: Date.now() - receivedAt,
        });
        void (async () => {
          try {
            const input = hookInputSchema.parse(JSON.parse(text));
            await this.session.handle(input, abort.signal);
          } catch (error) {
            this.logger.warn('execution_capture.hook_handle_failed', {
              ...summary,
              elapsedMs: Date.now() - receivedAt,
              error,
            });
            await this.session.transportFailure(error);
          } finally {
            clearInterval(pendingWarning);
            clearTimeout(deadline);
            // Never approve, deny, rewrite, or add model-visible output.
            if (!response.writableEnded) {
              response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
            }
            const elapsedMs = Date.now() - receivedAt;
            const fields = { ...summary, elapsedMs, aborted: abort.signal.aborted };
            if (elapsedMs >= SLOW_HOOK_MS) {
              this.logger.warn('execution_capture.hook_response_slow', fields);
            } else {
              this.logger.debug('execution_capture.hook_responded', fields);
            }
          }
        })().catch((error: unknown) => {
          this.logger.warn('execution_capture.hook_response_failed', { ...summary, error });
          response.end('{}');
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Capture listener has no loopback port');
    this.server = server;
    this.launch = {
      command: executionHookCommand(),
      environment: {
        HEY_HEY_CAPTURE_URL: `http://127.0.0.1:${address.port}/`,
        HEY_HEY_CAPTURE_TOKEN: token,
      },
    };
    return this.launch;
  }

  public async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.launch = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
