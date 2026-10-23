import type { Request, Response } from 'express';
import type { ServerLogger } from '../../server/logger';
import { RunRegistry } from '../../run/run-registry';
import { PlatformMcpForwarder } from './forwarder';
import type { JsonRpcRequest, JsonValue } from './session';
import type { OAuthClient } from '../../auth/index';
import { childPlatformMcpProxies } from './child-proxy-registry';

const failure = (
  id: string | number | null,
  code: number,
  message: string,
): { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } } => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

const isJsonObject = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRequest = (value: JsonValue): JsonRpcRequest | null => {
  if (!isJsonObject(value)) return null;
  const jsonrpc = value['jsonrpc'];
  const method = value['method'];
  const idValue = value['id'];
  const params = value['params'];
  const id =
    typeof idValue === 'string' || typeof idValue === 'number' || idValue === null ? idValue : null;
  if (jsonrpc !== '2.0' || typeof method !== 'string') return null;
  if (params !== undefined && !isJsonObject(params)) return null;
  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  };
};

export class PlatformMcpProxyHttpController {
  private readonly forwarder: PlatformMcpForwarder;

  public constructor(
    private readonly runRegistry: RunRegistry,
    oauthClient: OAuthClient,
    private readonly logger: ServerLogger,
    fetchImpl: typeof fetch = fetch,
    endpointUrl?: string,
  ) {
    this.forwarder = new PlatformMcpForwarder({
      oauthClient,
      logger,
      fetchImpl,
      ...(endpointUrl !== undefined ? { endpointUrl } : {}),
    });
  }

  /** Bound because Express receives this method as a route callback. */
  public readonly handle = async (req: Request, res: Response): Promise<void> => {
    const runIdParam = req.params['runId'];
    const turnIdParam = req.params['turnId'];
    const tokenParam = req.params['token'];
    const runId = typeof runIdParam === 'string' ? runIdParam : null;
    const turnId = typeof turnIdParam === 'string' ? turnIdParam : null;
    const token = typeof tokenParam === 'string' ? tokenParam : null;
    if (!runId || !turnId || !token) {
      res.status(400).json(failure(null, -32600, 'Missing scoped platform MCP URL path fields'));
      return;
    }

    const run = this.runRegistry.get(runId);
    const activeTurn = run?.activeTurn ?? null;
    const turnProxy = activeTurn?.platformMcpProxy ?? null;
    const proxy = turnProxy?.matches({ turnId, token })
      ? turnProxy
      : childPlatformMcpProxies.find({ runId, turnId, token });
    if (!proxy) {
      res.status(404).json(failure(null, -32001, 'No active scoped platform MCP proxy for URL'));
      return;
    }

    const request = parseRequest(req.body);
    if (!request) {
      res.status(400).json(failure(null, -32600, 'Invalid JSON-RPC request'));
      return;
    }

    this.logger.debug('local.platform_mcp_proxy.request.accepted', {
      runId,
      turnId,
      method: request.method,
    });

    try {
      const result = await proxy.handleJsonRpc(request, this.forwarder);
      if (result.body === undefined) {
        res.status(result.statusCode).end();
        return;
      }
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      this.logger.error('local.platform_mcp_proxy.endpoint_error', {
        runId,
        turnId,
        method: request.method,
        error,
      });
      res.json(
        failure(
          request.id,
          -32603,
          error instanceof Error ? error.message : 'Platform MCP proxy internal error',
        ),
      );
    }
  };
}
