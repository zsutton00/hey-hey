import { isInertPlatformToolAllowed } from '../../run/inert-execution-policy';
import type { McpSessionContext } from '../mcp-server-config';
import type { ServerLogger } from '../../server/logger';
import type { ActivePlatformToolCatalog } from './catalog';
import type { PlatformMcpForwarder } from './forwarder';
import {
  ProposalGroupFinalizationGuard,
  readMcpPayload,
} from './proposal-group-finalization-guard';

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: JsonObject;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: JsonValue;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: JsonValue };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export interface PlatformMcpProxyResult {
  statusCode: number;
  body?: JsonRpcResponse;
}

export interface PlatformMcpProxyRuntime {
  runId: string;
  turnId: string;
  context: McpSessionContext;
  catalog: ActivePlatformToolCatalog;
  activeHandlerPromptType: string;
  active: boolean;
  logger?: ServerLogger;
}

const INERT_PROPOSAL_TOOLS = new Set([
  'create_work_item',
  'edit_work_item',
  'create_plan',
  'create_design_doc',
  'edit_design_doc',
  'create_work_item_type',
  'edit_work_item_type',
]);

const success = (id: string | number | null, result: JsonValue): JsonRpcSuccess => ({
  jsonrpc: '2.0',
  id,
  result,
});

const failure = (
  id: string | number | null,
  code: number,
  message: string,
  data?: JsonValue,
): JsonRpcError => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

