import type { OAuthClient } from '../../auth/index';
import type { ServerLogger } from '../../server/logger';
import type { McpSessionContext } from '../mcp-server-config';
import { buildMcpHeaders, resolveMcpEndpointUrl } from '../mcp-server-config';
import type { JsonRpcRequest, JsonRpcResponse, JsonValue } from './session';

export interface PlatformMcpForwarderDeps {
  oauthClient: OAuthClient;
  logger: ServerLogger;
  fetchImpl?: typeof fetch;
  endpointUrl?: string;
}

export class PlatformMcpForwarder {
  private readonly fetchImpl: typeof fetch;
  private readonly endpointUrl: string;

  constructor(private readonly deps: PlatformMcpForwarderDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.endpointUrl = deps.endpointUrl ?? resolveMcpEndpointUrl();
  }

  async forward(request: JsonRpcRequest, context: McpSessionContext): Promise<JsonRpcResponse> {
    const tokenResult = await this.deps.oauthClient.getAccessToken();
    if (!tokenResult.success) {
      throw new Error(`Cannot forward platform MCP call: ${tokenResult.error}`);
    }

    const response = await this.fetchImpl(this.endpointUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...buildMcpHeaders(tokenResult.data, context),
      },
      body: JSON.stringify(request),
    });
    const body = await response.text();
    const parsed: JsonValue = body ? JSON.parse(body) : null;
    if (!response.ok) {
      this.deps.logger.warn('local.platform_mcp_proxy.forward.http_error', {
        status: response.status,
        method: request.method,
      });
    }
    const normalized = toJsonRpcResponse(parsed);
    if (!normalized) {
      throw new Error('Platform MCP forwarder received an invalid JSON-RPC response');
    }
    return normalized;
  }
}

const isJsonObject = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toJsonRpcResponse = (value: JsonValue): JsonRpcResponse | null => {
  if (!isJsonObject(value) || value['jsonrpc'] !== '2.0') {
    return null;
  }
  const id = value['id'];
  if (!(typeof id === 'string' || typeof id === 'number' || id === null)) {
    return null;
  }
  if ('result' in value) {
    return {
      jsonrpc: '2.0',
      id,
      result: value['result'] ?? null,
    };
  }
  const error = value['error'];
  if (error === undefined) {
    return null;
  }
  if (
    !isJsonObject(error) ||
    typeof error['code'] !== 'number' ||
    typeof error['message'] !== 'string'
  ) {
    return null;
  }
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: error['code'],
      message: error['message'],
      ...(error['data'] !== undefined ? { data: error['data'] } : {}),
    },
  };
};
