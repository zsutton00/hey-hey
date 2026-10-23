import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ConversationStatus,
  InitiationType,
  WorkflowName,
  type GoalPmRoutingAnswer,
  type GoalPmRoutingEnactmentRequest,
  type GoalPmRoutingEnactmentResponse,
  type GoalPmRoutingSelectionPayload,
  type GoalPmRoutingOutcome,
  type GoalPmRoutingCreation,
} from '../generated';
import {
  GoalPmRoutingAnswerSchema,
  GoalPmRoutingEnactmentRequestSchema,
  GoalPmRoutingCompletionRequestSchema,
} from '../generated/goal-pm-decision.schema';
import { PrismaService } from '../prisma/prisma.service';
import type {
  OrganizationId,
  ConversationId,
  UserId,
  ProjectId,
  MessageId,
  WorkflowId,
} from '../types';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { AgentSessionService } from './agent-session.service';
import {
  GOAL_PM_ROUTING_DECISION_TYPE,
  jsonObject,
  routingField,
} from './goal-pm-routing-decision.service';
import { GoalTracksService } from './tasks/goal-tracks.service';
import { ProposalService } from './proposal/proposal.service';
import type { RequestorContext } from '../mcp/tools/requestor-context';
import type { TaskId } from '../types';
import {
  TIMELINE_MESSAGE_WHERE,
  timelineCreatedAt,
} from 'src/utils/message-timeline.util';
import { UserMessageExtractor } from '../utils/user-message-extractor';
import type { UserMessageData } from '../generated';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validRequest = ajv.compile<GoalPmRoutingEnactmentRequest>(
  GoalPmRoutingEnactmentRequestSchema,
);
const validAnswer = ajv.compile<GoalPmRoutingAnswer>(GoalPmRoutingAnswerSchema);
const validCompletion = ajv.compile(GoalPmRoutingCompletionRequestSchema);
type Tx = import('@prisma/client').Prisma.TransactionClient;