const MCP_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;
type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];
const LATEST_MCP_PROTOCOL_VERSION: McpProtocolVersion = '2025-11-25';
const SERVER_INFO = {
  name: 'heyhey-platform',
  version: '1.0.0',
} as const;

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readToolName = (params: JsonObject | undefined): string | null => {
  const value = params?.['name'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const readToolEntries = (value: JsonValue): JsonObject[] => {
  if (!isJsonObject(value) || !Array.isArray(value['tools'])) {
    return [];
  }
  return value['tools'].filter((entry): entry is JsonObject => isJsonObject(entry));
};

const readToolEntryName = (entry: JsonObject): string | null => {
  const name = entry['name'];
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
};

const readRequestedProtocolVersion = (params: JsonObject | undefined): string | null => {
  const value = params?.['protocolVersion'];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const isSupportedProtocolVersion = (value: string): value is McpProtocolVersion =>
  MCP_PROTOCOL_VERSIONS.some((version) => version === value);

const supportsStructuredOutput = (protocolVersion: McpProtocolVersion): boolean =>
  protocolVersion === '2025-06-18' || protocolVersion === '2025-11-25';

const normalizeToolAnnotations = (value: JsonValue | undefined): JsonObject | null => {
  if (!isJsonObject(value)) return null;
  const title = value['title'];
  const readOnlyHint = value['readOnlyHint'];
  const destructiveHint = value['destructiveHint'];
  const idempotentHint = value['idempotentHint'];
  const openWorldHint = value['openWorldHint'];
  return {
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof readOnlyHint === 'boolean' ? { readOnlyHint } : {}),
    ...(typeof destructiveHint === 'boolean' ? { destructiveHint } : {}),
    ...(typeof idempotentHint === 'boolean' ? { idempotentHint } : {}),
    ...(typeof openWorldHint === 'boolean' ? { openWorldHint } : {}),
  };
};

const normalizeToolIcons = (value: JsonValue | undefined): JsonObject[] | null => {
  if (!Array.isArray(value)) return null;
  return value.flatMap((icon) => {
    if (!isJsonObject(icon) || typeof icon['src'] !== 'string') return [];
    const mimeType = icon['mimeType'];
    const sizes = icon['sizes'];
    const theme = icon['theme'];
    return [
      {
        src: icon['src'],
        ...(typeof mimeType === 'string' ? { mimeType } : {}),
        ...(Array.isArray(sizes) && sizes.every((size) => typeof size === 'string')
          ? { sizes }
          : {}),
        ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
      },
    ];
  });
};

const normalizeToolExecution = (value: JsonValue | undefined): JsonObject | null => {
  if (!isJsonObject(value)) return null;
  const taskSupport = value['taskSupport'];
  return taskSupport === 'forbidden' || taskSupport === 'optional' || taskSupport === 'required'
    ? { taskSupport }
    : null;
};

const normalizeToolEntry = (
  entry: JsonObject,
  protocolVersion: McpProtocolVersion,
): JsonObject | null => {
  const name = readToolEntryName(entry);
  const inputSchema = entry['inputSchema'];
  if (!name || !isJsonObject(inputSchema)) {
    return null;
  }

  const description = entry['description'];
  const title = entry['title'];
  const outputSchema = entry['outputSchema'];
  const annotations = normalizeToolAnnotations(entry['annotations']);
  const meta = entry['_meta'];
  const icons = normalizeToolIcons(entry['icons']);
  const execution = normalizeToolExecution(entry['execution']);
  const supportsAnnotations = protocolVersion !== '2024-11-05';
  const includesStructuredOutput = supportsStructuredOutput(protocolVersion);
  const supportsIconsAndExecution = protocolVersion === '2025-11-25';
  return {
    name,
    ...(typeof description === 'string' ? { description } : {}),
    inputSchema,
    ...(supportsAnnotations && annotations ? { annotations } : {}),
    ...(includesStructuredOutput && typeof title === 'string' ? { title } : {}),
    ...(includesStructuredOutput && isJsonObject(outputSchema) ? { outputSchema } : {}),
    ...(includesStructuredOutput && isJsonObject(meta) ? { _meta: meta } : {}),
    ...(supportsIconsAndExecution && icons ? { icons } : {}),
    ...(supportsIconsAndExecution && execution ? { execution } : {}),
  };
};

const mismatchText = (input: { toolName: string; promptType: string; active: boolean }): string => {
  const state = input.active ? 'is not active' : 'has no active scoped proxy session';
  return (
    `${input.toolName} ${state} for the current ${input.promptType} turn. ` +
    'This is a Hey Hey tool-surface mismatch, not a user rejection.'
  );
};

export class PlatformMcpProxySession {
  private readonly inertGroupIds = new Set<string>();

  private readonly proposalGroupFinalizationGuard: ProposalGroupFinalizationGuard;
  private protocolVersion: McpProtocolVersion = '2024-11-05';

  constructor(
    private readonly runtime: PlatformMcpProxyRuntime,
    private readonly forwarder: PlatformMcpForwarder,
  ) {
    this.proposalGroupFinalizationGuard = new ProposalGroupFinalizationGuard(
      forwarder,
      runtime.context,
    );
  }

  async handle(request: JsonRpcRequest): Promise<PlatformMcpProxyResult> {
    switch (request.method) {
      case 'initialize':
        return this.initialize(request);

      case 'notifications/initialized':
        this.runtime.logger?.debug('local.platform_mcp_proxy.protocol.initialized', {
          runId: this.runtime.runId,
          turnId: this.runtime.turnId,
          protocolVersion: this.protocolVersion,
        });
        return { statusCode: 202 };

      case 'ping':
        return { statusCode: 200, body: success(request.id, {}) };

      case 'tools/list':
        return this.listTools(request);

      case 'tools/call':
        return this.callTool(request);

      default:
        return {
          statusCode: 200,
          body: failure(request.id, -32601, `Method not found: ${request.method}`),
        };
    }
  }

  private initialize(request: JsonRpcRequest): PlatformMcpProxyResult {
    const requestedProtocolVersion = readRequestedProtocolVersion(request.params);
    if (!requestedProtocolVersion) {
      return {
        statusCode: 200,
        body: failure(request.id, -32602, 'Missing protocol version'),
      };
    }

    this.protocolVersion = isSupportedProtocolVersion(requestedProtocolVersion)
      ? requestedProtocolVersion
      : LATEST_MCP_PROTOCOL_VERSION;
    this.runtime.logger?.debug('local.platform_mcp_proxy.protocol.negotiated', {
      runId: this.runtime.runId,
      turnId: this.runtime.turnId,
      requestedProtocolVersion,
      protocolVersion: this.protocolVersion,
      requestedVersionSupported: isSupportedProtocolVersion(requestedProtocolVersion),
    });
    return {
      statusCode: 200,
      body: success(request.id, {
        protocolVersion: this.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      }),
    };
  }

  private async listTools(request: JsonRpcRequest): Promise<PlatformMcpProxyResult> {
    if (!this.runtime.active) {
      this.runtime.logger?.debug('local.platform_mcp_proxy.tools_list.inactive', {
        runId: this.runtime.runId,
        turnId: this.runtime.turnId,
        promptType: this.runtime.activeHandlerPromptType,
      });
      return {
        statusCode: 200,
        body: success(request.id, { tools: [] }),
      };
    }

    const forwarded = await this.forwarder.forward(request, this.runtime.context);
    if ('error' in forwarded) {
      return { statusCode: 200, body: forwarded };
    }
    const result = forwarded.result;
    if (!isJsonObject(result) || !Array.isArray(result['tools'])) {
      this.runtime.logger?.warn('local.platform_mcp_proxy.tools_list.invalid_upstream_shape', {
        runId: this.runtime.runId,
        turnId: this.runtime.turnId,
        promptType: this.runtime.activeHandlerPromptType,
      });
      return { statusCode: 200, body: forwarded };
    }

    const upstreamTools = readToolEntries(result);
    const upstreamToolNames = upstreamTools
      .map((entry) => readToolEntryName(entry))
      .filter((name): name is string => name !== null);
    const activeUpstreamTools = upstreamTools.filter((entry) => {
      const name = readToolEntryName(entry);
      return (
        name !== null &&
        this.runtime.catalog.has(name) &&
        (!this.runtime.context.inert ||
          isInertPlatformToolAllowed(this.runtime.catalog.normalize(name)))
      );
    });
    const normalizedActiveTools = activeUpstreamTools.map((entry) => ({
      name: readToolEntryName(entry),
      normalized: normalizeToolEntry(entry, this.protocolVersion),
    }));
    const tools = normalizedActiveTools
      .map(({ normalized }) => normalized)
      .filter((entry): entry is JsonObject => entry !== null);
    const invalidActiveTools = normalizedActiveTools
      .filter(({ normalized }) => normalized === null)
      .map(({ name }) => name)
      .filter((name): name is string => name !== null);
    const missingActiveTools = this.runtime.catalog.shortNames.filter(
      (name) =>
        !upstreamToolNames.includes(name) &&
        !upstreamToolNames.includes(`mcp__heyhey-platform__${name}`),
    );
    const logFields = {
      runId: this.runtime.runId,
      turnId: this.runtime.turnId,
      promptType: this.runtime.activeHandlerPromptType,
      upstreamToolCount: upstreamToolNames.length,
      filteredToolCount: tools.length,
      activeCatalogToolCount: this.runtime.catalog.shortNames.length,
      invalidActiveToolCount: invalidActiveTools.length,
      invalidActiveTools,
      protocolVersion: this.protocolVersion,
      missingActiveTools,
    };
    if (tools.length === 0 && this.runtime.catalog.shortNames.length > 0) {
      this.runtime.logger?.warn(
        'local.platform_mcp_proxy.tools_list.empty_filtered_surface',
        logFields,
      );
    } else {
      this.runtime.logger?.debug('local.platform_mcp_proxy.tools_list.filtered', logFields);
    }

    return {
      statusCode: 200,
      body: success(request.id, {
        tools,
        ...(typeof result['nextCursor'] === 'string' ? { nextCursor: result['nextCursor'] } : {}),
        ...(supportsStructuredOutput(this.protocolVersion) && isJsonObject(result['_meta'])
          ? { _meta: result['_meta'] }
          : {}),
      }),
    };
  }

  private async callTool(request: JsonRpcRequest): Promise<PlatformMcpProxyResult> {
    const toolName = readToolName(request.params);
    if (!toolName) {
      return {
        statusCode: 200,
        body: failure(request.id, -32602, 'Missing tool name'),
      };
    }

    if (!this.runtime.active || !this.runtime.catalog.has(toolName)) {
      this.runtime.logger?.warn('local.platform_mcp_proxy.tool_call.inactive_tool', {
        runId: this.runtime.runId,
        turnId: this.runtime.turnId,
        promptType: this.runtime.activeHandlerPromptType,
        toolName,
        active: this.runtime.active,
      });
      return {
        statusCode: 200,
        body: success(request.id, {
          content: [
            {
              type: 'text',
              text: mismatchText({
                toolName,
                promptType: this.runtime.activeHandlerPromptType,
                active: this.runtime.active,
              }),
            },
          ],
          isError: true,
        }),
      };
    }

    const normalizedName = this.runtime.catalog.normalize(toolName);
    if (this.runtime.context.inert && !isInertPlatformToolAllowed(normalizedName)) {
      return {
        statusCode: 200,
        body: failure(request.id, -32602, 'Tool unavailable to inert execution.'),
      };
    }
    const params: JsonObject = request.params
      ? { ...request.params, name: normalizedName }
      : { name: normalizedName };
    if (this.runtime.context.inert) {
      const suppliedArguments = params['arguments'];
      const args = isJsonObject(suppliedArguments) ? suppliedArguments : {};
      const groupContext = args['groupContext'];
      if (isJsonObject(groupContext)) {
        const groupId = groupContext['groupId'];
        if (typeof groupId !== 'string' || !this.inertGroupIds.has(groupId)) {
          return {
            statusCode: 200,
            body: failure(
              request.id,
              -32602,
              'Inert execution can only change proposal groups it created.',
            ),
          };
        }
      }
      if (INERT_PROPOSAL_TOOLS.has(normalizedName)) {
        params['arguments'] = { ...args, ragEnabled: false, applicationEligible: false };
      } else if (normalizedName === 'create_report' || normalizedName === 'update_report') {
        params['arguments'] = { ...args, ragEnabled: false };
      }
    }
    const normalizedRequest = { ...request, params };
    if (normalizedName === 'finalize_proposal_group') {
      this.runtime.logger?.debug(
        'local.platform_mcp_proxy.proposal_group_finalization.inspecting',
        {
          runId: this.runtime.runId,
          turnId: this.runtime.turnId,
          promptType: this.runtime.activeHandlerPromptType,
        },
      );
      const guardResponse = await this.proposalGroupFinalizationGuard.inspect(normalizedRequest);
      if (guardResponse) {
        this.runtime.logger?.debug(
          'local.platform_mcp_proxy.proposal_group_finalization.not_forwarded',
          {
            runId: this.runtime.runId,
            turnId: this.runtime.turnId,
            promptType: this.runtime.activeHandlerPromptType,
            upstreamError: 'error' in guardResponse,
          },
        );
        return { statusCode: 200, body: guardResponse };
      }
      this.runtime.logger?.debug('local.platform_mcp_proxy.proposal_group_finalization.eligible', {
        runId: this.runtime.runId,
        turnId: this.runtime.turnId,
        promptType: this.runtime.activeHandlerPromptType,
      });
    }
    const startedAt = Date.now();
    this.runtime.logger?.debug('local.platform_mcp_proxy.tool_call.forwarding', {
      runId: this.runtime.runId,
      turnId: this.runtime.turnId,
      promptType: this.runtime.activeHandlerPromptType,
      toolName,
      normalizedName,
    });
    const forwarded = await this.forwarder.forward(normalizedRequest, this.runtime.context);
    if (
      this.runtime.context.inert &&
      normalizedName === 'start_proposal_group' &&
      'result' in forwarded
    ) {
      const snapshot = readMcpPayload(forwarded.result);
      if (isJsonObject(snapshot) && typeof snapshot['groupId'] === 'string') {
        this.inertGroupIds.add(snapshot['groupId']);
      }
    }
    this.runtime.logger?.debug('local.platform_mcp_proxy.tool_call.forwarded', {
      runId: this.runtime.runId,
      turnId: this.runtime.turnId,
      promptType: this.runtime.activeHandlerPromptType,
      normalizedName,
      status: 'error' in forwarded ? 'error' : 'success',
      durationMs: Date.now() - startedAt,
    });
    return {
      statusCode: 200,
      body: forwarded,
    };
  }
}
