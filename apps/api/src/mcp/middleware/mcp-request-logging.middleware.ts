import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Diagnostic-only: logs one line per inbound `/mcp` JSON-RPC request so we can
 * see, on a real (and a resumed) agent turn, whether the client actually calls
 * `tools/list`/`tools/call`, which identifying headers arrived, and the
 * response status. Pairs with the cli `session.starting` log to bisect why a
 * resumed turn loses the heyhey-platform tools. Never throws — logging must not
 * affect request handling.
 */
@Injectable()
export class McpRequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('McpRequestLogging');

  use(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = req.body as
        | { method?: unknown; id?: unknown; params?: { name?: unknown } }
        | undefined;
      const method = typeof body?.method === 'string' ? body.method : null;
      const toolName =
        method === 'tools/call' && typeof body?.params?.name === 'string'
          ? body.params.name
          : null;
      const has = (h: string): boolean => {
        const v = req.headers[h];
        return typeof v === 'string' && v.length > 0;
      };
      const startedAt = Date.now();
      res.on('finish', () => {
        this.logger.log(
          JSON.stringify({
            event: 'mcp.request',
            httpMethod: req.method,
            jsonrpcMethod: method,
            jsonrpcId: body?.id ?? null,
            toolName,
            status: res.statusCode,
            durationMs: Date.now() - startedAt,
            headers: {
              authorization: has('authorization'),
              'x-organization-id': has('x-organization-id'),
              'x-agent-session-id': has('x-agent-session-id'),
              'x-conversation-id': has('x-conversation-id'),
              'x-message-id': has('x-message-id'),
            },
          }),
        );
      });
    } catch {
      // Diagnostic logging must never break the request path.
    }
    next();
  }
}
