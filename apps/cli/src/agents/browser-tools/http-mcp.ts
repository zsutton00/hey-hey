import type { Request, Response } from 'express';
import { z } from 'zod';
import { browserCallSchema, BROWSER_TOOLS } from '../../browser/browser-tool-schemas';
import type { BrowserTools } from '../../browser/browser-tools';
import type { BrowserMcpAccess } from './browser-mcp-access';
import type { ServerLogger } from '../../server/logger';
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);
const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(jsonSchema).optional(),
});

export class BrowserToolsHttpController {
  public constructor(
    private readonly access: BrowserMcpAccess,
    private readonly tools: BrowserTools,
    private readonly logger: ServerLogger,
  ) {}
  public readonly handle = async (req: Request, res: Response): Promise<void> => {
    const error = (id: string | number | null, code: number, message: string, status = 200) =>
      res.status(status).json({ jsonrpc: '2.0', id, error: { code, message } });
    const host = req.headers.host ?? '';
    if (
      !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u.test(host) ||
      req.headers.origin !== undefined ||
      (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'none')
    ) {
      error(null, -32001, 'Browser-originated requests are forbidden', 403);
      return;
    }
    const token = req.params['token'];
    const mount = typeof token === 'string' ? this.access.resolve(token) : null;
    if (!mount) {
      error(null, -32001, 'No active browser access', 404);
      return;
    }
    try {
      if (!(await this.access.enabled())) {
        error(null, -32001, 'Shared Browser is disabled', 403);
        return;
      }
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        error(null, -32600, 'Invalid JSON-RPC request', 400);
        return;
      }
      const request = parsed.data;
      const id = request.id ?? null;
      const success = (result: object) => res.json({ jsonrpc: '2.0', id, result });
      this.logger.debug('browser.mcp.request', {
        runId: mount.runId,
        method: [
          'initialize',
          'ping',
          'notifications/initialized',
          'tools/list',
          'tools/call',
        ].includes(request.method)
          ? request.method
          : 'unsupported',
      });
      switch (request.method) {
        case 'initialize':
          success({
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'heyhey-browser', version: '1.0.0' },
          });
          return;
        case 'ping':
          success({});
          return;
        case 'notifications/initialized':
          res.status(202).end();
          return;
        case 'tools/list':
          success({ tools: BROWSER_TOOLS });
          return;
        case 'tools/call': {
          const call = browserCallSchema.safeParse(request.params);
          if (!call.success) {
            error(id, -32602, 'Invalid browser tool arguments');
            return;
          }
          success(
            await this.tools.execute(mount.runId, mount.projectId, call.data, () =>
              this.access.admitted(mount),
            ),
          );
          return;
        }
        default:
          error(id, -32601, 'Method not found');
      }
    } catch {
      this.logger.warn('browser.mcp.request_failed', { runId: mount.runId });
      error(null, -32603, 'Browser request failed');
    }
  };
}
