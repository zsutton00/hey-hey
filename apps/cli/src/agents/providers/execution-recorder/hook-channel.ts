import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';
import type { ToolExecutionHookLaunch } from '@hey-hey/ui-common/agents';
import { executionHookCommand } from './hook-command';
import type { ExecutionCaptureSession } from './capture-session';

const hookInputSchema = z.object({
  hook_event_name: z.enum(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']),
  session_id: z.string().min(1),
  tool_use_id: z.string().min(1),
  tool_name: z.string().min(1),
  turn_id: z.string().min(1).optional(),
  exit_code: z.number().nullable().optional(),
});
export type HookInput = z.infer<typeof hookInputSchema>;

/** Private per-provider-process channel. It accepts no cwd, roots, Run IDs, or file bytes. */
export class HookChannel {
  private server: http.Server | null = null;
  private launch: ToolExecutionHookLaunch | null = null;

  public constructor(private readonly session: ExecutionCaptureSession) {}

  public async open(): Promise<ToolExecutionHookLaunch> {
    if (this.launch) return this.launch;
    const token = randomBytes(32).toString('hex');
    const server = http.createServer((request, response) => {
      if (request.method !== 'POST' || request.headers.authorization !== token) {
        response.writeHead(403).end();
        return;
      }
      const abort = new AbortController();
      response.on('close', () => {
        if (!response.writableEnded) abort.abort();
      });
      let text = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        text += chunk;
        if (text.length > 16384) {
          abort.abort();
          request.destroy();
        }
      });
      request.on('error', () => abort.abort());
      request.on('end', () => {
        void (async () => {
          try {
            const input = hookInputSchema.parse(JSON.parse(text));
            await this.session.handle(input, abort.signal);
          } catch {
            await this.session.transportFailure();
          } finally {
            // Never approve, deny, rewrite, or add model-visible output.
            response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
          }
        })().catch(() => response.end('{}'));
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
