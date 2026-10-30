import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  ConversationCreatedEventPayload,
  DesignDocCreatedEventPayload,
  MessageCreatedEventPayload,
  TaskCreatedEventPayload,
  PayloadType,
  SystemMessageData,
  UserMessageData,
  WorkflowName,
  InitiationType,
  ConversationStatus,
  MessageStatus,
  CreateSystemMessage,
  CreateUserMessage,
  EntityType,
  AgentSessionCreatedEventPayload,
  AgentSessionDto,
  ServiceCreatedEventPayload,
  ServiceDto,
  ProposalApprovedEventPayload,
  Influence,
} from '../../generated';
import {
  OrganizationId,
  ProjectId,
  UserId,
  ConversationId,
  MessageId,
  TaskId,
  AgentSessionId,
  ProposalId,
} from '../../types';
import { buildDesignDocEventDoc } from '../../utils/design-doc-event.util';
import {
  buildTaskEventContentSnapshotFromSections,
  toTaskSnapshot,
} from '../../utils/task-event.util';
import { WorkItemTypeKey } from '../tasks/work-item-type-keys';
import { TemplateCloneRemapper } from './template-clone-remapper';
import { getContentFromMessageData } from '../../utils/message-content.util';
import { buildMessageCreatedEventPayload } from '../../utils/message-event.util';
import { extractMentions } from '../../utils/mentionFormatting';
import { normalizeMentionTypeAlias } from '../mentions/mention-type-aliases';
import { MentionCreatedEventPayload } from '../../generated';

