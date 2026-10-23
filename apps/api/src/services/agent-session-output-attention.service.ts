import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AgentSessionOutputAttentionBatchItemDto,
  AgentSessionOutputAttentionState,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { AgentSessionOutputAttentionProjection } from './agent-session-output-attention-projection.service';

type OutputAttentionIdentity = {
  agentSessionId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  updatedAt: Date;
};

@Injectable()
export class AgentSessionOutputAttentionService {
  private readonly logger = new Logger(AgentSessionOutputAttentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: AgentSessionOutputAttentionProjection,
  ) {}

  async readAuthorized(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    requestedAgentSessionIds: readonly string[],
  ): Promise<AgentSessionOutputAttentionBatchItemDto[]> {
    const sessions = await this.prisma.db.agentSession.findMany({
      where: {
        id: { in: [...requestedAgentSessionIds] },
        organizationId,
        projectId,
        userId,
      },
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        userId: true,
        updatedAt: true,
      },
    });
    const identities = sessions.map(this.toIdentity);
    const byId = new Map(identities.map((identity) => [identity.agentSessionId, identity]));
    const entries = await this.projection.readMany(identities);

    this.logger.log('[output-attention] authorized batch read', {
      requested: requestedAgentSessionIds.length,
      authorized: identities.length,
      projectionResults: entries.size,
      userId,
    });

    return requestedAgentSessionIds.flatMap((agentSessionId) => {
      const identity = byId.get(agentSessionId);
      if (!identity) return [];
      const entry = entries.get(agentSessionId);
      return [entry ? this.projection.toItem(entry) : this.toNoneItem(identity)];
    });
  }

  async setReady(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    agentSessionId: string,
  ): Promise<AgentSessionOutputAttentionBatchItemDto> {
    return this.transition(
      organizationId,
      projectId,
      userId,
      agentSessionId,
      AgentSessionOutputAttentionState.MessageReady,
    );
  }

  async acknowledge(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    agentSessionId: string,
  ): Promise<AgentSessionOutputAttentionBatchItemDto> {
    return this.transition(
      organizationId,
      projectId,
      userId,
      agentSessionId,
      AgentSessionOutputAttentionState.None,
    );
  }

  private async transition(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    agentSessionId: string,
    state: AgentSessionOutputAttentionState,
  ): Promise<AgentSessionOutputAttentionBatchItemDto> {
    const session = await this.prisma.db.agentSession.findFirst({
      where: { id: agentSessionId, organizationId, projectId, userId },
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        userId: true,
        updatedAt: true,
      },
    });
    if (!session) {
      throw new NotFoundException('Agent Session not found');
    }
    const result = await this.projection.transition({
      agentSessionId,
      organizationId,
      projectId,
      userId,
      state,
    });
    if (result.outcome === 'schema_mismatch') {
      throw new Error('Agent Session output-attention projection schema mismatch');
    }
    return this.projection.toItem(
      result.outcome === 'transition' ? result.transition.entry : result.entry,
    );
  }

  private readonly toIdentity = (session: {
    id: string;
    organizationId: string;
    projectId: string;
    userId: string;
    updatedAt: Date;
  }): OutputAttentionIdentity => ({
    agentSessionId: session.id,
    organizationId: session.organizationId,
    projectId: session.projectId,
    userId: session.userId,
    updatedAt: session.updatedAt,
  });

  private toNoneItem(
    identity: OutputAttentionIdentity,
  ): AgentSessionOutputAttentionBatchItemDto {
    return {
      agentSessionId: identity.agentSessionId,
      state: AgentSessionOutputAttentionState.None,
      revision: 0,
      changedAt: identity.updatedAt.toISOString(),
    } satisfies AgentSessionOutputAttentionBatchItemDto;
  }
}
