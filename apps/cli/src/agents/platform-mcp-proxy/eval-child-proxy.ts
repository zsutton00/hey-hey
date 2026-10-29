import { z } from 'zod/v4';
import type { CreateReportProxy } from '../submission-tools/create-report-proxy';
import { CREATE_REPORT_INPUT_SCHEMA } from '../submission-tools/create-report-tool';
import {
  filterEvalReportsFromToolResult,
  withholdEvalMutationTools,
} from '../run-eval/eval-execution-context';
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
  private readonly reportProxy: CreateReportProxy | undefined;
  private readonly context: McpSessionContext;
  private readonly researchTools: EvalResearchTools | undefined;

  public constructor(input: {
    runId: string;
    reportProxy?: CreateReportProxy;
    attemptId: string;
    context: McpSessionContext;
    allowedTools: readonly string[];
    activeHandlerPromptType: string;
    logger?: ServerLogger;
    researchTools?: EvalResearchTools;
  }) {
    this.context = input.context;
    this.reportProxy = input.reportProxy;
    this.researchTools = input.researchTools;
    this.inner = new TurnPlatformMcpProxy({
      runId: input.runId,
      // Unique per child so the mount URL never collides with the Run's Turn.
      turnId: `eval-attempt-${input.attemptId}-${input.activeHandlerPromptType}-${randomUUID()}`,
      context: input.context,
      catalog: new ActivePlatformToolCatalog({
        exactTools: input.context.inert
          ? withholdEvalMutationTools(input.allowedTools)
          : input.allowedTools,
      }),
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
        ...(this.reportProxy ? ['mcp__heyhey-platform__create_report'] : []),
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
    if (
      this.inner.active &&
      this.reportProxy &&
      request.method === 'tools/call' &&
      request.params?.['name'] === 'create_report'
    ) {
      const args = request.params['arguments'];
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        throw new Error('Report arguments must be an object.');
      }
      if (!this.context.agentSessionId || !this.context.conversationId || !this.context.projectId) {
        throw new Error('Inert reports require their target execution context.');
      }
      const result = await this.reportProxy.create({
        runId: this.context.agentSessionId,
        conversationId: this.context.conversationId,
        projectId: this.context.projectId,
        inert: this.context.inert === true,
        args,
      });
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: { content: z.json().parse(result.content) },
        },
      };
    }
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
    if (
      request.method === 'tools/list' &&
      this.reportProxy &&
      response.body &&
      'result' in response.body
    ) {
      const result = response.body.result;
      if (
        typeof result === 'object' &&
        result !== null &&
        !Array.isArray(result) &&
        Array.isArray(result['tools'])
      ) {
        result['tools'].push({
          name: 'create_report',
          description: 'Retain an evaluation report as evidence.',
          inputSchema: CREATE_REPORT_INPUT_SCHEMA,
        });
      }
    }
    if (request.method !== 'tools/call' || !response.body || !('result' in response.body)) {
      return response;
    }
    return {
      ...response,
      body: { ...response.body, result: filterEvalReportsFromToolResult(response.body.result) },
    };
  }
}
