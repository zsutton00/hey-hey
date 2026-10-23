import {
  TIMELINE_MESSAGE_WHERE,
  timelineCreatedAt,
} from 'src/utils/message-timeline.util';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import {
  EntityType,
  Prisma,
  ReportEntityRelation as PrismaReportEntityRelation,
} from '@prisma/client';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  ConversationId,
  JobId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from 'src/types';
import { MessageStatus } from '../constants/message-status.constants';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import {
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageUpdatedEvent,
} from '../core/events/types/domain-events';
import {
  OnboardingReplyDelivery,
  RepositoryImportReplyDelivery,
} from '../core/events/types/event.types';
import { MentionCreatedEvent } from '../generated/model/mentionCreatedEvent';
import { MentionRemovedEvent } from '../generated/model/mentionRemovedEvent';
import {
  EventContextManager,
  WithEventContext,
} from '../core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../core/events/tokens';
import {
  CreateSystemMessage,
  CreateUserMessage,
  ConversationMessageHistoryPageDto,
  UpdateMessageDto as GeneratedUpdateMessageDto,
  GetMessagesQueryDto,
  GetAgentSessionResponse,
  MessageMention,
  MessageResponseDto,
  MessageRecordDto,
  MessageReadMode,
  MessageType,
  MessageUpdatedEventPayload,
  MentionCreatedEventPayload,
  MentionRemovedEventPayload,
  ProposalResponseDto,
  SearchConversationMessagesResponseDto,
  SecondaryActionHandler,
  SystemMessageData,
  UserMessageData,
} from '../generated';
import { AnyTransactionClient, PrismaService } from '../prisma/prisma.service';

import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import { RedisService } from 'src/core/redis/redis.service';
import {
  isTimelineMessage,
  prismaMessageResultToMessageRecordDto,
  prismaMessageResultToResponseDto,
} from 'src/mappers/message.mapper';
import {
  isAgentSystemMessageData,
  isQuestionSystemMessageData,
} from 'src/utils/type-checks';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import { MessageQueryResult } from './types';
import {
  currentWritingSessionId,
  EvalOutputAdmissionService,
} from './eval/eval-output-admission.service';
import { MentionProcessingService } from './mentions/mention-processing.service';
import { ProjectApprovalPolicyService } from './proposal/project-approval-policy.service';
import {
  mapProposalResponses,
  resolveProjectApprovalPolicies,
} from './proposal/proposal-response-policy';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from './proposal/proposal-visibility';
import { WorkItemTypeRegistryService } from './tasks/work-item-type-registry.service';
import { ReportService } from './reports/report.service';
import {
  ConversationMessageHistoryCursorError,
  decodeConversationMessageHistoryCursor,
  encodeConversationMessageHistoryCursor,
} from './conversation-message-history-cursor';
import {
  getContentFromMessageData,
  MessageDataForContent,
} from 'src/utils/message-content.util';
import {
  buildMessageCreatedEventPayload,
  buildMentionCreatedEventPayload,
  buildMentionRemovedEventPayload,
  buildMessageUpdatedEventPayload,
  buildMessageDeletedEventPayload,
  hasRagDisabled,
} from 'src/utils/message-event.util';

type UpdateMessageDto = Omit<GeneratedUpdateMessageDto, 'status' | 'data'> & {
  status?: MessageStatus;
  data?: SystemMessageData | Partial<SystemMessageData> | UserMessageData;
};

type CreateMessageAdapterInput =
  | (CreateUserMessage & { id?: MessageId })
  | (CreateSystemMessage & { id?: MessageId });
type CreateMessageBaseInput = {
  /**
   * Optional pre-generated id for the persisted row. Used by the trigger
   * persistence seam (activities.ts createSystemMessage, node-execution's
   * startExternalAgentNode) so it can stamp `triggerMessageId` onto the
   * AgentTrigger body *before* the row is written, keeping the persisted
   * `data.triggersAgent.triggerMessageId` and the row's `id` in lockstep.
   * Callers without this constraint leave it unset and Prisma generates one.
   */
  id?: MessageId;
  projectId: ProjectId;
  status?: MessageStatus;
  userId?: string;
  conversationId: ConversationId;
  parentMessageId?: MessageId | null;
  createdAt?: string;
};

type MessageWithProposalReferences = MessageQueryResult & {
  proposalReferences?: Array<{
    proposal: Prisma.ProposalGetPayload<{
      include: { approvalRecords: true };
    }>;
  }>;
};
type CreateSystemMessageInput = CreateMessageBaseInput &
  Pick<CreateSystemMessage, 'proposalIds' | 'reportIds'> & {
    type: 'SYSTEM';
    data: SystemMessageData;
  };
type CreateUserMessageInput = CreateMessageBaseInput & {
  type: 'USER';
  data: UserMessageData;
  handler?: SecondaryActionHandler;
};
export type CreateMessageInput =
  | CreateUserMessageInput
  | CreateSystemMessageInput;
type MentionRecord = MessageMention & { id: string };

type SystemMessageAttachmentPlan = {
  proposalIds: string[];
  proposalIdsToClaim: string[];
  proposalGroupIds: string[];
  reportIds: string[];
};

export const PENDING_MSG_TTL = 3600; // 1 hour TTL to prevent memory leaks
export const PENDING_MSG_BY_JOB_PREFIX = 'pending_msg:job:';
export const PENDING_MSG_BY_REQUEST_PREFIX = 'pending_msg:request:';

type AgentSessionHistoryCursor = {
  version: 1;
  agentSessionId: string;
  conversationId: string;
  createdAt: string;
  id: string;
};

export class AgentSessionHistoryCursorError extends BadRequestException {
  constructor() {
    super('cursor is invalid for this Agent Session Conversation');
  }
}
// Type representing a Prisma Message query result with included responses and parentMessage
// This type is complex due to recursive relations, so we use documentation instead of strict typing

// Define locally now that observable-event.service.ts is removed

export type AddMessageInTransactionOptions = {
  messageCreatedEventScheduledFor?: Date;
  expectedConversationVersion?: number;
  onboardingReplyDelivery?: OnboardingReplyDelivery;
  repositoryImportReplyDelivery?: RepositoryImportReplyDelivery;
  suppressExecutableDelivery?: boolean;
  /**
   * Inserts the row as a queued executable input owned by this operation.
   * Queued inputs are undated: `createdAt` and `contentUpdatedAt` stay null
   * until the platform accepts the agent's start of the input.
   */
  executableOperationId?: string;
};