export async function publishCloneCreatedEvents(
  tx: Prisma.TransactionClient,
  events: DomainEventPublisher,
  target: { id: string; organizationId: string },
  remap: TemplateCloneRemapper,
  source: {
    tasks: Array<Record<string, unknown>>;
    docs: Array<Record<string, unknown>>;
    conversations: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    proposals: Array<Record<string, unknown>>;
    services: Array<Record<string, unknown>>;
    types: Array<Record<string, unknown>>;
    sessions: Array<Record<string, unknown>>;
  },
): Promise<void> {
  const context = {
    organizationId: target.organizationId as OrganizationId,
    projectId: target.id as ProjectId,
  };
  const mentionEvents = async (
    sourceEntityId: string,
    sourceEntityType: MentionCreatedEventPayload.SourceEntityTypeEnum,
    content: string,
    conversationId?: ConversationId,
  ) => {
    const seen = new Set<string>();
    for (const mention of extractMentions(content)) {
      if (seen.has(mention.entityId)) continue;
      seen.add(mention.entityId);
      const entityType = normalizeMentionTypeAlias(mention.entityType)
        .replace(/-/g, '_')
        .toUpperCase();
      // Matches the existing mention boundary's supported domain entity types.
      if (
        !Object.values(MentionCreatedEventPayload.EntityTypeEnum).includes(
          entityType as MentionCreatedEventPayload.EntityTypeEnum,
        )
      )
        continue;
      const payload = {
        ...context,
        payloadType: PayloadType.MentionCreated,
        sourceEntityId,
        sourceEntityType,
        entityId: mention.entityId,
        entityType: entityType as MentionCreatedEventPayload.EntityTypeEnum,
        conversationId,
        messageId:
          sourceEntityType === 'MESSAGE'
            ? (sourceEntityId as MessageId)
            : undefined,
      } satisfies MentionCreatedEventPayload;
      await events.publishInTransaction(tx, {
        type: 'mention.created',
        aggregateId: randomUUID(),
        payload,
      });
    }
  };
  for (const row of source.services) {
    const service = await tx.service.findUniqueOrThrow({
      where: { id: remap.require(row.id as string) },
    });
    const payload = {
      ...context,
      payloadType: PayloadType.ServiceCreated,
      service: {
        id: service.id,
        name: service.name,
        description: service.description ?? undefined,
        organizationId: service.organizationId,
        projectId: service.projectId ?? undefined,
        repositoryUrl: service.repositoryUrl ?? undefined,
        repositoryId: service.repositoryId ?? undefined,
        repositoryType: service.repositoryType as
          | ServiceDto.RepositoryTypeEnum
          | undefined,
        serviceType: service.serviceType as
          | ServiceDto.ServiceTypeEnum
          | undefined,
        language: service.language ?? undefined,
        framework: service.framework ?? undefined,
        tags: service.tags,
        status: service.status as ServiceDto.StatusEnum,
        createdAt: service.createdAt.toISOString(),
        updatedAt: service.updatedAt.toISOString(),
      },
    } satisfies ServiceCreatedEventPayload;
    await events.publishInTransaction(tx, {
      type: 'service.created',
      aggregateId: service.id,
      payload,
    });
  }
  for (const row of source.sessions) {
    const session = await tx.agentSession.findUniqueOrThrow({
      where: { id: remap.require(row.id as string) },
    });
    const agentSession = {
      id: session.id,
      projectId: session.projectId as ProjectId,
      organizationId: session.organizationId,
      userId: session.userId,
      status: session.status,
      currentState: 'IDLE',
      conversationId: session.conversationId,
      title: session.title,
      type: session.type,
      entityId: session.entityId ?? undefined,
      entityType: session.entityType as AgentSessionDto['entityType'],
      serviceIds: session.serviceId ? [session.serviceId] : [],
      sessionDate: session.sessionDate.toISOString(),
      hasUnsyncedChanges: session.hasUnsyncedChanges,
      monitoringEnabled: session.monitoringEnabled,
      autoDecide: session.autoDecide,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    } satisfies AgentSessionDto;
    const payload = {
      ...context,
      payloadType: PayloadType.AgentSessionCreated,
      conversationId: session.conversationId as ConversationId | null,
      serviceId: session.serviceId ?? undefined,
      agentSession,
    } satisfies AgentSessionCreatedEventPayload;
    await events.publishInTransaction(tx, {
      type: 'agent_session.created',
      aggregateId: session.id as AgentSessionId,
      payload,
    });
  }
  // Approval is the canonical proposal lifecycle event. Draft/rejected proposals
  // have no ordinary created event and remain ordinary persisted review records.
  for (const row of source.proposals) {
    const proposal = await tx.proposal.findUniqueOrThrow({
      where: { id: remap.require(row.id as string) },
    });
    if (proposal.status !== 'APPROVED') continue;
    const payload = {
      ...context,
      payloadType: PayloadType.ProposalApproved,
      shouldProcess: false,
      proposalId: proposal.id as ProposalId,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
      action: proposal.action,
      requestorId: proposal.requestorId as UserId,
      influences: (proposal.influences ?? undefined) as Influence[] | undefined,
      conversationId: (proposal.conversationId ?? undefined) as
        | ConversationId
        | undefined,
      messageId: (proposal.messageId ?? undefined) as MessageId | undefined,
      resultingEntityId: proposal.targetEntityId,
      createdAt: proposal.createdAt.toISOString(),
    } satisfies ProposalApprovedEventPayload;
    await events.publishInTransaction(tx, {
      type: 'proposal.approved',
      aggregateId: proposal.id as ProposalId,
      payload,
    });
  }
  for (const row of source.tasks) {
    const task = await tx.task.findUniqueOrThrow({
      where: { id: remap.require(row.id as string) },
      include: { sections: true },
    });
    const payload = {
      ...context,
      payloadType: PayloadType.TaskCreated,
      task: toTaskSnapshot(
        { ...task, type: task.type as WorkItemTypeKey },
        buildTaskEventContentSnapshotFromSections(
          task.type as WorkItemTypeKey,
          task.sections,
          task.tag,
        ),
      ),
    } satisfies TaskCreatedEventPayload;
    await events.publishInTransaction(tx, {
      type: 'task.created',
      aggregateId: task.id as TaskId,
      payload,
    });
    await mentionEvents(
      task.id,
      'TASK',
      task.sections
        .map((section) => section.materializedMarkdown ?? '')
        .join('\n'),
    );
  }
  for (const row of source.docs) {
    const doc = await tx.designDoc.findUniqueOrThrow({
      where: { id: remap.require(row.id as string) },
      include: { sections: true },
    });
    const payload = {
      ...context,
      payloadType: PayloadType.DesignDocCreated,
      designDoc: buildDesignDocEventDoc(doc),
    } satisfies DesignDocCreatedEventPayload;
    await events.publishInTransaction(tx, {
      type: 'design_doc.created',
      aggregateId: doc.id,
      payload,
    });
    await mentionEvents(
      doc.id,
      'DESIGN_DOC',
      doc.sections
        .map((section) => section.materializedMarkdown ?? '')
        .join('\n'),
    );
  }
  for (const row of source.conversations) {
    const conversation = await tx.conversation.findUniqueOrThrow({
      where: { id: remap.require(row.id as string) },
    });
    if (!conversation.workflowName)
      throw new Error('Template conversation has no workflow name');
    const payload = {
      ...context,
      payloadType: PayloadType.ConversationCreated,
      conversationId: conversation.id as ConversationId,
      workflowName: conversation.workflowName as WorkflowName,
      workflowAboutId: conversation.workflowAboutId ?? undefined,
      workflowAboutType: conversation.workflowAboutType ?? undefined,
      conversationTitle: conversation.title ?? undefined,
      initiatedBy: conversation.initiatedBy as InitiationType,
      status: conversation.status as ConversationStatus,
    } satisfies ConversationCreatedEventPayload;
    await events.publishInTransaction(tx, {
      type: 'conversation.created',
      aggregateId: conversation.id as ConversationId,
      payload,
    });
  }
  for (const row of source.messages) {
    const message = await tx.message.findUniqueOrThrow({
      where: { id: remap.require(row.id as string) },
    });
    const base = {
      projectId: target.id as ProjectId,
      conversationId: message.conversationId as ConversationId,
      status: message.status as MessageStatus,
      userId: message.userId,
      parentMessageId: message.parentMessageId as MessageId | null,
      createdAt: message.createdAt?.toISOString(),
    };
    const input: CreateUserMessage | CreateSystemMessage =
      message.type === 'USER'
        ? {
            ...base,
            type: 'USER',
            data: message.data as unknown as UserMessageData,
          }
        : {
            ...base,
            type: 'SYSTEM',
            data: message.data as unknown as SystemMessageData,
          };
    const parent = message.parentMessageId
      ? await tx.message.findUniqueOrThrow({
          where: { id: message.parentMessageId },
        })
      : null;
    const mentions = await tx.messageMention.findMany({
      where: { messageId: message.id },
    });
    const payload: MessageCreatedEventPayload = buildMessageCreatedEventPayload(
      {
        ...context,
        conversationId: message.conversationId as ConversationId,
        message: input,
        parentMessage: parent
          ? {
              id: parent.id as MessageId,
              type: parent.type,
              data: parent.data as unknown as
                | UserMessageData
                | SystemMessageData,
            }
          : null,
        mentions: mentions.map((mention) => ({
          entityId: mention.entityId,
          entityType: mention.entityType as EntityType,
        })),
      },
    );
    payload.messageId = message.id as MessageId;
    payload.message.userMessage =
      getContentFromMessageData(
        message.type,
        message.data as unknown as UserMessageData | SystemMessageData,
      ) ?? payload.message.userMessage;
    delete payload.triggersAgent;
    delete payload.completesExternalAgentNode;
    delete payload.triggerNotification;
    // A clone is projection input, never executable agent input.
    await events.publishInTransaction(
      tx,
      {
        type: 'message.created',
        aggregateId: message.id as MessageId,
        payload,
      },
      {},
      { headers: { templateClone: true } },
    );
    await mentionEvents(
      message.id,
      'MESSAGE',
      JSON.stringify(message.data),
      message.conversationId as ConversationId,
    );
  }
}
