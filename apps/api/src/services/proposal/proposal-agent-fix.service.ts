import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Proposal } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import {
  AgentSessionStatus,
  AgentSessionType,
  EntityType,
  WorkflowName,
  type ConversationStartRunRequestDto,
  type CreateAgentSessionConversationDto,
  type CreateAgentSessionDto,
  type ProposalAgentFixRequest,
  type RunCreatePayloadProposalRefiner,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { AgentSessionService } from '../agent-session.service';
import { ProposalService } from './proposal.service';

export const AGENT_FIX_HANDLER_PROMPT_TYPE = 'proposal_refiner';

const AGENT_FIX_USER_MESSAGE =
  'This proposal is out of date. Prepare a reconciled result that keeps the intervening changes to current content and carries the proposal’s intent forward. Ask me about any real conflict before submitting, and never apply anything yourself.';

/**
 * Records Agent fix requests for out-of-date proposals (Agentic Processes:
 * prepare, then the app starts). Recording never dispatches a run; the start
 * gate only admits a start carrying exactly the recorded input.
 *
 * The run input is derived from the proposal row, so it stays the record a
 * start is checked against: if the proposal changes between recording and
 * start, the start is rejected and a retry re-records against the same session.
 */
@Injectable()
export class ProposalAgentFixService {
  private readonly logger = new Logger(ProposalAgentFixService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalService,
    private readonly sessions: AgentSessionService,
  ) {}

  async record(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    proposalId: string,
  ): Promise<ProposalAgentFixRequest> {
    const proposal = await this.prisma.db.proposal.findFirst({
      where: { id: proposalId, organizationId, projectId },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    const state = await this.proposals.reconciliationState(
      proposalId,
      organizationId,
      projectId,
    );
    if (
      state.status !== 'RECONCILIATION_REQUIRED' &&
      state.status !== 'AGENT_FIX_REQUIRED'
    ) {
      throw new ConflictException('This proposal does not need reconciliation');
    }
    const unstarted = await this.prisma.db.agentSession.findFirst({
      where: {
        organizationId,
        projectId,
        userId,
        type: AgentSessionType.ProposalRefining,
        entityType: EntityType.Proposal,
        entityId: proposalId,
        status: AgentSessionStatus.NotStarted,
        conversationId: { not: null },
        agentOperations: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, conversationId: true, createdAt: true },
    });
    const prepared = unstarted
      ? {
          agentSessionId: unstarted.id,
          conversationId: unstarted.conversationId!,
          createdAt: unstarted.createdAt,
        }
      : await this.prepareSession(organizationId, projectId, userId, proposal);
    return {
      proposalId,
      organizationId,
      projectId,
      agentSessionId: prepared.agentSessionId,
      conversationId: prepared.conversationId,
      payload: this.payloadFor(proposal),
      createdAt: prepared.createdAt.toISOString(),
    };
  }

  /**
   * Returns false when the start does not touch an Agent fix session; throws
   * when it does and differs from the recorded request.
   */
  async assertStartRun(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    conversationId: string;
    requestDto: ConversationStartRunRequestDto;
  }): Promise<boolean> {
    const { requestDto } = input;
    const session = await this.prisma.db.agentSession.findUnique({
      where: { id: requestDto.agentSessionId },
      select: {
        type: true,
        userId: true,
        organizationId: true,
        projectId: true,
        entityType: true,
        entityId: true,
        conversationId: true,
      },
    });
    if (
      session?.type !== AgentSessionType.ProposalRefining ||
      session.entityType !== EntityType.Proposal ||
      !session.entityId
    ) {
      return false;
    }
    const proposal = await this.prisma.db.proposal.findFirst({
      where: {
        id: session.entityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
      },
    });
    const mismatches = [
      ['proposal', !!proposal],
      ['user', session.userId === input.userId],
      ['organization', session.organizationId === input.organizationId],
      ['project', session.projectId === input.projectId],
      ['conversation', session.conversationId === input.conversationId],
      [
        'handler',
        requestDto.handlerPromptType === AGENT_FIX_HANDLER_PROMPT_TYPE,
      ],
      ['triggersAgent', requestDto.triggersAgent !== false],
      [
        'repository scope',
        requestDto.serviceIds === undefined &&
          requestDto.launchServiceId === undefined &&
          requestDto.worktree === undefined,
      ],
      [
        'payload',
        !!proposal &&
          isDeepStrictEqual(requestDto.payload, this.payloadFor(proposal)),
      ],
      [
        'context',
        requestDto.contextMetadata.agentSessionId ===
          requestDto.agentSessionId &&
          requestDto.contextMetadata.projectId === input.projectId &&
          requestDto.contextMetadata.organizationId === input.organizationId,
      ],
    ]
      .filter(([, matches]) => !matches)
      .map(([field]) => field);
    if (mismatches.length > 0) {
      this.logger.warn('Rejected Agent fix start-run: differs from record', {
        agentSessionId: requestDto.agentSessionId,
        mismatches,
      });
      throw new ConflictException(
        `Start-run does not match the recorded Agent fix request: ${mismatches.join(', ')}`,
      );
    }
    return true;
  }

  private payloadFor(proposal: Proposal): RunCreatePayloadProposalRefiner {
    return {
      promptType: AGENT_FIX_HANDLER_PROMPT_TYPE,
      entity: { entityType: 'PROPOSAL', entityId: proposal.id },
      payloadVersion: 1,
      userMessage: AGENT_FIX_USER_MESSAGE,
      proposal: {
        id: proposal.id,
        action: proposal.action,
        status: proposal.status,
        targetEntityId: proposal.targetEntityId,
        targetEntityType: proposal.targetEntityType,
        title: proposal.title ?? null,
        updates: (proposal.updates ?? {}) as Record<string, unknown>,
      },
    };
  }

  private async prepareSession(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    proposal: Proposal,
  ): Promise<{
    agentSessionId: string;
    conversationId: string;
    createdAt: Date;
  }> {
    const preparedAt = new Date();
    const session = await this.sessions.create(
      organizationId,
      projectId,
      userId,
      {
        projectId,
        sessionDate: preparedAt.toISOString(),
        title: `Agent fix: ${(proposal.title ?? 'proposal').slice(0, 120)}`,
        type: AgentSessionType.ProposalRefining,
        entityType: EntityType.Proposal,
        entityId: proposal.id,
      } satisfies CreateAgentSessionDto,
    );
    const { conversation } = await this.sessions.createConversationForSession(
      organizationId,
      projectId,
      session.id,
      {
        workflowType: WorkflowName.AgentProposalRefining,
        title: 'Agent fix',
      } satisfies CreateAgentSessionConversationDto,
    );
    return {
      agentSessionId: session.id,
      conversationId: conversation.id,
      createdAt: preparedAt,
    };
  }
}
