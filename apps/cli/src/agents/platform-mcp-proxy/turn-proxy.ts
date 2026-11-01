import { randomUUID } from 'node:crypto';

import type { McpSessionContext } from '../mcp-server-config';
import type { ServerLogger } from '../../server/logger';
import type { ActivePlatformToolCatalog } from './catalog';
import type { PlatformMcpForwarder } from './forwarder';
import {
  PlatformMcpProxySession,
  type JsonRpcRequest,
  type PlatformMcpProxyResult,
} from './session';
import {
  readCreatedProposalGroupMembers,
  readCreatedProposalIds,
  readDeletedProposalId,
  readRemovedProposalGroupMemberId,
  readUpdatedProposal,
} from './proposal-result';

export interface TurnPlatformMcpProxyInput {
  runId: string;
  turnId: string;
  context: McpSessionContext;
  catalog: ActivePlatformToolCatalog;
  activeHandlerPromptType: string;
  logger?: ServerLogger;
}

export interface PlatformMcpProxyMount {
  runId: string;
  turnId: string;
  token: string;
  allowedTools: readonly string[];
}

export class TurnPlatformMcpProxy {
  readonly runId: string;
  readonly turnId: string;
  readonly context: McpSessionContext;
  readonly catalog: ActivePlatformToolCatalog;
  readonly activeHandlerPromptType: string;
  readonly token: string;
  readonly logger: ServerLogger | undefined;

  private closed = false;
  private reportingRepair = false;
  private platformMcpProxySession: PlatformMcpProxySession | null = null;
  private proposalIdentityObserver: ((proposalId: string) => void) | null = null;
  private proposalRemovalObserver: ((proposalId: string) => void) | null = null;
  private readonly proposalIdByGroupMemberId = new Map<string, string>();

  constructor(input: TurnPlatformMcpProxyInput) {
    this.runId = input.runId;
    this.turnId = input.turnId;
    this.context = input.context;
    this.catalog = input.catalog;
    this.activeHandlerPromptType = input.activeHandlerPromptType;
    this.logger = input.logger;
    this.token = randomUUID();
  }

  get active(): boolean {
    return !this.closed;
  }
  setReportingRepair(active: boolean): void {
    this.reportingRepair = active;
  }

  get mount(): PlatformMcpProxyMount {
    return {
      runId: this.runId,
      turnId: this.turnId,
      token: this.token,
      allowedTools: this.catalog.qualifiedNames,
    };
  }

  matches(input: { turnId: string; token: string }): boolean {
    return this.turnId === input.turnId && this.token === input.token;
  }

  close(): void {
    this.closed = true;
  }

  setProposalIdentityObserver(observer: (proposalId: string) => void): void {
    this.proposalIdentityObserver = observer;
  }

  setProposalRemovalObserver(observer: (proposalId: string) => void): void {
    this.proposalRemovalObserver = observer;
  }

  async handleJsonRpc(
    request: JsonRpcRequest,
    forwarder: PlatformMcpForwarder,
  ): Promise<PlatformMcpProxyResult> {
    if (this.reportingRepair && request.method === 'tools/call') {
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Only report_changed_files is permitted during reporting repair.',
              },
            ],
          },
        },
      };
    }
    this.platformMcpProxySession ??= new PlatformMcpProxySession(
      {
        runId: this.runId,
        turnId: this.turnId,
        context: this.context,
        catalog: this.catalog,
        activeHandlerPromptType: this.activeHandlerPromptType,
        active: this.active,
        ...(this.logger ? { logger: this.logger } : {}),
      },
      forwarder,
    );
    const response = await this.platformMcpProxySession.handle(request);
    if (request.method === 'tools/call') {
      const requestedName = request.params?.['name'];
      if (typeof requestedName === 'string') {
        const normalizedName = this.catalog.normalize(requestedName);
        for (const membership of readCreatedProposalGroupMembers(normalizedName, response)) {
          this.proposalIdByGroupMemberId.set(membership.memberId, membership.proposalId);
        }
        const updated = readUpdatedProposal(normalizedName, response);
        if (updated?.memberId)
          this.proposalIdByGroupMemberId.set(updated.memberId, updated.proposalId);
        if (updated) this.proposalIdentityObserver?.(updated.proposalId);
        if (this.proposalIdentityObserver) {
          for (const proposalId of readCreatedProposalIds(normalizedName, response)) {
            this.proposalIdentityObserver(proposalId);
          }
        }
        const removedMemberId = readRemovedProposalGroupMemberId(
          normalizedName,
          request.params?.['arguments'],
          response,
        );
        if (removedMemberId) {
          const removedProposalId = this.proposalIdByGroupMemberId.get(removedMemberId);
          if (removedProposalId) {
            this.proposalRemovalObserver?.(removedProposalId);
            this.proposalIdByGroupMemberId.delete(removedMemberId);
          } else {
            this.logger?.debug('platform_mcp_proxy.proposal_group_member_removal.untracked', {
              runId: this.runId,
              turnId: this.turnId,
              memberId: removedMemberId,
            });
          }
        }
        const deletedProposalId = readDeletedProposalId(
          normalizedName,
          request.params?.['arguments'],
          response,
        );
        if (deletedProposalId) this.proposalRemovalObserver?.(deletedProposalId);
      }
    }
    return response;
  }
}