@Injectable()
export class GoalPmRoutingEnactmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageService,
    private readonly conversations: ConversationService,
    private readonly sessions: AgentSessionService,
    private readonly tracks: GoalTracksService,
    private readonly proposals: ProposalService,
  ) {}

  async enactWork(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    selection: GoalPmRoutingSelectionPayload,
    token: string | null,
    requestorContext: RequestorContext,
  ): Promise<GoalPmRoutingEnactmentResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const source = await this.source(
          tx,
          organizationId,
          conversationId,
          userId,
          selection,
        );
        const stored = await this.answer(tx, source.id, selection.uiElementId);
        if (!stored) throw new NotFoundException('Routing answer not found');
        const response = this.response(conversationId, selection, stored);
        const option = stored.value.selectedOption;
        if (
          stored.value.state === 'COMPLETED' ||
          (option.kind !== 'trackExistingWork' &&
            option.kind !== 'createMissingWork')
        )
          return response;
        const goalId = routingField(source.data, selection.uiElementId).goalId;
        let outcome: GoalPmRoutingOutcome;
        if (option.kind === 'trackExistingWork') {
          if (option.target.entityType !== 'TASK')
            throw new BadRequestException(
              'Plan tracking is not available here yet',
            );
          const result = await this.tracks.attachToGoal(
            organizationId,
            source.projectId as ProjectId,
            goalId as TaskId,
            {
              targetEntityId: option.target.entityId,
              targetEntityType: 'TASK',
            },
            null,
            token,
          );
          outcome = {
            entityType: 'TASK',
            entityId: result.target.targetEntityId,
            title: result.target.title,
          };
        } else {
          const proposal = await this.proposals.createWithReservedId(
            organizationId,
            source.projectId as ProjectId,
            userId,
            {
              type: 'SINGLE',
              action: 'CREATE',
              targetEntityType: 'TASK',
              targetEntityId: option.parentFeatureId,
              title: option.title,
              eli5: 'Creates a task to help deliver this goal.',
              conversationId,
              tracks: { sourceEntityId: goalId },
              requestorContext,
              updates: {
                name: option.title,
                type: 'STANDARD',
                parentTaskId: option.parentFeatureId,
                status: 'BACKLOG',
                sections: [
                  { key: 'description', content: option.description, order: 0 },
                  {
                    key: 'acceptanceCriteria',
                    content: option.acceptanceCriteria,
                    order: 1,
                  },
                ],
              },
            },
            stored.value.operationId,
          );
          outcome = {
            entityType: 'PROPOSAL',
            entityId: proposal.id,
            title: option.title,
          };
        }
        const value: GoalPmRoutingAnswer = {
          ...stored.value,
          state: 'COMPLETED',
          outcome,
        };
        await this.messages.updateFormAnswerInTransaction(
          tx,
          stored.id as MessageId,
          organizationId,
          source.projectId as ProjectId,
          conversationId,
          { [selection.uiElementId]: value },
        );
        return this.response(conversationId, selection, {
          id: stored.id,
          value,
        });
      },
      { timeout: 60000 },
    );
  }

  async enact(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    input: GoalPmRoutingEnactmentRequest,
  ): Promise<GoalPmRoutingEnactmentResponse> {
    if (!validRequest(input))
      throw new BadRequestException('Invalid routing enactment');
    return this.prisma.$transaction(async (tx) => {
      const source = await this.source(
        tx,
        organizationId,
        conversationId,
        userId,
        input.selection,
      );
      const stored = await this.answer(
        tx,
        source.id,
        input.selection.uiElementId,
      );
      if (stored) return this.response(conversationId, input.selection, stored);
      const legacy = await tx.suggestionDecision.findUnique({
        where: {
          organizationId_type_suggestionId: {
            organizationId,
            type: GOAL_PM_ROUTING_DECISION_TYPE,
            suggestionId: `${source.id}:${input.selection.uiElementId}`,
          },
        },
      });
      if (legacy)
        throw new ConflictException(
          'This historical choice has no recorded outcome and cannot be replayed.',
        );
      const payload = routingField(source.data, input.selection.uiElementId);
      if (payload.goalId !== source.conversation.workflowAboutId)
        throw new BadRequestException('Routing field belongs to another goal');
      const matches = payload.options.filter(
        (option) => option.optionId === input.selection.selectedOptionId,
      );
      const selectedOption = matches[0];
      if (matches.length !== 1 || !selectedOption)
        throw new BadRequestException(
          'Option is not uniquely offered by the source field',
        );
      const answer: GoalPmRoutingAnswer = {
        type: 'GOAL_PM_ROUTING',
        selectedOption,
        operationId: randomUUID(),
        state: 'PENDING',
        requestedAt: new Date().toISOString(),
        pendingRequest:
          input.pendingRequest ??
          (await this.pendingRequest(
            tx,
            conversationId,
            timelineCreatedAt(source),
          )),
        ...(input.creation ? { creation: input.creation } : {}),
      };
      switch (selectedOption.kind) {
        case 'startNewConversation': {
          if (!input.creation)
            throw new BadRequestException(
              'Conversation launch settings are required',
            );
          answer.outcome = await this.createDestination(
            tx,
            organizationId,
            source.projectId as ProjectId,
            userId,
            payload.goalId,
            selectedOption.title,
            input.creation,
          );
          break;
        }
        case 'existingConversation':
        case 'refineSearch': {
          const destinationId =
            selectedOption.kind === 'refineSearch'
              ? conversationId
              : selectedOption.conversationId;
          const session = await tx.agentSession.findFirst({
            where: {
              conversationId: destinationId,
              organizationId,
              projectId: source.projectId as ProjectId,
              userId,
              conversation: {
                workflowAboutId: payload.goalId,
                workflowAboutType: 'task',
                ...(selectedOption.kind === 'existingConversation'
                  ? { workflowName: { not: WorkflowName.GoalPm } }
                  : {}),
              },
            },
            include: { conversation: true },
          });
          if (!session?.conversation)
            throw new NotFoundException(
              'Destination session is not available in this goal',
            );
          answer.outcome = {
            entityType: 'CONVERSATION',
            entityId: destinationId,
            agentSessionId: session.id,
            title: session.conversation.title || selectedOption.title,
          };
          const settings = {
            ...(input.creation ?? {
              config: session.config,
              provider: session.provider,
            }),
            machineId: session.machineId ?? input.creation?.machineId,
          };
          const launch = { selection: input.selection, creation: settings };
          if (!validRequest(launch) || !launch.creation)
            throw new BadRequestException(
              'Destination launch settings are not available',
            );
          answer.creation = launch.creation;
          break;
        }
        case 'proposal': {
          const proposal = await tx.proposal.findFirst({
            where: {
              id: selectedOption.proposalId,
              organizationId,
              projectId: source.projectId,
            },
          });
          if (!proposal)
            throw new NotFoundException('Proposal is not available');
          answer.outcome = {
            entityType: 'PROPOSAL',
            entityId: proposal.id,
            title: selectedOption.title,
          };
          answer.state = 'COMPLETED';
          break;
        }
        case 'trackExistingWork':
        case 'createMissingWork':
          // The receipt reserves the choice before the existing work owner acts.
          // Recovery never authorizes another option after a partial effect.
          break;
      }
      const message = await this.messages.addMessageInTransaction(
        tx,
        {
          type: 'USER',
          projectId: source.projectId as ProjectId,
          conversationId,
          parentMessageId: source.id as MessageId,
          userId,
          data: { [input.selection.uiElementId]: answer },
        },
        organizationId,
        'goal-pm-routing-answer',
        { suppressExecutableDelivery: true },
      );
      return this.response(conversationId, input.selection, {
        id: message.id,
        value: answer,
      });
    });
  }

  private async createDestination(
    tx: Tx,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    goalId: string,
    title: string,
    creation: GoalPmRoutingCreation,
  ): Promise<GoalPmRoutingOutcome> {
    const machine = await tx.machine.findFirst({
      where: {
        id: creation.machineId,
        userId,
        revokedAt: null,
        OR: [{ organizationId }, { organizationId: null }],
      },
    });
    if (!machine)
      throw new BadRequestException('Selected machine is not available');
    const conversation =
      await this.conversations.createConversationInTransaction(
        tx,
        {
          organizationId,
          projectId,
          workflowId: randomUUID() as WorkflowId,
          workflowName: 'agent-entity-conversation',
          workflowAboutType: 'task',
          workflowAboutId: goalId,
          title,
          initiatedBy: InitiationType.User,
          status: ConversationStatus.NotStarted,
          context: {},
        },
        organizationId,
        undefined,
        userId,
      );
    const session = await this.sessions.createInTransaction(
      tx,
      {
        organization: { connect: { id: organizationId } },
        project: { connect: { id: projectId } },
        user: { connect: { id: userId } },
        conversation: { connect: { id: conversation.id } },
        machine: { connect: { id: creation.machineId } },
        type: 'ENTITY_CONVERSATION',
        entityType: 'TASK',
        entityId: goalId,
        title,
        sessionDate: new Date(),
        provider: creation.provider,
        config: jsonObject(creation.config),
      },
      organizationId,
    );
    return {
      entityType: 'CONVERSATION',
      entityId: conversation.id,
      agentSessionId: session.id,
      title,
    };
  }

  async complete(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    selection: GoalPmRoutingSelectionPayload,
  ): Promise<GoalPmRoutingEnactmentResponse> {
    if (!validCompletion({ selection }))
      throw new BadRequestException('Invalid completion');
    return this.prisma.$transaction(async (tx) => {
      const source = await this.source(
        tx,
        organizationId,
        conversationId,
        userId,
        selection,
      );
      const stored = await this.answer(tx, source.id, selection.uiElementId);
      if (!stored) throw new NotFoundException('Routing answer not found');
      this.response(conversationId, selection, stored);
      if (stored.value.state === 'COMPLETED')
        return this.response(conversationId, selection, stored);
      const outcome = stored.value.outcome;
      if (outcome?.entityType !== 'CONVERSATION' || !outcome.agentSessionId)
        throw new ConflictException(
          'This choice has no conversation handoff to complete',
        );
      const operation = await tx.agentOperation.findFirst({
        where: {
          operationId: stored.value.operationId,
          organizationId,
          userId,
          agentSessionId: outcome.agentSessionId,
          conversationId: outcome.entityId,
          state: 'SUCCEEDED',
        },
      });
      if (!operation)
        throw new ConflictException(
          'The request has not completed its authorized handoff',
        );
      const value: GoalPmRoutingAnswer = {
        ...stored.value,
        state: 'COMPLETED',
      };
      await this.messages.updateFormAnswerInTransaction(
        tx,
        stored.id as MessageId,
        organizationId,
        source.projectId as ProjectId,
        conversationId,
        { [selection.uiElementId]: value },
      );
      return this.response(conversationId, selection, { id: stored.id, value });
    });
  }

  private async pendingRequest(
    tx: Tx,
    conversationId: ConversationId,
    before: Date,
  ): Promise<string> {
    const messages = await tx.message.findMany({
      where: {
        conversationId,
        type: 'USER',
        AND: [TIMELINE_MESSAGE_WHERE, { createdAt: { lt: before } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    for (const message of messages) {
      const data = message.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const input = data.agentInput;
      // A refinement asks a new routing question while retaining the original
      // substantive request. Its linked receipt is the durable draft owner.
      if (
        input &&
        typeof input === 'object' &&
        !Array.isArray(input) &&
        input.promptType === 'goal_pm' &&
        typeof input.userMessage === 'string'
      ) {
        const operation = await tx.agentOperation.findFirst({
          where: { messageId: message.id, conversationId },
          select: { operationId: true },
        });
        const refinement = messages
          .flatMap((previous) => {
            const fields = previous.data;
            return fields &&
              typeof fields === 'object' &&
              !Array.isArray(fields)
              ? Object.values(fields)
              : [];
          })
          .find(
            (value) =>
              validAnswer(value) &&
              value.selectedOption.kind === 'refineSearch' &&
              value.operationId === operation?.operationId,
          );
        if (validAnswer(refinement)) return refinement.pendingRequest;
      }
      // The lazy first-message start stores the request as plain `comment`
      // data without an `agentInput` envelope.
      const content = UserMessageExtractor.extractContentFromData(
        data as UserMessageData,
        '',
      );
      if (content) return content;
    }
    throw new BadRequestException(
      'The pending Goal PM request could not be recovered',
    );
  }

  private async source(
    tx: Tx,
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    selection: GoalPmRoutingSelectionPayload,
  ) {
    // Lock the canonical source, not an in-memory component instance.
    await tx.$queryRaw`SELECT id FROM messages WHERE id = ${selection.sourceMessageId} FOR UPDATE`;
    const source = await tx.message.findFirst({
      where: {
        id: selection.sourceMessageId,
        conversationId,
        type: 'SYSTEM',
        conversation: {
          organizationId,
          workflowName: WorkflowName.GoalPm,
          agentSessions: { some: { userId, organizationId } },
        },
      },
      include: { conversation: true },
    });
    if (!source)
      throw new NotFoundException('Goal PM source message is not available');
    const goal = await tx.task.findFirst({
      where: {
        id: source.conversation.workflowAboutId ?? '',
        organizationId,
        projectId: source.projectId as ProjectId,
        type: 'GOAL',
        archivedAt: null,
      },
    });
    if (!goal) throw new NotFoundException('Goal is not available');
    return source;
  }

  private async answer(
    tx: Tx,
    sourceMessageId: string,
    field: string,
  ): Promise<{ id: string; value: GoalPmRoutingAnswer } | null> {
    const answers = await tx.message.findMany({
      where: { parentMessageId: sourceMessageId, type: 'USER' },
    });
    for (const message of answers) {
      const data = message.data;
      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        field in data
      ) {
        const value = data[field];
        if (!validAnswer(value))
          throw new ConflictException(
            'The source field has an incompatible historical answer',
          );
        return { id: message.id, value };
      }
    }
    return null;
  }

  private response(
    conversationId: ConversationId,
    selection: GoalPmRoutingSelectionPayload,
    stored: { id: string; value: GoalPmRoutingAnswer },
  ): GoalPmRoutingEnactmentResponse {
    if (stored.value.selectedOption.optionId !== selection.selectedOptionId)
      throw new ConflictException(
        'This field already has a different selection',
      );
    return {
      sourceConversationId: conversationId,
      sourceMessageId: selection.sourceMessageId as MessageId,
      uiElementId: selection.uiElementId,
      answerMessageId: stored.id as MessageId,
      answer: stored.value,
    };
  }
}
