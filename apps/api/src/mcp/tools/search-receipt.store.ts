import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { RedisService } from '../../core/redis/redis.service';
import { mcpError } from './mcp-tool.utils';

export interface SearchReceipt {
  agentSessionId: string;
  projectId: string;
  tool: string;
  input: unknown;
  createdAt: string;
}

export interface SearchReceiptScope {
  agentSessionId: string;
  projectId: string;
}

const RECEIPT_KEY_PREFIX = 'mcp:project-graph-search-receipt:';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SearchReceiptStore {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    config: ConfigService,
  ) {
    const configuredTtl = Number(
      config.get('MCP_SEARCH_RECEIPT_TTL_SECONDS') ?? 300,
    );
    this.ttlSeconds =
      Number.isInteger(configuredTtl) && configuredTtl > 0
        ? configuredTtl
        : 300;
  }

  resolveScope(request: Request, projectId: string): SearchReceiptScope | null {
    const agentSessionId = request.headers['x-agent-session-id'];
    if (typeof agentSessionId !== 'string' || !UUID_RE.test(agentSessionId)) {
      return null;
    }

    return { agentSessionId, projectId };
  }

  async issue(
    scope: SearchReceiptScope,
    tool: string,
    input: unknown,
  ): Promise<string> {
    const id = randomUUID();
    const receipt: SearchReceipt = {
      ...scope,
      tool,
      input,
      createdAt: new Date().toISOString(),
    };
    await this.redisService
      .getClient()
      .set(
        `${RECEIPT_KEY_PREFIX}${id}`,
        JSON.stringify(receipt),
        'EX',
        this.ttlSeconds,
      );
    return id;
  }

  async validate(
    id: string | undefined,
    scope: SearchReceiptScope,
  ): Promise<string | null> {
    if (!id) {
      return 'A recent project-graph search is required before creating a work item. Run unified_search, task_search, search_features, search_goals, search_design_docs, plan_search, or get_context, then pass its searchReceiptId.';
    }

    const value = await this.redisService
      .getClient()
      .get(`${RECEIPT_KEY_PREFIX}${id}`);
    if (!value) {
      return 'The searchReceiptId is unknown or expired. Run a project-graph search and pass its searchReceiptId when creating the work item.';
    }

    const receipt = JSON.parse(value) as SearchReceipt;
    if (
      receipt.agentSessionId !== scope.agentSessionId ||
      receipt.projectId !== scope.projectId
    ) {
      return 'The searchReceiptId belongs to a different agent session or project. Run a project-graph search in this session and project, then pass its searchReceiptId.';
    }

    return null;
  }

  missingSessionError() {
    return mcpError(
      'Missing or invalid X-Agent-Session-ID header. Start an agent session and retry the project-graph search.',
    );
  }
}
