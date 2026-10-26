import { filterEvalReportsFromToolResult } from '../run-eval/eval-execution-context';
import type { McpSessionContext } from '../mcp-server-config';
import type { ServerLogger } from '../../server/logger';
import { ActivePlatformToolCatalog } from './catalog';
import type { ChildPlatformMcpProxy } from './child-proxy-registry';
import type { PlatformMcpForwarder } from './forwarder';
import type { JsonRpcRequest, PlatformMcpProxyResult } from './session';
import { TurnPlatformMcpProxy, type PlatformMcpProxyMount } from './turn-proxy';
import { randomUUID } from 'node:crypto';
import type { EvalResearchTools } from '../run-eval/eval-research-tools';

/**
 * Platform MCP proxy for one eval attempt's child. Exposes exactly the tools
 * the child may use and removes eval run, attempt and human-review reports from
 * every tool result before the child sees it.
 */
export class EvalChildPlatformMcpProxy implements ChildPlatformMcpProxy {
  private readonly inner: TurnPlatformMcpProxy;
  private readonly researchTools: EvalResearchTools | undefined;

  public constructor(input: {
    runId: string;
    attemptId: string;
    context: McpSessionContext;
    allowedTools: readonly string[];
    activeHandlerPromptType: string;
    logger?: ServerLogger;
    researchTools?: EvalResearchTools;
  }) {
    this.researchTools = input.researchTools;
    this.inner = new TurnPlatformMcpProxy({
      runId: input.runId,
      // Unique per child so the mount URL never collides with the Run's Turn.
      turnId: `eval-attempt-${input.attemptId}-${input.activeHandlerPromptType}-${randomUUID()}`,
      context: input.context,
      catalog: new ActivePlatformToolCatalog({ exactTools: input.allowedTools }),
      activeHandlerPromptType: input.activeHandlerPromptType,
      ...(input.logger ? { logger: input.logger } : {}),
    });
  }

  public get runId(): string {
    return this.inner.runId;
  }

  public get mount(): PlatformMcpProxyMount {
    const mount = this.inner.mount;
    return {
      ...mount,
      allowedTools: [
        ...mount.allowedTools,
        ...(this.researchTools?.toolNames.map((name) => `mcp__heyhey-platform__${name}`) ?? []),
      ],
    };
  }

  public matches(input: { turnId: string; token: string }): boolean {
    return this.inner.matches(input);
  }

  public close(): void {
    this.inner.close();
  }

  public async handleJsonRpc(
    request: JsonRpcRequest,
    forwarder: PlatformMcpForwarder,
  ): Promise<PlatformMcpProxyResult> {
    if (this.inner.active && this.researchTools && request.method === 'tools/list') {
      return {
        statusCode: 200,
        body: { jsonrpc: '2.0', id: request.id, result: { tools: this.researchTools.tools } },
      };
    }
    const name = request.params?.['name'];
    if (
      this.inner.active &&
      request.method === 'tools/call' &&
      typeof name === 'string' &&
      this.researchTools?.toolNames.includes(name)
    ) {
      const args = request.params?.['arguments'];
      const result = await this.researchTools.call(
        name,
        typeof args === 'object' && args !== null && !Array.isArray(args) ? args : {},
      );
      return { statusCode: 200, body: { jsonrpc: '2.0', id: request.id, result } };
    }
    const response = await this.inner.handleJsonRpc(request, forwarder);
    if (request.method !== 'tools/call' || !response.body || !('result' in response.body)) {
      return response;
    }
    return {
      ...response,
      body: { ...response.body, result: filterEvalReportsFromToolResult(response.body.result) },
    };
  }
}
