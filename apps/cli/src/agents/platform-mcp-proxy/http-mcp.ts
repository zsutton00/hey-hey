import type { Request, Response } from 'express';
import type { ServerLogger } from '../../server/logger';
import { RunRegistry } from '../../run/run-registry';
import { PlatformMcpForwarder } from './forwarder';
import type { JsonObject, JsonRpcRequest, JsonValue } from './session';
import type { OAuthClient } from '../../auth/index';
import { PLATFORM_SCHEMA_LOOKUP_TOOL } from './mcp-config';
import { childPlatformMcpProxies, type ChildPlatformMcpProxy } from './child-proxy-registry';

const describeTool = PLATFORM_SCHEMA_LOOKUP_TOOL;
const compactTool = (name: string, description: string, parameter: string): JsonObject => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: { [parameter]: { type: 'string' } },
    required: [parameter],
  },
});

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
  private readonly catalogs = new WeakMap<ChildPlatformMcpProxy, Map<string, JsonObject>>();
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
      const compact = req.query['catalog'] === 'compact';
      const params = request.params;
      const args = params?.['arguments'];
      if (compact && request.method === 'tools/call' && args && isJsonObject(args)) {
        if (params?.['name'] === describeTool) {
          const name = args['name'];
          const schema = typeof name === 'string' && this.catalogs.get(proxy)?.get(name);
          if (!schema) {
            this.logger.warn('local.platform_mcp_proxy.unknown_tool_description', {
              runId,
              turnId,
            });
            res.json(failure(request.id, -32602, 'Tool absent from this turn catalog'));
            return;
          }
          res.json({
            jsonrpc: '2.0',
            id: request.id,
            result: { content: [{ type: 'text', text: JSON.stringify(schema) }] },
          });
          return;
        }
        if (typeof args['argumentsJson'] === 'string') {
          let decoded: JsonValue;
          try {
            decoded = JSON.parse(args['argumentsJson']);
          } catch (error) {
            this.logger.warn('local.platform_mcp_proxy.invalid_arguments_json', {
              runId,
              turnId,
              cause: error instanceof Error ? error.name : 'invalid_json',
            });
            res.json(failure(request.id, -32602, 'argumentsJson must contain valid JSON'));
            return;
          }
          if (!decoded || !isJsonObject(decoded)) {
            this.logger.warn('local.platform_mcp_proxy.invalid_tool_arguments', { runId, turnId });
            res.json(failure(request.id, -32602, 'argumentsJson must encode an object'));
            return;
          }
          request.params = { ...params, arguments: decoded };
        }
      }
      const result = await proxy.handleJsonRpc(request, this.forwarder);
      if (compact && request.method === 'tools/list' && result.body && 'result' in result.body) {
        const payload = result.body.result;
        if (payload && isJsonObject(payload) && Array.isArray(payload['tools'])) {
          const catalog = this.catalogs.get(proxy) ?? new Map<string, JsonObject>();
          if (!request.params?.['cursor']) {
            catalog.clear();
          }
          this.catalogs.set(proxy, catalog);
          const listed = payload['tools'].flatMap((tool) => {
            if (!tool || !isJsonObject(tool) || typeof tool['name'] !== 'string') {
              return [];
            }
            catalog.set(tool['name'], tool);
            return [
              compactTool(
                tool['name'],
                'Call describe_platform_tool for the arguments, then pass them as JSON.',
                'argumentsJson',
              ),
            ];
          });
          if (!request.params?.['cursor'] && listed.length) {
            listed.push(
              compactTool(
                describeTool,
                'Return the full description and input schema for a named Hey Hey tool.',
                'name',
              ),
            );
          }
          payload['tools'] = listed;
        }
      }
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
