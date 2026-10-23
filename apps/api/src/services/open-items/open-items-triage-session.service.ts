import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  AgentSessionStatus as PrismaAgentSessionStatus,
  AgentSessionType as PrismaAgentSessionType,
} from '@prisma/client';
import { WorkflowName } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentSessionId, ConversationId } from '../../types';
import { AgentSessionService } from '../agent-session.service';
import type { OpenItemsScope } from './open-items.repository';

export const OPEN_ITEMS_TRIAGE_SESSION_TITLE = 'Open Items triage';

export type CreatedOpenItemsTriageSession = {
  agentSessionId: AgentSessionId;
  conversationId: ConversationId;
  created: true;
};

/**
 * Creates a new Open Items triage Agent Session and its Conversation for every
 * triage Run, like project reports and entity conversations. An earlier
 * session is never resumed; the run itself is launched through the shared
 * Agent Session start sequence, and no Open Items or Goal state is read or
 * written here.
 */
@Injectable()
export class OpenItemsTriageSessionService {
  private readonly logger = new Logger(OpenItemsTriageSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentSessionService))
    private readonly agentSessionService: AgentSessionService,
  ) {}

  async create(scope: OpenItemsScope): Promise<CreatedOpenItemsTriageSession> {
    const { organizationId, projectId, userId } = scope;
    this.logger.debug('Creating Open Items triage session', scope);

    const session = await this.prisma.db.$transaction((tx) =>
      this.agentSessionService.createInTransaction(
        tx,
        {
          organization: { connect: { id: organizationId } },
          project: { connect: { id: projectId } },
          user: { connect: { id: userId } },
          status: PrismaAgentSessionStatus.NOT_STARTED,
          sessionDate: new Date(),
          title: OPEN_ITEMS_TRIAGE_SESSION_TITLE,
          type: PrismaAgentSessionType.PROJECT_CONVERSATION,
        },
        organizationId,
      ),
    );
    const agentSessionId = session.id as AgentSessionId;
    const { conversation } =
      await this.agentSessionService.createConversationForSession(
        organizationId,
        projectId,
        agentSessionId,
        { workflowType: WorkflowName.OpenItemsTriage },
      );
    const conversationId = conversation.id as ConversationId;

    this.logger.log('Created Open Items triage session', {
      ...scope,
      agentSessionId,
      conversationId,
    });
    return { agentSessionId, conversationId, created: true };
  }
}