@Injectable()
export class MessageService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    MessageService.name,
  );

  /**
   * Recent prepend writes keyed on the `beforeMessageId` target. Used by
   * `prependMessage` to detect two prepends racing on the same target inside
   * the 100ms fork-bug window and emit a `workflow.message.prepend.burst`
   * warning when it happens. Cleaned up opportunistically at write time —
   * a separate timer/job is not warranted for a single in-memory map whose
   * entries expire after 100ms of inactivity per key.
   */
  private readonly recentPrependsByBeforeMessageId = new Map<
    string,
    { newMessageId: string; timestamp: number }
  >();
  private static readonly PREPEND_BURST_WINDOW_MS = 100;

  constructor(
    private prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    private redisService: RedisService,
    private mentionProcessingService: MentionProcessingService,
    @Inject(forwardRef(() => ReportService))
    private reportService: ReportService,
    @Optional()
    private projectApprovalPolicyService: ProjectApprovalPolicyService = new ProjectApprovalPolicyService(),
    @Optional()
    private evalOutputAdmission: EvalOutputAdmissionService = new EvalOutputAdmissionService(),
    @Optional()
    private readonly workItemTypeRegistry?: WorkItemTypeRegistryService,
  ) {}

  /**
   * Admits a message written by an eval target. The message stays readable
   * but is written with ragEnabled false so nothing ingests it.
   */
  private async admitEvalOutput(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    messageData: CreateMessageInput,
  ): Promise<CreateMessageInput> {
    const writingSessionId = currentWritingSessionId();
    if (!writingSessionId) {
      return messageData;
    }
    const stamp = await this.evalOutputAdmission.resolve(tx, {
      organizationId,
      projectId: messageData.projectId,
      writingSessionId,
    });
    if (!stamp.isEvalOutput) {
      return messageData;
    }
    return {
      ...messageData,
      data: {
        ...(messageData.data as object),
        ragEnabled: stamp.ragEnabled,
      },
    } as CreateMessageInput;
  }

  /**
   * Remove a trigger from the reconnect-delivery projection after its initial
   * start-run dispatch receives a negative acknowledgement. Keep the message
   * row for diagnostics and history; only the durable delivery eligibility is
   * being discarded.
   */
  async removePendingOpenTrigger(messageId: MessageId): Promise<void> {
    const removed = await this.prisma.db.pendingOpenTrigger.deleteMany({
      where: { messageId },
    });
    this.logger.log('[removePendingOpenTrigger] removed failed trigger', {
      messageId,
      removed: removed.count,
    });
  }

  private collectUserIds(messages: MessageQueryResult[]): Set<string> {
    const ids = new Set<string>();
    const visit = (msg: MessageQueryResult) => {
      if (msg.userId && msg.userId !== 'system') {
        ids.add(msg.userId);
      }
      msg.responses?.forEach(visit);
      if (msg.parentMessage) visit(msg.parentMessage);
    };
    messages.forEach(visit);
    return ids;
  }

  private attachUsers(
    messages: MessageQueryResult[],
    userMap: Map<string, MessageQueryResult['user']>,
  ): void {
    const visit = (msg: MessageQueryResult) => {
      if (msg.userId && msg.userId !== 'system') {
        msg.user = userMap.get(msg.userId) ?? null;
      }
      msg.responses?.forEach(visit);
      if (msg.parentMessage) visit(msg.parentMessage);
    };
    messages.forEach(visit);
  }

  private async resolveLatestMessageId(
    tx: Prisma.TransactionClient,
    conversationId: ConversationId | string,
  ): Promise<string | undefined> {
    const latest = await tx.message.findFirst({
      where: { conversationId, ...TIMELINE_MESSAGE_WHERE },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return latest?.id;
  }

  private async resolveMessageUsers(
    messages: MessageQueryResult[],
  ): Promise<void> {
    const userIds = this.collectUserIds(messages);
    if (userIds.size === 0) return;

    const users = await this.prisma.db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    this.attachUsers(messages, userMap);
  }

  private async mapMessageResults(
    results: MessageWithProposalReferences[],
  ): Promise<MessageResponseDto[]> {
    return this.mapMessageResultsWith(
      results,
      prismaMessageResultToResponseDto,
    );
  }

  private async mapMessageResultsWith<T>(
    results: MessageWithProposalReferences[],
    map: (
      result: MessageQueryResult,
      workflowId: WorkflowId,
      proposalDtosById: ReadonlyMap<string, ProposalResponseDto>,
    ) => T,
  ): Promise<T[]> {
    const queryResults = results.map((result) => ({
      ...result,
      proposals: result.proposalReferences?.map(
        (reference) => reference.proposal,
      ),
    })) as MessageQueryResult[];
    await this.resolveMessageUsers(queryResults);
    const proposals = queryResults.flatMap((result) => result.proposals ?? []);
    const projectPolicies = await resolveProjectApprovalPolicies(
      this.projectApprovalPolicyService,
      proposals,
    );
    const proposalDtos = await mapProposalResponses(
      this.prisma.db,
      proposals,
      projectPolicies,
      { workItemTypeRegistry: this.workItemTypeRegistry },
    );
    const proposalDtosById = new Map<string, ProposalResponseDto>(
      proposalDtos.map((proposal) => [proposal.id, proposal]),
    );

    return queryResults.map((result) =>
      map(
        result,
        (result.conversation?.workflowId ?? undefined) as WorkflowId,
        proposalDtosById,
      ),
    );
  }

  private assertUniqueAttachmentIds(
    ids: readonly string[],
    artifactName: 'Proposal' | 'Report',
  ): void {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Duplicate ' + artifactName + ' attachment identifiers are not allowed',
      );
    }
  }

  private assertAttachmentIdsAreSystemOnly(
    dto: CreateMessageAdapterInput,
  ): void {
    if (dto.type === 'USER' && ('proposalIds' in dto || 'reportIds' in dto)) {
      throw new BadRequestException(
        'Proposal and Report attachment identifiers are only accepted for SYSTEM messages',
      );
    }
  }

  private async lockReportAttachmentRows(
    tx: AnyTransactionClient,
    reportIds: readonly string[],
    scope: {
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
  ): Promise<void> {
    if (reportIds.length === 0) return;

    // ReportEntity's uniqueness is per report/message pair, so it cannot by
    // itself prevent two concurrent final Messages from claiming one Report.
    // Lock the scoped Report rows before reading their associations; sorting
    // gives concurrent attachment transactions a consistent lock order.
    const sortedReportIds = [...reportIds].sort();
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "reports"
      WHERE "id" IN (${Prisma.join(sortedReportIds)})
        AND "organization_id" = ${scope.organizationId}
        AND "project_id" = ${scope.projectId}
      ORDER BY "id" ASC
      FOR UPDATE
    `;
  }

  private async lockProposalAttachmentRows(
    tx: AnyTransactionClient,
    proposalIds: readonly string[],
    scope: { organizationId: OrganizationId; projectId: ProjectId },
  ): Promise<void> {
    if (proposalIds.length === 0) return;
    const sortedProposalIds = [...proposalIds].sort();
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "proposals"
      WHERE "id" IN (${Prisma.join(sortedProposalIds)})
        AND "organization_id" = ${scope.organizationId}
        AND "project_id" = ${scope.projectId}
      ORDER BY "id" ASC
      FOR UPDATE
    `;
  }

  private async validateSystemMessageAttachments(
    tx: AnyTransactionClient,
    messageData: CreateSystemMessageInput,
    scope: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      conversationId: ConversationId;
    },
  ): Promise<SystemMessageAttachmentPlan | undefined> {
    const proposalIds = messageData.proposalIds ?? [];
    const reportIds = messageData.reportIds ?? [];

    if (proposalIds.length === 0 && reportIds.length === 0) {
      return undefined;
    }

    this.assertUniqueAttachmentIds(proposalIds, 'Proposal');
    this.assertUniqueAttachmentIds(reportIds, 'Report');
    await this.lockProposalAttachmentRows(tx, proposalIds, scope);
    await this.lockReportAttachmentRows(tx, reportIds, scope);

    const [proposals, reports] = await Promise.all([
      proposalIds.length > 0
        ? tx.proposal.findMany({
            where: {
              id: { in: proposalIds },
              organizationId: scope.organizationId,
              projectId: scope.projectId,
            },
            select: {
              id: true,
              conversationId: true,
              messageId: true,
              groupMembership: {
                select: {
                  groupId: true,
                  group: {
                    select: {
                      id: true,
                      organizationId: true,
                      projectId: true,
                      conversationId: true,
                      messageId: true,
                      members: {
                        select: { proposalId: true },
                      },
                    },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
      reportIds.length > 0
        ? tx.report.findMany({
            where: {
              id: { in: reportIds },
              organizationId: scope.organizationId,
              projectId: scope.projectId,
            },
            select: {
              id: true,
              reportEntities: {
                select: {
                  entityType: true,
                  entityId: true,
                  relation: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const foundProposalIds = new Set(
      proposals.map((proposal: { id: string }) => proposal.id),
    );
    if (foundProposalIds.size !== proposalIds.length) {
      throw new BadRequestException(
        'One or more Proposal attachments are missing or outside the requested scope',
      );
    }

    const groupsById = new Map<
      string,
      {
        id: string;
        messageId?: string | null;
        conversationId: string | null;
        members: Array<{ proposalId: string }>;
      }
    >();

    for (const proposalId of proposalIds) {
      const proposal = proposals.find(
        (candidate: { id: string }) => candidate.id === proposalId,
      );
      if (!proposal) {
        throw new BadRequestException(
          'One or more Proposal attachments are missing or outside the requested scope',
        );
      }

      const membership = proposal.groupMembership;
      if (!membership) continue;

      const group = membership.group;
      if (!group || group.id !== membership.groupId) {
        throw new BadRequestException(
          'One or more Proposal Group attachments are invalid',
        );
      }
      if (
        group.organizationId !== scope.organizationId ||
        group.projectId !== scope.projectId
      ) {
        throw new BadRequestException(
          'One or more Proposal Group attachments are outside the requested scope',
        );
      }
      if (!Array.isArray(group.members) || group.members.length === 0) {
        throw new BadRequestException(
          'One or more Proposal Group attachments have no members',
        );
      }

      groupsById.set(group.id, group);
    }

    const reportIdsFound = new Set(
      reports.map((report: { id: string }) => report.id),
    );
    if (reportIdsFound.size !== reportIds.length) {
      throw new BadRequestException(
        'One or more Report attachments are missing or outside the requested scope',
      );
    }

    for (const report of reports) {
      const reportEntities = Array.isArray(report.reportEntities)
        ? report.reportEntities
        : [];
      if (
        reportEntities.some(
          (entity: { entityType: EntityType }) =>
            entity.entityType === EntityType.MESSAGE,
        )
      ) {
        throw new ConflictException(
          'One or more Report attachments already belong to a Message',
        );
      }
      if (
        reportEntities.some(
          (entity: { entityType: EntityType; entityId: string }) =>
            entity.entityType === EntityType.CONVERSATION &&
            entity.entityId !== scope.conversationId,
        )
      ) {
        throw new BadRequestException(
          'One or more Report attachments are outside the requested conversation',
        );
      }
    }

    const requestedProposalIds = new Set(proposalIds);
    const proposalGroupIds = [...groupsById.values()]
      .filter(
        (group) =>
          group.messageId === null &&
          (group.conversationId === null ||
            group.conversationId === scope.conversationId) &&
          group.members.every((member) =>
            requestedProposalIds.has(member.proposalId),
          ),
      )
      .map((group) => group.id);

    return {
      proposalIds: [...proposalIds],
      proposalIdsToClaim: proposals
        .filter(
          (proposal: {
            messageId: string | null;
            conversationId: string | null;
          }) =>
            proposal.messageId === null &&
            proposal.conversationId === scope.conversationId,
        )
        .map((proposal: { id: string }) => proposal.id),
      proposalGroupIds,
      reportIds: [...reportIds],
    };
  }

  private async persistSystemMessageAttachments(
    tx: AnyTransactionClient,
    plan: SystemMessageAttachmentPlan | undefined,
    scope: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      conversationId: ConversationId;
    },
    messageId: MessageId,
  ): Promise<void> {
    if (!plan) return;

    if (plan.proposalIdsToClaim.length > 0) {
      const attachedProposals = await tx.proposal.updateMany({
        where: {
          id: { in: plan.proposalIdsToClaim },
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          conversationId: scope.conversationId,
          messageId: null,
        },
        data: { messageId },
      });
      if (attachedProposals.count !== plan.proposalIdsToClaim.length) {
        throw new ConflictException(
          'Proposal attachments changed before Message ownership was committed',
        );
      }
    }

    if (plan.proposalIds.length > 0) {
      await tx.messageProposalReference.createMany({
        data: plan.proposalIds.map((proposalId, position) => ({
          messageId,
          proposalId,
          position,
        })),
      });
    }

    if (plan.proposalGroupIds.length > 0) {
      const attachedGroups = await tx.proposalGroup.updateMany({
        where: {
          id: { in: plan.proposalGroupIds },
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          OR: [
            { conversationId: null },
            { conversationId: scope.conversationId },
          ],
          messageId: null,
        },
        data: { messageId },
      });
      if (attachedGroups.count !== plan.proposalGroupIds.length) {
        throw new ConflictException(
          'Proposal Group attachments changed before Message ownership was committed',
        );
      }
    }

    if (plan.reportIds.length > 0) {
      await tx.reportEntity.createMany({
        data: plan.reportIds.map((reportId) => ({
          reportId,
          entityType: EntityType.MESSAGE,
          entityId: messageId,
          relation: PrismaReportEntityRelation.CONTEXT,
        })),
      });
    }
  }

  private async publishMessageCreatedEvent(
    tx: Prisma.TransactionClient,
    params: {
      messageId: MessageId;
      organizationId: OrganizationId;
      projectId: ProjectId;
      workflowId?: WorkflowId;
      conversationId: ConversationId;
      message: CreateMessageInput;
      parentMessage?: MessageQueryResult | null;
      nodeId?: string;
      mentions?: MessageMention[];
      scheduledFor?: Date;
      onboardingReplyDelivery?: OnboardingReplyDelivery;
      repositoryImportReplyDelivery?: RepositoryImportReplyDelivery;
      suppressExecutableDelivery?: boolean;
    },
  ): Promise<string | null> {
    const payload = buildMessageCreatedEventPayload(
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        workflowId: params.workflowId,
        conversationId: params.conversationId,
        nodeId: params.nodeId,
        message: params.message as unknown as
          | CreateUserMessage
          | CreateSystemMessage,
        mentions: params.mentions,
        parentMessage: params.parentMessage as
          | {
              id: MessageId;
              type: string;
              data?: SystemMessageData | UserMessageData | null;
            }
          | null
          | undefined,
      },
      this.logger,
    );

    const deliverySafePayload = params.suppressExecutableDelivery
      ? {
          ...payload,
          completesExternalAgentNode: undefined,
          triggersAgent: undefined,
        }
      : payload;

    const event: Omit<MessageCreatedEvent, 'id'> = {
      type: EVENT_TYPES.MESSAGE.CREATED,
      aggregateId: params.messageId,
      payload: {
        ...deliverySafePayload,
        ...(params.onboardingReplyDelivery
          ? { onboardingReplyDelivery: params.onboardingReplyDelivery }
          : {}),
        ...(params.repositoryImportReplyDelivery
          ? {
              repositoryImportReplyDelivery:
                params.repositoryImportReplyDelivery,
            }
          : {}),
      },
    };

    return this.eventPublisher.publishInTransaction(
      tx,
      event,
      {},
      {
        ...(params.scheduledFor ? { scheduledFor: params.scheduledFor } : {}),
      },
    );
  }

  private async publishMentionCreatedEvents(
    tx: Prisma.TransactionClient,
    params: {
      mentions: MentionRecord[];
      organizationId: OrganizationId;
      projectId: ProjectId;
      workflowId?: WorkflowId;
      conversationId: ConversationId;
      messageId: MessageId;
      workflowAboutId?: string | null;
      workflowAboutType?: string | null;
      nodeId?: string;
      userId?: UserId;
    },
  ): Promise<void> {
    const {
      mentions,
      workflowAboutId,
      workflowAboutType,
      organizationId,
      projectId,
      workflowId,
      conversationId,
      messageId,
      nodeId,
      userId,
    } = params;

    if (!mentions.length) {
      return;
    }

    if (!workflowAboutId || !workflowAboutType) {
      this.logger.debug(
        '[publishMentionCreatedEvents] Missing workflow about metadata',
        {
          messageId,
          workflowAboutId,
          workflowAboutType,
        },
      );
      return;
    }

    for (const mention of mentions) {
      const payload = buildMentionCreatedEventPayload({
        organizationId,
        projectId,
        workflowId,
        sourceEntityId: messageId,
        sourceEntityType:
          MentionCreatedEventPayload.SourceEntityTypeEnum.Message,
        conversationId,
        messageId,
        workflowAboutId,
        workflowAboutType,
        entityId: mention.entityId,
        entityType:
          mention.entityType as MentionCreatedEventPayload.EntityTypeEnum,
        nodeId,
        userId,
      });

      const event: Omit<MentionCreatedEvent, 'id'> = {
        type: EVENT_TYPES.MENTION.CREATED,
        aggregateId: mention.id,
        payload,
      };

      await this.eventPublisher.publishInTransaction(tx, event);
    }
  }

  private async publishMentionRemovedEvents(
    tx: Prisma.TransactionClient,
    params: {
      mentions: MentionRecord[];
      organizationId: OrganizationId;
      projectId: ProjectId;
      workflowId?: WorkflowId;
      conversationId: ConversationId;
      messageId: MessageId;
      userId?: UserId;
    },
  ): Promise<void> {
    const {
      mentions,
      organizationId,
      projectId,
      workflowId,
      conversationId,
      messageId,
      userId,
    } = params;

    if (!mentions.length) {
      return;
    }

    this.logger.debug('[publishMentionRemovedEvents] publishing events', {
      messageId,
      removedCount: mentions.length,
    });

    for (const mention of mentions) {
      const payload = buildMentionRemovedEventPayload({
        organizationId,
        projectId,
        workflowId,
        sourceEntityId: messageId,
        sourceEntityType:
          MentionRemovedEventPayload.SourceEntityTypeEnum.Message,
        conversationId,
        entityId: mention.entityId,
        entityType:
          mention.entityType as MentionRemovedEventPayload.EntityTypeEnum,
        userId,
      });

      const event: Omit<MentionRemovedEvent, 'id'> = {
        type: EVENT_TYPES.MENTION.REMOVED,
        aggregateId: mention.id,
        payload,
      };

      await this.eventPublisher.publishInTransaction(tx, event);
    }
  }

  private async isEvalOutput(
    tx: AnyTransactionClient,
    messageId: MessageId,
  ): Promise<boolean> {
    const message = await tx.message.findUnique({
      where: { id: messageId },
      select: { data: true },
    });
    return hasRagDisabled(message?.data);
  }

  public async publishMessageUpdatedEvent(
    tx: AnyTransactionClient,
    params: {
      messageId: MessageId;
      organizationId: OrganizationId;
      projectId: ProjectId;
      workflowId?: WorkflowId;
      nodeId?: string;
      update: UpdateMessageDto;
      conversationId: ConversationId;
      /** Known by callers that already read the message; looked up otherwise. */
      inert?: boolean;
    },
  ): Promise<string | null> {
    const inert =
      params.inert ??
      (params.update.data !== undefined &&
        (await this.isEvalOutput(tx, params.messageId)));
    const payload = buildMessageUpdatedEventPayload(
      {
        inert,
        workflowId: params.workflowId,
        nodeId: params.nodeId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        conversationId: params.conversationId,
        update: params.update as MessageUpdatedEventPayload['update'],
      },
      this.logger,
    );

    const event: Omit<MessageUpdatedEvent, 'id'> = {
      type: EVENT_TYPES.MESSAGE.UPDATED,
      aggregateId: params.messageId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishMessageDeletedEvent(
    tx: Prisma.TransactionClient,
    params: {
      messageId: MessageId;
      organizationId: OrganizationId;
      projectId: ProjectId;
      conversationId: ConversationId;
      workflowId?: WorkflowId;
      deletedBy: string;
    },
  ): Promise<string | null> {
    const payload = buildMessageDeletedEventPayload({
      organizationId: params.organizationId,
      projectId: params.projectId,
      conversationId: params.conversationId,
      workflowId: params.workflowId,
      deletedBy: params.deletedBy,
    });

    const event: Omit<MessageDeletedEvent, 'id'> = {
      type: EVENT_TYPES.MESSAGE.DELETED,
      aggregateId: params.messageId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  // Adapter methods for external API integration
  async getMessagesForAdapter(
    query: GetMessagesQueryDto,
    organizationId: OrganizationId,
    authorizedProjectId: ProjectId,
    includeResponses = true,
    includeProposals = true,
    includeReports = false,
  ): Promise<MessageResponseDto[] | ConversationMessageHistoryPageDto> {
    if (query.mode === MessageReadMode.ReverseHistory) {
      return this.getConversationMessageHistoryPage({
        query,
        organizationId,
        projectId: authorizedProjectId,
        includeResponses,
        includeProposals,
        includeReports,
      });
    }
    return this.getMessages(
      query,
      organizationId,
      includeResponses,
      includeProposals,
      includeReports,
    );
  }

  async getMessageForAdapter(
    id: string,
    organizationId: OrganizationId,
    includeResponses = true,
  ): Promise<MessageRecordDto | null> {
    return this.getMessage(id, organizationId, includeResponses);
  }

  async addMessageFromAdapter(
    dto: CreateMessageAdapterInput,
    organizationId: OrganizationId,
  ): Promise<MessageResponseDto> {
    this.assertAttachmentIdsAreSystemOnly(dto);

    if (!dto.conversationId) {
      throw new BadRequestException('conversationId is required');
    }

    const conversation = await this.prisma.db.conversation.findFirst({
      where: {
        id: dto.conversationId,
        organizationId,
      },
      select: {
        projectId: true,
      },
    });

    if (!conversation) {
      throw new BadRequestException('Conversation not found');
    }
    if (!conversation.projectId) {
      throw new BadRequestException('Conversation does not have a projectId');
    }
    if (conversation.projectId !== dto.projectId) {
      throw new BadRequestException(
        'Message projectId does not match conversation projectId',
      );
    }

    let parentMessageId = dto.parentMessageId as MessageId | undefined;

    if (parentMessageId == null) {
      const latest = await this.prisma.db.message.findFirst({
        where: {
          conversationId: dto.conversationId,
          ...TIMELINE_MESSAGE_WHERE,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      parentMessageId = latest?.id as MessageId | undefined;

      this.logger.debug(
        '[addMessageFromAdapter] Resolved tail parentMessageId',
        {
          conversationId: dto.conversationId,
          parentMessageId,
        },
      );
    }

    const createMessageDto = {
      ...dto,
      projectId: conversation.projectId as ProjectId,
      parentMessageId,
    } as CreateMessageInput;

    return this.addMessage(createMessageDto, organizationId, 'adapter');
  }

  async prependMessageFromAdapter(
    targetMessageId: MessageId,
    dto: CreateMessageAdapterInput,
    organizationId: OrganizationId,
  ): Promise<MessageResponseDto> {
    this.assertAttachmentIdsAreSystemOnly(dto);

    if (!dto.conversationId) {
      throw new BadRequestException('conversationId is required');
    }

    const conversation = await this.prisma.db.conversation.findFirst({
      where: {
        id: dto.conversationId,
        organizationId,
      },
      select: { projectId: true },
    });

    if (!conversation) {
      throw new BadRequestException('Conversation not found');
    }
    if (!conversation.projectId) {
      throw new BadRequestException('Conversation does not have a projectId');
    }
    if (conversation.projectId !== dto.projectId) {
      throw new BadRequestException(
        'Message projectId does not match conversation projectId',
      );
    }

    const createMessageDto = {
      ...dto,
      projectId: conversation.projectId as ProjectId,
    } as CreateMessageInput;

    return this.prependMessage(
      targetMessageId,
      createMessageDto,
      organizationId,
      'adapter',
    );
  }

  async updateMessageFromAdapter(
    id: string,
    organizationId: OrganizationId,
    dto: UpdateMessageDto,
  ): Promise<MessageResponseDto> {
    return this.updateMessage(id, organizationId, dto, { source: 'adapter' });
  }

  async setPendingMessageByJob(
    jobId: string,
    messageId: string,
  ): Promise<void> {
    this.logger.debug('setting pending message by job', {
      jobId,
      messageId,
    });
    await this.redisService
      .getClient()
      .setex(PENDING_MSG_BY_JOB_PREFIX + jobId, PENDING_MSG_TTL, messageId);
  }

  async setPendingMessage(
    params: { requestId: RequestId; jobId: JobId },
    messageId: string,
  ): Promise<void> {
    this.logger.debug('setting pending message', {
      params,
      messageId,
    });
    await this.redisService
      .getClient()
      .setex(
        PENDING_MSG_BY_REQUEST_PREFIX + params.requestId,
        PENDING_MSG_TTL,
        messageId,
      );
    await this.redisService
      .getClient()
      .setex(
        PENDING_MSG_BY_JOB_PREFIX + params.jobId,
        PENDING_MSG_TTL,
        messageId,
      );
  }

  /**
   * Get messageId by jobId from Redis
   */
  async getPendingMessageByJob(jobId: string): Promise<string | null> {
    const messageId = await this.redisService
      .getClient()
      .get(PENDING_MSG_BY_JOB_PREFIX + jobId);
    this.logger.debug('got pending message by job?', {
      jobId,
      messageId,
    });
    return messageId;
  }

  /**
   * Get messageId by requestId from Redis
   */
  async getPendingMessageByRequest(requestId: string): Promise<string | null> {
    const messageId = await this.redisService
      .getClient()
      .get(PENDING_MSG_BY_REQUEST_PREFIX + requestId);
    this.logger.debug('got pending message by requestId?', {
      requestId,
      messageId,
    });
    return messageId;
  }

  async getMessage(
    id: string,
    organizationId: OrganizationId,
    includeResponses = true,
  ): Promise<MessageRecordDto | null> {
    const result = await this.prisma.db.message.findFirst({
      where: {
        id,
        // CRITICAL: Filter by organization through conversation relationship
        conversation: {
          organizationId,
        },
      },
      include: {
        responses: includeResponses,
        parentMessage: true,
        proposalReferences: {
          where: { proposal: ORDINARY_PROPOSAL_VISIBILITY_WHERE },
          include: {
            proposal: { include: { approvalRecords: true } },
          },
          orderBy: { position: 'asc' },
        },
        conversation: {
          select: {
            workflowId: true,
          },
        },
      },
    });
    if (!result) return null;
    const [message] = await this.mapMessageResultsWith(
      [result as MessageWithProposalReferences],
      prismaMessageResultToMessageRecordDto,
    );
    return message ?? null;
  }

  /**
   * Queued executable inputs of a conversation in send order. They are
   * undated, so order comes from the owning AgentOperation.
   */
  async getQueuedInputs(
    conversationId: ConversationId,
  ): Promise<MessageRecordDto[]> {
    const ordered = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT m.id
      FROM messages m
      JOIN agent_operations o ON o.operation_id = m.execution_operation_id
      WHERE m.conversation_id = ${conversationId}
        AND m.execution_status = 'queued'
      ORDER BY o.created_at ASC, m.id ASC
    `;
    if (ordered.length === 0) return [];
    const results = await this.prisma.db.message.findMany({
      where: { id: { in: ordered.map((row) => row.id) } },
      include: {
        parentMessage: true,
        conversation: { select: { workflowId: true } },
      },
    });
    const byId = new Map(
      (
        await this.mapMessageResultsWith(
          results as MessageWithProposalReferences[],
          prismaMessageResultToMessageRecordDto,
        )
      ).map((message) => [message.id, message]),
    );
    return ordered.flatMap((row) => byId.get(row.id as MessageId) ?? []);
  }

  /**
   * Strictly increasing so an in-place edit always outranks the previous
   * value, even within one clock tick. Raw write on purpose: going through
   * updateMessage would publish another message.updated.
   */
  async advanceContentUpdatedAt(
    messageId: MessageId,
    organizationId: OrganizationId,
  ): Promise<Date | null> {
    const rows = await this.prisma.db.$queryRaw<{ content_updated_at: Date }[]>`
      UPDATE "messages" AS m
      SET "content_updated_at" = GREATEST(
        clock_timestamp(),
        m."content_updated_at" + INTERVAL '1 millisecond'
      )
      FROM "conversations" AS c
      WHERE m."id" = ${messageId}
        AND c."id" = m."conversation_id"
        AND c."organization_id" = ${organizationId}
        -- Undated queued inputs get their date only when they start.
        AND m."content_updated_at" IS NOT NULL
      RETURNING m."content_updated_at"
    `;
    const contentUpdatedAt = rows[0]?.content_updated_at ?? null;
    if (contentUpdatedAt) {
      this.logger.log('Advanced message contentUpdatedAt', {
        messageId,
        organizationId,
        contentUpdatedAt: contentUpdatedAt.toISOString(),
      });
    } else {
      this.logger.warn('Message not found when advancing contentUpdatedAt', {
        messageId,
        organizationId,
      });
    }
    return contentUpdatedAt;
  }

  async getMostRecentUserMessage(
    userId: UserId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    includeResponses = true,
  ): Promise<MessageResponseDto | null> {
    const result = await this.prisma.db.message.findFirst({
      where: {
        conversationId,
        userId,
        ...TIMELINE_MESSAGE_WHERE,
        // CRITICAL: Filter by organization through conversation relationship
        conversation: {
          organizationId,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        responses: includeResponses,
        parentMessage: true,
        conversation: {
          select: {
            workflowId: true,
          },
        },
      },
    });
    return result
      ? prismaMessageResultToResponseDto(
          result as MessageQueryResult,
          (result.conversation?.workflowId ?? undefined) as WorkflowId,
        )
      : null;
  }

  async getMentionsForConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<
    Array<{
      entityId: string;
      entityType: EntityType;
      messageId: MessageId;
      conversationId: ConversationId;
      createdAt: Date;
    }>
  > {
    const mentions = await this.prisma.db.messageMention.findMany({
      where: {
        conversationId,
        // Guard by organization to prevent cross-tenant leakage
        message: {
          conversation: {
            organizationId,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        entityId: true,
        entityType: true,
        messageId: true,
        conversationId: true,
        createdAt: true,
      },
    });

    return mentions.map((mention) => ({
      entityId: mention.entityId,
      entityType: mention.entityType as EntityType,
      messageId: mention.messageId as MessageId,
      conversationId: mention.conversationId as ConversationId,
      createdAt: mention.createdAt,
    }));
  }

  async getMessagesMentioningEntity(
    entityId: string,
    entityType: EntityType,
    organizationId: OrganizationId,
  ): Promise<
    Array<{
      messageId: MessageId;
      conversationId: ConversationId;
      createdAt: Date;
    }>
  > {
    const messages = await this.prisma.db.messageMention.findMany({
      where: {
        entityId,
        entityType,
        message: {
          conversation: {
            organizationId,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        messageId: true,
        conversationId: true,
        createdAt: true,
      },
    });

    return messages.map((message) => ({
      messageId: message.messageId as MessageId,
      conversationId: message.conversationId as ConversationId,
      createdAt: message.createdAt,
    }));
  }

  async getLatestMessage(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<MessageResponseDto | null> {
    const result = await this.prisma.db.message.findFirst({
      where: {
        conversationId,
        ...TIMELINE_MESSAGE_WHERE,
        conversation: {
          organizationId,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        responses: false,
        parentMessage: true,
        conversation: {
          select: {
            workflowId: true,
          },
        },
      },
    });
    return result
      ? prismaMessageResultToResponseDto(
          result as MessageQueryResult,
          (result.conversation?.workflowId ?? undefined) as WorkflowId,
        )
      : null;
  }

  /**
   * Entity-scoped message search. Returns matching messages across every
   * conversation in the project whose `workflowAboutId` + `workflowAboutType`
   * equal the supplied pair, ordered newest-first.
   *
   * `Message.data` is JSON, not a flat text column, so the candidate set is
   * picked via a `data::text ILIKE` raw query (bounded to a configurable
   * candidate ceiling) and then post-filtered through
   * `getContentFromMessageData` so the actual user-readable content is
   * confirmed to match and CARRIER plumbing rows are excluded. The snippet
   * is built from that extracted text, ~200 chars centered on the match.
   *
   * Throws `BadRequestException` for an empty `query` and `NotFoundException`
   * when no conversation in the project is anchored to the supplied
   * `workflowAboutId`.
   */
  async searchByWorkflowAbout(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    workflowAboutId: string;
    workflowAboutType: string;
    query: string;
    limit?: number;
  }): Promise<SearchConversationMessagesResponseDto[]> {
    const {
      organizationId,
      projectId,
      workflowAboutId,
      workflowAboutType,
      query,
    } = params;

    const trimmedQuery = (query ?? '').trim();
    if (!trimmedQuery.length) {
      throw new BadRequestException(
        '`query` is required and must be non-empty',
      );
    }

    const requestedLimit = Number.isFinite(params.limit)
      ? Math.floor(params.limit as number)
      : 20;
    const limit = Math.max(1, Math.min(requestedLimit, 100));
    // Post-filter drops CARRIER plumbing rows and any data shape whose
    // extracted text doesn't actually contain the query, so over-fetch the
    // candidate set to give the post-filter room to reject without
    // under-filling the result.
    const candidateCeiling = Math.min(limit * 5, 200);

    const anchored = await this.prisma.db.conversation.findFirst({
      where: {
        projectId,
        organizationId,
        workflowAboutId,
        workflowAboutType,
      },
      select: { id: true },
    });
    if (!anchored) {
      throw new NotFoundException(
        `No conversation in project ${projectId} is anchored to ${workflowAboutType} ${workflowAboutId}`,
      );
    }

    this.logger.log('[searchByWorkflowAbout] running entity-scoped search', {
      organizationId,
      projectId,
      workflowAboutId,
      workflowAboutType,
      query: trimmedQuery,
      limit,
      candidateCeiling,
    });

    // ILIKE on the JSON-cast text is a coarse pre-filter — it can hit field
    // names, ids, or other plumbing inside `data` — so each row is re-tested
    // via the canonical content extractor below. Prisma's JSON filters don't
    // support case-insensitive substring across an arbitrary JSON tree, so
    // the candidate set is picked via a raw `data::text ILIKE` query.
    const pattern = `%${trimmedQuery
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')}%`;
    const candidateIds = await this.prisma.db.$queryRaw<
      Array<{ id: string }>
    >(Prisma.sql`
      SELECT m.id
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id = ${organizationId}
        AND c.project_id = ${projectId}
        AND c.workflow_about_id = ${workflowAboutId}
        AND c.workflow_about_type = ${workflowAboutType}
        AND m.data::text ILIKE ${pattern}
        AND m.created_at IS NOT NULL
      ORDER BY m.created_at DESC
      LIMIT ${candidateCeiling}
    `);

    const candidates = candidateIds.length
      ? await this.prisma.db.message.findMany({
          where: { id: { in: candidateIds.map((r) => r.id) } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            data: true,
            createdAt: true,
            conversationId: true,
            conversation: { select: { title: true } },
          },
        })
      : [];

    const lowerQuery = trimmedQuery.toLowerCase();
    const results: SearchConversationMessagesResponseDto[] = [];
    for (const candidate of candidates) {
      const content = getContentFromMessageData(
        candidate.type as 'USER' | 'SYSTEM',
        candidate.data as MessageDataForContent | undefined,
      );
      if (!content) continue;
      const matchIndex = content.toLowerCase().indexOf(lowerQuery);
      if (matchIndex < 0) continue;

      results.push({
        conversationId: candidate.conversationId as ConversationId,
        conversationTitle: candidate.conversation?.title ?? null,
        messageId: candidate.id as MessageId,
        snippet: this.buildSearchSnippet(
          content,
          matchIndex,
          trimmedQuery.length,
        ),
        createdAt: timelineCreatedAt(candidate).toISOString(),
        type: candidate.type as MessageType,
      });
      if (results.length >= limit) break;
    }

    this.logger.log('[searchByWorkflowAbout] returning results', {
      candidates: candidates.length,
      returned: results.length,
    });

    return results;
  }

  /**
   * Build a ~200-char excerpt of `content` centered on the match. Adds an
   * ellipsis on either side that was trimmed off so the caller can render
   * the snippet without re-deriving where the truncation happened.
   */
  private buildSearchSnippet(
    content: string,
    matchIndex: number,
    matchLength: number,
  ): string {
    const WINDOW = 200;
    if (content.length <= WINDOW) {
      return content;
    }
    const half = Math.floor((WINDOW - matchLength) / 2);
    let start = Math.max(0, matchIndex - half);
    let end = Math.min(content.length, start + WINDOW);
    if (end - start < WINDOW) {
      start = Math.max(0, end - WINDOW);
    }
    const prefix = start > 0 ? '…' : '';
    const suffix = end < content.length ? '…' : '';
    return `${prefix}${content.slice(start, end)}${suffix}`;
  }

  async getLastSystemMessage(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<MessageResponseDto | null> {
    const result = await this.prisma.db.message.findFirst({
      where: {
        conversationId,
        type: 'SYSTEM',
        ...TIMELINE_MESSAGE_WHERE,
        // CRITICAL: Filter by organization through conversation relationship
        conversation: {
          organizationId,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        responses: false,
        parentMessage: true,
        conversation: {
          select: {
            workflowId: true,
          },
        },
      },
    });
    return result
      ? prismaMessageResultToResponseDto(
          result as MessageQueryResult,
          (result.conversation?.workflowId ?? undefined) as WorkflowId,
        )
      : null;
  }

  async getMessages(
    query: GetMessagesQueryDto,
    organizationId: OrganizationId,
    includeResponses = true,
    includeProposals = true,
    includeReports = false,
  ): Promise<MessageResponseDto[]> {
    if (query.historyCursor) {
      throw new BadRequestException(
        '`historyCursor` requires `mode=REVERSE_HISTORY`',
      );
    }
    const { projectId, conversationId, type, since } = query;
    const page = query.page ? Number(query.page) : undefined;
    const limit = query.limit ? Number(query.limit) : undefined;

    let cursorWhere: Prisma.MessageWhereInput | undefined;
    if (since) {
      if (!conversationId) {
        throw new BadRequestException(
          '`since` cursor requires `conversationId` so the cursor can be scoped to a conversation',
        );
      }
      const cursor = await this.prisma.db.message.findFirst({
        where: {
          id: since,
          conversationId,
          ...TIMELINE_MESSAGE_WHERE,
          conversation: { organizationId },
        },
        select: { id: true, createdAt: true },
      });
      if (!cursor) {
        throw new NotFoundException(
          `Cursor message ${since} not found in conversation ${conversationId}`,
        );
      }
      const cursorCreatedAt = timelineCreatedAt(cursor);
      cursorWhere = {
        OR: [
          { createdAt: { gt: cursorCreatedAt } },
          {
            createdAt: cursorCreatedAt,
            id: { gt: cursor.id },
          },
        ],
      };
    }

    const skip = since
      ? 0
      : page !== undefined && limit !== undefined
        ? (page - 1) * limit
        : undefined;
    const orderBy: Prisma.MessageOrderByWithRelationInput[] = [
      { createdAt: 'asc' },
      { id: 'asc' },
    ];

    const results = await this.prisma.db.message.findMany({
      where: {
        // CRITICAL: Always filter by organization through conversation relationship
        conversation: {
          organizationId,
        },
        ...(projectId && { projectId }),
        ...(conversationId && { conversationId }),
        ...(type && { type }),
        ...TIMELINE_MESSAGE_WHERE,
        ...(cursorWhere ?? {}),
      },
      skip,
      take: limit,
      orderBy,
      include: {
        responses: includeResponses ? { where: TIMELINE_MESSAGE_WHERE } : false,
        parentMessage: true,
        proposalReferences: includeProposals
          ? {
              where: { proposal: ORDINARY_PROPOSAL_VISIBILITY_WHERE },
              include: {
                proposal: { include: { approvalRecords: true } },
              },
              orderBy: { position: 'asc' },
            }
          : false,
        conversation: {
          select: {
            workflowId: true,
          },
        },
      },
    });

    if (since) {
      this.logger.debug('[getMessages] returning delta after cursor', {
        organizationId,
        conversationId,
        since,
        returned: results.length,
      });
    }

    const dtos = await this.mapMessageResults(
      results as unknown as MessageWithProposalReferences[],
    );

    if (includeReports && dtos.length > 0) {
      const reportsByMessageId =
        await this.reportService.loadReportsForMessageIds(
          organizationId,
          dtos.map((d) => d.id),
        );
      for (const dto of dtos) {
        dto.reports = reportsByMessageId.get(dto.id) ?? [];
      }
    }

    return dtos;
  }

  private async getConversationMessageHistoryPage(params: {
    query: GetMessagesQueryDto;
    organizationId: OrganizationId;
    projectId: ProjectId;
    includeResponses: boolean;
    includeProposals: boolean;
    includeReports: boolean;
  }): Promise<ConversationMessageHistoryPageDto> {
    const { query } = params;
    if (!query.conversationId) {
      throw new BadRequestException(
        '`mode=REVERSE_HISTORY` requires `conversationId`',
      );
    }
    if (query.since || query.page !== undefined) {
      throw new BadRequestException(
        '`mode=REVERSE_HISTORY` cannot be combined with `since` or `page`',
      );
    }

    const limit = query.limit === undefined ? 8 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException(
        '`limit` must be an integer between 1 and 100 for reverse history',
      );
    }

    const cursor = query.historyCursor
      ? decodeConversationMessageHistoryCursor({
          cursor: query.historyCursor,
          projectId: params.projectId,
          conversationId: query.conversationId,
        })
      : undefined;

    if (cursor) {
      const anchor = await this.prisma.db.message.findFirst({
        where: {
          id: cursor.id,
          conversationId: query.conversationId,
          projectId: params.projectId,
          createdAt: new Date(cursor.createdAt),
          conversation: {
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
        },
        select: { id: true },
      });
      if (!anchor) {
        throw new ConversationMessageHistoryCursorError();
      }
    }

    const cursorWhere: Prisma.MessageWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { lt: cursor.id },
            },
          ],
        }
      : undefined;
    const rows = await this.prisma.db.message.findMany({
      where: {
        conversationId: query.conversationId,
        projectId: params.projectId,
        conversation: {
          id: query.conversationId,
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
        ...(query.type && { type: query.type }),
        ...TIMELINE_MESSAGE_WHERE,
        ...(cursorWhere ?? {}),
      },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        responses: params.includeResponses
          ? { where: TIMELINE_MESSAGE_WHERE }
          : false,
        parentMessage: true,
        proposalReferences: params.includeProposals
          ? {
              where: { proposal: ORDINARY_PROPOSAL_VISIBILITY_WHERE },
              include: {
                proposal: { include: { approvalRecords: true } },
              },
              orderBy: { position: 'asc' },
            }
          : false,
        conversation: { select: { workflowId: true } },
      },
    });

    const hasOlder = rows.length > limit;
    const selectedRows = rows.slice(0, limit);
    const oldestSelectedRow = selectedRows.at(-1);
    const messages = await this.mapMessageResults(
      [...selectedRows].reverse() as unknown as MessageWithProposalReferences[],
    );

    if (params.includeReports && messages.length > 0) {
      const reportsByMessageId =
        await this.reportService.loadReportsForMessageIds(
          params.organizationId,
          messages.map((message) => message.id),
        );
      for (const message of messages) {
        message.reports = reportsByMessageId.get(message.id) ?? [];
      }
    }

    return {
      messages,
      ...(hasOlder && oldestSelectedRow
        ? {
            nextCursor: encodeConversationMessageHistoryCursor({
              version: 1,
              projectId: params.projectId,
              conversationId: query.conversationId,
              createdAt: timelineCreatedAt(oldestSelectedRow).toISOString(),
              id: oldestSelectedRow.id,
            }),
          }
        : {}),
    } satisfies ConversationMessageHistoryPageDto;
  }

  async getAgentSessionHistoryPage(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    agentSessionId: string;
    conversationId: ConversationId;
    cursor?: string;
    limit: number;
    /**
     * Serialized-size ceiling for the returned messages. Whole messages are
     * kept newest-first until the next would exceed it (the newest message is
     * always kept), and `nextCursor` then points past the last one kept.
     */
    maxMessageCharacters: number;
  }): Promise<Pick<GetAgentSessionResponse, 'messages' | 'nextCursor'>> {
    const encodedCursor = params.cursor;
    const cursor = encodedCursor
      ? await this.decodeAgentSessionHistoryCursor({
          ...params,
          cursor: encodedCursor,
        })
      : undefined;
    const cursorWhere: Prisma.MessageWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { lt: cursor.id },
            },
          ],
        }
      : undefined;

    const rows = await this.prisma.db.message.findMany({
      where: {
        conversationId: params.conversationId,
        projectId: params.projectId,
        conversation: {
          id: params.conversationId,
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
        ...TIMELINE_MESSAGE_WHERE,
        ...(cursorWhere ?? {}),
      },
      take: params.limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        responses: false,
        parentMessage: false,
        proposalReferences: {
          where: { proposal: ORDINARY_PROPOSAL_VISIBILITY_WHERE },
          include: {
            proposal: { include: { approvalRecords: true } },
          },
          orderBy: { position: 'asc' },
        },
        conversation: { select: { workflowId: true } },
      },
    });

    const requestedRows = rows.slice(0, params.limit);
    const requestedMessages = await this.mapMessageResults(
      requestedRows as MessageWithProposalReferences[],
    );
    let keptCount = 0;
    let keptCharacters = 2; // surrounding brackets of the serialized array
    for (const message of requestedMessages) {
      const characters = JSON.stringify(message).length + 1; // plus separator
      if (
        keptCount > 0 &&
        keptCharacters + characters > params.maxMessageCharacters
      ) {
        break;
      }
      keptCharacters += characters;
      keptCount += 1;
    }
    const messages = requestedMessages.slice(0, keptCount);
    const hasMore =
      rows.length > params.limit || keptCount < requestedRows.length;
    const lastRow = requestedRows[keptCount - 1];

    return {
      messages,
      ...(hasMore && lastRow
        ? {
            nextCursor: this.encodeAgentSessionHistoryCursor({
              version: 1,
              agentSessionId: params.agentSessionId,
              conversationId: params.conversationId,
              createdAt: timelineCreatedAt(lastRow).toISOString(),
              id: lastRow.id,
            }),
          }
        : {}),
    } satisfies Pick<GetAgentSessionResponse, 'messages' | 'nextCursor'>;
  }

  private encodeAgentSessionHistoryCursor(
    cursor: AgentSessionHistoryCursor,
  ): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private async decodeAgentSessionHistoryCursor(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    agentSessionId: string;
    conversationId: ConversationId;
    cursor: string;
  }): Promise<AgentSessionHistoryCursor> {
    if (!/^[A-Za-z0-9_-]+$/.test(params.cursor)) {
      throw new AgentSessionHistoryCursorError();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(
        Buffer.from(params.cursor, 'base64url').toString('utf8'),
      );
    } catch {
      throw new AgentSessionHistoryCursorError();
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new AgentSessionHistoryCursorError();
    }

    const cursor = parsed as Partial<AgentSessionHistoryCursor>;
    if (
      cursor.version !== 1 ||
      cursor.agentSessionId !== params.agentSessionId ||
      cursor.conversationId !== params.conversationId ||
      typeof cursor.createdAt !== 'string' ||
      Number.isNaN(Date.parse(cursor.createdAt)) ||
      new Date(cursor.createdAt).toISOString() !== cursor.createdAt ||
      typeof cursor.id !== 'string' ||
      !isUuid(cursor.id)
    ) {
      throw new AgentSessionHistoryCursorError();
    }

    const anchor = await this.prisma.db.message.findFirst({
      where: {
        id: cursor.id,
        conversationId: params.conversationId,
        projectId: params.projectId,
        createdAt: new Date(cursor.createdAt),
        conversation: {
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
      },
      select: { id: true },
    });
    if (!anchor) {
      throw new AgentSessionHistoryCursorError();
    }

    return cursor as AgentSessionHistoryCursor;
  }

  async getContextWindowForMessage(
    conversationId: ConversationId,
    messageId: MessageId,
    organizationId: OrganizationId,
    windowSize = 5,
  ): Promise<MessageResponseDto[]> {
    const selectedMessage = await this.getMessage(
      messageId,
      organizationId,
      false,
    );
    // An undated queued input has no place in the timeline to window around.
    if (!selectedMessage || !isTimelineMessage(selectedMessage)) {
      return [];
    }

    const selectedCreatedAt = new Date(selectedMessage.createdAt);
    const previousMessages = await this.prisma.db.message.findMany({
      where: {
        conversationId,
        // CRITICAL: Always filter by organization through conversation relationship
        conversation: {
          organizationId,
        },
        createdAt: {
          not: null,
          lte: selectedCreatedAt,
        },
        id: {
          not: messageId,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: Math.max(windowSize - 1, 0),
      include: {
        responses: false,
        parentMessage: true,
        conversation: {
          select: {
            workflowId: true,
          },
        },
      },
    });

    const orderedPreviousMessages = previousMessages
      .map((r) =>
        prismaMessageResultToResponseDto(
          r as MessageQueryResult,
          (r.conversation?.workflowId ?? undefined) as WorkflowId,
        ),
      )
      .reverse()
      .filter((msg) => {
        if (msg.type !== 'SYSTEM') return true;
        const data = msg.data as SystemMessageData | undefined;
        return data?.type !== 'CARRIER';
      });

    this.logger.debug('[getContextWindowForMessage] built context window', {
      conversationId,
      messageId,
      windowSize,
      total: orderedPreviousMessages.length,
    });

    return [...orderedPreviousMessages, selectedMessage];
  }

  /**
   * Appends a new message to a conversation in sequential order.
   *
   * This method automatically determines the parent message ID by finding the most recent
   * message in the conversation, creating a linear conversation chain. Use this for normal
   * conversation flow where each message naturally follows the previous one.
   *
   * For cases requiring explicit parent control (threading, error handling, admin messages,
   * etc.), use the standard `addMessage` method instead.
   *
   * @param conversationId - The conversation to append the message to
   * @param messageData - The message content and metadata
   * @param organizationId - Organization context for the message
   * @param source - Source identifier for the message creation (e.g., 'workflow', 'api')
   *
   * @returns Promise resolving to the created message
   *
   * @example
   * ```typescript
   * // System message following user input
   * const systemResponse = await messageService.appendMessageToConversation(
   *   conversationId,
   *   {
   *     type: 'SYSTEM',
   *     workflowId,
   *     projectId,
   *     data: { response: 'I understand your request...' }
   *   },
   *   organizationId,
   *   'workflow'
   * );
   * ```
   *
   * @throws {Error} If conversation doesn't exist or is in invalid state
   */
  @WithEventContext('MessageService')
  async appendMessageToConversation(
    conversationId: ConversationId,
    messageData: Omit<CreateMessageInput, 'parentMessageId' | 'conversationId'>,
    organizationId: OrganizationId,
    source: string,
  ): Promise<MessageResponseDto> {
    try {
      // Find the most recent message in this conversation
      const lastMessage = await this.prisma.db.message.findFirst({
        where: {
          conversationId,
          ...TIMELINE_MESSAGE_WHERE,
          // CRITICAL: Always filter by organization through conversation relationship
          conversation: {
            organizationId,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      this.logger.debug('[appendMessageToConversation] Found last message', {
        conversationId,
        lastMessageId: lastMessage?.id,
        lastMessageType: lastMessage?.type,
        lastMessageCreatedAt: lastMessage?.createdAt,
      });

      // Create the message with the auto-determined parent
      const createMessageDto: CreateMessageInput = {
        ...messageData,
        conversationId,
        parentMessageId: lastMessage?.id || undefined,
      } as CreateMessageInput;

      return this.addMessage(createMessageDto, organizationId, source);
    } catch (error) {
      this.logger.error(
        '[appendMessageToConversation] Failed to append message',
        {
          error: (error as Error).message,
          conversationId,
          organizationId,
          source,
        },
      );
      throw new InternalServerErrorException(
        'Failed to append message to conversation',
        error as Error,
      );
    }
  }

  @WithEventContext('MessageService')
  async addMessage(
    createMessageDto: CreateMessageInput,
    organizationId: OrganizationId,
    source: string,
  ): Promise<MessageResponseDto> {
    try {
      if (createMessageDto.type === 'USER' && !createMessageDto.userId) {
        throw new BadRequestException('USER messages require userId');
      }
      const projectId = createMessageDto.projectId;

      // Set up event context with business data
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext) {
        currentContext.organizationId = organizationId;
        currentContext.projectId = projectId;
        currentContext.conversationId = createMessageDto.conversationId;
      }

      let messageData: CreateMessageInput =
        createMessageDto.type === 'SYSTEM'
          ? ({
              type: 'SYSTEM' as const,
              id: createMessageDto.id,
              projectId,
              status: createMessageDto.status || MessageStatus.Open,
              userId: createMessageDto.userId || 'system',
              data: createMessageDto.data,
              ...(createMessageDto.proposalIds !== undefined
                ? { proposalIds: createMessageDto.proposalIds }
                : {}),
              ...(createMessageDto.reportIds !== undefined
                ? { reportIds: createMessageDto.reportIds }
                : {}),
              conversationId: createMessageDto.conversationId,
              parentMessageId: createMessageDto.parentMessageId || undefined,
              createdAt: (createMessageDto.createdAt
                ? new Date(createMessageDto.createdAt)
                : new Date()
              ).toISOString(),
            } as CreateSystemMessageInput)
          : ({
              type: 'USER' as const,
              id: createMessageDto.id,
              projectId,
              status: createMessageDto.status || MessageStatus.Completed,
              userId: createMessageDto.userId,
              data: createMessageDto.data || {},
              conversationId: createMessageDto.conversationId,
              parentMessageId: createMessageDto.parentMessageId || undefined,
              createdAt: (createMessageDto.createdAt
                ? new Date(createMessageDto.createdAt)
                : new Date()
              ).toISOString(),
            } as CreateUserMessageInput);
      const nodeId =
        messageData.type === 'SYSTEM'
          ? (messageData.data as SystemMessageData | undefined)?.nodeId
          : undefined;

      this.logger.log('[addMessage] Creating message with events', {
        source,
        conversationId: createMessageDto.conversationId,
        projectId,
        correlationId: currentContext?.correlationId,
        organizationId,
      });

      const mentionTokens =
        this.extractMentionTokensFromMessage(createMessageDto);

      let conversationWorkflowId: WorkflowId | undefined;

      const created = await this.prisma.$transaction(async (tx) => {
        this.logger.debug(`[addMessage] creating message in tx`, {
          messageData,
        });

        messageData = await this.admitEvalOutput(
          tx,
          organizationId,
          messageData,
        );

        const currentConversation = await tx.conversation.findUnique({
          where: { id: messageData.conversationId },
          select: {
            version: true,
            workflowId: true,
            workflowAboutId: true,
            workflowAboutType: true,
          },
        });

        if (!currentConversation) {
          throw new Error(
            `Conversation ${messageData.conversationId} not found`,
          );
        }

        conversationWorkflowId = (currentConversation.workflowId ??
          undefined) as WorkflowId | undefined;

        const attachmentPlan =
          messageData.type === 'SYSTEM'
            ? await this.validateSystemMessageAttachments(tx, messageData, {
                organizationId,
                projectId: messageData.projectId,
                conversationId: messageData.conversationId,
              })
            : undefined;

        const validatedMentions = mentionTokens.length
          ? await this.validateMentions(mentionTokens, organizationId, tx)
          : [];
        const mentionRecords: MentionRecord[] = validatedMentions.map(
          (mention) => ({
            id: uuidv4(),
            entityId: mention.entityId,
            entityType: mention.entityType,
          }),
        );

        try {
          const msg = (await tx.message.create({
            data: {
              ...(messageData.id ? { id: messageData.id } : {}),
              projectId: messageData.projectId,
              type: messageData.type,
              status: messageData.status,
              userId: messageData.userId as UserId,
              data: messageData.data as Prisma.InputJsonValue,
              conversationId: messageData.conversationId,
              parentMessageId: messageData.parentMessageId,
              createdAt: new Date(messageData.createdAt ?? new Date()),
            },
            include: {
              responses: true,
              parentMessage: true,
              conversation: {
                select: {
                  workflowId: true,
                },
              },
            },
          })) as unknown as MessageQueryResult;

          this.logger.debug(`[addMessage] created message in tx`);

          await this.persistSystemMessageAttachments(
            tx,
            attachmentPlan,
            {
              organizationId,
              projectId: messageData.projectId,
              conversationId: messageData.conversationId,
            },
            msg.id as MessageId,
          );

          if (mentionRecords.length) {
            await tx.messageMention.createMany({
              data: mentionRecords.map((mention) => ({
                id: mention.id,
                messageId: msg.id,
                conversationId: msg.conversationId,
                entityId: mention.entityId,
                entityType: mention.entityType,
              })),
            });
            this.logger.debug(`[addMessage] created message mentions`, {
              count: mentionRecords.length,
            });
          }

          await this.publishMessageCreatedEvent(tx, {
            messageId: msg.id as MessageId,
            organizationId,
            projectId: msg.projectId,
            workflowId: conversationWorkflowId,
            conversationId: messageData.conversationId,
            message: messageData,
            parentMessage: msg.parentMessage ?? null,
            nodeId,
            mentions: validatedMentions,
          });

          this.logger.debug(`[addMessage] published created message event`);

          // Keep the deterministic open-trigger projection in lockstep with
          // the message log, atomically with this write (see method docs).
          await this.maintainPendingOpenTriggerStore(
            tx,
            {
              id: msg.id,
              conversationId: msg.conversationId,
              projectId: msg.projectId,
            },
            messageData,
            organizationId,
          );

          // Bump the conversation version atomically for every author. This is
          // the message-APPEND path: a new row never clobbers a concurrent
          // writer's edit, so it needs no optimistic-concurrency predicate. The
          // version-match guard that matters for edits lives on the
          // updateMessage path. A `where: { id, version }` predicate here would
          // spuriously fail with P2025 whenever another writer (e.g. a live
          // Temporal workflow appending SYSTEM messages to the same
          // conversation) commits a version bump between the read above and
          // this update.
          const updatedConversation = await tx.conversation.update({
            where: { id: messageData.conversationId },
            data: {
              version: { increment: 1 },
              updatedAt: new Date(),
            },
            select: { version: true, projectId: true },
          });

          await this.publishMentionCreatedEvents(tx, {
            mentions: mentionRecords,
            organizationId,
            projectId: msg.projectId,
            workflowId: conversationWorkflowId,
            conversationId: messageData.conversationId,
            messageId: msg.id as MessageId,
            workflowAboutId: currentConversation.workflowAboutId,
            workflowAboutType: currentConversation.workflowAboutType,
            nodeId,
            userId:
              messageData.type === 'USER'
                ? (messageData.userId as UserId)
                : undefined,
          });

          const triggersAgentForConversationUpdate = (
            messageData.data as SystemMessageData | UserMessageData | undefined
          )?.triggersAgent;
          if (triggersAgentForConversationUpdate) {
            this.logger.debug(
              '[addMessage] publishing trigger conversation update',
              {
                event: 'message_service.conversation_update.trigger_diagnostic',
                messageId: msg.id,
                conversationId: messageData.conversationId,
                workflowId: conversationWorkflowId,
                nodeId,
                triggerPromptType:
                  triggersAgentForConversationUpdate.promptType,
                triggerNodeId: triggersAgentForConversationUpdate.nodeId,
                triggerMessageId:
                  triggersAgentForConversationUpdate.triggerMessageId,
              },
            );
          }
          await this.eventPublisher.publishInTransaction(tx, {
            type: EVENT_TYPES.CONVERSATION.UPDATED,
            aggregateId: messageData.conversationId,
            payload: {
              payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
              organizationId,
              projectId: msg.projectId,
              update: {
                expectedVersion: currentConversation.version,
                messageAdded: msg.id,
              },
              latestMessageId: msg.id,
              previousVersion: currentConversation.version,
              newVersion: updatedConversation.version,
              changeType: 'message_added',
              workflowId: conversationWorkflowId,
              nodeId,
              // Both SYSTEM and USER rows can carry a server-stamped
              // `triggersAgent`, so the elevated envelope the RealtimeBridge
              // reads off `conversation.updated` must fire for either author.
              triggersAgent: triggersAgentForConversationUpdate,
            },
          });

          this.logger.debug(
            `[addMessage] published updated conversation event`,
          );

          return msg;
        } catch (err) {
          this.logger.error(`[addMessage] error creating message in tx`, err);
          throw err;
        }
      });

      this.logger.log('[addMessage] Message created', {
        messageId: created.id,
        conversationId: created.conversationId,
      });

      if (currentContext) {
        currentContext.workflowId = conversationWorkflowId;
      }

      return prismaMessageResultToResponseDto(created, conversationWorkflowId);
    } catch (error) {
      this.logger.error('[addMessage] Failed to create message', {
        error: error instanceof Error ? error.message : String(error),
        code:
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined,
        createMessageDto,
        organizationId,
        source,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof (error as { code?: unknown }).code === 'string'
      ) {
        const prismaCode = (error as { code: string }).code;
        const meta = (error as { meta?: Record<string, unknown> }).meta;
        const fieldName =
          typeof meta?.field_name === 'string'
            ? meta.field_name
            : typeof meta?.target === 'string'
              ? meta.target
              : '';
        const isUserIdNullViolation =
          prismaCode === 'P2011' && fieldName.includes('user_id');
        const isParentMessageFkViolation =
          prismaCode === 'P2003' && fieldName.includes('parent_message_id');

        if (isUserIdNullViolation) {
          throw new BadRequestException('USER messages require userId');
        }

        if (isParentMessageFkViolation) {
          throw new BadRequestException(
            `Invalid parentMessageId: ${createMessageDto.parentMessageId ?? ''}`,
          );
        }
      }

      throw new InternalServerErrorException(
        'Failed to create Message entry',
        error as Error,
      );
    }
  }

  /**
   * Append a message using the caller-owned transaction. Interactive
   * operation submission uses this seam so the message, its projections, and
   * the dispatch obligation commit or roll back together.
   */
  async addMessageInTransaction(
    tx: AnyTransactionClient,
    createMessageDto: CreateMessageInput,
    organizationId: OrganizationId,
    source: string,
    options?: Omit<AddMessageInTransactionOptions, 'executableOperationId'>,
  ): Promise<MessageResponseDto & { messageCreatedEventId: string | null }>;
  async addMessageInTransaction(
    tx: AnyTransactionClient,
    createMessageDto: CreateMessageInput,
    organizationId: OrganizationId,
    source: string,
    options: AddMessageInTransactionOptions,
  ): Promise<MessageRecordDto & { messageCreatedEventId: string | null }>;
  async addMessageInTransaction(
    tx: AnyTransactionClient,
    createMessageDto: CreateMessageInput,
    organizationId: OrganizationId,
    source: string,
    options: AddMessageInTransactionOptions = {},
  ): Promise<MessageRecordDto & { messageCreatedEventId: string | null }> {
    if (createMessageDto.type === 'USER' && !createMessageDto.userId) {
      throw new BadRequestException('USER messages require userId');
    }

    let messageData: CreateMessageInput = {
      ...createMessageDto,
      userId:
        createMessageDto.type === 'SYSTEM'
          ? createMessageDto.userId || 'system'
          : createMessageDto.userId,
      status:
        createMessageDto.status ||
        (createMessageDto.type === 'SYSTEM'
          ? MessageStatus.Open
          : MessageStatus.Completed),
      createdAt: options.executableOperationId
        ? undefined
        : (createMessageDto.createdAt ?? new Date().toISOString()),
    } as CreateMessageInput;
    messageData = await this.admitEvalOutput(tx, organizationId, messageData);
    const createdAt = messageData.createdAt
      ? new Date(messageData.createdAt)
      : null;
    const currentConversation = await tx.conversation.findUnique({
      where: { id: messageData.conversationId },
      select: {
        version: true,
        workflowId: true,
        workflowAboutId: true,
        workflowAboutType: true,
      },
    });
    if (!currentConversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (
      options.expectedConversationVersion !== undefined &&
      currentConversation.version !== options.expectedConversationVersion
    ) {
      throw new ConflictException('Conversation version is stale');
    }

    const attachmentPlan =
      messageData.type === 'SYSTEM'
        ? await this.validateSystemMessageAttachments(tx, messageData, {
            organizationId,
            projectId: messageData.projectId,
            conversationId: messageData.conversationId,
          })
        : undefined;

    const mentionTokens = this.extractMentionTokensFromMessage(messageData);
    const validatedMentions = mentionTokens.length
      ? await this.validateMentions(mentionTokens, organizationId, tx)
      : [];
    const mentionRecords: MentionRecord[] = validatedMentions.map(
      (mention) => ({
        id: uuidv4(),
        entityId: mention.entityId,
        entityType: mention.entityType,
      }),
    );
    const nodeId =
      messageData.type === 'SYSTEM'
        ? (messageData.data as SystemMessageData).nodeId
        : undefined;
    const created = (await tx.message.create({
      data: {
        ...(messageData.id ? { id: messageData.id } : {}),
        projectId: messageData.projectId,
        type: messageData.type,
        status: messageData.status,
        userId: messageData.userId as UserId,
        data: messageData.data as Prisma.InputJsonValue,
        conversationId: messageData.conversationId,
        parentMessageId: messageData.parentMessageId,
        createdAt,
        contentUpdatedAt: createdAt,
        ...(options.executableOperationId
          ? {
              executionStatus: 'queued' as const,
              executionOperationId: options.executableOperationId,
            }
          : {}),
      },
      include: {
        responses: true,
        parentMessage: true,
        conversation: { select: { workflowId: true } },
      },
    })) as MessageQueryResult;

    await this.persistSystemMessageAttachments(
      tx,
      attachmentPlan,
      {
        organizationId,
        projectId: messageData.projectId,
        conversationId: messageData.conversationId,
      },
      created.id as MessageId,
    );

    if (mentionRecords.length) {
      await tx.messageMention.createMany({
        data: mentionRecords.map((mention) => ({
          id: mention.id,
          messageId: created.id,
          conversationId: created.conversationId,
          entityId: mention.entityId,
          entityType: mention.entityType,
        })),
      });
    }
    const messageCreatedEventId = await this.publishMessageCreatedEvent(tx, {
      messageId: created.id as MessageId,
      organizationId,
      projectId: created.projectId,
      workflowId: (currentConversation.workflowId ?? undefined) as
        | WorkflowId
        | undefined,
      conversationId: created.conversationId,
      message: messageData,
      parentMessage: created.parentMessage ?? null,
      nodeId,
      mentions: validatedMentions,
      ...(options.messageCreatedEventScheduledFor
        ? { scheduledFor: options.messageCreatedEventScheduledFor }
        : {}),
      ...(options.onboardingReplyDelivery
        ? { onboardingReplyDelivery: options.onboardingReplyDelivery }
        : {}),
      ...(options.repositoryImportReplyDelivery
        ? {
            repositoryImportReplyDelivery:
              options.repositoryImportReplyDelivery,
          }
        : {}),
      ...(options.suppressExecutableDelivery
        ? { suppressExecutableDelivery: true }
        : {}),
    });
    if (!options.suppressExecutableDelivery) {
      await this.maintainPendingOpenTriggerStore(
        tx,
        {
          id: created.id,
          conversationId: created.conversationId,
          projectId: created.projectId,
        },
        messageData,
        organizationId,
      );
    }
    const versionUpdate = await tx.conversation.updateMany({
      where: {
        id: created.conversationId,
        ...(options.expectedConversationVersion !== undefined
          ? { version: options.expectedConversationVersion }
          : {}),
      },
      data: { version: { increment: 1 }, updatedAt: new Date() },
    });
    if (versionUpdate.count !== 1) {
      throw new ConflictException('Conversation version is stale');
    }
    const updatedConversation = {
      version: currentConversation.version + 1,
    };
    await this.publishMentionCreatedEvents(tx, {
      mentions: mentionRecords,
      organizationId,
      projectId: created.projectId,
      workflowId: (currentConversation.workflowId ?? undefined) as
        | WorkflowId
        | undefined,
      conversationId: created.conversationId,
      messageId: created.id as MessageId,
      workflowAboutId: currentConversation.workflowAboutId,
      workflowAboutType: currentConversation.workflowAboutType,
      nodeId,
      userId:
        messageData.type === 'USER'
          ? (messageData.userId as UserId)
          : undefined,
    });
    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.CONVERSATION.UPDATED,
      aggregateId: created.conversationId,
      payload: {
        payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
        organizationId,
        projectId: created.projectId,
        update: {
          expectedVersion: currentConversation.version,
          messageAdded: created.id,
        },
        // An undated queued input is not the conversation's latest message.
        latestMessageId: options.executableOperationId
          ? await this.resolveLatestMessageId(tx, created.conversationId)
          : created.id,
        previousVersion: currentConversation.version,
        newVersion: updatedConversation.version,
        changeType: 'message_added',
        workflowId: (currentConversation.workflowId ?? undefined) as
          | WorkflowId
          | undefined,
        nodeId,
        triggersAgent: options.suppressExecutableDelivery
          ? undefined
          : (messageData.data as SystemMessageData | UserMessageData)
              .triggersAgent,
      },
    });
    this.logger.log('[addMessageInTransaction] Message created', {
      source,
      messageId: created.id,
      conversationId: created.conversationId,
    });
    const workflowId = (currentConversation.workflowId ?? undefined) as
      | WorkflowId
      | undefined;
    return {
      ...(options.executableOperationId
        ? prismaMessageResultToMessageRecordDto(created, workflowId)
        : prismaMessageResultToResponseDto(created, workflowId)),
      messageCreatedEventId,
    };
  }

  async updateFormAnswerInTransaction(
    tx: AnyTransactionClient,
    messageId: MessageId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    conversationId: ConversationId,
    data: UserMessageData,
  ): Promise<void> {
    await tx.message.update({
      where: { id: messageId },
      data: { data: data as Prisma.InputJsonValue },
    });
    await this.publishMessageUpdatedEvent(tx as Prisma.TransactionClient, {
      messageId,
      organizationId,
      projectId,
      conversationId,
      update: { data },
    });
  }

  /**
   * Maintain the reconnect-eligible `pending_open_trigger` store from the
   * message log. Runs inside the `addMessage` transaction so trigger and
   * completion writes update the projection atomically:
   *
   *  - a message (SYSTEM or USER) whose `data.triggersAgent` is an object
   *    OPENS a trigger — insert one row, keyed by the human user who owns the
   *    conversation. SYSTEM trigger rows are minted by the engine on
   *    EXTERNAL_AGENT node entry; USER trigger rows are server-stamped at
   *    create time by the message controller when a USER turn dispatches via
   *    `promptType` or a terminated `workflowName` (the wire-discriminator
   *    contract). Both author kinds resolve the owning user through the
   *    conversation's AgentSession, not the message row — SYSTEM rows carry
   *    `userId = 'system'`, and a USER row's owner is still defined by the
   *    bound session for re-fan parity with the trigger emitter. Without a
   *    bound session the conversation is not engine-bound to a user and cannot
   *    be re-fanned, so the trigger is intentionally not tracked (mirrors the
   *    backfill's INNER JOIN on `agent_sessions`).
   *  - a message carrying `data.completesExternalAgentNode.completesTriggerMessageId`
   *    COMPLETES a trigger — delete the row for the trigger it references.
   *
   * A negative acknowledgement on the initial start-run dispatch removes its
   * row separately through `removePendingOpenTrigger`; the message remains in
   * the log because dispatch failure is not a workflow completion.
   *
   * This is the materialized form of the reconnect-eligible trigger set that
   * `PendingTriggerService.resolveOpenTriggersForUser` reads on CLI
   * authenticate; the resolver is now a point lookup rather than a session
   * scan precisely because this write path keeps the set current.
   */
  private async maintainPendingOpenTriggerStore(
    tx: Prisma.TransactionClient,
    msg: { id: string; conversationId: string; projectId: string },
    messageData: CreateMessageInput,
    organizationId: OrganizationId,
  ): Promise<void> {
    if (!messageData.data) {
      return;
    }

    // Completion: drop the row for the trigger this message completes.
    // `completesExternalAgentNode` lives on the SYSTEM-AGENT data shape, so we
    // narrow to it via the discriminator (mirroring the completion router's
    // `AGENT` gate). deleteMany is a no-op when no row matches (already
    // completed, or a trigger that predates the store), so it is safe to run
    // unconditionally.
    if (
      messageData.type === 'SYSTEM' &&
      isAgentSystemMessageData(messageData.data)
    ) {
      const completion = messageData.data.completesExternalAgentNode;
      if (
        completion &&
        typeof completion.completesTriggerMessageId === 'string' &&
        completion.completesTriggerMessageId.length > 0
      ) {
        const removed = await tx.pendingOpenTrigger.deleteMany({
          where: { messageId: completion.completesTriggerMessageId },
        });
        this.logger.log(
          '[maintainPendingOpenTriggerStore] completion removed open trigger',
          {
            completionMessageId: msg.id,
            completesTriggerMessageId: completion.completesTriggerMessageId,
            conversationId: msg.conversationId,
            removed: removed.count,
          },
        );
        return;
      }
    }

    // Trigger: any message (SYSTEM or USER) whose `data.triggersAgent` is an
    // object opens a trigger. `triggersAgent` is declared on both
    // `SystemMessageData` and `UserMessageData`, so server-stamped USER rows
    // are tracked for re-fan exactly like the SYSTEM rows the engine mints.
    const triggersAgent = messageData.data.triggersAgent;
    if (!triggersAgent || typeof triggersAgent !== 'object') {
      return;
    }

    // Resolve the owning user through the conversation's AgentSession. Order by
    // `createdAt asc` so the chosen session matches the backfill's
    // `DISTINCT ON (m.id) ... ORDER BY a.created_at ASC`.
    const session = await tx.agentSession.findFirst({
      where: { conversationId: msg.conversationId, organizationId },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!session) {
      this.logger.warn(
        '[maintainPendingOpenTriggerStore] trigger has no AgentSession binding — not tracked for re-fan',
        {
          messageId: msg.id,
          conversationId: msg.conversationId,
        },
      );
      return;
    }

    await tx.pendingOpenTrigger.create({
      data: {
        userId: session.userId,
        conversationId: msg.conversationId,
        messageId: msg.id,
        organizationId,
        projectId: msg.projectId,
      },
    });
    this.logger.log('[maintainPendingOpenTriggerStore] tracked open trigger', {
      messageId: msg.id,
      conversationId: msg.conversationId,
      userId: session.userId,
    });
  }

  @WithEventContext('MessageService')
  async prependMessage(
    targetMessageId: MessageId,
    createMessageDto: CreateMessageInput,
    organizationId: OrganizationId,
    source: string,
  ): Promise<MessageResponseDto> {
    this.logger.log('[prependMessage] Prepending message', {
      targetMessageId,
      source,
      conversationId: createMessageDto.conversationId,
      organizationId,
    });

    if (createMessageDto.type === 'USER' && !createMessageDto.userId) {
      throw new BadRequestException('USER messages require userId');
    }

    const projectId = createMessageDto.projectId;
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = organizationId;
      currentContext.projectId = projectId;
      currentContext.conversationId = createMessageDto.conversationId;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      createMessageDto = await this.admitEvalOutput(
        tx,
        organizationId,
        createMessageDto,
      );
      // 1. Fetch the target message and validate ownership
      const targetMessage = await tx.message.findFirst({
        where: {
          id: targetMessageId,
          conversation: { organizationId },
        },
        include: {
          parentMessage: true,
          conversation: { select: { version: true, workflowId: true } },
        },
      });

      if (!targetMessage) {
        throw new NotFoundException(
          `Target message ${targetMessageId} not found or access denied`,
        );
      }

      if (targetMessage.conversationId !== createMessageDto.conversationId) {
        throw new BadRequestException(
          'New message conversationId must match target message',
        );
      }

      const attachmentPlan =
        createMessageDto.type === 'SYSTEM'
          ? await this.validateSystemMessageAttachments(tx, createMessageDto, {
              organizationId,
              projectId,
              conversationId: createMessageDto.conversationId,
            })
          : undefined;

      const conversationWorkflowId = (targetMessage.conversation?.workflowId ??
        undefined) as WorkflowId | undefined;

      // Snapshot the target's parent at read-time — this is the value that
      // becomes the new message's parent and is then overwritten on the
      // target on step 3. Captured up-front so the structured prepend-trace
      // event can show pre/post rewire deltas in a single record.
      const beforeMessageParentAtRead = targetMessage.parentMessageId ?? null;

      // 2. Create the new message with target's current parentMessageId
      const newMsg = (await tx.message.create({
        data: {
          projectId,
          type: createMessageDto.type,
          status: (createMessageDto.status as string) || MessageStatus.Open,
          userId: createMessageDto.userId || 'system',
          data: createMessageDto.data as Prisma.InputJsonValue,
          conversationId: createMessageDto.conversationId,
          createdAt: createMessageDto.createdAt
            ? new Date(createMessageDto.createdAt)
            : new Date(),
          parentMessageId: targetMessage.parentMessageId ?? undefined,
        },
        include: {
          responses: true,
          parentMessage: true,
          conversation: { select: { workflowId: true } },
        },
      })) as unknown as MessageQueryResult;

      this.logger.debug('[prependMessage] Created new message', {
        newMessageId: newMsg.id,
        parentMessageId: targetMessage.parentMessageId,
      });

      await this.persistSystemMessageAttachments(
        tx,
        attachmentPlan,
        {
          organizationId,
          projectId,
          conversationId: createMessageDto.conversationId,
        },
        newMsg.id as MessageId,
      );

      // 3. Rewire: update target message's parentMessageId to point at new message
      await tx.message.update({
        where: { id: targetMessageId },
        data: { parentMessageId: newMsg.id },
      });

      this.logger.debug('[prependMessage] Rewired target message parent', {
        targetMessageId,
        newParentMessageId: newMsg.id,
      });

      // Structured prepend-trace event — one record per write, pairing the
      // pre/post values of `beforeMessageId.parentMessageId` so a fork on a
      // shared target is reconstructable from logs without joining multiple
      // debug lines.
      this.logger.log('[prependMessage] Wrote prepend record', {
        event: 'workflow.message.prepend.write',
        beforeMessageId: targetMessageId,
        beforeMessageParentAtRead,
        newMessageId: newMsg.id,
        newMessageParent: newMsg.parentMessageId ?? null,
        beforeMessageParentAfterRewire: newMsg.id,
        source,
      });

      // Burst detection — two prepends on the same `beforeMessageId` inside a
      // 100ms window is the fork-bug precondition. Emit a warn-level event
      // naming both new-message ids and the elapsed-ms so a racing pair is
      // greppable as one record. Map cleanup is opportunistic at write time.
      const now = Date.now();
      const recent = this.recentPrependsByBeforeMessageId.get(targetMessageId);
      if (
        recent &&
        now - recent.timestamp < MessageService.PREPEND_BURST_WINDOW_MS
      ) {
        this.logger.warn(
          '[prependMessage] Same-target prepend burst detected',
          {
            event: 'workflow.message.prepend.burst',
            beforeMessageId: targetMessageId,
            firstNewMessageId: recent.newMessageId,
            secondNewMessageId: newMsg.id,
            elapsedMs: now - recent.timestamp,
            windowMs: MessageService.PREPEND_BURST_WINDOW_MS,
          },
        );
      }
      // Opportunistically prune any entry older than the window so the map
      // does not grow without bound across a long-lived process.
      for (const [key, value] of this.recentPrependsByBeforeMessageId) {
        if (now - value.timestamp >= MessageService.PREPEND_BURST_WINDOW_MS) {
          this.recentPrependsByBeforeMessageId.delete(key);
        }
      }
      this.recentPrependsByBeforeMessageId.set(targetMessageId, {
        newMessageId: newMsg.id,
        timestamp: now,
      });

      // 4. Publish message.created event for the new message
      const nodeId =
        createMessageDto.type === 'SYSTEM'
          ? (createMessageDto.data as SystemMessageData | undefined)?.nodeId
          : undefined;

      await this.publishMessageCreatedEvent(tx, {
        messageId: newMsg.id as MessageId,
        organizationId,
        projectId,
        workflowId: conversationWorkflowId,
        conversationId: createMessageDto.conversationId,
        message: createMessageDto,
        parentMessage: newMsg.parentMessage ?? null,
        nodeId,
      });

      // 5. Publish message.updated event for target message's parentMessageId change
      await this.publishMessageUpdatedEvent(tx, {
        messageId: targetMessageId,
        organizationId,
        projectId: targetMessage.projectId as ProjectId,
        workflowId: conversationWorkflowId,
        conversationId: targetMessage.conversationId as ConversationId,
        update: {
          parentMessageId: newMsg.id as MessageId,
        } as UpdateMessageDto,
      });

      // 6. Bump conversation version
      const newVersion = targetMessage.conversation.version + 1;
      await tx.conversation.update({
        where: {
          id: createMessageDto.conversationId,
          version: targetMessage.conversation.version,
        },
        data: { version: newVersion, updatedAt: new Date() },
      });

      // 7. Publish conversation.updated event
      await this.eventPublisher.publishInTransaction(tx, {
        type: EVENT_TYPES.CONVERSATION.UPDATED,
        aggregateId: createMessageDto.conversationId,
        payload: {
          payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
          organizationId,
          projectId,
          update: {
            expectedVersion: targetMessage.conversation.version,
            messageAdded: newMsg.id,
          },
          latestMessageId: newMsg.id,
          previousVersion: targetMessage.conversation.version,
          newVersion,
          changeType: 'message_prepended',
          workflowId: conversationWorkflowId,
          // Both SYSTEM and USER rows can carry a server-stamped
          // `triggersAgent`, so the elevated envelope fires for either author.
          triggersAgent: (
            createMessageDto.data as
              | SystemMessageData
              | UserMessageData
              | undefined
          )?.triggersAgent,
        },
      });

      return newMsg;
    });

    this.logger.log('[prependMessage] Message prepended successfully', {
      newMessageId: created.id,
      targetMessageId,
      conversationId: created.conversationId,
    });

    if (currentContext) {
      currentContext.workflowId = (created.conversation?.workflowId ??
        undefined) as WorkflowId | undefined;
    }

    return prismaMessageResultToResponseDto(
      created,
      (created.conversation?.workflowId ?? undefined) as WorkflowId,
    );
  }

  @WithEventContext('MessageService')
  async updateMessage(
    id: string,
    organizationId: OrganizationId,
    updateMessageDto: UpdateMessageDto,
    options: { source: string; suppressConversationEvent?: boolean },
  ): Promise<MessageResponseDto> {
    try {
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext && organizationId) {
        currentContext.organizationId = organizationId;
      }

      this.logger.log('Updating message with events', {
        messageId: id,
        source: options.source,
        correlationId: currentContext?.correlationId,
        organizationId,
        updateMessageDto,
      });

      const updated = await this.prisma.$transaction(async (tx) => {
        // First verify the message belongs to the organization
        const existingMessage = await tx.message.findFirst({
          where: {
            id,
            // CRITICAL: Validate organization access through conversation relationship
            conversation: {
              organizationId,
            },
          },
          select: {
            id: true,
            type: true,
            conversation: {
              select: {
                workflowAboutId: true,
                workflowAboutType: true,
                version: true,
              },
            },
          },
        });

        if (!existingMessage) {
          throw new NotFoundException(
            `Message with ID ${id} not found or access denied`,
          );
        }

        const shouldProcessMentions =
          existingMessage.type === 'SYSTEM' && updateMessageDto.data;

        const mentionTokens = shouldProcessMentions
          ? this.extractMentionTokensFromData('SYSTEM', updateMessageDto.data)
          : [];

        const validatedMentions = mentionTokens.length
          ? await this.validateMentions(mentionTokens, organizationId, tx)
          : [];

        const updateData: Prisma.MessageUpdateInput = {};

        if (updateMessageDto.status !== undefined) {
          updateData.status = updateMessageDto.status;
        }

        if (updateMessageDto.data !== undefined) {
          updateData.data =
            updateMessageDto.data === null
              ? Prisma.JsonNull
              : (updateMessageDto.data as unknown as Prisma.InputJsonValue);
        }

        const msg = await tx.message.update({
          where: { id },
          data: updateData,
          include: {
            responses: true,
            parentMessage: true,
            conversation: {
              select: {
                workflowId: true,
              },
            },
          },
        });

        const messageWorkflowId = (msg.conversation?.workflowId ??
          undefined) as WorkflowId | undefined;

        let addedMentionRecords: MentionRecord[] = [];
        let removedMentionRecords: MentionRecord[] = [];

        if (shouldProcessMentions) {
          // Snapshot prior mention rows before deletion so we can diff
          // prior-vs-new by entityId after createMany. Re-creating rows
          // mints fresh PKs that carry no semantic meaning to subscribers,
          // so the diff key is entityId.
          const priorMentions = await tx.messageMention.findMany({
            where: { messageId: id },
            select: { id: true, entityId: true, entityType: true },
          });

          await tx.messageMention.deleteMany({ where: { messageId: id } });

          const newMentionRecords: MentionRecord[] = validatedMentions.map(
            (mention) => ({
              id: uuidv4(),
              entityId: mention.entityId,
              entityType: mention.entityType,
            }),
          );

          if (newMentionRecords.length) {
            await tx.messageMention.createMany({
              data: newMentionRecords.map((mention) => ({
                id: mention.id,
                messageId: msg.id,
                conversationId: msg.conversationId,
                entityId: mention.entityId,
                entityType: mention.entityType,
              })),
            });
          }

          const priorIds = new Set(priorMentions.map((m) => m.entityId));
          const newIds = new Set(newMentionRecords.map((m) => m.entityId));

          addedMentionRecords = newMentionRecords.filter(
            (m) => !priorIds.has(m.entityId),
          );
          removedMentionRecords = priorMentions
            .filter((m) => !newIds.has(m.entityId))
            .map((m) => ({
              id: m.id,
              entityId: m.entityId,
              entityType: m.entityType as MessageMention['entityType'],
            }));
        }

        // Persist "message.updated" domain event in the same transaction
        await this.publishMessageUpdatedEvent(tx, {
          messageId: msg.id as MessageId,
          organizationId,
          projectId: msg.projectId as ProjectId,
          workflowId: messageWorkflowId,
          nodeId: (msg.data as unknown as SystemMessageData).nodeId,
          update: updateMessageDto,
          conversationId: msg.conversationId as ConversationId,
          inert: hasRagDisabled(msg.data),
        });

        if (shouldProcessMentions) {
          const mentionNodeId = (msg.data as unknown as SystemMessageData)
            .nodeId;
          await this.publishMentionCreatedEvents(tx, {
            mentions: addedMentionRecords,
            organizationId,
            projectId: msg.projectId as ProjectId,
            workflowId: messageWorkflowId,
            conversationId: msg.conversationId as ConversationId,
            messageId: msg.id as MessageId,
            workflowAboutId: existingMessage.conversation?.workflowAboutId,
            workflowAboutType: existingMessage.conversation?.workflowAboutType,
            nodeId: mentionNodeId,
          });

          await this.publishMentionRemovedEvents(tx, {
            mentions: removedMentionRecords,
            organizationId,
            projectId: msg.projectId as ProjectId,
            workflowId: messageWorkflowId,
            conversationId: msg.conversationId as ConversationId,
            messageId: msg.id as MessageId,
          });
        }

        if (!options.suppressConversationEvent) {
          const conversationVersion = existingMessage.conversation?.version;

          if (!conversationVersion) {
            throw new Error(`Conversation ${msg.conversationId} not found`);
          }

          const latestMessageId =
            (await this.resolveLatestMessageId(tx, msg.conversationId)) ??
            msg.id;

          await this.eventPublisher.publishInTransaction(tx, {
            type: EVENT_TYPES.CONVERSATION.UPDATED,
            aggregateId: msg.conversationId as ConversationId,
            payload: {
              payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
              organizationId,
              workflowId: messageWorkflowId,
              nodeId: (msg.data as unknown as SystemMessageData).nodeId,
              projectId: msg.projectId as ProjectId,
              update: {
                expectedVersion: existingMessage.conversation.version,
                messageUpdated: msg.id,
              },
              latestMessageId,
              previousVersion: existingMessage.conversation.version,
              newVersion: existingMessage.conversation.version,
            },
          });
        }

        return msg;
      });

      // Update context with fetched message data
      if (currentContext) {
        currentContext.projectId = updated.projectId as ProjectId;
        currentContext.workflowId = (updated.conversation?.workflowId ??
          undefined) as WorkflowId | undefined;
        currentContext.conversationId =
          updated.conversationId as ConversationId;
      }

      const messageResponseDto = prismaMessageResultToResponseDto(
        updated as unknown as MessageQueryResult,
        (updated.conversation?.workflowId ?? undefined) as WorkflowId,
      );

      this.logger.log('Message updated', {
        messageId: updated.id,
        conversationId: updated.conversationId,
        correlationId: currentContext?.correlationId,
      });

      return messageResponseDto;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update message', {
        error: (error as Error).message,
        messageId: id,
        updateMessageDto,
        organizationId,
        source: options.source,
      });
      throw new InternalServerErrorException(
        'Failed to update Message entry',
        error as Error,
      );
    }
  }

  /**
   * Shared method to update system message with LLM completion data
   * Used by both dev controller and real LLM completion flow
   */
  async updateSystemMessageWithLLMResponse({
    systemMessageData,
    organizationId,
    requestId,
    status,
  }: {
    systemMessageData: SystemMessageData;
    organizationId: OrganizationId;
    requestId: string;
    status: MessageStatus;
  }): Promise<void> {
    try {
      if (!requestId) {
        this.logger.error('No requestId in LLMCompleteEvent payload');
        return;
      }
      // Try to get message ID from pending messages (for job-based flow) or by requestId
      const messageId = await this.getPendingMessageByRequest(requestId);

      if (!messageId) {
        this.logger.warn(`No pending message found for request ${requestId}`);
        return;
      }

      this.logger.log('updating system message with LLM response', {
        systemMessageData,
        messageId,
        organizationId,
        requestId,
        status,
      });

      await this.updateMessage(
        messageId,
        organizationId,
        {
          status,
          data: systemMessageData,
        },
        {
          source: 'updateSystemMessageWithLLMResponse',
          suppressConversationEvent: false,
        },
      );

      // Initiative creation is now handled directly in flow nodes
      // See: shared_generate_initiatives.node.ts

      // NOTE: Workflow signaling is handled by FlowNodeProcessor.completeLLMNode()
      // which is called by CoreProcessor after this method completes.
      // This ensures consistent workflow signaling from a single source.

      const isQuestionData =
        typeof (systemMessageData as { type?: string }).type === 'string' &&
        isQuestionSystemMessageData(systemMessageData);

      this.logger.log(`Updated system message for LLM completion`, {
        requestId,
        messageId,
        status,
        hasQuestions:
          isQuestionData &&
          !!(
            systemMessageData as typeof systemMessageData & {
              uiElements?: unknown[];
            }
          ).uiElements?.length,
      });
    } catch (error) {
      this.logger.error(
        `Error updating system message with LLM response for request ${requestId}:`,
        error,
      );
      throw error;
    }
  }

  @WithEventContext('MessageService')
  async deleteMessage(
    messageId: MessageId,
    organizationId: OrganizationId,
    source: string,
  ): Promise<void> {
    try {
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext && organizationId) {
        currentContext.organizationId = organizationId;
      }

      this.logger.log('Deleting message with events', {
        messageId,
        source,
        correlationId: currentContext?.correlationId,
        organizationId,
      });

      await this.prisma.$transaction(async (tx) => {
        // First verify the message belongs to the organization
        const existingMessage = await tx.message.findFirst({
          where: {
            id: messageId,
            // CRITICAL: Validate organization access through conversation relationship
            conversation: {
              organizationId,
            },
          },
          select: {
            id: true,
            conversationId: true,
            projectId: true,
            conversation: {
              select: {
                workflowId: true,
              },
            },
          },
        });

        if (!existingMessage) {
          throw new NotFoundException(
            `Message with ID ${messageId} not found or access denied`,
          );
        }

        // Update context with message data before deletion
        if (currentContext) {
          currentContext.projectId = existingMessage.projectId as ProjectId;
          currentContext.workflowId = (existingMessage.conversation
            ?.workflowId ?? undefined) as WorkflowId | undefined;
          currentContext.conversationId =
            existingMessage.conversationId as ConversationId;
        }

        // Delete the message
        await tx.message.delete({
          where: { id: messageId },
        });

        // Persist "message.deleted" domain event in the same transaction
        await this.publishMessageDeletedEvent(tx, {
          messageId,
          organizationId,
          projectId: existingMessage.projectId as ProjectId,
          conversationId: existingMessage.conversationId as ConversationId,
          workflowId: (existingMessage.conversation?.workflowId ??
            undefined) as WorkflowId | undefined,
          deletedBy: source,
        });

        // Update conversation version atomically when message is deleted
        const updatedConversation = await tx.conversation.update({
          where: { id: existingMessage.conversationId },
          data: {
            version: { increment: 1 },
            updatedAt: new Date(),
          },
          select: { version: true, projectId: true },
        });

        const latestMessageId =
          (await this.resolveLatestMessageId(
            tx,
            existingMessage.conversationId,
          )) ?? messageId;

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.CONVERSATION.UPDATED,
          aggregateId: existingMessage.conversationId as ConversationId,
          payload: {
            payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
            organizationId,
            projectId: existingMessage.projectId as ProjectId,
            update: {
              expectedVersion: updatedConversation.version - 1,
              messageDeleted: messageId,
            },
            latestMessageId,
            previousVersion: updatedConversation.version - 1,
            newVersion: updatedConversation.version,
            changeType: 'message_deleted',
          },
        });
      });

      this.logger.log('Message deleted successfully', {
        messageId,
        correlationId: currentContext?.correlationId,
        organizationId,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete message', {
        error: (error as Error).message,
        messageId,
        organizationId,
        source,
      });
      throw new InternalServerErrorException(
        'Failed to delete Message entry',
        error as Error,
      );
    }
  }

  /**
   * Clone messages from one conversation to another up to a specific node
   * @param sourceConversationId - Source conversation to clone from
   * @param targetConversationId - Target conversation to clone to
   * @param targetNodeId - Node ID to clone up to (inclusive)
   * @param organizationId - Organization ID for security
   * @returns Number of messages cloned and ID mapping
   */
  async cloneMessagesForConversationWithOpenerHandling(
    sourceConversationId: ConversationId,
    targetConversationId: ConversationId,
    targetNodeId: string,
    organizationId: OrganizationId,
    existingOpenerMessageId: string | null,
  ): Promise<{
    messagesCloned: number;
    messageIdMap: Map<string, string>;
    nodeIds: string[];
  }> {
    try {
      // Fetch all messages from source conversation ordered by creation
      const sourceMessages = await this.prisma.db.message.findMany({
        where: {
          conversationId: sourceConversationId,
          ...TIMELINE_MESSAGE_WHERE,
          conversation: {
            organizationId,
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          conversation: {
            select: {
              projectId: true,
            },
          },
        },
      });

      if (sourceMessages.length === 0) {
        return {
          messagesCloned: 0,
          messageIdMap: new Map(),
          nodeIds: [],
        };
      }

      // Filter messages up to and including the target node
      // Skip the first message (opener) if target conversation already has an opener
      const messagesToClone: typeof sourceMessages = [];
      const nodeIds: string[] = [];
      let foundTargetNode = false;
      let startIndex = 0;

      // If target conversation has an opener, skip the first message from source
      if (existingOpenerMessageId) {
        startIndex = 1;
        this.logger.log(
          'Skipping source opener message due to existing opener',
          {
            sourceConversationId,
            targetConversationId,
            existingOpenerMessageId,
          },
        );
      }

      for (let i = startIndex; i < sourceMessages.length; i++) {
        const message = sourceMessages[i];
        if (!message) {
          continue;
        }

        messagesToClone.push(message);

        // Check if this message contains the target node ID and collect nodeIds
        if (message.type === 'SYSTEM' && message.data) {
          const messageData = message.data as SystemMessageData;
          if (messageData.nodeId) {
            nodeIds.push(messageData.nodeId);
          }
          if (messageData.nodeId === targetNodeId) {
            foundTargetNode = true;
            break; // Stop after finding the target node
          }
        }
      }

      if (!foundTargetNode) {
        throw new BadRequestException(
          `Target node ${targetNodeId} not found in conversation messages`,
        );
      }

      // Create ID mapping (old ID -> new ID) - BUILD COMPLETE MAP FIRST
      const messageIdMap = new Map<string, string>();

      // STEP 1: Generate new IDs for all messages that will be cloned
      for (const sourceMessage of messagesToClone) {
        const newMessageId = uuidv4();
        messageIdMap.set(sourceMessage.id, newMessageId);
      }

      // STEP 2: Clone messages in transaction with proper parent ID mapping
      await this.prisma.$transaction(async (tx) => {
        for (const sourceMessage of messagesToClone) {
          const newMessageId = messageIdMap.get(sourceMessage.id); // We know this exists

          // Map parent message ID with special handling for opener
          let newParentMessageId = null;
          if (sourceMessage.parentMessageId) {
            // If the parent was the source opener and we have an existing opener, use that
            const openerMessage = sourceMessages[0];
            if (
              startIndex === 1 &&
              openerMessage &&
              sourceMessage.parentMessageId === openerMessage.id
            ) {
              newParentMessageId = existingOpenerMessageId;
              this.logger.log('Mapped parent to existing opener', {
                sourceMessageId: sourceMessage.id,
                sourceParentId: sourceMessage.parentMessageId,
                newParentId: newParentMessageId,
              });
            } else {
              // Normal parent mapping within cloned messages
              newParentMessageId =
                messageIdMap.get(sourceMessage.parentMessageId) || null;
            }
          }

          // Create cloned message
          await tx.message.create({
            data: {
              id: newMessageId,
              conversationId: targetConversationId,
              projectId: sourceMessage.projectId,
              type: sourceMessage.type,
              data:
                sourceMessage.data === null
                  ? Prisma.JsonNull
                  : (sourceMessage.data as unknown as Prisma.InputJsonValue),
              status: sourceMessage.status,
              parentMessageId: newParentMessageId,
              userId: sourceMessage.userId,
            },
          });
        }
      });

      this.logger.log('Messages cloned successfully with opener handling', {
        sourceConversationId,
        targetConversationId,
        targetNodeId,
        messagesCloned: messagesToClone.length,
        skippedOpener: startIndex === 1,
        existingOpenerMessageId,
      });

      return {
        messagesCloned: messagesToClone.length,
        messageIdMap,
        nodeIds,
      };
    } catch (error) {
      this.logger.error('Failed to clone messages with opener handling', {
        error: (error as Error).message,
        sourceConversationId,
        targetConversationId,
        targetNodeId,
        existingOpenerMessageId,
      });
      throw error;
    }
  }

  async cloneMessagesForConversation(
    sourceConversationId: ConversationId,
    targetConversationId: ConversationId,
    targetNodeId: string,
    organizationId: OrganizationId,
  ): Promise<{
    messagesCloned: number;
    messageIdMap: Map<string, string>;
    nodeIds: string[];
  }> {
    try {
      // Fetch all messages from source conversation ordered by creation
      const sourceMessages = await this.prisma.db.message.findMany({
        where: {
          conversationId: sourceConversationId,
          ...TIMELINE_MESSAGE_WHERE,
          conversation: {
            organizationId,
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          conversation: {
            select: {
              projectId: true,
            },
          },
        },
      });

      if (sourceMessages.length === 0) {
        return {
          messagesCloned: 0,
          messageIdMap: new Map(),
          nodeIds: [],
        };
      }

      // Filter messages up to and including the target node
      const messagesToClone: typeof sourceMessages = [];
      const nodeIds: string[] = [];
      let foundTargetNode = false;

      for (let i = 0; i < sourceMessages.length; i++) {
        const message = sourceMessages[i];
        if (!message) {
          continue;
        }

        messagesToClone.push(message);

        // Check if this message contains the target node ID and collect nodeIds
        if (message.type === 'SYSTEM' && message.data) {
          const messageData = message.data as SystemMessageData;
          if (messageData.nodeId) {
            nodeIds.push(messageData.nodeId);
          }
          if (messageData.nodeId === targetNodeId) {
            foundTargetNode = true;
            break; // Stop after finding the target node
          }
        }
      }

      if (!foundTargetNode) {
        throw new BadRequestException(
          `Target node ${targetNodeId} not found in conversation messages`,
        );
      }

      // Create ID mapping (old ID -> new ID) - BUILD COMPLETE MAP FIRST
      const messageIdMap = new Map<string, string>();

      // STEP 1: Generate new IDs for all messages that will be cloned
      for (const sourceMessage of messagesToClone) {
        const newMessageId = uuidv4();
        messageIdMap.set(sourceMessage.id, newMessageId);
      }

      // STEP 2: Clone messages in transaction with proper parent ID mapping
      await this.prisma.$transaction(async (tx) => {
        for (const sourceMessage of messagesToClone) {
          const newMessageId = messageIdMap.get(sourceMessage.id); // We know this exists

          // Map parent message ID if it exists and the parent was also cloned
          let newParentMessageId = null;
          if (sourceMessage.parentMessageId) {
            newParentMessageId =
              messageIdMap.get(sourceMessage.parentMessageId) || null;
          }

          // Create cloned message
          await tx.message.create({
            data: {
              id: newMessageId,
              conversationId: targetConversationId,
              projectId: sourceMessage.projectId,
              type: sourceMessage.type,
              data:
                sourceMessage.data === null
                  ? Prisma.JsonNull
                  : (sourceMessage.data as unknown as Prisma.InputJsonValue),
              status: sourceMessage.status,
              parentMessageId: newParentMessageId,
              userId: sourceMessage.userId,
            },
          });
        }
      });

      this.logger.log('Messages cloned successfully', {
        sourceConversationId,
        targetConversationId,
        targetNodeId,
        messagesCloned: messagesToClone.length,
      });

      return {
        messagesCloned: messagesToClone.length,
        messageIdMap,
        nodeIds,
      };
    } catch (error) {
      this.logger.error('Failed to clone messages', {
        error: (error as Error).message,
        sourceConversationId,
        targetConversationId,
        targetNodeId,
      });
      throw error;
    }
  }

  /**
   * Delete the opener message from a conversation (used after workflow start)
   * @param conversationId - Conversation to delete opener from
   * @param organizationId - Organization ID for security
   */
  async deleteOpenerMessage(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<void> {
    try {
      // Find the first message in the conversation
      const openerMessage = await this.prisma.db.message.findFirst({
        where: {
          conversationId,
          ...TIMELINE_MESSAGE_WHERE,
          conversation: {
            organizationId,
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      if (openerMessage) {
        await this.deleteMessage(
          openerMessage.id,
          organizationId,
          'clone-cleanup',
        );

        this.logger.log('Opener message deleted', {
          conversationId,
          messageId: openerMessage.id,
        });
      }
    } catch (error) {
      this.logger.error('Failed to delete opener message', {
        error: (error as Error).message,
        conversationId,
      });
      // Don't throw - this is a cleanup operation
    }
  }

  /**
   * Get messages up to a specific node ID
   * @param conversationId - Conversation to query
   * @param targetNodeId - Node ID to query up to
   * @param organizationId - Organization ID for security
   * @returns Messages up to and including the target node
   */
  async getMessagesByNodeId(
    conversationId: ConversationId,
    targetNodeId: string,
    organizationId: OrganizationId,
  ): Promise<MessageQueryResult[]> {
    const messages = await this.prisma.db.message.findMany({
      where: {
        conversationId,
        ...TIMELINE_MESSAGE_WHERE,
        conversation: {
          organizationId,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        responses: true,
        parentMessage: true,
      },
    });

    const result: MessageQueryResult[] = [];
    for (const message of messages) {
      result.push(message as MessageQueryResult);

      // Check if we've reached the target node
      if (message.type === 'SYSTEM' && message.data) {
        const messageData = message.data as { nodeId?: string };
        if (messageData.nodeId === targetNodeId) {
          break;
        }
      }
    }

    return result;
  }

  private extractMentionTokensFromMessage(
    createMessageDto: CreateMessageInput,
  ): Array<{ entityId: string; entityType: string }> {
    return this.mentionProcessingService.extractMentionTokens(
      this.getMessageContentForMentions(createMessageDto),
    );
  }

  private getMessageContentForMentions(
    createMessageDto: CreateMessageInput,
  ): string | null {
    return getContentFromMessageData(
      createMessageDto.type,
      createMessageDto.data,
    );
  }

  private extractMentionTokensFromData(
    type: 'USER' | 'SYSTEM',
    data: MessageDataForContent | undefined,
  ): Array<{ entityId: string; entityType: string }> {
    return this.mentionProcessingService.extractMentionTokens(
      getContentFromMessageData(type, data),
    );
  }

  private async validateMentions(
    mentionTokens: Array<{ entityId: string; entityType: string }>,
    organizationId: OrganizationId,
    tx: Prisma.TransactionClient,
  ): Promise<Array<MessageMention>> {
    return this.mentionProcessingService.validateMentions(
      mentionTokens,
      organizationId,
      tx,
    );
  }
}
