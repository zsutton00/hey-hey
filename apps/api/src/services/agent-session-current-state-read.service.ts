import { Injectable, Logger, Optional } from '@nestjs/common';
import { AgentSessionCurrentStateBatchItemDto } from 'src/generated';
import { AgentSessionCurrentState } from 'src/generated/model/agentSessionCurrentState';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId } from 'src/types';
import {
  AgentSessionCurrentStateProjection,
  AgentSessionCurrentStateProjectionEntry,
} from './agent-session-current-state-projection.service';

export type AgentSessionCurrentStateLoadedIdentity = {
  agentSessionId: string;
  organizationId: string;
  projectId: string;
  updatedAt: Date;
};

type AuthorizedAgentSessionIdentity = AgentSessionCurrentStateLoadedIdentity;

@Injectable()
export class AgentSessionCurrentStateReadService {
  private readonly logger = new Logger(
    AgentSessionCurrentStateReadService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly projection?: AgentSessionCurrentStateProjection,
  ) {}

  async readAuthorized(
    organizationId: OrganizationId,
    projectId: ProjectId,
    requestedAgentSessionIds: readonly string[],
  ): Promise<AgentSessionCurrentStateBatchItemDto[]> {
    const startedAt = Date.now();
    if (requestedAgentSessionIds.length === 0) {
      return [];
    }

    try {
      const sessions = await this.prisma.db.agentSession.findMany({
        where: {
          id: { in: [...requestedAgentSessionIds] },
          organizationId,
          projectId,
        },
        select: {
          id: true,
          organizationId: true,
          projectId: true,
          updatedAt: true,
        },
      });
      const identities: AuthorizedAgentSessionIdentity[] = sessions.map(
        (session) => ({
          agentSessionId: session.id,
          organizationId: session.organizationId,
          projectId: session.projectId,
          updatedAt: session.updatedAt,
        }),
      );
      const byId = new Map(
        identities.map((identity) => [identity.agentSessionId, identity]),
      );
      const resolved = await this.readLoaded(identities);

      this.logger.log('[current-state-read] authorization completed', {
        requested: requestedAgentSessionIds.length,
        authorized: identities.length,
        omitted: requestedAgentSessionIds.length - identities.length,
        projectionResults: resolved.projectionResults,
        projectionMisses: resolved.projectionMisses,
        latencyMs: Date.now() - startedAt,
      });

      return requestedAgentSessionIds.flatMap((agentSessionId) => {
        if (!byId.has(agentSessionId)) return [];
        const item = resolved.items.get(agentSessionId);
        return item ? [item] : [];
      });
    } catch (error) {
      this.logger.error('[current-state-read] authorized read failed', {
        requested: requestedAgentSessionIds.length,
        organizationId,
        projectId,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async readLoaded(
    identities: readonly AgentSessionCurrentStateLoadedIdentity[],
  ): Promise<{
    items: Map<string, AgentSessionCurrentStateBatchItemDto>;
    projectionResults: number;
    projectionMisses: number;
  }> {
    if (identities.length === 0) {
      return { items: new Map(), projectionResults: 0, projectionMisses: 0 };
    }

    const ids = identities.map(({ agentSessionId }) => agentSessionId);
    const projectionEntries = this.projection
      ? await this.projection.readMany(ids)
      : new Map<string, AgentSessionCurrentStateProjectionEntry>();
    const validEntries = new Map<
      string,
      AgentSessionCurrentStateProjectionEntry
    >();

    for (const identity of identities) {
      const entry = projectionEntries.get(identity.agentSessionId);
      if (
        entry &&
        entry.agentSessionId === identity.agentSessionId &&
        entry.organizationId === identity.organizationId &&
        entry.projectId === identity.projectId
      ) {
        validEntries.set(identity.agentSessionId, entry);
      }
    }

    const items = new Map<string, AgentSessionCurrentStateBatchItemDto>();

    for (const identity of identities) {
      const entry = validEntries.get(identity.agentSessionId);
      items.set(
        identity.agentSessionId,
        entry ? this.toItem(entry) : this.toIdleItem(identity),
      );
    }

    return {
      items,
      projectionResults: validEntries.size,
      projectionMisses: identities.length - validEntries.size,
    };
  }

  private toItem(
    entry: AgentSessionCurrentStateProjectionEntry,
  ): AgentSessionCurrentStateBatchItemDto {
    return {
      agentSessionId: entry.agentSessionId,
      currentState: entry.currentState,
      revision: entry.revision,
      transitionedAt: entry.transitionedAt,
    } satisfies AgentSessionCurrentStateBatchItemDto;
  }

  private toIdleItem(
    identity: AgentSessionCurrentStateLoadedIdentity,
  ): AgentSessionCurrentStateBatchItemDto {
    return {
      agentSessionId: identity.agentSessionId,
      currentState: AgentSessionCurrentState.Idle,
      revision: 0,
      transitionedAt: identity.updatedAt.toISOString(),
    } satisfies AgentSessionCurrentStateBatchItemDto;
  }
}
