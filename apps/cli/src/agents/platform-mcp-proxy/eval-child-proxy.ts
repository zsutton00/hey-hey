import { filterEvalReportsFromToolResult } from '../run-eval/eval-execution-context';
import type { McpSessionContext } from '../mcp-server-config';
import type { ServerLogger } from '../../server/logger';
import { ActivePlatformToolCatalog } from './catalog';
import type { ChildPlatformMcpProxy } from './child-proxy-registry';
import type { PlatformMcpForwarder } from './forwarder';
import type { JsonRpcRequest, PlatformMcpProxyResult } from './session';
import { TurnPlatformMcpProxy, type PlatformMcpProxyMount } from './turn-proxy';

/**
 * Platform MCP proxy for one eval attempt's child. Exposes exactly the tools
 * the child may use and removes eval run, attempt and human-review reports from
 * every tool result before the child sees it.
 */
export class EvalChildPlatformMcpProxy implements ChildPlatformMcpProxy {
  private readonly inner: TurnPlatformMcpProxy;

  public constructor(input: {
    runId: string;
    attemptId: string;
    context: McpSessionContext;
    allowedTools: readonly string[];
    activeHandlerPromptType: string;
    logger?: ServerLogger;
  }) {
    this.inner = new TurnPlatformMcpProxy({
      runId: input.runId,
      // Unique per child so the mount URL never collides with the Run's Turn.
      turnId: `eval-attempt-${input.attemptId}-${input.activeHandlerPromptType}`,
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
    return this.inner.mount;
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
